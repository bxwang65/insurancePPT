export const state = {
  sessionId: null,
  files: [],
  extractions: [],
  selectedStyle: 'broker',
  selectedFormat: 'pptx',
  selectedQuality: 'high',
  selectedCompanyId: '',
  companyInfo: '',
  downloadUrl: '',
  markdownUrl: '',
  previewUrls: [],
  previewPdfUrl: '',
  // 2026-09-10: 长图海报 (单产品 URL, 多产品数组)
  posterUrl: '',
  posterPerExtraction: [],
  slideCount: 0,
  validation: null,
  resultFilename: '',
  // per-product 公司映射 (key = pdfName, value = companyId)
  // 取代老的 per-type savingsCompany/ciCompany/iulCompany (多产品对比时按产品选)
  productCompanies: {},
  // 兼容老字段 (默认空, 老 UI 不再写入, 但保留以防 result-summary 等旧代码引用)
  savingsCompany: '',
  ciCompany: '',
  iulCompany: '',
};

export function resetState() {
  Object.assign(state, {
    sessionId: null, files: [], extractions: [],
    selectedStyle: 'broker', selectedFormat: 'pptx', selectedQuality: 'high',
    selectedCompanyId: '', companyInfo: '', downloadUrl: '', markdownUrl: '', previewUrls: [], previewPdfUrl: '', posterUrl: '', posterPerExtraction: [], slideCount: 0, validation: null, resultFilename: '',
    productCompanies: {},
    savingsCompany: '', ciCompany: '', iulCompany: '',
  });
}
