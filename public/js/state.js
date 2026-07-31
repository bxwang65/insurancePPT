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
  slideCount: 0,
  validation: null,
  resultFilename: '',
  // 三端口公司选择
  savingsCompany: '',
  ciCompany: '',
  iulCompany: '',
};

export function resetState() {
  Object.assign(state, {
    sessionId: null, files: [], extractions: [],
    selectedStyle: 'broker', selectedFormat: 'pptx', selectedQuality: 'high',
    selectedCompanyId: '', companyInfo: '', downloadUrl: '', markdownUrl: '', previewUrls: [], previewPdfUrl: '', slideCount: 0, validation: null, resultFilename: '',
    savingsCompany: '', ciCompany: '', iulCompany: '',
  });
}
