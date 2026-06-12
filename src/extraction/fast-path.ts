/**
 * 签名快路径: 命中 PDF 签名后直接走专用 extractor
 *
 * 用法:
 *   const result = await tryFastExtraction(pdfPath);
 *   → { matched: boolean, signature?, data?, reason? }
 */
import { getFirstPagesSnapshot } from "./pdf-first-pages.ts";
import { detectProductCodeFromText, matchPdfSignature, matchPdfSignatureAll } from "./signatures/matcher.ts";
import { extractBySignature, type SignatureExtractionResult } from "./signature-extractor.ts";
import type { PdfSignature, PdfSignatureMatch } from "./signatures/types.ts";

export interface FastExtractionOutcome {
  matched: boolean;
  signature?: PdfSignature;
  match?: PdfSignatureMatch;
  data?: SignatureExtractionResult;
  durationMs: number;
  reason?: string;
  alternatives?: PdfSignatureMatch[];
}

export async function tryFastExtraction(pdfPath: string, options: {
  requiredCompanyId?: string;
  minConfidence?: number;
} = {}): Promise<FastExtractionOutcome> {
  const t0 = Date.now();
  const minConfidence = options.minConfidence ?? 0.7;

  // 1. 取前 2 页文本
  const snap = await getFirstPagesSnapshot(pdfPath, 2);
  const code = detectProductCodeFromText(snap.firstPagesText);

  // 2. 多签名冲突检测
  const all = matchPdfSignatureAll({ firstPagesText: snap.firstPagesText, detectedProductCode: code }, 0.5);

  if (all.length === 0) {
    return { matched: false, durationMs: Date.now() - t0, reason: "no_signature_match" };
  }

  // 3. 强制公司要求
  let best: PdfSignatureMatch | undefined = all[0];
  if (options.requiredCompanyId) {
    const forced = all.find((m) => m.signature.companyId === options.requiredCompanyId);
    if (!forced) {
      return {
        matched: false, durationMs: Date.now() - t0,
        reason: `forced_company_mismatch: required=${options.requiredCompanyId}, candidates=${all.map((m) => m.signature.companyId).join(",")}`,
        alternatives: all,
      };
    }
    best = forced;
  }

  if (best.confidence < minConfidence) {
    return {
      matched: false, match: best, durationMs: Date.now() - t0,
      reason: `low_confidence_${best.confidence.toFixed(2)}`,
      alternatives: all,
    };
  }

  // 4. 调用专用 extractor
  try {
    const data = await extractBySignature(pdfPath, best.signature);
    if (!data.ok) {
      return { matched: false, signature: best.signature, match: best, durationMs: Date.now() - t0, reason: `extractor_error: ${data.error}` };
    }
    return { matched: true, signature: best.signature, match: best, data, durationMs: Date.now() - t0 };
  } catch (e: any) {
    return { matched: false, signature: best.signature, match: best, durationMs: Date.now() - t0, reason: `extractor_threw: ${e.message}` };
  }
}
