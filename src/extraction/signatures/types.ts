/**
 * PDF 签名注册表（公司-产品级别）
 *
 * 设计目标：
 * 1. 在调用 LLM 之前，用纯规则识别"这 PDF 来自哪个公司、哪个产品"
 * 2. 命中后直接走专用 extractor（pdfplumber 按页提取），跳过 30s+ 的 Gemini
 * 3. 命中失败 / 多公司冲突 → fallback 到 LLM
 */

export type PlanType = "savings" | "ci" | "iul";

export interface PageTargets {
  /** 不提领表的页码列表（1-based） */
  noWithdraw?: number[];
  /** 提领表演示页码列表 */
  withdraw?: number[];
  /** 提领后剩余价值表演示页码列表（部分 AIA 计划有） */
  withdrawRemainder?: number[];
  /** 投保摘要页（受保人姓名/年龄/性别/保额） */
  summary?: number;
  /** CI 保障范围页（重疾险专用） */
  coverage?: number[];
  /** CI/IUL 保费表页 */
  premiumTable?: number[];
}

export interface PdfSignature {
  /** 唯一签名 ID (例: ctf-mw2iua-v1) */
  id: string;
  companyId: string;
  productCode: string;
  productName: string;
  planType: PlanType;
  currency: "USD" | "HKD" | "RMB" | string;
  /** 必须出现在 PDF 标题区/首页的关键词（全部命中） */
  titleKeywords: string[];
  /** 首页必须包含的关键词（用于公司层校验） */
  firstPageMustContain: string[];
  /** 精确页码锚点（命中后可跳过全页扫描） */
  pageTargets: PageTargets;
  /** 演示口径（默认 80 年） */
  presentationHorizonYears?: number;
  /** 该签名已知的产品代号（如 MW2IUA / WE2 / HUANYU5） */
  productCodeAliases?: string[];
  /** 关键数字交叉验证基线（可选） */
  crossCheckBaseline?: Array<{
    label: string;
    policyYear: number;
    field: string;
    expected: number;
    tolerance?: number;
  }>;
}

export interface PdfSignatureMatch {
  signature: PdfSignature;
  /** 0..1，签名字段命中率 */
  confidence: number;
  /** 命中的原因（用于日志） */
  matchedKeywords: string[];
  matchedBy: "exact_title" | "partial_title" | "product_code" | "first_page_only";
}
