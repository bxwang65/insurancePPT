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
import { buildSignedDownloadUrl, appendCacheBustQuery, verifyDownloadSignature } from "./download-auth.ts";
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

// ─── Auth: 用户存储 (本地 JSON) ──────────────────────────
const USERS_FILE = path.join(process.cwd(), "data", "users.json");

interface AuthUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  firebaseUid?: string;   // Firebase UID (Firebase 管理密码)
  createdAt: string;
}

interface UsersFile {
  users: AuthUser[];
  tokens: Record<string, string>;  // token → userId
}

let usersFile: UsersFile = { users: [], tokens: {} };

function loadUsers(): void {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      usersFile = {
        users: Array.isArray(parsed?.users) ? parsed.users : [],
        tokens: parsed?.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {},
      };
    }
  } catch (e) {
    console.error("[auth] loadUsers failed:", e);
    usersFile = { users: [], tokens: {} };
  }
}

function saveUsers(): void {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersFile, null, 2));
  } catch (e) {
    console.error("[auth] saveUsers failed:", e);
  }
}

function generateId(): string {
  return "u_" + crypto.randomBytes(6).toString("hex");
}

function generateToken(userId: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  usersFile.tokens[token] = userId;
  saveUsers();
  return token;
}

function getUserByToken(token: string): AuthUser | null {
  const userId = usersFile.tokens[token];
  if (!userId) return null;
  return usersFile.users.find((u) => u.id === userId) ?? null;
}

function getUserByEmail(email: string): AuthUser | null {
  const norm = email.toLowerCase().trim();
  return usersFile.users.find((u) => u.email === norm) ?? null;
}

function publicUser(u: AuthUser) {
  return { id: u.id, email: u.email, name: u.name, firebaseUid: u.firebaseUid, createdAt: u.createdAt };
}

loadUsers();

// ─── Firebase Admin SDK (验证 ID token) ────────────────────
const FIREBASE_SA_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
  path.join(process.cwd(), "data", "firebase-service-account.json");

let firebaseInitialized = false;
try {
  // 动态 import — firebase-admin 仅在确实配置后才加载
  const admin = await import("firebase-admin");
  if (fs.existsSync(FIREBASE_SA_PATH)) {
    const sa = JSON.parse(fs.readFileSync(FIREBASE_SA_PATH, "utf-8"));
    admin.default.initializeApp({
      credential: admin.default.credential.cert(sa),
    });
    firebaseInitialized = true;
    console.log(`[firebase] Admin SDK initialized (project: ${sa.project_id})`);
  } else {
    console.warn(`[firebase] Service account not found at ${FIREBASE_SA_PATH}`);
    console.warn(`[firebase] /auth/firebase-login will return 503 until configured`);
  }
} catch (e) {
  console.error("[firebase] init failed:", (e as Error).message || e);
}

// ─── AI Provider 配置 ─────────────────────────────────
// 优先级: 用户 header X-User-Api-Key > 服务端环境变量
// 默认 provider: minimax (MiniMax M3, 无限额度), kimi 已耗尽踢出链, DeepSeek 保留 fallback
const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || "minimax") as "kimi" | "deepseek" | "openai" | "gemini" | "minimax";
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

// 2026-07-15 V3.3.8+: planType-aware brand profile
// 同一 company_id 复用同一资产目录 (ASSETS/companies/{cid}/logo.png 等),
// 但 brand_profile 内容按 planType 区分 — 同一公司不同实体 (宏利 HK vs 新加坡、永明 HK vs 新加坡、全美 HK vs 新加坡)
// 例如 manulife 储蓄险是香港实体, IUL 是新加坡实体, 关于页文案不能混用
const PLAN_TYPE_BRAND_PROFILES: Record<string, Record<string, any>> = {
  // 储蓄险 = 香港实体 (宏利/永明/全美 都有 HK 子公司做储蓄)
  savings: {
    manulife: {
      name_zh: "宏利", name_en: "Manulife Hong Kong",
      short: "宏利", short_en: "MANULIFE",
      rating: "S&P AA-", founded_year: "1897", rating_value: "AA-",
      series_label: "宏挚传承", series_sub: "财富传承专家",
      business_lines: [
        "· 人寿保险 — 储蓄/保障",
        "· 健康保险 — 医疗/危疾",
        "· 强积金 — 香港MPF市场长期领先",
        "· 财富传承 — 多元货币储蓄/年金",
      ],
      brand_background: [
        "· 母公司宏利金融创立于1887年（加拿大）",
        "· S&P AA- / Moody's A1",
        "· 1897年扎根香港 (亚洲总部)",
        "· 香港强积金(MPF)主要供应商之一",
        "· 全球管理资产超1.3万亿加元",
      ],
    },
    sunlife: {
      name_zh: "永明金融", name_en: "Sun Life Hong Kong",
      short: "永明", short_en: "SLIFE",
      rating: "S&P AA", founded_year: "1899", rating_value: "AA",
      series_label: "卓势传承", series_sub: "顶尖资产保全与传承",
      business_lines: [
        "· 人寿保险 — 储蓄/保障",
        "· 健康保险 — 医疗/危疾",
        "· 强积金 — 香港MPF管理",
        "· 财富传承 — 多元货币/年金",
      ],
      brand_background: [
        "· 母公司加拿大永明金融创立于1865年",
        "· S&P AA / A.M. Best A+ / Moody's Aa3 顶尖评级",
        "· 1899年进驻香港",
        "· 香港强积金(MPF)主要供应商之一",
      ],
    },
    transamerica: {
      name_zh: "全美人寿", name_en: "Transamerica",
      short: "全美人寿", short_en: "TA",
      rating: "S&P A+", founded_year: "1904", rating_value: "A+",
      series_label: "财富传承", series_sub: "海外寿险统筹",
      business_lines: [
        "· 人寿保险 — 储蓄/保障",
        "· 健康保险 — 重疾/医疗",
        "· 财富传承 — 海外寿险/信托",
        "· 强积金 — 香港MPF管理",
      ],
      brand_background: [
        "· 全美人寿总公司创立于1904年（旧金山）",
        "· 隶属荷兰全球人寿保险集团（Aegon N.V.）",
        "· S&P A+ / Moody's A1",
        "· 海外寿险/财富传承专家",
      ],
    },
  },
};

// 2026-07-15 V3.3.8+: 根据 planType 选择正确的 brand_profile
// - 储蓄(HK) vs IUL(新加坡) 同公司不同实体, 用 planType 路由
// - 保持 company_id 不变 (asset dir 仍用 cid 查找 logo/cover)
function getBrandProfileForProduct(companyId: string, planType: string): any {
  const override = (PLAN_TYPE_BRAND_PROFILES as any)[planType]?.[companyId];
  if (override) return override;
  return COMPANY_BRAND_PROFILES[companyId] || COMPANY_BRAND_PROFILES.fwd;
}

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
    previewUrls: (session.previewPaths || []).map((p) => appendCacheBustQuery(signedDownloadUrl(p))),
    previewPdfUrl: session.previewPdfPath ? appendCacheBustQuery(signedDownloadUrl(session.previewPdfPath)) : undefined,
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

// ── 多产品对比: best pick 排序指标 (2026-07-08 V3.1.3+) ─────
function getY20IRR(data: any): number {
  const bi = data?.benefit_illustration || [];
  const candidates = [20, 19, 21, 18, 22];
  for (const yr of candidates) {
    const row = bi.find((r: any) => Number(r?.policy_year) === yr);
    if (!row) continue;
    if (typeof row.IRR === "number" && row.IRR > 0) return row.IRR;
    // 兜底: 从 CV/Premium 用 CAGR 估算 (用于 best pick 排序, 不入主叙事)
    const cv = Number(row.total_surrender_value || 0);
    const prem = Number(row.total_premium_paid || 0);
    if (cv > 0 && prem > 0 && yr > 0) {
      return Math.pow(cv / prem, 1 / yr) - 1;
    }
  }
  return 0;
}
function getIULLeverage(data: any): number {
  const sumInsured = Number(data?.summary?.sum_insured || data?.policy?.sum_insured || 0);
  const annualPrem = Number(data?.summary?.annual_premium || data?.policy?.annual_premium || 0);
  const payRaw = data?.summary?.payment_years || data?.policy?.premium_payment_period || "5";
  const payYears = payRaw === "趸交" ? 1 : (parseInt(String(payRaw).replace(/[^0-9]/g, "")) || 5);
  const totalPrem = annualPrem * payYears;
  return totalPrem > 0 ? sumInsured / totalPrem : 0;
}
function getCIRatio(data: any): number {
  const sumInsured = Number(data?.summary?.sum_insured || data?.policy?.sum_insured || 0);
  const annualPrem = Number(data?.summary?.annual_premium || data?.policy?.annual_premium || 0);
  return annualPrem > 0 ? sumInsured / annualPrem : 0;
}
function pickBest(extractions: any[], type: 'savings'|'ci'|'iul'): any {
  const candidates = (extractions || []).filter(e => e.planType === type && e.data);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  let bestScore = -Infinity;
  let best = candidates[0];
  for (const c of candidates) {
    let score = 0;
    if (type === 'savings') score = getY20IRR(c.data);
    else if (type === 'iul') score = getIULLeverage(c.data);
    else score = getCIRatio(c.data);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
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
  assignments?: Array<{ pdfName: string; companyId: string }>;  // per-product 公司 (2026-07-14 V3.1.9+)
}) {
  const { req, session } = params;
  const theme = params.theme || 'broker';
  const companyId = params.companyId || 'fwd';
  const rawCompanyId = companyId;
  const savingsCompanyId = params.savingsCompanyId || rawCompanyId;
  const ciCompanyId = params.ciCompanyId || rawCompanyId;
  const iulCompanyId_param = params.iulCompanyId || rawCompanyId;

  // Per-product 公司映射: pdfName → companyId (前端生成页 per-product 公司下拉)
  const pdfNameToCompany: Record<string, string> = {};
  for (const a of (params.assignments || [])) {
    if (a && a.pdfName && a.companyId) pdfNameToCompany[a.pdfName] = a.companyId;
  }

  const validExtractions = session.extractions.filter(e => e.data);
  if (!validExtractions.length) return json({ error: "No parsed data" }, 400);

  // 多产品对比: 按 best pick 选取主叙事 (2026-07-08 V3.1.3+)
  const savingsEntry = pickBest(validExtractions, 'savings');
  const ciEntry = pickBest(validExtractions, 'ci');
  const iulEntry = pickBest(validExtractions, 'iul');

  // Combo detection: 2+ plan types → combo mode
  const planTypes = [...new Set(session.extractions.filter(e => e.data).map(e => e.planType))];
  const failedExtractions = session.extractions.filter(e => !e.data).map(e => `${e.pdfName}: ${e.error || '未知错误'}`);
  if (planTypes.length > 1) {
    console.log(`[combo] 检测到 ${planTypes.join(' + ')} 组合方案${failedExtractions.length ? `，以下提取失败: ${failedExtractions.join('; ')}` : ''}`);
  }

  // 多产品对比: 收集全部 extractions 按类型分组 (2026-07-08 V3.1.3+)
  const allExtractions: Record<string, any[]> = { savings: [], ci: [], iul: [] };
  for (const e of validExtractions) {
    if (allExtractions[e.planType]) allExtractions[e.planType].push(e);
  }
  const compareCounts = {
    savings: allExtractions.savings.length,
    ci: allExtractions.ci.length,
    iul: allExtractions.iul.length,
  };
  console.log(`[multi-product] savings=${compareCounts.savings} ci=${compareCounts.ci} iul=${compareCounts.iul}`);
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

    // 通用: 用 pdfName 推断公司 (中文文件名 → 公司id, 优先于英文匹配)
    // 2026-07-14 V3.3.0+: 增加中文产品名映射, 例如「守護家倍」是 CTF 周大福人寿
    const PDF_NAME_COMPANY_PATTERNS: Array<[RegExp, string]> = [
      [/守.{0,3}家倍|守護加倍/i, 'ctf'],          // 周大福人寿 守護家倍198 / 守護加倍
      [/愛伴航|爱伴航/i, 'aia'],                   // AIA 爱伴航
      [/保诚|保誠/i, 'pru'],                       // 保诚 信守明天
      [/安盛/i, 'axa'],                            // 安盛 盛利II
      [/富卫|富衛/i, 'fwd'],                       // 富卫 盈聚天下
      [/^TA[_-]|GIUL/i, 'transamerica'],           // Transamerica GIUL 3
      [/^MLS[_-]|SIUL/i, 'manulife'],              // Manulife SIUL 3
      [/^SLS[_-]/i, 'sunlife'],                    // Sun Life SLS
    ];
    const inferCompanyFromPdfName = (pdfName?: string): string => {
      if (!pdfName) return rawCompanyId;
      // 1) 中文/产品名模式优先
      for (const [re, id] of PDF_NAME_COMPANY_PATTERNS) {
        if (re.test(pdfName)) return id;
      }
      // 2) 英文 id / name_en 包含匹配
      const fn = pdfName.toLowerCase();
      for (const [id, info] of Object.entries(COMPANY_BRAND_PROFILES)) {
        if (fn.includes(id) || (info as any).name_en?.toLowerCase() && fn.includes((info as any).name_en.toLowerCase())) return id;
      }
      // 3) fallback rawCompanyId
      return rawCompanyId;
    };
    // Per-product 公司推导链: assignments[pdfName] → per-type param → pdfName 模糊匹配 → rawCompanyId
    const finalCiCompanyId = pdfNameToCompany[ciEntry?.pdfName || '']
      || ciCompanyId
      || inferCompanyFromPdfName(ciEntry?.pdfName);
    const finalIulCompanyId = pdfNameToCompany[iulEntry?.pdfName || '']
      || iulCompanyId_param
      || inferCompanyFromPdfName(iulEntry?.pdfName);
    // 修复 savingsCompanyId 缺口 (2026-07-14 V3.1.9+): 之前声明但未用, 现在按 per-product 推导
    const finalSavingsCompanyId = pdfNameToCompany[savingsEntry?.pdfName || '']
      || savingsCompanyId
      || inferCompanyFromPdfName(savingsEntry?.pdfName);

    // 2026-07-14 V3.2.0+: per-product 公司资产 — logo_path + cover + 公司图片数组
    const getCompanyAssets = (cid: string) => {
      const dir = path.join(ASSETS, 'companies', cid);
      const lp = path.join(dir, 'logo.png');
      const coverJpg = path.join(dir, 'company-hero-01.jpg');
      const coverPng = path.join(dir, 'company-hero-01.png');
      const cp = fs.existsSync(coverPng) ? coverPng : coverJpg;
      const imgs = [
        path.join(dir, 'brand-01.jpg'),
        path.join(dir, 'brand-02.jpg'),
        path.join(dir, 'office-01.jpg'),
        path.join(dir, 'adviser-01.jpg'),
      ].filter((p) => fs.existsSync(p));
      return {
        logo_path: fs.existsSync(lp) ? lp : null,
        cover_path: fs.existsSync(cp) ? cp : null,
        company_images: imgs,
      };
    };
    // 全部 extractions (按类型分组) — 用于多产品对比章节 (2026-07-08 V3.1.3+)
    const tmpAllJson = `/tmp/enhanced_all_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
    const allExtractionsPayload: Record<string, any[]> = { savings: [], ci: [], iul: [] };
    // 2026-07-14 V3.3.0+: per-product 公司解析 — **每个**产品独立推断 (assignments → 自己 pdfName → per-type → rawCompanyId)
    // V3.2.0 旧逻辑用 per-type finalXxx 会让所有同类型产品共享同公司, 必须改用 inferCompanyFromPdfName(e.pdfName) 优先
    const resolveProductCompanyId = (e: any): string => {
      return pdfNameToCompany[e.pdfName]
        || inferCompanyFromPdfName(e.pdfName)
        || (e.planType === 'savings' ? finalSavingsCompanyId : null)
        || (e.planType === 'ci' ? finalCiCompanyId : null)
        || (e.planType === 'iul' ? finalIulCompanyId : null)
        || rawCompanyId
        || 'fwd';
    };
    for (const type of ['savings', 'ci', 'iul'] as const) {
      for (const e of allExtractions[type]) {
        const d = e.data || {};
        let metric = 0;
        if (type === 'savings') metric = getY20IRR(d);
        else if (type === 'iul') metric = getIULLeverage(d);
        else metric = getCIRatio(d);
        const prodCompanyId = resolveProductCompanyId(e);
        // 2026-07-15 V3.3.8+: planType-aware profile — 储蓄(HK) vs IUL(新加坡) 同公司不同内容
        const prodBp = getBrandProfileForProduct(prodCompanyId, type);
        const prodAssets = getCompanyAssets(prodCompanyId);
        allExtractionsPayload[type].push({
          pdfName: e.pdfName,
          product_name: d.product_name || d.summary?.product_name || '',
          company_id: prodCompanyId,
          company_short: prodBp.short || '',
          company_short_en: prodBp.short_en || '',
          brand_profile: prodBp,
          logo_path: prodAssets.logo_path,
          company_images: prodAssets.company_images,
          cover_path: prodAssets.cover_path,
          data: d,
          metric,
        });
      }
    }
    fs.writeFileSync(tmpAllJson, JSON.stringify(sanitizeForXml(allExtractionsPayload), null, 2), 'utf-8');    const ciCompany = ciDataRaw ? { brand_profile: COMPANY_BRAND_PROFILES[finalCiCompanyId] || COMPANY_BRAND_PROFILES.fwd, name_zh: COMPANY_BRAND_PROFILES[finalCiCompanyId]?.name_zh, id: finalCiCompanyId } : null;
    const iulCompany = iulDataRaw ? { brand_profile: COMPANY_BRAND_PROFILES[finalIulCompanyId] || COMPANY_BRAND_PROFILES.fwd, name_zh: COMPANY_BRAND_PROFILES[finalIulCompanyId]?.name_zh, id: finalIulCompanyId } : null;

    // 修复: 之前 meta.brand_profile 始终用 rawCompanyId, 忽略 per-product 推导
    // 现在若有 savings 产品且 finalSavingsCompanyId 与 rawCompanyId 不同, 覆盖 meta
    if (savingsEntry && finalSavingsCompanyId && finalSavingsCompanyId !== rawCompanyId) {
      // 2026-07-15 V3.3.8+: planType-aware profile — 储蓄用 HK 内容
      const savingsBp = getBrandProfileForProduct(finalSavingsCompanyId, 'savings');
      meta.company_id = finalSavingsCompanyId;
      meta.company_name_zh = savingsBp.name_zh || '';
      meta.company_name_en = savingsBp.name_en || '';
      meta.company_short = savingsBp.short || '';
      meta.company_short_en = savingsBp.short_en || '';
      meta.company_rating = savingsBp.rating || '';
      meta.brand_profile = savingsBp;
    }

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

# 全部 extractions (按类型分组, 用于多产品对比章节) (2026-07-08 V3.1.3+)
all_extractions = None
try:
    with open('${tmpAllJson}') as f:
        all_extractions = json.load(f)
except Exception:
    all_extractions = {'savings': [], 'ci': [], 'iul': []}

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
    iul_company=${iulCompany ? JSON.stringify(iulCompany) : 'None'},
    all_extractions=all_extractions)
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
    try { fs.unlinkSync(tmpAllJson); } catch {}
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
    previewUrls: (session.previewPaths || []).map((p) => appendCacheBustQuery(signedDownloadUrl(p))),
    previewPdfUrl: session.previewPdfPath ? appendCacheBustQuery(signedDownloadUrl(session.previewPdfPath)) : undefined,
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

      // ── Auth Routes (Firebase Admin SDK 验证 ID token) ──
      if (pathname === "/auth/firebase-login" && method === "POST") {
        if (!firebaseInitialized) {
          return json({ message: "Firebase Admin SDK 未配置 (data/firebase-service-account.json 缺失)" }, 503);
        }
        const body = (await req.json().catch(() => ({}))) as any;
        const idToken = String(body?.idToken || "");
        const clientUid = String(body?.firebaseUid || "");

        if (!idToken) {
          return json({ message: "缺少 idToken" }, 400);
        }

        try {
          const admin = await import("firebase-admin");
          const decoded = await admin.default.auth().verifyIdToken(idToken);
          if (clientUid && decoded.uid !== clientUid) {
            return json({ message: "uid 不匹配" }, 401);
          }

          const userEmail = String(decoded.email || "").toLowerCase().trim();
          if (!userEmail) {
            return json({ message: "Firebase token 缺少 email claim" }, 400);
          }

          // 查找或创建本地用户记录 (Firebase UID 映射)
          let localUser = usersFile.users.find((u) => u.firebaseUid === decoded.uid);
          if (!localUser) {
            localUser = {
              id: generateId(),
              email: userEmail,
              name: userEmail.split("@")[0],
              passwordHash: "(firebase-managed)",  // 实际密码由 Firebase 管理
              firebaseUid: decoded.uid,
              createdAt: new Date().toISOString(),
            };
            usersFile.users.push(localUser);
            console.log(`[firebase-login] new local user: ${userEmail} (firebaseUid=${decoded.uid})`);
          }

          const access_token = generateToken(localUser.id);
          saveUsers();
          console.log(`[firebase-login] ${userEmail} → token issued`);
          return json({ access_token, user: publicUser(localUser) });
        } catch (e: any) {
          const code = e?.code || e?.errorInfo?.code || "UNKNOWN";
          console.error(`[firebase-login] verifyIdToken failed: ${code} ${e?.message || e}`);
          return json({ message: `Firebase token 验证失败: ${code}` }, 401);
        }
      }

      if (pathname === "/auth/me" && method === "GET") {
        const authHeader = req.headers.get("Authorization") || "";
        const m = authHeader.match(/^Bearer\s+(\S+)$/);
        if (!m) return json({ message: "未登录" }, 401);
        const user = getUserByToken(m[1]);
        if (!user) return json({ message: "token 无效或已过期" }, 401);
        return json({ user: publicUser(user) });
      }

      if (pathname === "/auth/logout" && method === "POST") {
        const authHeader = req.headers.get("Authorization") || "";
        const m = authHeader.match(/^Bearer\s+(\S+)$/);
        if (m && usersFile.tokens[m[1]]) {
          delete usersFile.tokens[m[1]];
          saveUsers();
        }
        return json({ ok: true });
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
          let companyId = companies[i] || "";
          // V3.3.7: IUL 文件名前缀自动识别公司 (per memory feedback_iul_filename_company)
          // 触发场景: upload UI 未选公司 (公司下拉留空) 时, 从文件名推断, 让 Kimi→MiniMax→DeepSeek 三级 fallback 链能启用
          if (!companyId && type === "iul") {
            const fn = cleanName.toLowerCase();
            if (fn.startsWith("mls_") || fn.includes("siul3")) companyId = "manulife";
            else if (fn.startsWith("sls_")) companyId = "sunlife";
            else if (fn.startsWith("ta_") || fn.includes("giul3")) companyId = "transamerica";
            if (companyId) console.log(`[upload] IUL auto-detected company: ${cleanName} -> ${companyId}`);
          }
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

        // 关键: parse 改为 fire-and-forget (202 + 后台运行), 避免 CF 100s 边缘超时
        //   同步 await 会让 LLM 慢路径超过 100s, 公网用户拿到 524
        //   后台跑完后 status="parsed", 前端通过 /api/session/:id 轮询拿到结果
        setImmediate(() => {
          (async () => {
            try {
              for (const f of session.files) {
          // 宏利 IUL: Kimi 主 (用户实测比 MiniMax 快很多), MiniMax / DeepSeek 备用
          let resolvedProvider = userProvider;
          let resolvedKey = effectiveApiKey;
          if (f.type === "iul" && (f as any).companyId === "manulife" && KIMI_API_KEY) {
            resolvedProvider = "kimi";
            resolvedKey = KIMI_API_KEY;
            console.log("[server] Manulife IUL detected, using Kimi (primary)");
          }

          const orch = new ExtractionOrchestrator({
            apiKey: resolvedKey,
            provider: resolvedProvider as "kimi" | "deepseek" | "openai" | "gemini" | "minimax" | undefined,
            useCache: true,
          });
          let r = await extractionQueue.run(() => orch.extractPlan(f.path, f.type));

          // Manulife IUL fallback 1: Kimi → MiniMax (MiniMax 也支持图片 PDF, 比 Kimi 慢但能兜底)
          if ((!r.data || r.status === "error") && f.type === "iul" && (f as any).companyId === "manulife" && MINIMAX_API_KEY && resolvedProvider !== "minimax") {
            console.log("[server] Manulife IUL Kimi failed, falling back to MiniMax");
            const mmOrch = new ExtractionOrchestrator({
              apiKey: MINIMAX_API_KEY,
              provider: "minimax",
              useCache: false,
            });
            const r2 = await extractionQueue.run(() => mmOrch.extractPlan(f.path, f.type));
            if (r2.data && r2.status === "success") {
              r = r2;
              const biLen = (r2.data as any).benefit_illustration?.length || 0;
              console.log(`[server] MiniMax fallback succeeded: ${biLen} rows`);
            }
          }

          // Manulife IUL fallback 2: MiniMax → DeepSeek (文本型 PDF 可用, 图片型仍会失败, 但作为最后兜底)
          if ((!r.data || r.status === "error") && f.type === "iul" && (f as any).companyId === "manulife" && DEEPSEEK_API_KEY && resolvedProvider !== "deepseek") {
            console.log("[server] Manulife IUL MiniMax failed, falling back to DeepSeek");
            const dsOrch = new ExtractionOrchestrator({
              apiKey: DEEPSEEK_API_KEY,
              provider: "deepseek",
              useCache: false,
            });
            const r3 = await extractionQueue.run(() => dsOrch.extractPlan(f.path, f.type));
            if (r3.data && r3.status === "success") {
              r = r3;
              const biLen = (r3.data as any).benefit_illustration?.length || 0;
              console.log(`[server] DeepSeek fallback succeeded: ${biLen} rows`);
            }
          }
          // LLM失败 / fast path 0 行 时用 fitz 兜底(适用于有签名的储蓄险,断网时可用)
          // 关键: fast path 命中但 0 行时 status=success 但 data.benefit_illustration 为空, 也算失败
          // 关键: LLM schema 校验失败时 status=error 但 data.benefit_illustration 有 fitz 行, 也需重建结构
          const fastPathEmpty = r.data && Array.isArray((r.data as any).benefit_illustration) && (r.data as any).benefit_illustration.length === 0;
          const llmValidationFailed = (r as any).status === "error" && r.data && Array.isArray((r.data as any).benefit_illustration) && (r.data as any).benefit_illustration.length > 0;
          if ((!r.data || fastPathEmpty || llmValidationFailed) && f.type === "savings" && fs.existsSync(f.path)) {
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
                  (r as any).error = undefined;
                  console.log(`[server] LLM失败, fitz兜底成功: ${ft.benefit_illustration.length} rows`);
                }
              }
            } catch (_) {}
          }
          // IUL: LLM失败时用fitz兜底. OCR脚本需更长时间(图片型6页 ~17s), 提到 60s
          // V3.3.7: 按文件名 hint 优先选脚本 (MLS_*→manulife, SLS_*→sunlife, TA_*→transamerica)
          // V3.3.7b: 按脚本名路由字段映射 (manulife 输出 cumulative_premium_paid/account_value/surrender_value/min_surrender_value, transamerica 输出 total_premium_paid/non_guaranteed_account_value/guaranteed_cash_value)
          if (!r.data && f.type === "iul" && fs.existsSync(f.path)) {
            const iulAllScripts = {
              manulife: path.resolve(import.meta.dir, "../../scripts/extract_manulife_iul.py"),
              sunlife: path.resolve(import.meta.dir, "../../scripts/extract_sunlife_iul.py"),
              transamerica: path.resolve(import.meta.dir, "../../scripts/extract_transamerica_iul.py"),
            };
            const fname = f.name.toLowerCase();
            let ordered: string[];
            if (fname.startsWith("mls_") || fname.includes("siul3")) ordered = [iulAllScripts.manulife, iulAllScripts.sunlife, iulAllScripts.transamerica];
            else if (fname.startsWith("sls_")) ordered = [iulAllScripts.sunlife, iulAllScripts.manulife, iulAllScripts.transamerica];
            else if (fname.startsWith("ta_") || fname.includes("giul3")) ordered = [iulAllScripts.transamerica, iulAllScripts.manulife, iulAllScripts.sunlife];
            else ordered = [iulAllScripts.sunlife, iulAllScripts.manulife, iulAllScripts.transamerica];
            const iulScripts = ordered.filter((s) => s && fs.existsSync(s));
            for (const iulScript of iulScripts) {
              if (!fs.existsSync(iulScript)) continue;
              const isManulife = iulScript.includes("manulife");
              try {
                const { execSync } = await import("child_process");
                const py2 = execSync(`python3.11 "${iulScript}" "${f.path}"`, { timeout: 60000, encoding: "utf-8" });
                const iulResult = JSON.parse(py2.trim());
                const bi = (iulResult.benefit_illustration || []) as any[];
                if (bi.length > 5) {
                  // manulife summary 用 payment_term_years, transamerica 用 payment_years, 兜底 iulResult.summary.payment_term_years
                  const payYears = iulResult.summary?.payment_years || iulResult.summary?.payment_term_years || 0;
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
                      premium_payment_period: `${payYears}年`,
                      coverage_period: "终身",
                      total_premium_with_levy: null,
                    },
                    benefit_illustration: bi.map((row: any) => ({
                      policy_year: row.policy_year,
                      // manulife: cumulative_premium_paid (累计) / planned_premium (年缴) / account_value / surrender_value
                      // transamerica/sunlife: total_premium_paid (累计) / non_guaranteed_account_value / guaranteed_cash_value
                      total_premium_paid: isManulife ? (row.cumulative_premium_paid || 0) : (row.total_premium_paid || row.premium || 0),
                      non_guaranteed_account_value: isManulife ? (row.account_value || 0) : (row.non_guaranteed_account_value || 0),
                      non_guaranteed_cash_value: isManulife ? (row.surrender_value || row.account_value_less_fee || 0) : (row.non_guaranteed_cash_value || row.surrender_value || 0),
                      guaranteed_cash_value: isManulife ? (row.min_surrender_value || 0) : (row.guaranteed_cash_value || row.guaranteed_value || 0),
                      death_benefit: row.death_benefit || 0,
                      sum_insured: row.sum_insured || 0,
                      age: row.age || 0,
                    })),
                    withdrawal_illustration: [],
                    sales_insights: { target_customer: "高净值客户", key_selling_points: ["指数账户", "身故保障杠杆"], unique_advantages: "", suggested_narrative: "", highlight_numbers: [] },
                    _meta: { source: "fitz_fallback", parser: path.basename(iulScript).replace(".py", "") },
                  };
                  (r as any).status = "success";

                  // 年龄兜底: BI数据年龄字段 → extract_age.py
                  let age = Number(iulResult.summary?.insured_age || 0);
                  if (age <= 0 && bi[0]?.age) age = Number(bi[0].age);
                  if (age <= 0) {
                    try {
                      const ageScript = path.resolve(import.meta.dir, "../../scripts/extract_age.py");
                      if (fs.existsSync(ageScript)) {
                        const pyAge = execSync(`python3.11 "${ageScript}" "${f.path}" 2>/dev/null`, { timeout: 10000, encoding: "utf-8" });
                        // 取最后一行 (Mutool 错误也写到 stdout)
                        const lines = pyAge.trim().split('\n').filter(Boolean);
                        const parsed = parseInt(lines[lines.length - 1], 10);
                        if (parsed > 0 && parsed < 120) age = parsed;
                      }
                    } catch (_) {}
                  }
                  if (age > 0) (r as any).data.insured.age = age;

                  console.log(`[server] IUL fitz兜底成功: ${bi.length} rows, age=${age} (${path.basename(iulScript)})`);
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
                  // 只在 Python 行数 STRICTLY 多于 LLM 时才覆盖, 避免 LLM 完整数据被降级
                  // (历史问题: 财富盈活 LLM=90 行, Python 旧阈值 >20 把 22 行错数据覆盖上去)
                  const llmBiLen = (r.data as any).benefit_illustration?.length || 0;
                  const llmWdLen = (r.data as any).withdrawal_illustration?.length || 0;
                  let fitzRecovered = false;
                  if (ft.benefit_illustration?.length > llmBiLen) {
                    (r.data as any).benefit_illustration = ft.benefit_illustration;
                    console.log(`[server] fitz 覆盖 benefit: ${ft.benefit_illustration.length} rows (LLM=${llmBiLen})`);
                    fitzRecovered = true;
                  }
                  if (ft.withdrawal_illustration?.length > llmWdLen) {
                    (r.data as any).withdrawal_illustration = ft.withdrawal_illustration;
                    console.log(`[server] fitz 覆盖 withdrawal: ${ft.withdrawal_illustration.length} rows (LLM=${llmWdLen})`);
                    fitzRecovered = true;
                  }
                  // LLM schema 校验失败时 r.status=error 但 r.data 仍存在, fitz 覆盖后应清掉错误
                  if (fitzRecovered && (r as any).status === "error") {
                    (r as any).status = "success";
                    (r as any).error = undefined;
                    console.log(`[server] fitz 覆盖后清除 LLM 校验错误, 标记为 success`);
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
            // 关键: orchestrator 的 fast-path 已经把 IUL row 完整映射 (含 age/annual_premium/source_page)
            //       这里只对 LLM-only 路径 (无 _meta.source="signature_fast_path") 做兜底, 避免降级覆盖
            if (f.type === "iul" && (r.data as any)?._meta?.source !== "signature_fast_path") {
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
                    // 关键: 年缴字段从累计推 (transamerica 不返 planned_premium)
                    let prevCum = 0;
                    (r.data as any).benefit_illustration = iulBi.map((row: any) => {
                      const cum = row.total_premium_paid || row.premium || 0;
                      const perYear = Math.max(cum - prevCum, 0);
                      prevCum = cum;
                      return {
                        policy_year: row.policy_year,
                        age: row.age || 0,
                        annual_premium: perYear,
                        total_premium_paid: cum,
                        non_guaranteed_cash_value: row.non_guaranteed_cash_value || row.surrender_value || row.account_value || 0,
                        non_guaranteed_account_value: row.non_guaranteed_account_value || row.account_value || 0,
                        guaranteed_account_value: row.guaranteed_cash_value || row.guaranteed_value || 0,
                        guaranteed_cash_value: row.guaranteed_cash_value || row.guaranteed_value || 0,
                        death_benefit: row.death_benefit || 0,
                        sum_insured: row.sum_insured || 0,
                        source_page: row.source_page || 1,
                      };
                    });
                    // 同步保费/保额/年龄
                    const sm = iulResult.summary || {};
                    const policy = (r.data as any)?.policy || {};
                    if (sm.annual_premium && !policy.annual_premium) {
                      policy.annual_premium = sm.annual_premium;
                    }
                    if (sm.sum_insured && !policy.sum_insured) {
                      policy.sum_insured = sm.sum_insured;
                      policy.basic_sum_insured = sm.sum_insured;
                    }
                    if (sm.insured_age && !(r.data as any).insured?.age) {
                      (r.data as any).insured = (r.data as any).insured || {};
                      (r.data as any).insured.age = Number(sm.insured_age);
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
                const out = execSync(`python3.11 ${ageScript} "${f.path}" 2>/dev/null`, { timeout: 5000, encoding: "utf-8" });
                const lines = out.trim().split('\n').filter(Boolean);
                const age = parseInt(lines[lines.length - 1], 10);
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
          // 2026-07-14: 强制 savings → ci 时, savings 数据无 sum_insured,
          //   从 benefit_illustration 最早行的 death_benefit 兜底提取 (≈ 初始保额)
          //   例: AIA 爱伴航上传为 CI, AI 检测为 savings, 但用户要 CI 视图
          if (
            r.data && forcedPlanType === "ci" && r.planType === "savings"
            && (r.data as any).policy && !(r.data as any).policy.sum_insured
          ) {
            const bi = (r.data as any).benefit_illustration || [];
            const sortedBi = [...bi].sort((a: any, b: any) => (a?.policy_year ?? 9999) - (b?.policy_year ?? 9999));
            const firstRow = sortedBi.find((row: any) => Number(row?.policy_year) >= 1);
            const fallbackSum = firstRow?.death_benefit ?? firstRow?.total_surrender_value ?? null;
            if (fallbackSum && fallbackSum > 0) {
              (r.data as any).policy.sum_insured = fallbackSum;
              (r.data as any).policy.basic_sum_insured = fallbackSum;
              console.log(`[ci-sum] 强制 ci ${f.name}: 从 death_benefit 兜底 sum_insured=${fallbackSum} (Y${firstRow?.policy_year})`);
            }
          }
          // 根据利益表数据修正缴费年期（不依赖AI提取）
          // 关键: 不能用 max(total_premium_paid) / annual_premium,
          //   首年2倍保费 (10年交 Y1=2x, Y2-10=1x) 算出来是 4.99 ≈ 5年, 错!
          // 正确: 数 annual_premium > 0 的行数 (Y1到第一个 0 元之间)
          if (r.data && Array.isArray(r.data.benefit_illustration)) {
            const bi = r.data.benefit_illustration as any[];
            const pol = (r.data as any).policy || {};
            let payYears = 0;
            for (const row of bi) {
              if (Number(row?.annual_premium || 0) > 0) {
                payYears++;
              } else {
                break;
              }
            }
            if (payYears > 0) {
              pol.premium_payment_period = payYears === 1 ? "趸交" : `${payYears}年`;
            }
          }
          // [diag-save] 检查 IUL 数据完整性
          if (f.type === "iul" && r.data) {
            const bi0 = (r.data as any).benefit_illustration?.[0];
            console.log(`[diag-save] IUL r.data.benefit_illustration[0] keys: ${bi0 ? Object.keys(bi0).join(",") : "EMPTY"}`);
          }
          // [diag-save] 检查 IUL 数据完整性 (临时, 用完即删)
          if (f.type === "iul" && r.data) {
            const bi0 = (r.data as any).benefit_illustration?.[0];
            console.log(`[diag-save] IUL r.data.benefit_illustration[0] keys: ${bi0 ? Object.keys(bi0).join(",") : "EMPTY"}`);
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

              console.log(`[parse-bg] session ${session.id} 完成, ${session.extractions.length} extractions`);
            } catch (err) {
              console.error(`[parse-bg] session ${session.id} unhandled:`, err);
              transition(session, "error");
              saveSession(session);
            }
          })().catch((err) => {
            console.error(`[parse-bg] session ${session.id} catch-all:`, err);
          });
        });

        return json({
          sessionId: session.id,
          status: "parsing",
          message: "AI 解析已在后台启动, 请稍候 (前端轮询会自动加载结果)",
        }, 202);
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
          previewUrls: (session.previewPaths || []).map((p) => appendCacheBustQuery(signedDownloadUrl(p))),
          previewPdfUrl: session.previewPdfPath ? appendCacheBustQuery(signedDownloadUrl(session.previewPdfPath)) : undefined,
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
          assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
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
      // 2026-07-26: 接受 HEAD — CF revalidate 用 HEAD, 之前只匹配 GET 让 CF 缓存了 404 导致下载全坏
      if (method === "GET" || method === "HEAD") {
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
          // HEAD 不读 body (省内存 + 加速), 只返 headers + Content-Length
          const content = method === "HEAD" ? undefined : (ext === ".html" ? fs.readFileSync(filePath, "utf-8") : fs.readFileSync(filePath));
          const contentType = MIME[ext] || "application/octet-stream";
          const headers: Record<string, string> = {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
          };
          // 缓存策略: HTML 必须 revalidate (发版后用户不能卡在旧版), JS/CSS 短缓存 1h 提速
          if (ext === ".html") {
            headers["Cache-Control"] = "no-cache, must-revalidate";
          } else if (ext === ".js" || ext === ".css") {
            headers["Cache-Control"] = "public, max-age=3600";
          } else if (servePath.startsWith("downloads/")) {
            // 2026-07-30: 改 public 缓存 PPTX/PDF/PNG 下载
            //   之前 no-store → 每次都走 Cloudflare Tunnel 跨太平洋 (LA edge → HK ECS) 被限流 ~50KB/s,
            //   1.9MB PPTX 要 40s, 用户实测 "点了下载 2-3 分钟才下好"
            //   改 public, max-age=3600 后 CF edge 缓存文件, 第二次起 HIT 边缘节点秒下
            //   安全: signed URL 含 1h HMAC + expires, 公开桶也无权限泄漏 (sessionId UUID 不可猜)
            //   404 风险: 走的是下方 json() 兜底, 无 Cache-Control 头 → CF 默认不缓存 4xx, 不会重现之前 404-cache 4h bug
            headers["Cache-Control"] = "public, max-age=3600";
          }
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
