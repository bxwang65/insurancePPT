/**
 * PDF 签名匹配器
 *
 * 接收 PDF 前 1-2 页文本（含标题、产品代号），返回最佳签名匹配
 */
import type { PdfSignature, PdfSignatureMatch } from "./types.ts";
import { getAllSignatures } from "./registry-auto.ts";

export interface MatchInput {
  /** PDF 前 N 页纯文本（PyMuPDF.get_text()） */
  firstPagesText: string;
  /** 是否检测到产品代号（例：MW2IUA 在文中出现） */
  detectedProductCode?: string;
}

function scoreMatch(sig: PdfSignature, input: MatchInput): { score: number; matchedKeywords: string[]; matchedBy: PdfSignatureMatch["matchedBy"] } {
  const text = input.firstPagesText;
  const matchedKeywords: string[] = [];
  let totalTitleKw = sig.titleKeywords.length;
  let titleHit = 0;
  for (const kw of sig.titleKeywords) {
    if (kw && text.includes(kw)) {
      matchedKeywords.push(kw);
      titleHit++;
    }
  }
  const firstPageHits = sig.firstPageMustContain.filter((kw) => text.includes(kw)).length;
  const firstPageRatio = sig.firstPageMustContain.length === 0
    ? 1
    : firstPageHits / sig.firstPageMustContain.length;
  const titleRatio = totalTitleKw === 0 ? 1 : titleHit / totalTitleKw;

  // 产品代号命中（强信号）
  let codeHit = false;
  if (input.detectedProductCode) {
    if (sig.productCode === input.detectedProductCode) codeHit = true;
    if (sig.productCodeAliases?.includes(input.detectedProductCode)) codeHit = true;
  }

  let matchedBy: PdfSignatureMatch["matchedBy"] = "first_page_only";
  if (codeHit && titleRatio === 1) matchedBy = "exact_title";
  else if (titleRatio === 1) matchedBy = "exact_title";
  else if (titleRatio >= 0.5) matchedBy = "partial_title";
  else if (codeHit) matchedBy = "product_code";

  // 综合分：title 60% + firstPage 30% + code 10%
  const score = titleRatio * 0.6 + firstPageRatio * 0.3 + (codeHit ? 0.1 : 0);
  return { score, matchedKeywords, matchedBy };
}

/** 返回最佳签名（单一） */
export function matchPdfSignature(input: MatchInput): PdfSignatureMatch | null {
  let best: PdfSignatureMatch | null = null;
  for (const sig of getAllSignatures()) {
    const { score, matchedKeywords, matchedBy } = scoreMatch(sig, input);
    if (score < 0.5) continue; // 阈值：至少 50% 匹配
    if (!best || score > best.confidence) {
      best = {
        signature: sig,
        confidence: score,
        matchedKeywords,
        matchedBy,
      };
    }
  }
  return best;
}

/** 返回所有可能的签名（用于多公司冲突检测） */
export function matchPdfSignatureAll(input: MatchInput, threshold = 0.5): PdfSignatureMatch[] {
  const out: PdfSignatureMatch[] = [];
  for (const sig of getAllSignatures()) {
    const { score, matchedKeywords, matchedBy } = scoreMatch(sig, input);
    if (score < threshold) continue;
    out.push({ signature: sig, confidence: score, matchedKeywords, matchedBy });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/** 从 PDF 全文中检测产品代号（如 MW2IUA / WE2 / HUANYU5） */
export function detectProductCodeFromText(text: string): string | undefined {
  const codePattern = /\b(MW\d+[A-Z]+|WE\d+|HUANYU\d+|CAESARS|SPARK|ATAR|TRST|WEB\d+|AAXNA1U|MW3U|2606171|WPD|MIAHJ|CFYH)\b/i;
  const m = text.match(codePattern);
  return m ? m[1].toUpperCase() : undefined;
}
