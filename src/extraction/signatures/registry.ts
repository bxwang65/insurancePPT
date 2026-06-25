/**
 * 已注册的公司-产品 PDF 签名
 *
 * 新增产品：在 SIGNATURES 数组里加一项即可。
 * pageTargets 需先用 pdfplumber/肉眼核对官方计划书页码。
 */
import type { PdfSignature } from "./types.ts";

/** 生成连续页码数组 (含两端, 1-based) */
const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => i + start);

export const SIGNATURES: PdfSignature[] = [
  // ─── 周大福人寿 (CTF) ─── 储蓄险
  {
    id: "ctf-mw2iua-v1",
    companyId: "ctf",
    productCode: "MW2IUA",
    productName: "「匠心传承」储蓄寿险计划2(尊尚版)",
    planType: "savings",
    currency: "USD",
    // 注: 官方PDF 偶用 "匠X・传承" 占位符，故只锁非占位字符
    titleKeywords: ["尊尚版", "MW2IUA", "储蓄寿险计划2"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["MW2IUA"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: [...range(2, 15), ...range(30, 45)],
      withdraw: range(30, 50),
    },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 234795, tolerance: 50 },
      { label: "Y7 回本", policyYear: 7, field: "total_surrender_value", expected: 514498, tolerance: 100 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 638233, tolerance: 100 },
      { label: "Y20 总额", policyYear: 20, field: "total_surrender_value", expected: 1366345, tolerance: 200 },
      { label: "Y30 总额", policyYear: 30, field: "total_surrender_value", expected: 2782754, tolerance: 500 },
    ],
  },

  // ─── 周大福人寿 (CTF) ─── 重疾险
  {
    id: "ctf-hb4cila10-v1",
    companyId: "ctf",
    productCode: "HB4CILA10",
    productName: "「守X家倍198」危疾保障计划",
    planType: "ci",
    currency: "USD",
    // 注: PDF 实际显示 "守\n家倍198", X 字符被换行截断
    titleKeywords: ["家倍198", "HB4CILA10", "危疾保障计"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["HB4CILA10"],
    presentationHorizonYears: 100,
    pageTargets: {
      summary: 1,
      coverage: range(2, 6),
      premiumTable: range(2, 6),
    },
    crossCheckBaseline: [
      { label: "年缴保费", policyYear: 1, field: "annual_premium", expected: 4949, tolerance: 1 },
      { label: "保额", policyYear: 1, field: "sum_insured", expected: 100000, tolerance: 100 },
    ],
  },

  // ─── 友邦保险 (AIA) ───
  {
    id: "aia-huanyu5-v1",
    companyId: "aia",
    productCode: "HUANYU5",
    productName: "「环宇盈活」储蓄保险计划（5年缴费）",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["环宇盈活", "储蓄保险计划"],
    firstPageMustContain: ["受保人", "保单货币"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: [...range(2, 5), ...range(10, 17)],
      withdraw: range(14, 21),
      withdrawRemainder: range(17, 21),
    },
    crossCheckBaseline: [
      { label: "Y7 提领年额", policyYear: 7, field: "annual_withdrawal", expected: 35000, tolerance: 100 },
      { label: "Y20 累计提领", policyYear: 20, field: "cumulative_withdrawal", expected: 525006, tolerance: 500 },
    ],
  },
  {
    id: "aia-we2-v1",
    companyId: "aia",
    productCode: "WE2",
    productName: "「财富挚2」储蓄保险计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["财富", "挚2", "WE2"],
    firstPageMustContain: ["受保人", "保单货币"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: range(2, 10),
      withdraw: range(25, 35),
    },
  },

  // ─── 保诚 (Prudential) ───
  {
    id: "pru-caesars-v1",
    companyId: "pru",
    productCode: "CAESARS",
    productName: "「隽富」多元货币计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["隽富", "多元货币"],
    firstPageMustContain: ["受保人", "保单货币"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: [2, 3, 4],
    },
  },

  // ─── 宏利 (Manulife) ───
  {
    id: "manulife-spark-v1",
    companyId: "manulife",
    productCode: "SPARK",
    productName: "「丰誉传承」储蓄计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["丰誉", "传承"],
    firstPageMustContain: ["受保人", "保单货币"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: [2, 3],
    },
  },
  {
    id: "manulife-lovehome-v1",
    companyId: "manulife",
    productCode: "MIAHJ",
    productName: "「宏挚家传承」保险计划(5年缴费)",
    planType: "savings",
    currency: "USD",
    // 注: PDF 实际显示 "宏\n  家傳承", X 字符被换行+空格替代
    titleKeywords: ["家傳承保險計劃", "保費繳付期: 5 年", "MIAHJ"],
    firstPageMustContain: ["擬受保人", "貨幣", "保費繳付期"],
    productCodeAliases: ["MIAHJ", "LoveHome", "2606177"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: [4, 5, 6, 7],
      withdraw: [8, 9, 10, 11],
    },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 996353, tolerance: 200 },
      { label: "Y10 退保总额", policyYear: 10, field: "total_surrender_value", expected: 2657398, tolerance: 500 },
      { label: "Y20 退保总额", policyYear: 20, field: "total_surrender_value", expected: 5545082, tolerance: 1000 },
      { label: "Y30 退保总额", policyYear: 30, field: "total_surrender_value", expected: 11709541, tolerance: 1000 },
      { label: "Y20 提领年额", policyYear: 20, field: "annual_withdrawal", expected: 77929, tolerance: 200 },
      { label: "Y30 提领年额", policyYear: 30, field: "annual_withdrawal", expected: 39498, tolerance: 200 },
    ],
  },

  // ─── 富卫 (FWD) ───
  {
    id: "fwd-atar2-v1",
    companyId: "fwd",
    productCode: "GFC5",
    productName: "「盈聚天下II保险计划」(5年供)",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["天下II保险计划", "5 年供", "GFC5"],
    firstPageMustContain: ["被保人姓名", "保单货币", "投保时每年总保费"],
    presentationHorizonYears: 80,
    pageTargets: {
      summary: 1,
      noWithdraw: range(2, 15),
      withdraw: range(15, 22),
    },
    productCodeAliases: ["GFC5", "ATAR2", "天下II", "盈聚天下II"],
    crossCheckBaseline: [
      { label: "Y20 退保总额", policyYear: 20, field: "total_surrender_value", expected: 5727912, tolerance: 1000 },
      { label: "Y30 退保总额", policyYear: 30, field: "total_surrender_value", expected: 11709282, tolerance: 1000 },
      { label: "Y20 提领年额", policyYear: 20, field: "annual_withdrawal", expected: 200000, tolerance: 10 },
      { label: "Y30 提领年额", policyYear: 30, field: "annual_withdrawal", expected: 200000, tolerance: 10 },
    ],
  },

  // ─── 太平洋保险 (CPIC) ─── 储蓄险
  {
    id: "cpic-aarj31u-v1",
    companyId: "cpic",
    productCode: "AARJ31U",
    productName: "世代悅享儲蓄保險計劃3",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["悅享儲蓄保險計劃3", "AARJ31U", "建議書摘要"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["AARJ31U"],
    presentationHorizonYears: 130,
    pageTargets: {
      summary: 1,
      noWithdraw: range(2, 6),
      withdraw: range(6, 12),
    },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 325310, tolerance: 100 },
      { label: "Y10 退保总额", policyYear: 10, field: "total_surrender_value", expected: 659184, tolerance: 100 },
      { label: "Y20 退保总额", policyYear: 20, field: "total_surrender_value", expected: 1438104, tolerance: 200 },
    ],
  },

  // ─── 中国人寿 (China Life) ─── 储蓄险
  {
    id: "chinalife-c540-v1",
    companyId: "chinalife",
    productCode: "C540",
    productName: "傲瓏盛世儲蓄保險計劃(美元)",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["傲", "盛世儲蓄", "C540"],
    firstPageMustContain: ["受保人", "保單貨幣"],
    productCodeAliases: ["C540"],
    presentationHorizonYears: 130,
    pageTargets: { summary: 1, noWithdraw: range(2, 15) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 97950, tolerance: 100 },
      { label: "Y10 退保总额", policyYear: 10, field: "total_surrender_value", expected: 648979, tolerance: 200 },
    ],
  },

  // ─── 万通保险 (YFLife) ─── 储蓄险
  {
    id: "yflife-bisp5-v1",
    companyId: "yflife",
    productCode: "BISP5",
    productName: "富饒萬家儲蓄保險計劃 (5年繳付)",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["富", "万家储蓄", "BISP5"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["BISP5"],
    presentationHorizonYears: 80,
    pageTargets: { summary: 1, noWithdraw: range(2, 12) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 150733, tolerance: 100 },
      { label: "Y10 退保总额", policyYear: 10, field: "total_surrender_value", expected: 636178, tolerance: 200 },
    ],
  },

  // ─── 中国太平 (China Taiping) ─── 储蓄险
  {
    id: "china-taiping-1121nwlp7-v1",
    companyId: "china-taiping",
    productCode: "1121NWLP7",
    productName: "「頤·樂享」儲蓄保險計劃(尊享版)",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["頤", "樂享", "1121NWLP7"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["1121NWLP7"],
    presentationHorizonYears: 130,
    pageTargets: { summary: 1, noWithdraw: range(2, 12), withdraw: range(12, 22) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 315234, tolerance: 100 },
      { label: "Y10 退保总额", policyYear: 10, field: "total_surrender_value", expected: 638914, tolerance: 200 },
    ],
  },

  // ─── 中国太平 ─── 鑫安逸储蓄保险
  {
    id: "china-taiping-xinanyi-v1",
    companyId: "china-taiping",
    productCode: "AAXNA1U",
    productName: "安逸储蓄保险计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["安逸儲蓄保險", "AAXNA1U"],
    firstPageMustContain: ["保單貨幣", "保障摘要"],
    productCodeAliases: ["AAXNA1U"],
    presentationHorizonYears: 30,
    pageTargets: { summary: 1, noWithdraw: range(2, 4) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 244403, tolerance: 100 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 392305, tolerance: 200 },
    ],
  },

  // ─── 友邦 (AIA) ─── 财富盈活储蓄保险计划
  {
    id: "aia-cfyh-v1",
    companyId: "aia",
    productCode: "CFYH",
    productName: "财富盈活储蓄保险计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["财", "盈活储蓄保险计划"],
    firstPageMustContain: ["受保人", "保单货币"],
    productCodeAliases: ["CFYH"],
    presentationHorizonYears: 100,
    pageTargets: { summary: 1, noWithdraw: range(2, 15), withdraw: range(15, 28) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 235858, tolerance: 200 },
    ],
  },

  // ─── 忠意人寿 (Generali) ─── 启航创富卓越版
  {
    id: "generali-qihang-v1",
    companyId: "generali",
    productCode: "WPD",
    productName: "启航创富卓越版",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["WPD", "创富 (卓越版)"],
    firstPageMustContain: ["受保人姓名", "保单货币"],
    productCodeAliases: ["WPD"],
    presentationHorizonYears: 50,
    pageTargets: { summary: 1, noWithdraw: range(2, 5), withdraw: range(8, 18) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 240083, tolerance: 200 },
    ],
  },

  // ─── 安盛 (AXA) ─── 储蓄险
  {
    id: "axa-shengli2-v1",
    companyId: "axa",
    productCode: "WEB05",
    productName: "盛利II储蓄保险–至尊",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["WEB05", "至尊"],
    firstPageMustContain: ["被保人姓名", "保單貨幣"],
    productCodeAliases: ["WEB05", "盛利II"],
    presentationHorizonYears: 130,
    pageTargets: {
      summary: 1,
      noWithdraw: range(2, 10),
      withdraw: range(10, 16),
    },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 366420, tolerance: 200 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 660340, tolerance: 200 },
      { label: "Y20 总额", policyYear: 20, field: "total_surrender_value", expected: 1387972, tolerance: 500 },
    ],
  },

  // ─── 保诚 (Prudential) ─── 储蓄险
  {
    id: "pru-trst-v1",
    companyId: "pru",
    productCode: "TRST",
    productName: "「信守明天」多元貨幣計劃",
    planType: "savings",
    currency: "USD",
    // 注: PDF 中文字被换行分割 ("信"+"明天"), 所以不匹配 "信守明天"
    titleKeywords: ["明天多元貨幣", "TRST"],
    firstPageMustContain: ["受保人", "保單貨幣"],
    productCodeAliases: ["TRST", "信守明天"],
    presentationHorizonYears: 100,
    pageTargets: {
      summary: 1,
      noWithdraw: [...range(2, 5), ...range(11, 16)],
      withdraw: range(16, 24),
    },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 256594, tolerance: 100 },
      { label: "Y7 回本", policyYear: 7, field: "total_surrender_value", expected: 436102, tolerance: 200 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 639196, tolerance: 200 },
      { label: "Y20 总额", policyYear: 20, field: "total_surrender_value", expected: 1385670, tolerance: 500 },
      { label: "Y30 总额", policyYear: 30, field: "total_surrender_value", expected: 2926411, tolerance: 1000 },
    ],
  },

  // ─── 宏利 (Manulife) ─── 宏挚传承保障计划
  {
    id: "manulife-hongzhi-v1",
    companyId: "manulife",
    productCode: "2606171",
    productName: "宏挚传承保障计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["傳承保障計劃", "2606171"],
    firstPageMustContain: ["擬受保人", "貨幣"],
    productCodeAliases: ["2606171"],
    presentationHorizonYears: 80,
    pageTargets: { summary: 1, noWithdraw: range(2, 10), withdraw: range(10, 20) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 263352, tolerance: 200 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 602526, tolerance: 200 },
      { label: "Y20 总额", policyYear: 20, field: "total_surrender_value", expected: 1111564, tolerance: 500 },
    ],
  },

  // ─── 宏利 (Manulife) ─── 宏挚家传承保险计划
  {
    id: "manulife-jiachuan-v1",
    companyId: "manulife",
    productCode: "MIAHJ",
    productName: "宏挚家传承保险计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["家傳承保險計劃", "MIAHJ"],
    firstPageMustContain: ["擬受保人", "貨幣"],
    productCodeAliases: ["MIAHJ"],
    presentationHorizonYears: 80,
    pageTargets: { summary: 1, noWithdraw: range(2, 8), withdraw: range(8, 14) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 996353, tolerance: 200 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 2657398, tolerance: 500 },
    ],
  },


  // ─── 周大福 (CTF) ─── 匠心飞越储蓄保险计划
  {
    id: "ctf-jiangxinfeiyue-v1",
    companyId: "ctf",
    productCode: "MW3U",
    productName: "匠心飞越储蓄保险计划",
    planType: "savings",
    currency: "USD",
    titleKeywords: ["匠", "飞越", "MW3U"],
    firstPageMustContain: ["受保人姓名", "保单货币"],
    productCodeAliases: ["MW3U"],
    presentationHorizonYears: 100,
    pageTargets: { summary: 1, noWithdraw: [...range(2, 6), ...range(26, 30)], withdraw: range(34, 44) },
    crossCheckBaseline: [
      { label: "Y5 退保总额", policyYear: 5, field: "total_surrender_value", expected: 139170, tolerance: 200 },
      { label: "Y10 总额", policyYear: 10, field: "total_surrender_value", expected: 661472, tolerance: 200 },
      { label: "Y20 总额", policyYear: 20, field: "total_surrender_value", expected: 1433573, tolerance: 500 },
    ],
  },

  // ─── 永明新加坡 IUL ────────────────────────────
  {
    id: "sunlife-sbiul2-v1",
    companyId: "sunlife",
    productCode: "SBIUL2",
    productName: "Sun Life 新加坡 IUL",
    planType: "iul",
    currency: "USD",
    titleKeywords: ["保障金额", "初始保费", "指数账户"],
    firstPageMustContain: ["受保人", "货币"],
    productCodeAliases: ["SBIUL2", "SLS_SBIUL2"],
    presentationHorizonYears: 120,
    pageTargets: { summary: 1 },
  },

  // ─── 宏利新加坡 IUL ────────────────────────────
  {
    id: "manulife-siul3-v1",
    companyId: "manulife",
    productCode: "SIUL3",
    productName: "Manulife 新加坡 IUL",
    planType: "iul",
    currency: "USD",
    // 关键: PDF 几乎全图片, 走 OCR (eng+chi_tra)
    // 不能依赖 "Manulife" / "SIUL3" 等英文 (PDF 不含), 改用 PDF 中实际存在的繁体中文
    titleKeywords: ["保單摘要", "附屬說明", "指數賬戶", "S&P 500"],
    firstPageMustContain: ["保單名稱", "受保人的風險等級", "上一次生日年齡"],
    productCodeAliases: ["SIUL3", "MLS_SIUL3"],
    presentationHorizonYears: 120,
    pageTargets: {
      summary: 1,
      premiumTable: [2, 3, 4, 5],  // 附屬說明 利益表所在页 (最高收費 + 當前收費)
    },
  },

  // ─── 全美新加坡 IUL ────────────────────────────
  {
    id: "transamerica-giul3-v1",
    companyId: "transamerica",
    productCode: "GIUL3",
    productName: "Transamerica 新加坡 IUL",
    planType: "iul",
    currency: "USD",
    titleKeywords: ["GIUL3", "首日现金价值", "指数"],
    firstPageMustContain: ["保单", "现金价值"],
    productCodeAliases: ["GIUL3", "TA_GIUL3"],
    presentationHorizonYears: 120,
    pageTargets: { summary: 1 },
  },
];

const SIGNATURE_INDEX = new Map(SIGNATURES.map((s) => [s.id, s]));

export function getSignatureById(id: string): PdfSignature | undefined {
  return SIGNATURE_INDEX.get(id);
}

export function getSignaturesByCompany(companyId: string): PdfSignature[] {
  return SIGNATURES.filter((s) => s.companyId === companyId);
}

export function getSignaturesByProductCode(productCode: string): PdfSignature[] {
  return SIGNATURES.filter((s) => s.productCode === productCode || s.productCodeAliases?.includes(productCode));
}
