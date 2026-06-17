import { serve } from "bun";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn, execSync } from "child_process";
import { z } from "zod";

import { ExtractionOrchestrator } from "../extraction/orchestrator.ts";
import { extractionQueue } from "./extraction-queue.ts";
import { ChatEngine } from "../chat/chat-engine.ts";
import { OutlineGenerator } from "../chat/outline-generator.ts";
import { generateSavingsPpt } from "../generation/pptx-generator.ts";
import { CompositionEngine } from "../generation/composition-engine.ts";
import { renderSalesDeckWithMarp } from "../generation/marp-renderer.ts";
import { MultiAgentPipeline } from "../pipeline/orchestrator.ts";
import { expectedCompanyIdForProduct, matchCompanyKnowledge } from "../config/company-kb.ts";
import { mapSavingsMetrics } from "../savings/savings-mapper.ts";
import { validateSavingsMetrics } from "../savings/savings-validator.ts";
import { normalizeSavingsPlan } from "../savings/savings-normalizer.ts";
import { FormalDeckValidationError, validateFormalSavingsPlan } from "../savings/formal-deck-validator.ts";
import { COMPANY_SKINS, TEMPLATE_PRESETS, resolveCompanySkin, resolveTemplatePreset } from "../config/render-presets.ts";
import { listTemplateAssets } from "../config/template-assets.ts";
import type { SavingsPlanExtraction } from "../schemas/savings-plan.ts";
import type { CiPlanExtraction } from "../schemas/critical-illness.ts";
import type { IulExtraction } from "../schemas/iul.ts";
import { SavingsPlanExtractionSchema } from "../schemas/savings-plan.ts";
import { CiPlanExtractionSchema } from "../schemas/critical-illness.ts";
import { IulExtractionSchema } from "../schemas/iul.ts";
import { FileSessionStore, type Session, type SessionStatus } from "../storage/session-store.ts";
import { normalizeCiPlan } from "../ci/ci-normalizer.ts";
import { validateFormalCiPlan } from "../ci/formal-ci-validator.ts";
import { normalizeIulPlan } from "../iul/iul-normalizer.ts";
import { validateFormalIulPlan } from "../iul/formal-iul-validator.ts";
import { planBundle, type NormalizedProductPlan } from "../bundles/bundle-planner.ts";
import { loadTemplateCatalog } from "../config/template-catalog.ts";
import { generatePresentationArtifact } from "./generation-service.ts";
import {
  hasCiCloneRenderer,
  hasIulCloneRenderer,
  hasSavingsCloneRenderer,
  listCiCloneRendererIds,
  listIulCloneRendererIds,
  listSavingsCloneRendererIds,
} from "../templates/clone-renderer-registry.ts";
import { buildSignedDownloadUrl, verifyDownloadSignature } from "./download-auth.ts";
import { requireSelectedCompany } from "./company-selection.ts";
import { buildExportReadinessMatrix } from "../config/export-readiness.ts";
import { canAccessSessionOwner, ownerIdFromHeader, safeOwnerId } from "./session-access.ts";
import { generateDeckPreviews } from "./preview-assets.ts";

// Union schema for dynamic PlanData access
const PlanDataUnion = SavingsPlanExtractionSchema
  .merge(CiPlanExtractionSchema.omit({ insured: true, policy: true }))
  .merge(IulExtractionSchema.omit({ insured: true, policy: true }))
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));
type PlanDataUnion = z.infer<typeof PlanDataUnion>;

// ─── Security: API Key Auth ──────────────────────────
const ACCESS_API_KEY = process.env.APP_API_KEY || "";

// ─── 自动加载 .env (若存在) ──────────────────────────
try {
  const fs = await import("fs");
  const path = await import("path");
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    console.log(`[env] 已从 .env 加载 ${envPath}`);
  }
} catch (e) {
  // 静默
}

// ─── AI Provider 配置 ─────────────────────────────────
// 优先级: 用户 header X-User-Api-Key > 服务端环境变量
// 默认 provider: kimi (Kimi Coding Plan, Anthropic Messages-compatible), DeepSeek 仅保留 fallback
const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || "kimi") as "kimi" | "deepseek" | "openai" | "gemini" | "minimax";
const KIMI_API_KEY = process.env.KIMI_API_KEY || "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const API_KEY = KIMI_API_KEY || DEEPSEEK_API_KEY || GEMINI_API_KEY || MINIMAX_API_KEY;

function requireApiKey(req: Request): Response | null {
  // APP_API_KEY 未配置时，默认开放（本地开发）
  if (!ACCESS_API_KEY) return null;
  const key = req.headers.get("X-API-Key");
  if (key !== ACCESS_API_KEY) return json({ error: "Unauthorized" }, 401);
  return null;
}

function ownerId(req: Request): string {
  return ownerIdFromHeader(req.headers.get("X-User-Id"));
}

// ─── Security: Simple Rate Limiter ──────────────────
interface RateLimitEntry { count: number; resetAt: number; }
const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT = 30; // requests
const RATE_WINDOW = 60_000; // per minute

function rateLimit(ip: string): Response | null {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return null;
  }
  if (entry.count >= RATE_LIMIT) return json({ error: "Rate limit exceeded" }, 429);
  entry.count++;
  return null;
}

// ─── Cleanup stale rate limit entries every 5 min ───
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetAt) rateLimitMap.delete(k);
  }
}, 5 * 60_000);

// ─── Session State Machine ───────────────────────────
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  created: ["parsing", "parsed", "error"],
  parsing: ["parsed", "error"],
  parsed: ["chatting", "generating", "parsed", "error"],
  chatting: ["chatting", "generating", "parsed", "error"],
  generating: ["done", "error"],
  done: ["generating", "parsed"],
  error: ["parsing", "generating", "parsed"],
};

function transition(session: Session, nextStatus: SessionStatus): boolean {
  const current = (session.status as SessionStatus) || "created";
  if (VALID_TRANSITIONS[current]?.includes(nextStatus)) {
    session.status = nextStatus;
    return true;
  }
  console.warn(`[StateMachine] Invalid transition: ${current} → ${nextStatus}`);
  return false;
}

const PORT = parseInt(process.env.PORT || "3000");
// 注: API_KEY 在 line 84 已定义 (含 DeepSeek 优先), 这里不再重复

const COMPANY_BRAND_PROFILES: Record<string, any> = {
  aia: { name_zh: "友邦保险", name_en: "AIA", short: "友邦保险", short_en: "AIA", rating: "S&P AA-", founded_year: "1931", rating_value: "AA-", series_label: "环宇盈活", series_sub: "环球财富管理专家", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 重疾/医疗","· 财富传承 — 万用寿险","· 强积金 — 企业保障"], brand_background: ["· 亚洲最大独立上市人寿集团","· 业务覆盖亚太区18个市场","· 服务超3800万客户"] },
  axa: { name_zh: "安盛", name_en: "AXA", short: "安盛", short_en: "AXA", rating: "S&P A+", founded_year: "1816", rating_value: "A+", series_label: "盛利II", series_sub: "储蓄保险至尊", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 财产保险 — 车险/家财险","· 资产管理 — 全球投资"], brand_background: ["· 法国安盛集团 (AXA)","· 1816年创立","· 全球最大保险集团之一","· 管理资产超1万亿欧元"] },
  generali: { name_zh: "忠意保险", name_en: "Generali", short: "忠意保险", short_en: "GEN", rating: "A.M. Best A", founded_year: "1831", rating_value: "A", series_label: "啟航創富", series_sub: "卓越版", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 家族办公室 — 高端财富传承","· 多元货币分红储蓄险","· 精品健康保障与风险管理"], brand_background: ["· 意大利忠意集团 (Assicurazioni Generali)","· 1831年创立于意大利的里雅斯特","· 意大利第一大保险公司 · 世界500强","· 业务覆盖50+国家 · 服务数千万客户","· 贝氏A / 惠誉A+ / 穆迪A1 权威评级","· 管理资产规模达数千亿欧元"] },
  boclife: { name_zh: "中银人寿", name_en: "BOC Life", short: "中银人寿", short_en: "BOC", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  chinaTaiping: { name_zh: "中国太平", name_en: "China Taiping", short: "中国太平", short_en: "CHINA TP", rating: "央企", founded_year: "1929", rating_value: "A", series_label: "頤年樂享", series_sub: "财富传承与保障", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/重疾","· 财富传承 — 年金/储蓄","· 养老保险 — 退休规划"], brand_background: ["· 中国太平保险集团","· 1929年创立于上海","· 副部级金融央企","· 管理总资产超2.5万亿"] },
  "china-taiping": { name_zh: "中国太平", name_en: "China Taiping", short: "中国太平", short_en: "CHINA TP", rating: "央企", founded_year: "1929", rating_value: "A", series_label: "頤年樂享", series_sub: "财富传承与保障", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/重疾","· 财富传承 — 年金/储蓄","· 养老保险 — 退休规划"], brand_background: ["· 中国太平保险集团","· 1929年创立于上海","· 副部级金融央企","· 管理总资产超2.5万亿"] },
  chinalife: { name_zh: "中国人寿", name_en: "China Life", short: "中国人寿", short_en: "CLIFE", rating: "S&P A+", founded_year: "1949", rating_value: "A+", series_label: "傲瓏盛世", series_sub: "财富增值与传承", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 财富传承 — 年金/储蓄","· 资产管理 — 国寿资管"], brand_background: ["· 中国人寿保险集团","· 副部级央企","· 三地上市(A+H+美股ADR)","· 管理资产超5万亿"] },
  chubb: { name_zh: "安达人寿", name_en: "Chubb", short: "安达人寿", short_en: "CHUBB", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  cpic: { name_zh: "太平洋保险", name_en: "CPIC", short: "太平洋保险", short_en: "CPIC", rating: "S&P A", founded_year: "1991", rating_value: "A", series_label: "世代悅享", series_sub: "财富传承专家", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/重疾","· 财富传承 — 世代系列","· 资产管理 — 太保资管"], brand_background: ["· 中国太平洋保险集团","· A股+H股上市","· 业务覆盖全国","· 管理资产超万亿"] },
  ctf: { name_zh: "周大福人寿", name_en: "CTF Life", short: "周大福人寿", short_en: "CTF", rating: "A.M. Best a-", founded_year: "1985", rating_value: "a-", series_label: "匠心传承", series_sub: "财富传承专家", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 重疾/医疗","· 财富传承 — 匠心系列","· 强积金 — 企业保障"], brand_background: ["· 周大福集团旗下","· 郑氏家族控股","· 立足香港近40年"] },
  fwd: { name_zh: "富卫", name_en: "FWD", short: "富卫", short_en: "FWD", rating: "Fitch A", founded_year: "2013", rating_value: "A", series_label: "盈聚天下", series_sub: "环球财富管理方案", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 财富传承 — 盈聚系列","· 退休规划 — 年金/财富管理"], brand_background: ["· 盈科拓展集团旗下","· 业务覆盖亚洲10个市场","· 致力保险创新"] },
  manulife: { name_zh: "新加坡宏利", name_en: "Manulife Singapore", short: "宏利", short_en: "MANULIFE", rating: "S&P AA-", founded_year: "1887", rating_value: "AA-", series_label: "宏挚传承", series_sub: "财富传承专家", business_lines: ["· 投资相连险(ILPs) — 环球顶级基金直通","· 全生命周期退休年金 — DBS独家银保","· 万能寿险 — 大额身故保障与保单融资","· 家族办公室与信托统筹方案"], brand_background: ["· 母公司宏利金融创立于1887年（加拿大）","· S&P AA- / Moody's A1","· 1898年签发新加坡首张保单","· 新加坡D-SII系统重要性寿险公司","· 与DBS星展银行独家长期银保合作","· 新加坡三大零售寿险巨头之一"] },
  fubon: { name_zh: "富邦人寿", name_en: "Fubon", short: "富邦人寿", short_en: "FUBON", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  greatEastern: { name_zh: "大东方人寿", name_en: "Great Eastern", short: "大东方人寿", short_en: "GE", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  hsbclife: { name_zh: "汇丰人寿", name_en: "HSBC Life", short: "汇丰人寿", short_en: "HSBC", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  pru: { name_zh: "保诚", name_en: "Prudential", short: "保诚", short_en: "PRU", rating: "S&P A", founded_year: "1848", rating_value: "A", series_label: "信守明天", series_sub: "多元货币财富管理", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 多元货币 — 9种货币转换","· 财富传承 — 保单拆分"], brand_background: ["· 英国保诚集团","· 1848年创立","· 伦敦/香港/新加坡三地上市","· 全球管理资产超6000亿英镑"] },
  sunlife: { name_zh: "新加坡永明", name_en: "Sun Life Singapore", short: "永明", short_en: "SLIFE", rating: "S&P AA", founded_year: "1865", rating_value: "AA", series_label: "卓势传承", series_sub: "顶尖资产保全与传承", business_lines: ["· 高端指数万能险 — 卓势传承IUL系列","· 多元货币储蓄 — 美元/新币资产配置","· 家族财富代际流转 — 家族办公室方案","· 全球资管 — 永明金融全球资产统筹"], brand_background: ["· 母公司加拿大永明金融创立于1865年","· S&P AA / A.M. Best A+ / Moody's Aa3 顶尖评级","· 2020年进驻新加坡财富管理市场","· 迅速打通全球顶尖IFA及私人银行渠道"] },
  tplife: { name_zh: "太平人寿", name_en: "TP Life", short: "太平人寿", short_en: "TPLIFE", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  transamerica: { name_zh: "全美海外（新加坡）", name_en: "Transamerica Life Bermuda", short: "全美人寿", short_en: "TA", rating: "S&P A+", founded_year: "1904", rating_value: "A+", series_label: "GIUL 3", series_sub: "大额指数万能险", business_lines: ["· 指数型万能寿险 — GIUL 3代系列","· 海外信托与保单统筹 — 资产隔离与税务合规","· 万能寿险 — 大额趸交/灵活缴费","· 保单融资与贴现 — 私人银行流动性方案"], brand_background: ["· 全美人寿总公司创立于1904年（旧金山）","· 隶属荷兰全球人寿保险集团（Aegon N.V.）","· S&P A+ / Moody's A1","· 新加坡MAS全牌照寿险公司","· 亚洲大额人寿保单鼻祖"] },
  wll: { name_zh: "立桥人寿", name_en: "WLL", short: "立桥人寿", short_en: "WLL", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
  yflife: { name_zh: "万通保险", name_en: "YF Life", short: "万通保险", short_en: "YFLIFE", rating: "Fitch A-", founded_year: "1975", rating_value: "A-", series_label: "富饒萬家", series_sub: "更懂投资的保险公司", business_lines: ["· 人寿保险 — 储蓄/保障","· 健康保险 — 医疗/危疾","· 财富传承 — 年金/储蓄","· 强积金 — MPF管理"], brand_background: ["· 云锋金融控股(60%)+美国万通(25%)","· 穆迪A3 / 惠誉A- 评级","· 扎根香港50年","· 管理资产超850亿港元"] },
  zurich: { name_zh: "苏黎世", name_en: "Zurich", short: "苏黎世", short_en: "ZURICH", rating: "", founded_year: "", rating_value: "", series_label: "", business_lines: [], brand_background: [] },
};

const ROOT = path.resolve(import.meta.dir, "../../");
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const SESSION_DIR = path.join(ROOT, "sessions");
const DOWNLOAD_DIR = path.join(PUBLIC_DIR, "downloads");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 30 * 1024 * 1024);
const DOWNLOAD_SIGNING_SECRET = process.env.DOWNLOAD_SIGNING_SECRET || "";

for (const dir of [UPLOAD_DIR, SESSION_DIR, DOWNLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ownerUploadDir(owner: string): string {
  const dir = path.join(UPLOAD_DIR, safeOwnerId(owner));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ownerDownloadDir(owner: string): string {
  const dir = path.join(DOWNLOAD_DIR, safeOwnerId(owner));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Session Store ───────────────────────────────────
type PlanDataType = SavingsPlanExtraction | CiPlanExtraction | IulExtraction;
const sessions = new FileSessionStore(SESSION_DIR, 100, (sessionId) => {
  try {
    for (const ownerDirName of fs.readdirSync(UPLOAD_DIR)) {
      const ownerDir = path.join(UPLOAD_DIR, ownerDirName);
      if (!fs.existsSync(ownerDir) || !fs.statSync(ownerDir).isDirectory()) continue;
      for (const file of fs.readdirSync(ownerDir)) {
        if (file.startsWith(`${sessionId}_`)) fs.unlinkSync(path.join(ownerDir, file));
      }
    }
  } catch {}
  try {
    for (const ownerDirName of fs.readdirSync(DOWNLOAD_DIR)) {
      const ownerDir = path.join(DOWNLOAD_DIR, ownerDirName);
      if (!fs.existsSync(ownerDir) || !fs.statSync(ownerDir).isDirectory()) continue;
      for (const file of fs.readdirSync(ownerDir)) {
        if (file.startsWith(`${sessionId}_`)) fs.unlinkSync(path.join(ownerDir, file));
      }
    }
  } catch {}
  console.log(`[LRU] Evicted session ${sessionId}`);
});

function saveSession(s: Session) {
  sessions.save(s);
}
function loadSession(id: string): Session | undefined {
  return sessions.load(id);
}
function genId() { return crypto.randomUUID(); }

function safeFilename(filename: string): string {
  return path.basename(filename).replace(/[^\p{L}\p{N}._() -]/gu, "_");
}

function canAccess(req: Request, session: Session): boolean {
  return canAccessSessionOwner(ownerId(req), session.ownerId);
}

function signedDownloadUrl(relativePath: string): string {
  return buildSignedDownloadUrl({ relativePath, signingSecret: DOWNLOAD_SIGNING_SECRET });
}

function hydrateSessionPreviews(session: Session): void {
  if (!session.pptPath || session.previewPaths?.length) return;
  const currentOwner = safeOwnerId(session.ownerId || "local");
  const absolutePpt = path.join(DOWNLOAD_DIR, session.pptPath);
  if (!fs.existsSync(absolutePpt)) return;
  try {
    const preview = generateDeckPreviews({
      sourcePath: absolutePpt,
      ownerDownloadDir: ownerDownloadDir(currentOwner),
      relativePrefix: `${session.id}_preview`,
    });
    session.previewPaths = preview.previewRelativePaths.map((p) => path.join(currentOwner, p));
    session.previewPdfPath = preview.previewPdfRelativePath ? path.join(currentOwner, preview.previewPdfRelativePath) : undefined;
    session.slideCount = preview.slideCount;
    saveSession(session);
  } catch (error) {
    console.warn("Lazy preview hydration failed:", error);
  }
}

function validDownloadSignature(relativePath: string, url: URL): boolean {
  return verifyDownloadSignature({
    relativePath,
    signingSecret: DOWNLOAD_SIGNING_SECRET,
    expires: Number(url.searchParams.get("expires") || 0),
    token: url.searchParams.get("token") || "",
  });
}

async function handleFormalGenerate(params: {
  req: Request;
  session: Session;
  style?: string;
  companyInfo?: string;
  format?: string;
  quality?: string;
  companyId?: string;
  templateId?: string;
}) {
  const { req, session } = params;
  const style = params.style || "default";
  const companyInfo = params.companyInfo;
  const format = params.format || "pptx";
  const quality = params.quality || "standard";
  const templateId = params.templateId;
  const validExtractions = session.extractions.filter((e) => e.data);
  if (!validExtractions.length) return json({ error: "No parsed data" }, 400);

  let effectiveCompanyId = params.companyId;
  if (!effectiveCompanyId) {
    const savingsData = validExtractions.find((e) => e.planType === "savings")?.data as any;
    const ciData = validExtractions.find((e) => e.planType === "ci")?.data as any;
    const iulData = validExtractions.find((e) => e.planType === "iul")?.data as any;
    const productName = savingsData?.product_name || ciData?.product_name || iulData?.product_name || "";
    const inferred = expectedCompanyIdForProduct(productName);
    if (inferred) {
      effectiveCompanyId = inferred;
    } else {
      const firstMeta = validExtractions.find((e) => (e.data as any)?._meta?.signatureId);
      const sigId = (firstMeta?.data as any)?._meta?.signatureId || "";
      const m = sigId.match(/^([a-z]+)-/);
      if (m) effectiveCompanyId = m[1];
    }
  }

  const outFormat: "pptx" | "pdf" = format === "pdf" ? "pdf" : "pptx";
  const stylePreset = resolveTemplatePreset(templateId || style);

  transition(session, "generating");
  saveSession(session);

  const currentOwner = ownerId(req);
  const fn = `${session.id}_综合方案.${outFormat}`;
  const relativePptPath = path.join(safeOwnerId(currentOwner), fn);
  const pptPath = path.join(ownerDownloadDir(currentOwner), fn);
  const mdFn = `${session.id}_综合方案.marp.md`;
  const relativeMdPath = path.join(safeOwnerId(currentOwner), mdFn);
  const mdPath = path.join(ownerDownloadDir(currentOwner), mdFn);

  try {
    const savingsData = validExtractions.find((e) => e.planType === "savings")?.data as any;
    const savingsMetrics = savingsData ? mapSavingsMetrics(savingsData) : undefined;
    if (savingsMetrics) {
      const issues = validateSavingsMetrics(savingsMetrics).filter((x) => x.level === "error");
      if (issues.length) {
        return json({ error: "储蓄险关键字段校验失败", issues }, 400);
      }
    }
    const uiCompany = requireSelectedCompany(effectiveCompanyId);
    const expectedCompanyId = expectedCompanyIdForProduct(savingsMetrics?.productName || savingsData?.product_name || "");
    if (expectedCompanyId && expectedCompanyId !== uiCompany.id) {
      return json({
        error: "COMPANY_PRODUCT_MISMATCH",
        expectedCompanyId,
        selectedCompanyId: uiCompany.id,
        message: "当前产品与所选公司不一致，已阻断正式导出。",
      }, 400);
    }
    const companyMatch = matchCompanyKnowledge({
      productName: savingsMetrics?.productName || savingsData?.product_name || "",
      companyHint: String(companyInfo || ""),
      forcedCompanyId: uiCompany.id,
    });
    if (!companyMatch.evidenceFiles.length) {
      return json({ error: "公司资料公开证据为空，已阻断正式导出。请补充公司介绍资料后重试。" }, 400);
    }
    const target = await generatePresentationArtifact({
      session,
      ownerId: session.ownerId,
      companyId: uiCompany.id,
      companyName: uiCompany.name,
      companyRating: undefined,
      companyEvidence: companyMatch.evidenceFiles.map((file) => ({
        text: path.basename(file),
        sourceFile: file,
      })),
      style,
      stylePreset,
      quality: quality === "high" ? "high" : "standard",
      outputFormat: outFormat,
      templateId,
      companyContext: {
        ...companyMatch,
        companyId: uiCompany.id,
        companyName: uiCompany.name,
      },
      savingsMetrics,
      customerName: validExtractions[0]?.data?.insured?.name || "尊貴客戶",
      userId: session.ownerId,
      outputStem: `${session.id}_api`,
      targets: { pptPath, markdownPath: mdPath, pdfPath: outFormat === "pdf" ? pptPath : undefined },
    });
    if (!fs.existsSync(pptPath)) throw new Error("Generated output missing");
    if (target.artifact.markdownPath && fs.existsSync(target.artifact.markdownPath)) {
      fs.copyFileSync(target.artifact.markdownPath, mdPath);
    }
  } catch (pipelineErr) {
    transition(session, "error");
    saveSession(session);
    if (pipelineErr instanceof FormalDeckValidationError) {
      return json({
        error: "FORMAL_VALIDATION_FAILED",
        issues: pipelineErr.issues,
        message: pipelineErr.message,
      }, 400);
    }
    console.error("Formal pipeline render failed:", pipelineErr);
    throw pipelineErr;
  }

  session.pptPath = relativePptPath;
  if (fs.existsSync(mdPath)) session.markdownPath = relativeMdPath;
  try {
    const preview = generateDeckPreviews({
      sourcePath: pptPath,
      ownerDownloadDir: ownerDownloadDir(currentOwner),
      relativePrefix: `${session.id}_preview`,
    });
    session.previewPaths = preview.previewRelativePaths.map((p) => path.join(safeOwnerId(currentOwner), p));
    session.previewPdfPath = preview.previewPdfRelativePath ? path.join(safeOwnerId(currentOwner), preview.previewPdfRelativePath) : undefined;
    session.slideCount = preview.slideCount;
  } catch (previewErr) {
    console.warn("Preview generation failed:", previewErr);
    session.previewPaths = [];
    session.previewPdfPath = undefined;
    session.slideCount = 0;
  }
  transition(session, "done");
  saveSession(session);
  return json({
    sessionId: session.id,
    status: "done",
    format: outFormat,
    quality: quality === "high" ? "high" : "standard",
    downloadUrl: signedDownloadUrl(relativePptPath),
    markdownUrl: session.markdownPath ? signedDownloadUrl(session.markdownPath) : undefined,
    previewUrls: (session.previewPaths || []).map((p) => signedDownloadUrl(p)),
    previewPdfUrl: session.previewPdfPath ? signedDownloadUrl(session.previewPdfPath) : undefined,
    slideCount: session.slideCount || 0,
  });
}

// ── 字符串清洗: 移除 XML 非法字符 (U+FFFF 等) ─────
function sanitizeForXml(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF\uffff]/g, "").trim();
  }
  if (Array.isArray(obj)) return obj.map(sanitizeForXml);
  if (obj && typeof obj === "object") {
    const cleaned: any = {};
    for (const [k, v] of Object.entries(obj)) cleaned[k] = sanitizeForXml(v);
    return cleaned;
  }
  return obj;
}

// ── Enhanced Generate (python-pptx from insurance-deck) ─
async function handleEnhancedGenerate(params: {
  req: Request;
  session: Session;
  theme?: string;
  companyId?: string;
  savingsCompanyId?: string;
  ciCompanyId?: string;
  iulCompanyId?: string;
  aiNarrative?: string;
}) {
  const { req, session } = params;
  const theme = params.theme || 'broker';
  const companyId = params.companyId || 'fwd';
  const rawCompanyId = companyId;
  const savingsCompanyId = params.savingsCompanyId || rawCompanyId;
  const ciCompanyId = params.ciCompanyId || rawCompanyId;
  const iulCompanyId_param = params.iulCompanyId || rawCompanyId;

  const validExtractions = session.extractions.filter(e => e.data);
  if (!validExtractions.length) return json({ error: "No parsed data" }, 400);

  const savingsEntry = validExtractions.find(e => e.planType === 'savings');
  const ciEntry = validExtractions.find(e => e.planType === 'ci');
  const iulEntry = validExtractions.find(e => e.planType === 'iul');

  // Combo detection: 2+ plan types → combo mode
  const planTypes = [...new Set(session.extractions.filter(e => e.data).map(e => e.planType))];
  const failedExtractions = session.extractions.filter(e => !e.data).map(e => `${e.pdfName}: ${e.error || '未知错误'}`);
  if (planTypes.length > 1) {
    console.log(`[combo] 检测到 ${planTypes.join(' + ')} 组合方案${failedExtractions.length ? `，以下提取失败: ${failedExtractions.join('; ')}` : ''}`);
  }
    // 允许无储蓄险（单IUL/CI）

  transition(session, "generating");
  saveSession(session);

  const currentOwner = ownerId(req);
  const fn = `${session.id}_综合方案.pptx`;
  const relativePptPath = path.join(safeOwnerId(currentOwner), fn);
  const pptPath = path.join(ownerDownloadDir(currentOwner), fn);

  try {
    const savingsData = savingsEntry?.data as any || null;
    const ciDataRaw = ciEntry?.data as any || null;
    const iulDataRaw = iulEntry?.data as any || null;

    const ciDataClean = ciDataRaw ? sanitizeForXml(ciDataRaw) : null;
    const iulDataClean = iulDataRaw ? sanitizeForXml(iulDataRaw) : null;
    const primaryData = savingsData || iulDataClean || ciDataClean || {};
    const ins = primaryData.insured || {};
    const pol = primaryData.policy || {};
    // 修复 AI 提取常见错误: 姓名和年龄互换 ("1岁"→ name="1", age=100)
    let rawAge = ins.age;
    let insuredAge = (rawAge !== undefined && rawAge !== null && rawAge !== '') ? Number(rawAge) : 1;
    if (/^\d{1,2}$/.test(String(ins.name || '')) && insuredAge > 80) {
      insuredAge = Number(ins.name) || 1;
      ins.age = insuredAge;
    }
    insuredAge = Number(insuredAge) || 1;
    const annualPremium = Number(pol.annual_premium) || 0;
    const rawPeriod = String(pol.premium_payment_period || "5");
    const payYears = rawPeriod === "趸交" ? 1 : (parseInt(rawPeriod) || 5);
    const paidTotal = annualPremium * payYears;

    // Build no_withdraw dict from benefit_illustration
    const bi: any[] = (savingsData || iulDataRaw || {}).benefit_illustration || [];
    const noWithdraw: Record<string, any> = {};
    if (savingsData) {
      for (const r of bi) {
        const y = Number(r.policy_year || 0);
        if (y <= 0) continue;
        const total = Number(r.total_surrender_value || 0);
        const guar = Number(r.guaranteed_cash_value || 0);
        const rev = Number(r.reversionary_bonus || 0);
        const term = Number(r.terminal_dividend || 0);
        const paid = Number(r.total_premium_paid || 0);
        // 修复: 当 total 小于 guar（不可能）或 total 明显小于 guar+rev+term 时重算
        const computedSum = guar + rev + term;
        const correctedTotal = (total < guar || (computedSum > total && computedSum - total > total * 0.01))
          ? Math.max(total, computedSum)
          : (total > 0 ? total : computedSum);
        const irr = (y > 0 && correctedTotal > paidTotal && paidTotal > 0) ? (correctedTotal / paidTotal) ** (1 / y) - 1 : null;
        const simple = (y > 0 && paidTotal > 0) ? (correctedTotal - paidTotal) / paidTotal / y : null;
        noWithdraw[String(y)] = {
          Y: y, Age: insuredAge + y - 1, Paid: paid,
          Guar_CV: guar, Rev: rev, Term: term,
          Total: correctedTotal,
          Mult: paidTotal ? correctedTotal / paidTotal : 0,
          IRR: irr, Simple: simple,
        };
      }
    } else if (iulDataRaw) {
      for (const r of bi) {
        const y = Number(r.policy_year || 0);
        if (y <= 0) continue;
        const paid = Number(r.total_premium_paid || 0);
        const cv = Number(r.non_guaranteed_cash_value || 0);
        noWithdraw[String(y)] = {
          Y: y, Age: insuredAge + y - 1, Paid: paid,
          Guar_CV: Number(r.guaranteed_cash_value || 0), Rev: 0, Term: 0,
          Total: cv > 0 ? cv : Number(r.non_guaranteed_account_value || 0),
          Mult: paidTotal ? cv / paidTotal : 0,
          IRR: null, Simple: null,
        };
      }
    }

    // Build withdraw dict from withdrawal_illustration
    const wi: any[] = savingsData?.withdrawal_illustration || [];
    const withdraw: Record<string, any> = {};
    let runningCum = 0;
    const sortedWi = [...wi].sort((a, b) => Number(a.policy_year || 0) - Number(b.policy_year || 0));
    for (const r of sortedWi) {
      const y = Number(r.policy_year || 0);
      if (y <= 0) continue;
      const aw = Number(r.annual_withdrawal || 0);
      const aiCum = Number(r.total_withdrawn || 0);
      runningCum += aw;
      const cum = aiCum > 0 ? aiCum : runningCum;
      const total = Number(r.surrender_value_after || r.surrender_value_before || 0);
      const totalReceived = cum + total;
      const irr = (y > 0 && totalReceived > paidTotal && paidTotal > 0) ? (totalReceived / paidTotal) ** (1 / y) - 1 : null;
      const simple = (y > 0 && paidTotal > 0) ? (totalReceived - paidTotal) / paidTotal / y : null;
      withdraw[String(y)] = {
        Y: y, Age: insuredAge + y - 1,
        Paid: Number(r.total_premium_paid || 0),
        Annual_WD: aw, Cum_WD: cum,
        Total: total, Total_Received: totalReceived,
        Guar_CV: 0, Rev: 0, Term: 0,
        Mult: paidTotal ? totalReceived / paidTotal : 0,
        IRR: irr, Simple: simple,
      };
    }

    // Build company info
    const bp = COMPANY_BRAND_PROFILES[rawCompanyId] || COMPANY_BRAND_PROFILES.fwd;
    const meta: Record<string, any> = {
      pdf_path: (savingsEntry?.pdfPath || iulEntry?.pdfPath || ''),
      company_id: rawCompanyId,
      company_name_zh: bp.name_zh || '',
      company_name_en: bp.name_en || '',
      company_short: bp.short || '',
      company_short_en: bp.short_en || '',
      company_rating: bp.rating || '',
      brand_profile: bp,
      product_code: 'AUTO',
      product_name: (savingsData?.product_name || iulDataRaw?.product_name || pol.product_name || '万用寿险'),
      product_name_short: ((savingsData?.product_name || iulDataRaw?.product_name || '') + '').replace(/[「」]/g, '').substring(0, 12),
      product_type: iulDataRaw ? 'iul' : savingsData ? 'savings' : 'ci',
      has_savings: Boolean(savingsData),
      _assets_dir: path.resolve(import.meta.dir, '../../public/assets'),
      ai_narrative: params.aiNarrative || '',
      product_currency: pol.currency || 'USD',
      insured_name: ins.name || '客户',
      insured_age: insuredAge,
      insured_gender: ins.gender || '',
      annual_premium: annualPremium,
      payment_years: payYears,
      premium_total: paidTotal,
      coverage_period: pol.coverage_period || '终身',
      currency: pol.currency || 'USD',
      // Scenario
      scenario_type: insuredAge < 18 ? 'education' : insuredAge >= 55 ? 'retirement' : 'wealth_accumulation',
    };

    // Company assets
    const ASSETS = path.resolve(import.meta.dir, '../../public/assets/library');
    const coDir = path.join(ASSETS, 'companies', rawCompanyId);
    const logoPath = path.join(coDir, 'logo.png');
    const coverPathJpg = path.join(coDir, 'company-hero-01.jpg');
    const coverPathPng = path.join(coDir, 'company-hero-01.png');
    // 封面优先用png(定制封面), 回退到jpg
    const coverPath = fs.existsSync(coverPathPng) ? coverPathPng : coverPathJpg;
    const companyImages = [
      path.join(coDir, 'brand-01.jpg'),
      path.join(coDir, 'brand-02.jpg'),
      path.join(coDir, 'office-01.jpg'),
      path.join(coDir, 'adviser-01.jpg'),
    ].filter((p) => fs.existsSync(p));

    // Scene images based on scenario
    const sceneTheme = insuredAge < 18 ? 'education' : insuredAge >= 55 ? 'retirement' : 'savings';
    const sceneDir = path.join(ASSETS, 'themes', sceneTheme);
    const fallbackDir = path.join(ASSETS, 'themes', 'family');
    const sceneImages = (() => {
      const dirs = [sceneDir, fallbackDir, path.join(ASSETS, 'themes', 'savings')];
      const candidates = [
        'child-growth-01.jpg', 'graduation-01.jpg', 'family-outdoor-01.jpg',
        'senior-life-01.jpg', 'senior-travel-01.jpg', 'family-evening-01.jpg',
        'family-wealth-01.jpg', 'long-term-growth-01.jpg', 'father-child-01.jpg',
      ];
      const found: string[] = [];
      for (const c of candidates) {
        for (const d of dirs) {
          const fp = path.join(d, c);
          if (fs.existsSync(fp) && !found.includes(fp)) {
            found.push(fp);
            break;
          }
        }
        if (found.length >= 3) break;
      }
      return found;
    })();

    // Build the full data object
    const normalizedData = {
      meta,
      summary: {
        insured_name: ins.name || 'VIP',
        insured_age: insuredAge,
        insured_gender: ins.gender || '',
        product_name: (savingsData || iulDataRaw || {}).product_name || '',
        currency: pol.currency || 'USD',
        annual_premium: annualPremium,
        payment_years: payYears,
        coverage_period: pol.coverage_period || '终身',
        premium_total: paidTotal,
      },
      paid_total: paidTotal,
      no_withdraw: noWithdraw,
      withdraw: withdraw,
    };

    // Write temp JSON
    const tmpJson = `/tmp/enhanced_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(tmpJson, JSON.stringify(normalizedData, null, 2), 'utf-8');

    // Write temp Python script
    const insdeckDir = path.resolve(import.meta.dir, '../../../insurance-deck');
    const pyScript = `/tmp/enhanced_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`;
    const logoArg = fs.existsSync(logoPath) ? `'${logoPath}'` : 'None';
    // 全美/永明的定制封面仅用于IUL产品，储蓄险不用；宏利封面所有产品通用
    const iulOnlyCompanies = ['transamerica', 'sunlife'];
    const isSavings = planTypes.length === 1 && planTypes[0] === 'savings';
    const skipCover = iulOnlyCompanies.includes(rawCompanyId) && isSavings;
    const coverArg = (fs.existsSync(coverPath) && !skipCover) ? `'${coverPath}'` : 'None';

    // CI/IUL data args (清洗 XML 非法字符)
    const tmpCiJson = ciDataRaw ? `/tmp/enhanced_ci_${Date.now()}.json` : '';
    const tmpIulJson = iulDataRaw ? `/tmp/enhanced_iul_${Date.now()}.json` : '';
    if (ciDataRaw) fs.writeFileSync(tmpCiJson, JSON.stringify(sanitizeForXml(ciDataRaw), null, 2), 'utf-8');
    if (iulDataRaw) {
      // 所有IUL产品统一名称
      iulDataRaw.product_name = "新加坡IUL";
      if (!iulDataRaw.summary) iulDataRaw.summary = {};
      iulDataRaw.summary.product_name = "新加坡IUL";
      if (!iulDataRaw.policy) iulDataRaw.policy = {};
      iulDataRaw.policy.product_name = "新加坡IUL";
      // 从IUL保单数据计算缴费年期
      const iulPeriod = String(iulDataRaw.policy.premium_payment_period || "5");
      iulDataRaw.summary.payment_years = iulPeriod === "趸交" ? 1 : (parseInt(iulPeriod) || 5);
      // IUL 字段映射: AI 输出 account_value/cash_value/death_benefit → non_guaranteed_*
      iulDataRaw.benefit_illustration = (iulDataRaw.benefit_illustration || []).map((r: any) => ({
        ...r,
        non_guaranteed_account_value: r.non_guaranteed_account_value ?? r.account_value ?? 0,
        non_guaranteed_cash_value: r.non_guaranteed_cash_value ?? r.cash_value ?? 0,
        non_guaranteed_death_benefit: r.non_guaranteed_death_benefit ?? r.death_benefit ?? undefined,
      }));
      fs.writeFileSync(tmpIulJson, JSON.stringify(sanitizeForXml(iulDataRaw), null, 2), 'utf-8');
    }

    // CI/IUL company info (前端传入的ID优先)
    const finalCiCompanyId = ciCompanyId || (ciEntry?.pdfName
      ? (() => {
          const fn = ciEntry.pdfName.toLowerCase();
          for (const [id, info] of Object.entries(COMPANY_BRAND_PROFILES)) {
            if (fn.includes(id) || (info as any).name_en?.toLowerCase() && fn.includes((info as any).name_en.toLowerCase())) return id;
          }
          return rawCompanyId;
        })()
      : rawCompanyId);
    const finalIulCompanyId = iulCompanyId_param || (iulEntry?.pdfName
      ? (() => {
          const fn = iulEntry.pdfName.toLowerCase();
          for (const [id, info] of Object.entries(COMPANY_BRAND_PROFILES)) {
            if (fn.includes(id) || (info as any).name_en?.toLowerCase() && fn.includes((info as any).name_en.toLowerCase())) return id;
          }
          return rawCompanyId;
        })()
      : rawCompanyId);
    const ciCompany = ciDataRaw ? { brand_profile: COMPANY_BRAND_PROFILES[finalCiCompanyId] || COMPANY_BRAND_PROFILES.fwd, name_zh: COMPANY_BRAND_PROFILES[finalCiCompanyId]?.name_zh, id: finalCiCompanyId } : null;
    const iulCompany = iulDataRaw ? { brand_profile: COMPANY_BRAND_PROFILES[finalIulCompanyId] || COMPANY_BRAND_PROFILES.fwd, name_zh: COMPANY_BRAND_PROFILES[finalIulCompanyId]?.name_zh, id: finalIulCompanyId } : null;

    const themeMap: Record<string, string> = {
      broker: 'broker', business: 'business', chinese: 'chinese',
      ink: 'ink', minimal: 'minimal', caramel: 'caramel',
      deepblue: 'broker',
    };
    const resolvedTheme = themeMap[theme] || 'broker';

    // Build company_images JSON-safe string
    const pyCode = `
import sys, json
sys.path.insert(0, '${insdeckDir}')
from insdeck.render.pptx_renderer import render_pptx

with open('${tmpJson}') as f:
    data = json.load(f)

ci_data = None
if '${tmpCiJson}':
    with open('${tmpCiJson}') as f:
        ci_data = json.load(f)

iul_data = None
if '${tmpIulJson}':
    with open('${tmpIulJson}') as f:
        iul_data = json.load(f)

out = '${pptPath}'
render_pptx(data, out,
    theme='${resolvedTheme}',
    cover_image=${coverArg},
    logo_path=${logoArg},
    company_images=${JSON.stringify(companyImages)},
    scene_images=${JSON.stringify(sceneImages)},
    ci_data=ci_data,
    iul_data=iul_data,
    ci_company=${ciCompany ? JSON.stringify(ciCompany) : 'None'},
    iul_company=${iulCompany ? JSON.stringify(iulCompany) : 'None'})
print(json.dumps({"ok": True, "path": out}))
`;
    fs.writeFileSync(pyScript, pyCode);

    // Call python-pptx renderer
    execSync(`python3.11 ${pyScript}`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    // Cleanup
    try { fs.unlinkSync(tmpJson); } catch {}
    try { fs.unlinkSync(pyScript); } catch {}
    if (tmpCiJson) try { fs.unlinkSync(tmpCiJson); } catch {}
    if (tmpIulJson) try { fs.unlinkSync(tmpIulJson); } catch {}
  } catch (err: any) {
    transition(session, "error");
    saveSession(session);
    console.error("Enhanced render failed:", err);
    const msg = err?.stderr ? String(err.stderr).slice(-300) : (err?.message || "Render failed");
    return json({ error: "增强渲染失败", detail: msg }, 500);
  }

  if (!fs.existsSync(pptPath)) {
    transition(session, "error");
    saveSession(session);
    return json({ error: "增强渲染输出缺失" }, 500);
  }

  session.pptPath = relativePptPath;
  try {
    const preview = generateDeckPreviews({
      sourcePath: pptPath,
      ownerDownloadDir: ownerDownloadDir(currentOwner),
      relativePrefix: `${session.id}_preview`,
    });
    session.previewPaths = preview.previewRelativePaths.map((p) => path.join(safeOwnerId(currentOwner), p));
    session.previewPdfPath = preview.previewPdfRelativePath ? path.join(safeOwnerId(currentOwner), preview.previewPdfRelativePath) : undefined;
    session.slideCount = preview.slideCount;
  } catch (previewErr) {
    console.warn("Preview generation failed:", previewErr);
    session.previewPaths = [];
    session.previewPdfPath = undefined;
    session.slideCount = 0;
  }
  transition(session, "done");
  saveSession(session);
  return json({
    sessionId: session.id,
    status: "done",
    downloadUrl: signedDownloadUrl(relativePptPath),
    previewUrls: (session.previewPaths || []).map((p) => signedDownloadUrl(p)),
    previewPdfUrl: session.previewPdfPath ? signedDownloadUrl(session.previewPdfPath) : undefined,
    slideCount: session.slideCount || 0,
  });
}

// ─── HTTP Router ─────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function html(content: string) {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

serve({
  port: PORT,
  idleTimeout: 255, // Prevent timeout during long AI parsing (>4 min)
  async fetch(req: Request) {
    const url = new URL(req.url);
    const method = req.method;
    const pathname = url.pathname;

    // CORS preflight (允许 h5-app iframe 跨域请求)
    const ALLOWED_HEADERS = "Content-Type, X-API-Key, X-User-Id, X-User-Api-Key, X-User-Api-Provider, Authorization";
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": req.headers.get("Origin") || "*",
          "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": ALLOWED_HEADERS,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Rate limit only for mutable API routes; never limit static/download GETs
    const shouldRateLimit =
      pathname.startsWith("/api/") &&
      pathname !== "/api/health" &&
      !(method === "GET" && pathname.startsWith("/api/session/"));
    if (shouldRateLimit) {
      const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
      const rl = rateLimit(ip);
      if (rl) return rl;
    }

    try {
      // ── API Routes ────────────────────────────────
      if (pathname === "/api/health" && method === "GET") {
        return json({ status: "ok", time: new Date().toISOString() });
      }
      if (pathname === "/api/render-options" && method === "GET") {
        const assets = new Map(listTemplateAssets().map((asset) => [asset.id, asset]));
        return json({
          companies: COMPANY_SKINS,
          templates: TEMPLATE_PRESETS.map((template) => ({
            ...template,
            sourceTemplateAvailable: assets.has(template.id),
            sourceTemplateSha256: assets.get(template.id)?.sha256,
          })),
        });
      }
      if (pathname === "/api/clone-status" && method === "GET") {
        const templateAssets = new Set(listTemplateAssets().map((asset) => asset.id));
        const templates = loadTemplateCatalog();
        const savingsRenderers = listSavingsCloneRendererIds();
        const ciRenderers = listCiCloneRendererIds();
        const iulRenderers = listIulCloneRendererIds();
        return json({
          savingsRenderers,
          ciRenderers,
          iulRenderers,
          templates: templates.map((template) => {
            const sourceTemplateOk = !template.sourceTemplateAssetId || templateAssets.has(template.sourceTemplateAssetId);
            const rendererOk = !template.cloneReady
              ? template.cloneRenderer == null
              : template.planType === "savings"
                ? hasSavingsCloneRenderer(template.cloneRenderer)
                : template.planType === "ci"
                  ? hasCiCloneRenderer(template.cloneRenderer)
                  : template.planType === "iul"
                    ? hasIulCloneRenderer(template.cloneRenderer)
                : Boolean(template.cloneRenderer);
            return {
              id: template.id,
              planType: template.planType,
              stylePreset: template.stylePreset,
              cloneReady: Boolean(template.cloneReady),
              cloneRenderer: template.cloneRenderer || null,
              sourceTemplateAssetId: template.sourceTemplateAssetId || null,
              sourceTemplateOk,
              rendererOk,
              status: sourceTemplateOk && rendererOk ? "ok" : "blocked",
            };
          }),
        });
      }
      if (pathname === "/api/export-readiness" && method === "GET") {
        return json(buildExportReadinessMatrix());
      }

      if (pathname === "/api/company-kb/match" && method === "POST") {
        const authErr = requireApiKey(req); if (authErr) return authErr;
        const payload = await req.json().catch(() => ({} as any));
        const productName = String(payload?.productName || "").trim();
        const companyHint = String(payload?.companyHint || "").trim();
        const forcedCompanyId = String(payload?.companyId || "").trim() || undefined;
        if (!productName && !companyHint) {
          return json({ error: "productName or companyHint is required" }, 400);
        }
        const matched = matchCompanyKnowledge({ productName, companyHint, forcedCompanyId });
        const publicEvidenceCount = matched.evidenceFiles.length;
        const blockedReason =
          matched.companyId === "unknown"
            ? "COMPANY_UNKNOWN"
            : publicEvidenceCount === 0
              ? "PUBLIC_EVIDENCE_MISSING"
              : null;
        return json({
          companyId: matched.companyId,
          companyName: matched.companyName,
          confidence: matched.confidence,
          evidenceFiles: matched.evidenceFiles.slice(0, 8),
          publicEvidenceCount,
          blockedReason,
          matchedBy: matched.matchedBy,
        });
      }

      // Search company info (use Kimi as primary, Gemini as fallback)
      if (pathname === "/api/company-info" && method === "POST" && (KIMI_API_KEY || DEEPSEEK_API_KEY || GEMINI_API_KEY)) {
        const authErr = requireApiKey(req); if (authErr) return authErr;
        const { name } = await req.json().catch(() => ({}));
        if (!name) return json({ error: "Company name required" }, 400);
        let info = "未找到相关信息。";
        if (KIMI_API_KEY || DEEPSEEK_API_KEY) {
          const apiKey = KIMI_API_KEY || DEEPSEEK_API_KEY;
          const baseUrl = KIMI_API_KEY
            ? process.env.KIMI_BASE_URL || "https://api.kimi.com/coding"
            : process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
          const model = KIMI_API_KEY
            ? process.env.KIMI_MODEL || "kimi-for-coding"
            : process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
          try {
            const prompt = `请简要介绍${name}这家保险公司（中文，200字以内），包括成立时间、总部、核心业务、市场地位。如果不知道这家公司，请说明。`;
            const res = KIMI_API_KEY
              ? await fetch(`${baseUrl.replace(/\/$/, "")}/v1/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "anthropic-version": "2023-06-01" },
                  body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 300 }),
                })
              : await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                  body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 300 }),
                });
            const data = await res.json();
            info = KIMI_API_KEY
              ? (data.content || []).map((part: any) => part?.text || "").join("") || info
              : data.choices?.[0]?.message?.content || info;
          } catch {}
        }
        return json({ info });
      }

      if (pathname === "/api/upload" && method === "POST") {
        const authErr = requireApiKey(req); if (authErr) return authErr;
        const formData = await req.formData();
        const files = formData.getAll("files") as File[];
        const types = formData.getAll("types") as string[];
        const companies = formData.getAll("companies") as string[];
        if (!files.length) return json({ error: "No files uploaded" }, 400);

        const sessionId = genId();
        const currentOwner = ownerId(req);
        const uploadDir = ownerUploadDir(currentOwner);
        const session: Session = {
          id: sessionId, ownerId: currentOwner, files: [], status: "created", extractions: [],
          chatHistory: [], createdAt: new Date().toISOString(),
        };

        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (!f.name.toLowerCase().endsWith(".pdf")) continue;
          if (f.size > MAX_UPLOAD_BYTES) return json({ error: `PDF 文件过大，单文件限制为 ${MAX_UPLOAD_BYTES} bytes` }, 413);
          const cleanName = safeFilename(f.name);
          const fp = path.join(uploadDir, `${sessionId}_${cleanName}`);
          fs.writeFileSync(fp, new Uint8Array(await f.arrayBuffer()));
          // Use type from frontend, with fallback to auto-detect
          const type = (types[i] as "savings" | "ci" | "iul" | undefined)
            || (f.name.toLowerCase().includes("危疾") || f.name.toLowerCase().includes("守護") ? "ci" as const
              : f.name.toLowerCase().includes("iul") || f.name.toLowerCase().includes("genesis") ? "iul" as const
              : "savings" as const);
          const companyId = companies[i] || "";
          session.files.push({ path: fp, name: cleanName, type, companyId });
        }
        if (!session.files.length) return json({ error: "No valid PDFs" }, 400);
        saveSession(session);
        return json({ sessionId: session.id, files: session.files.map((f) => f.name) });
      }

      const parseMatch = pathname.match(/^\/api\/parse\/([\w-]+)$/);
      if (parseMatch && method === "POST") {
        const session = loadSession(parseMatch[1]);
        if (!session) return json({ error: "Session not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const authErr = requireApiKey(req); if (authErr) return authErr;
        // 关键: 用户可从前端传 X-User-Api-Key 覆盖服务端 key
        const userKey = req.headers.get("X-User-Api-Key");
        const userProvider = req.headers.get("X-User-Api-Provider") || DEFAULT_PROVIDER;
        // 按 provider 选择对应的 API key
        const providerKeyMap: Record<string, string> = {
          kimi: KIMI_API_KEY,
          deepseek: DEEPSEEK_API_KEY,
          openai: DEEPSEEK_API_KEY,
          gemini: GEMINI_API_KEY,
          minimax: MINIMAX_API_KEY,
        };
        const effectiveApiKey = userKey || providerKeyMap[userProvider] || KIMI_API_KEY || DEEPSEEK_API_KEY;

        transition(session, "parsing");
        session.extractions = [];
        saveSession(session);

        for (const f of session.files) {
                    // 宏利 IUL: 使用 Gemini 多模态提取
          let resolvedProvider = userProvider;
          let resolvedKey = effectiveApiKey;
          if (f.type === "iul" && (f as any).companyId === "manulife" && MINIMAX_API_KEY) {
            resolvedProvider = "minimax";
            resolvedKey = MINIMAX_API_KEY;
            console.log("[server] Manulife IUL detected, using MiniMax M3");
          }

          const orch = new ExtractionOrchestrator({
            apiKey: resolvedKey,
            provider: resolvedProvider as "deepseek" | "openai" | "gemini" | "minimax" | undefined,
            useCache: true,
          });
          let r = await extractionQueue.run(() => orch.extractPlan(f.path, f.type));

          // Manulife IUL: MiniMax 失败时自动降级到 Kimi
          if ((!r.data || r.status === "error") && f.type === "iul" && (f as any).companyId === "manulife" && KIMI_API_KEY && resolvedProvider === "minimax") {
            console.log("[server] Manulife IUL MiniMax failed, falling back to Kimi");
            const kimiOrch = new ExtractionOrchestrator({
              apiKey: KIMI_API_KEY,
              provider: "kimi",
              useCache: false, // 避免用 MiniMax 的 cache
            });
            const r2 = await extractionQueue.run(() => kimiOrch.extractPlan(f.path, f.type));
            if (r2.data && r2.status === "success") {
              r = r2;
              const biLen = (r2.data as any).benefit_illustration?.length || 0;
              console.log(`[server] Kimi fallback succeeded: ${biLen} rows`);
            }
          }
          // LLM失败时用fitz兜底(适用于有签名的储蓄险,断网时可用)
          if (!r.data && f.type === "savings" && fs.existsSync(f.path)) {
            try {
              const { spawnSync } = await import("child_process");
              const scriptPath = path.resolve(import.meta.dir, "../../scripts/extract_savings_tables.py");
              const py = spawnSync("python3.11", [scriptPath, f.path], { timeout: 30000, encoding: "utf-8" });
              if (py.status === 0 && py.stdout) {
                const ft = JSON.parse(py.stdout.trim());
                if (ft.benefit_illustration?.length > 5) {
                  (r as any).data = {
                    product_name: "储蓄保险计划",
                    product_type: "savings",
                    insured: { name: "VIP", age: 1, gender: "男", smoker: null },
                    policy: { product_name: "储蓄保险计划", currency: "USD", sum_insured: null, basic_sum_insured: null, annual_premium: 100000, premium_payment_period: "5年", coverage_period: "终身", total_premium_with_levy: null },
                    benefit_illustration: ft.benefit_illustration.map((row: any) => ({
                      policy_year: row.policy_year,
                      total_premium_paid: row.total_premium_paid || 0,
                      guaranteed_cash_value: row.guaranteed_cash_value || 0,
                      reversionary_bonus: row.reversionary_bonus || 0,
                      terminal_dividend: row.terminal_dividend || 0,
                      total_surrender_value: row.total_surrender_value || 0,
                      death_benefit: row.death_benefit || 0,
                    })),
                    withdrawal_illustration: (ft.withdrawal_illustration || []).map((row: any) => ({
                      policy_year: row.policy_year,
                      total_premium_paid: row.total_premium_paid || 0,
                      annual_withdrawal: row.annual_withdrawal || 0,
                      total_withdrawn: row.total_withdrawn || 0,
                      surrender_value_before: row.surrender_value_before || 0,
                      surrender_value_after: row.surrender_value_after || 0,
                    })),
                    sales_insights: { target_customer: "高净值客户", key_selling_points: ["稳健增值", "财富传承"], unique_advantages: "", suggested_narrative: "", highlight_numbers: [] },
                    _meta: { source: "fitz_fallback", parser: "fitz-table-v1" },
                  };
                  (r as any).status = "success";
                  console.log(`[server] LLM失败, fitz兜底成功: ${ft.benefit_illustration.length} rows`);
                }
              }
            } catch (_) {}
          }
          // IUL: LLM失败时用fitz兜底(永明/全美IUL有表格结构,断网可用)
          if (!r.data && f.type === "iul" && fs.existsSync(f.path)) {
            const iulScripts = [
              path.resolve(import.meta.dir, "../../scripts/extract_sunlife_iul.py"),
              path.resolve(import.meta.dir, "../../scripts/extract_transamerica_iul.py"),
            ];
            for (const iulScript of iulScripts) {
              if (!fs.existsSync(iulScript)) continue;
              try {
                const { execSync } = await import("child_process");
                const py2 = execSync(`python3.11 "${iulScript}" "${f.path}"`, { timeout: 15000, encoding: "utf-8" });
                const iulResult = JSON.parse(py2.trim());
                const bi = (iulResult.benefit_illustration || []) as any[];
                if (bi.length > 5) {
                  (r as any).data = {
                    product_name: iulResult.summary?.insured_name || "IUL Plan",
                    product_type: "iul",
                    insured: { name: "VIP", age: Number(iulResult.summary?.insured_age || 0), gender: iulResult.summary?.insured_gender || "", smoker: null },
                    policy: {
                      product_name: iulResult.summary?.insured_name || "IUL Plan",
                      currency: "USD",
                      sum_insured: iulResult.summary?.sum_insured || null,
                      basic_sum_insured: null,
                      annual_premium: iulResult.summary?.annual_premium || 0,
                      premium_payment_period: `${iulResult.summary?.payment_years || 0}年`,
                      coverage_period: "终身",
                      total_premium_with_levy: null,
                    },
                    benefit_illustration: bi.map((row: any) => ({
                      policy_year: row.policy_year,
                      total_premium_paid: row.total_premium_paid || row.premium || 0,
                      non_guaranteed_account_value: row.non_guaranteed_account_value || row.account_value || 0,
                      non_guaranteed_cash_value: row.non_guaranteed_cash_value || row.surrender_value || 0,
                      guaranteed_cash_value: row.guaranteed_cash_value || row.guaranteed_value || 0,
                      death_benefit: row.death_benefit || 0,
                      sum_insured: row.sum_insured || 0,
                    })),
                    withdrawal_illustration: [],
                    sales_insights: { target_customer: "高净值客户", key_selling_points: ["指数账户", "身故保障杠杆"], unique_advantages: "", suggested_narrative: "", highlight_numbers: [] },
                    _meta: { source: "fitz_fallback", parser: path.basename(iulScript).replace(".py", "") },
                  };
                  (r as any).status = "success";
                  console.log(`[server] IUL fitz兜底成功: ${bi.length} rows (${path.basename(iulScript)})`);
                  break;
                }
              } catch (_) {}
            }
          }
          // Try fitz extraction for savings/CI 表格
          if (r.data && fs.existsSync(f.path)) {
            try {
              const { spawnSync } = await import("child_process");
              const scriptPath = path.resolve(import.meta.dir, "../../scripts/extract_savings_tables.py");
              const py = spawnSync("python3.11", [scriptPath, f.path], { timeout: 30000, encoding: "utf-8" });
              if (py.status === 0 && py.stdout) {
                const ft = JSON.parse(py.stdout.trim());
                if (f.type === "savings") {
                  if (ft.benefit_illustration?.length > 20) {
                    (r.data as any).benefit_illustration = ft.benefit_illustration;
                    console.log(`[server] fitz 覆盖 benefit: ${ft.benefit_illustration.length} rows`);
                  }
                  if (ft.withdrawal_illustration?.length > 0) {
                    (r.data as any).withdrawal_illustration = ft.withdrawal_illustration;
                    console.log(`[server] fitz 覆盖 withdrawal: ${ft.withdrawal_illustration.length} rows`);
                  }
                }
                if (f.type === "ci" && ft.ci_benefit_illustration?.length > (r.data as any).benefit_illustration?.length) {
                  (r.data as any).benefit_illustration = ft.ci_benefit_illustration;
                  console.log(`[server] fitz 覆盖 CI: ${ft.ci_benefit_illustration.length} rows`);
                }
                if (f.type === "ci") {
                  try {
                    const ciScript = path.resolve(import.meta.dir, "../../scripts/extract_aia_ci.py");
                    if (fs.existsSync(ciScript)) {
                      const { execSync } = await import("child_process");
                      const py2 = execSync(`python3.11 "${ciScript}" "${f.path}"`, { timeout: 15000, encoding: "utf-8" });
                      const ciResult = JSON.parse(py2.trim());
                      const ciBi = ciResult.benefit_illustration || [];
                      if (ciBi.length > 5) {
                        (r.data as any).benefit_illustration = ciBi;
                        console.log(`[server] CI fitz 覆盖 benefit: ${ciBi.length} rows`);
                      }
                    }
                  } catch (_) { /* CI fitz silent */ }
                }
              }
            } catch (_) { /* fitz fallback silent */ }

            // IUL 专用提取 (独立于上面的 savings/CI fitz, 避免被异常跳过)
            if (f.type === "iul") {
              const iulScripts = [
                path.resolve(import.meta.dir, "../../scripts/extract_sunlife_iul.py"),
                path.resolve(import.meta.dir, "../../scripts/extract_transamerica_iul.py"),
              ];
              for (const iulScript of iulScripts) {
                if (!fs.existsSync(iulScript)) continue;
                try {
                  const { execSync } = await import("child_process");
                  const py2 = execSync(`python3.11 "${iulScript}" "${f.path}"`, { timeout: 15000, encoding: "utf-8" });
                  const iulResult = JSON.parse(py2.trim());
                  const iulBi = iulResult.benefit_illustration || [];
                  if (iulBi.length > 5) {
                    (r.data as any).benefit_illustration = iulBi.map((row: any) => ({
                      policy_year: row.policy_year,
                      total_premium_paid: row.total_premium_paid || row.premium || 0,
                      non_guaranteed_cash_value: row.non_guaranteed_cash_value || row.surrender_value || row.account_value || 0,
                      non_guaranteed_account_value: row.non_guaranteed_account_value || row.account_value || 0,
                      guaranteed_cash_value: row.guaranteed_cash_value || row.guaranteed_value || 0,
                      death_benefit: row.death_benefit || 0,
                    }));
                    // 同步保费/保额
                    const sm = iulResult.summary || {};
                    const policy = (r.data as any)?.policy || {};
                    if (sm.annual_premium && !policy.annual_premium) {
                      policy.annual_premium = sm.annual_premium;
                    }
                    if (sm.sum_insured && !policy.sum_insured) {
                      policy.sum_insured = sm.sum_insured;
                    }
                    console.log(`[server] IUL fitz 覆盖 benefit: ${iulBi.length} rows (${iulScript.split('/').pop()})`);
                    break;
                  }
                } catch (_) { continue; }
              }
            }

            // 年龄兜底: 从PDF首页提取年龄
            const ins = (r.data as any)?.insured;
            if (ins && (!ins.age || ins.age === 0)) {
              try {
                const { execSync } = await import("child_process");
                const ageScript = path.resolve(import.meta.dir, "../../scripts/extract_age.py");
                const out = execSync(`python3.11 ${ageScript} '${f.path}'`, { timeout: 5000, encoding: "utf-8" });
                const age = parseInt(out.trim(), 10);
                if (age > 0 && age < 120) { ins.age = age; console.log(`[server] 年龄兜底: ${age}`); }
              } catch {}
            }
          }
          // DIAG: 检查 IUL 数据字段
          if (f.type === "iul" && r.data && Array.isArray(r.data.benefit_illustration)) {
            const row0 = r.data.benefit_illustration[0] as Record<string, unknown> | undefined;
            if (row0) {
              console.log(`[diag] IUL row[0] keys: ${Object.keys(row0).join(",")}`);
              console.log(`[diag] IUL row[0] cv=${row0.cash_value} ng_cv=${row0.non_guaranteed_cash_value}`);
            }
          }
          // IUL 字段映射: AI 可能输出 account_value/cash_value/death_benefit（无前缀）
          // 也可能输出 non_guaranteed_*/guaranteed_*（有前缀），统一补齐
          if (f.type === "iul" && r.data && Array.isArray(r.data.benefit_illustration)) {
            (r.data as any).benefit_illustration = (r.data as any).benefit_illustration.map((row: any) => ({
              ...row,
              non_guaranteed_account_value: row.non_guaranteed_account_value ?? row.account_value ?? 0,
              non_guaranteed_cash_value: row.non_guaranteed_cash_value ?? row.cash_value ?? 0,
              non_guaranteed_death_benefit: row.non_guaranteed_death_benefit ?? row.death_benefit ?? undefined,
              guaranteed_account_value: row.guaranteed_account_value ?? 0,
              guaranteed_cash_value: row.guaranteed_cash_value ?? 0,
            }));
          }
          // 强制以上传类型为准：AI 可能误判 product_type，
          // 但用户在前端选择的是 ci / iul / savings
          const forcedPlanType = r.data ? f.type : r.planType;
          if (r.data && forcedPlanType !== r.planType) {
            console.log(`[type] 修正 ${f.name}: AI检测=${r.planType} → 强制=${forcedPlanType}`);
          }
          // 根据利益表数据修正缴费年期（不依赖AI提取）
          if (r.data && Array.isArray(r.data.benefit_illustration)) {
            const bi = r.data.benefit_illustration as any[];
            const pol = (r.data as any).policy || {};
            const annualPrem = Number(pol.annual_premium || 0);
            const maxTotalPrem = Math.max(...bi.map(r => Number(r.total_premium_paid || 0)), 0);

            // 用最大累计保费 ÷ 年缴保费 = 缴费年数（精确）
            if (annualPrem > 0 && maxTotalPrem > 0) {
              const payCount = Math.round(maxTotalPrem / annualPrem);
              pol.premium_payment_period = payCount === 1 ? "趸交" : `${payCount}年`;
            }
          }
          session.extractions.push({ pdfName: f.name, pdfPath: f.path, planType: forcedPlanType, data: r.data ?? null, error: r.error });
        }
        transition(session, "parsed");

        const summary = session.extractions.map((e) => {
          if (!e.data) return `📄 **${e.pdfName}**: ❌ ${e.error}`;
          const d = e.data as PlanDataType;
          const yrs = d.benefit_illustration || [];
          const tp = Math.max(...yrs.map((r: any) => r.total_premium_paid || 0), 0);
          const last = yrs[yrs.length - 1];
          const mult = tp > 0 ? ((((last as any)?.total_surrender_value ?? (last as any)?.non_guaranteed_cash_value ?? (last as any)?.cash_value ?? 0) / tp)).toFixed(1) : "-";
          const typeLabel = e.planType === "ci" ? "危疾保障" : e.planType === "iul" ? "指数万用寿险" : "储蓄计划";
          return `📄 **${e.pdfName}** → **${d.product_name}**\n   - ${typeLabel} | 年缴: $${(d.policy?.annual_premium ?? 0).toLocaleString()} | ${d.policy?.premium_payment_period ?? "-"}\n   - ${yrs.length}年数据 ${mult !== "-" ? `| 期末倍数: ${mult}x` : ""}`;
        }).join("\n\n");

        // 解析阶段仅返回稳定摘要，避免不完整大纲污染聊天区
        const outlineMsg = `\n\n你可以在下方输入定制需求（如：教育金/养老金、提领起始年龄、公司页重点、图表页偏好），我会据此优化PPT。`;

        session.chatHistory.push({
          role: "assistant",
          content: `✅ **AI 解析完成！**\n\n${summary}${outlineMsg}`,
        });
        saveSession(session);

        return json({
          sessionId: session.id, status: session.status,
          extractions: session.extractions.map((e) => ({
            pdfName: e.pdfName, planType: e.planType,
            status: e.data ? "success" : "error",
            productName: e.data?.product_name ?? "unknown",
            error: e.error,
            yearCount: e.data?.benefit_illustration?.length ?? 0,
          })),
          message: session.chatHistory[session.chatHistory.length - 1].content,
        });
      }

      const sessionMatch = pathname.match(/^\/api\/session\/([\w-]+)$/);
      if (sessionMatch && method === "GET") {
        const session = loadSession(sessionMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        hydrateSessionPreviews(session);
        return json({
          sessionId: session.id, status: session.status,
          files: session.files.map((f) => ({ name: f.name, type: f.type })),
          extractions: session.extractions.map((e) => ({
            pdfName: e.pdfName,
            planType: e.planType,
            status: e.data ? "success" : "error",
            productName: e.data?.product_name ?? "unknown",
            yearCount: e.data?.benefit_illustration?.length ?? 0,
            error: e.error,
            data: e.data ?? null,
          })),
          chatHistory: session.chatHistory.slice(-20),
          hasPpt: !!session.pptPath,
          pptPath: session.pptPath,
          markdownPath: session.markdownPath,
          downloadUrl: session.pptPath ? signedDownloadUrl(session.pptPath) : undefined,
          markdownUrl: session.markdownPath ? signedDownloadUrl(session.markdownPath) : undefined,
          previewUrls: (session.previewPaths || []).map((p) => signedDownloadUrl(p)),
          previewPdfUrl: session.previewPdfPath ? signedDownloadUrl(session.previewPdfPath) : undefined,
          slideCount: session.slideCount || 0,
        });
      }

      const bundlePreviewMatch = pathname.match(/^\/api\/bundle-preview\/([\w-]+)$/);
      if (bundlePreviewMatch && method === "GET") {
        const session = loadSession(bundlePreviewMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const products: NormalizedProductPlan[] = [];
        for (const entry of session.extractions.filter((e) => e.data)) {
          if (entry.planType === "savings") {
            products.push(normalizeSavingsPlan(entry.data as any, { pdfPath: undefined, parser: "llm-json" }));
          } else if (entry.planType === "ci") {
            products.push(normalizeCiPlan(entry.data as any, { pdfPath: undefined, parser: "llm-json" }));
          } else if (entry.planType === "iul") {
            products.push(normalizeIulPlan(entry.data as any, { pdfPath: undefined, parser: "llm-json" }));
          }
        }
        if (!products.length) return json({ error: "No parsed products" }, 400);
        const bundle = planBundle(products);
        return json({
          bundleId: bundle.bundleId,
          displayName: bundle.displayName,
          productKinds: bundle.products.map((p) => p.kind),
          modules: bundle.modules,
        });
      }

      const normalizedPreviewMatch = pathname.match(/^\/api\/normalized-preview\/([\w-]+)$/);
      if (normalizedPreviewMatch && method === "GET") {
        const session = loadSession(normalizedPreviewMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const products = [];
        for (const entry of session.extractions.filter((e) => e.data)) {
          if (entry.planType === "savings") {
            const normalized = normalizeSavingsPlan(entry.data as SavingsPlanExtraction, { pdfPath: undefined, parser: "llm-json" });
            products.push({
              planType: "savings",
              productName: normalized.productName,
              insuredAge: normalized.insured.age,
              annualPremium: normalized.policy.annualPremium,
              payYears: normalized.policy.payYears,
              rowCount: normalized.benefitRows.length,
              validation: validateFormalSavingsPlan(normalized),
            });
          } else if (entry.planType === "ci") {
            const normalized = normalizeCiPlan(entry.data as CiPlanExtraction, { pdfPath: undefined, parser: "llm-json" });
            products.push({
              planType: "ci",
              productName: normalized.productName,
              insuredAge: normalized.insured.age,
              annualPremium: normalized.policy.annualPremium,
              payYears: normalized.policy.payYears,
              coverageItems: normalized.coverageItems.length,
              validation: validateFormalCiPlan(normalized),
            });
          } else if (entry.planType === "iul") {
            const normalized = normalizeIulPlan(entry.data as IulExtraction, { pdfPath: undefined, parser: "llm-json" });
            products.push({
              planType: "iul",
              productName: normalized.productName,
              insuredAge: normalized.insured.age,
              annualPremium: normalized.policy.annualPremium,
              payYears: normalized.policy.paymentPeriod,
              benefitRows: normalized.benefitRows.length,
              indexAccounts: normalized.indexAccounts.length,
              validation: validateFormalIulPlan(normalized),
            });
          }
        }
        if (!products.length) return json({ error: "No parsed products" }, 400);
        return json({ sessionId: session.id, ownerId: session.ownerId, products });
      }

      const chatMatch = pathname.match(/^\/api\/chat\/([\w-]+)$/);
      if (chatMatch && method === "POST") {
        const session = loadSession(chatMatch[1]);
        if (!session) return json({ error: "Session not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const authErr = requireApiKey(req); if (authErr) return authErr;
        // chat 无 API_KEY 时降级: 复用 outline-generator 的纯规则 fallback
        // 但若 chat 引擎要 LLM, 引擎内部会自动 catch

        const { message } = await req.json();
        if (!message?.trim()) return json({ error: "Message required" }, 400);

        session.chatHistory.push({ role: "user", content: message });
        const engine = new ChatEngine(API_KEY);
        const response = await engine.chat({
          message,
          extractions: session.extractions
            .filter((e) => e.data)
            .map((e) => ({
              pdfName: e.pdfName,
              planType: e.planType as "savings" | "ci" | "iul",
              data: e.data!,
            })),
          history: session.chatHistory,
        });
        session.chatHistory.push({ role: "assistant", content: response });
        transition(session, "chatting");
        saveSession(session);
        return json({ sessionId: session.id, message: response, history: session.chatHistory.slice(-20) });
      }

      const generateMatch = pathname.match(/^\/api\/generate\/([\w-]+)$/);
      if (generateMatch && method === "POST") {
        const session = loadSession(generateMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const authErr = requireApiKey(req); if (authErr) return authErr;
        const payload = await req.json().catch(() => ({} as any));
        return handleFormalGenerate({
          req,
          session,
          style: payload.style,
          companyInfo: payload.companyInfo,
          format: payload.format,
          quality: payload.quality,
          companyId: payload.companyId,
          templateId: payload.templateId,
        });
      }

      // ── Enhanced Generate (python-pptx from insurance-deck) ─
      const enhancedGenMatch = pathname.match(/^\/api\/generate-enhanced\/([\w-]+)$/);
      if (enhancedGenMatch && method === "POST") {
        const session = loadSession(enhancedGenMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);
        const authErr = requireApiKey(req); if (authErr) return authErr;
        const payload = await req.json().catch(() => ({} as any));
        return handleEnhancedGenerate({
          req,
          session,
          theme: payload.theme || payload.style,
          companyId: payload.companyId || "fwd",
          savingsCompanyId: payload.savingsCompanyId,
          ciCompanyId: payload.ciCompanyId,
          iulCompanyId: payload.iulCompanyId,
          aiNarrative: payload.aiNarrative || "",
        });
        console.log(`[enhanced] aiNarrative=${payload.aiNarrative ? payload.aiNarrative.substring(0,40)+'...' : 'empty'}`);
      }

      // ── AI 提取验证 ───────────────────────────────
      const validateMatch = pathname.match(/^\/api\/validate-extraction\/([\w-]+)$/);
      if (validateMatch && method === "GET") {
        const session = loadSession(validateMatch[1]);
        if (!session) return json({ error: "Not found" }, 404);
        if (!canAccess(req, session)) return json({ error: "Forbidden" }, 403);

        const issues: Array<{ field: string; severity: "error" | "warn"; message: string }> = [];
        for (const ext of session.extractions) {
          if (!ext.data) { issues.push({ field: ext.pdfName, severity: "error", message: "提取失败" }); continue; }
          const d = ext.data as any;
          const ins = d.insured || {};
          const pol = d.policy || {};
          const bi = d.benefit_illustration || [];

          // Age must be a reasonable number
          if (!ins.age || Number(ins.age) <= 0) issues.push({ field: "insured.age", severity: "error", message: `${ext.pdfName}: 年龄缺失或无效` });
          if (!pol.annual_premium || Number(pol.annual_premium) <= 0) issues.push({ field: "policy.annual_premium", severity: "error", message: `${ext.pdfName}: 年缴保费缺失` });

          // Benefit rows must be sorted
          let prevY = 0;
          for (const row of bi) {
            const y = Number(row.policy_year);
            if (y && y <= prevY && prevY > 0) issues.push({ field: "benefit_illustration", severity: "warn", message: `${ext.pdfName}: 保单年度未排序 (Y${prevY} -> Y${y})` });
            if (y) prevY = y;
          }

          // Check age consistency - 降级为warn, 数据构建层已自动修复
          for (const row of bi) {
            if (row.total_surrender_value != null && row.guaranteed_cash_value != null && row.total_surrender_value < row.guaranteed_cash_value) {
              issues.push({ field: "benefit_illustration", severity: "warn", message: `${ext.pdfName}: Y${row.policy_year} 退保总额已自动修正` });
              break;
            }
          }

          // Withdrawal validation
          const wi = d.withdrawal_illustration || [];
          let prevWd = 0;
          for (const row of wi) {
            const aw = Number(row.annual_withdrawal || 0);
            if (aw < 0) issues.push({ field: "withdrawal_illustration", severity: "error", message: `${ext.pdfName}: Y${row.policy_year} 提领金额为负` });
            if (aw > 0 && prevWd > 0 && Math.abs(aw - prevWd) > prevWd * 5) {
              issues.push({ field: "withdrawal_illustration", severity: "warn", message: `${ext.pdfName}: Y${row.policy_year} 提领金额异常波动 (${prevWd} -> ${aw})` });
            }
            if (aw > 0) prevWd = aw;
          }
        }

        const errorCount = issues.filter((i) => i.severity === "error").length;
        return json({ sessionId: session.id, validated: errorCount === 0, errorCount, warnCount: issues.filter((i) => i.severity === "warn").length, issues });
      }

      // ── Static Files ──────────────────────────────
      if (method === "GET") {
        // Decode URL-encoded characters (e.g., Chinese filenames)
        const decodedPath = decodeURIComponent(pathname);
        const servePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\//, "");
        const filePath = path.join(PUBLIC_DIR, servePath);

        // Security: prevent directory traversal
        const relative = path.relative(PUBLIC_DIR, filePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return new Response("Forbidden", { status: 403 });
        if (servePath.startsWith("downloads/")) {
          const relativeDownloadPath = servePath.replace(/^downloads\//, "");
          if (!validDownloadSignature(relativeDownloadPath, url)) {
            return new Response("Forbidden", { status: 403 });
          }
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const content = ext === ".html" ? fs.readFileSync(filePath, "utf-8") : fs.readFileSync(filePath);
          const contentType = MIME[ext] || "application/octet-stream";
          const headers: Record<string, string> = { "Content-Type": contentType, "Access-Control-Allow-Origin": "*" };
          if (ext === ".pptx") {
            // Use RFC 5987 encoding for non-ASCII filenames
            const basename = path.basename(filePath);
            headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(basename)}`;
          }
          return new Response(content, { headers });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      console.error("Error:", err);
      return json({ error: err.message }, 500);
    }
  },
});

console.log(`\n🚀 Insurance PPT Generator`);
console.log(`   http://localhost:${PORT}\n`);

// 每5分钟清理提取缓存，避免过期数据干扰
setInterval(() => {
  const cacheDir = path.resolve(import.meta.dir, '../../.cache/insurance-ppt');
  const genDir = path.join(cacheDir, 'generation');
  let count = 0;
  const rm = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rm(p);
      else { fs.unlinkSync(p); count++; }
    }
  };
  try { rm(cacheDir); if (count > 0) console.log(`[cache] 清理 ${count} 个缓存文件`); } catch {}
}, 5 * 60 * 1000);

// TEMP IUL FIX
function fixIulData(data: any): any {
  if (!data || !Array.isArray(data.benefit_illustration)) return data;
  return {
    ...data,
    benefit_illustration: data.benefit_illustration.map((r: any) => {
      if (r.cash_value != null || r.account_value != null || r.death_benefit != null) {
        return {
          ...r,
          non_guaranteed_cash_value: r.non_guaranteed_cash_value ?? r.cash_value ?? 0,
          non_guaranteed_account_value: r.non_guaranteed_account_value ?? r.account_value ?? 0,
          non_guaranteed_death_benefit: r.non_guaranteed_death_benefit ?? r.death_benefit ?? undefined,
        };
      }
      return r;
    }),
  };
}
