import fs from "fs";
import path from "path";
import { generatePresentationArtifact } from "../src/api/generation-service.ts";
import { MultiAgentPipeline } from "../src/pipeline/orchestrator.ts";
import type { ExtractionInput, PipelineRequest } from "../src/pipeline/types.ts";
import { matchCompanyKnowledge } from "../src/config/company-kb.ts";
import { resolveTemplatePreset } from "../src/config/render-presets.ts";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const sessionId = getArg("--session") || "01907ac5";
const tenantId = getArg("--tenant") || "ctf";
const userId = getArg("--user") || "demo-user";
const customerName = getArg("--customer") || "尊贵客户";
const format = (getArg("--format") as "pptx" | "pdf" | "both" | undefined) || "both";
const quality = (getArg("--quality") as "standard" | "high" | undefined) || "high";
const stylePreset = resolveTemplatePreset(getArg("--style"));

const sessionPath = path.resolve("sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionPath)) throw new Error(`Session not found: ${sessionPath}`);
const s = JSON.parse(fs.readFileSync(sessionPath, "utf8"));

// 从 session.files 拿真实 PDF 路径
const fileMap = new Map<string, string>();
for (const f of (s.files || [])) {
  if (f.path) fileMap.set(f.name, f.path);
}

const extractions: ExtractionInput[] = (s.extractions || [])
  .filter((e: any) => e.data)
  .map((e: any) => ({
    pdfName: e.pdfName,
    pdfPath: fileMap.get(e.pdfName) || undefined,
    planType: e.planType,
    data: e.data,
  }));
if (!extractions.length) throw new Error("No extractions found in session");

// 强制公司: 用第一份 PDF 的产品名做公司识别
const productName = extractions[0].data?.product_name || "";
const knowledge = matchCompanyKnowledge({
  productName,
  forcedCompanyId: tenantId,
});

const req: PipelineRequest = {
  tenantId,
  userId,
  sessionId,
  customerName,
  outputStem: `${sessionId}_${tenantId}_${userId}`,
  quality,
  format,
  stylePreset,
  companyContext: {
    companyId: knowledge.companyId,
    companyName: knowledge.companyName,
    evidenceFiles: knowledge.evidenceFiles,
  },
  extractions,
};

console.log(`[Pipeline] session=${sessionId} tenant=${tenantId} company=${knowledge.companyId} style=${stylePreset} quality=${quality} products=${extractions.length}`);
console.log(`[Pipeline] evidence files: ${knowledge.evidenceFiles.length}`);

const signatureId = (extractions[0]?.data as any)?.source?.signatureId || (extractions[0]?.data as any)?._meta?.signatureId;
if (quality === "standard" && extractions.length === 1 && signatureId && extractions[0].planType === "savings") {
  const currentUser = userId;
  const targetStem = `${sessionId}_${tenantId}_${userId}`;
  const targetDir = path.resolve("outputs", `${targetStem}_pipeline`);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPptPath = path.join(targetDir, "deck.pptx");
  const targetMdPath = path.join(targetDir, "deck.marp.md");
  const result = await generatePresentationArtifact({
    session: s,
    ownerId: currentUser,
    companyId: knowledge.companyId,
    companyName: knowledge.companyName,
    style: stylePreset,
    stylePreset,
    quality,
    outputFormat: format === "pdf" ? "pdf" : "pptx",
    templateId: undefined,
    companyContext: {
      companyId: knowledge.companyId,
      companyName: knowledge.companyName,
      evidenceFiles: knowledge.evidenceFiles,
    },
    savingsMetrics: undefined,
    customerName,
    userId,
    outputStem: targetStem,
    targets: {
      pptPath: targetPptPath,
      markdownPath: targetMdPath,
      pdfPath: format === "pdf" ? path.join(targetDir, "deck.pdf") : undefined,
    },
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  const p = new MultiAgentPipeline();
  const result = await p.run(req);
  console.log(JSON.stringify(result, null, 2));
}
