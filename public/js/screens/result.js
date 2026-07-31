/* =========================================================================
   Screen 5: Result - 完成 + 下载
   ========================================================================= */

import { state, resetState } from '../state.js';
import { downloadSignedFile } from '../api.js';
import { goStep, toast } from '../steps.js';
import { renderSummaryTo, showIntervalDialog } from './result-summary.js';

const STYLE_NAMES = {
  broker:   '专业券商风',
  business: '商务风',
  minimal:  '简洁风',
  chinese:  '中国风',
  ink:      '水墨风',
};

function setPreview(index = 0) {
  const image = document.getElementById('resultPreviewImage');
  const empty = document.getElementById('resultPreviewEmpty');
  const badge = document.getElementById('resultPreviewBadge');
  const urls = state.previewUrls || [];
  if (!image || !empty || !badge) return;
  if (!urls.length) {
    image.classList.add('hidden');
    empty.classList.remove('hidden');
    badge.classList.add('hidden');
    return;
  }
  const safeIndex = Math.max(0, Math.min(index, urls.length - 1));
  image.src = urls[safeIndex];
  image.classList.remove('hidden');
  empty.classList.add('hidden');
  badge.textContent = `${String(safeIndex + 1).padStart(2, '0')} / ${String(state.slideCount || urls.length).padStart(2, '0')}`;
  badge.classList.remove('hidden');
}

function renderThumbs() {
  const wrap = document.getElementById('resultThumbs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const urls = state.previewUrls || [];
  if (!urls.length) return;
  urls.slice(0, 8).forEach((url, i) => {
    const btn = document.createElement('button');
    btn.className = `result-thumb flex-shrink-0 w-24 aspect-video rounded-lg overflow-hidden border ${i === 0 ? 'border-2 border-primary-container' : 'border-border-subtle'} bg-surface-container-low shadow-sm`;
    btn.innerHTML = `<img src="${url}" alt="第 ${i + 1} 页缩略图" class="w-full h-full object-cover" />`;
    btn.onclick = () => {
      document.querySelectorAll('.result-thumb').forEach((x) => {
        x.classList.remove('border-2', 'border-primary-container');
        x.classList.add('border', 'border-border-subtle');
      });
      btn.classList.remove('border', 'border-border-subtle');
      btn.classList.add('border-2', 'border-primary-container');
      setPreview(i);
    };
    wrap.appendChild(btn);
  });
}

function render() {
  const fnEl = document.getElementById('resultFilename');
  if (fnEl) fnEl.textContent = state.resultFilename || 'plan.pptx';
  const ext = (state.resultFilename || '').toLowerCase().endsWith('.pdf') ? 'PDF' : 'PPTX';
  const styleName = STYLE_NAMES[state.selectedStyle] || '专业券商风';
  const styleEl = document.getElementById('resultStyleName');
  if (styleEl) styleEl.textContent = styleName;
  const summary = document.getElementById('resultSummary');
  if (summary) {
    const products = (state.extractions || []).map(e => e.productName).filter(Boolean);
    summary.textContent = products.length > 0
      ? `已为 ${products.join(' + ')} 联合定制方案`
      : '已为您生成定制方案';
  }
  const metaValue = document.getElementById('resultMetaValue');
  if (metaValue) {
    const kinds = [...new Set((state.extractions || []).map((e) => e.planType).filter(Boolean))];
    metaValue.textContent = state.slideCount ? `${state.slideCount}页` : (kinds.length > 1 ? `${kinds.length}类产品` : '已完成');
  }
  const mdBtn = document.getElementById('resultDownloadMdBtn');
  if (mdBtn) mdBtn.style.display = state.markdownUrl ? 'flex' : 'none';
  const downloadBtn = document.getElementById('resultDownloadBtn');
  if (downloadBtn) {
    downloadBtn.innerHTML = `<span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">file_download</span> 下载 .${ext}`;
  }
  renderBanners();
  renderThumbs();
  setPreview(0);
}

// 顶部 banner: 对比模式提示 + 解析失败警告
function renderBanners() {
  const screen = document.getElementById('screen-result');
  if (!screen) return;
  const main = screen.querySelector('main');
  if (!main) return;

  // 移除旧 banner
  const oldBanners = main.querySelectorAll('.result-banner');
  oldBanners.forEach((b) => b.remove());

  // Banner 1: 对比模式已启用
  if (state.compareMode && (state.compareTypes || []).length > 0) {
    const labels = { savings: '储蓄险', ci: '重疾险', iul: 'IUL' };
    const typeNames = (state.compareTypes || []).map((t) => labels[t] || t).join('、');
    const banner = document.createElement('div');
    banner.className = 'result-banner w-full mb-4 px-4 py-3 bg-primary-container/10 border border-primary-container/30 rounded-xl flex items-start gap-2 text-sm text-on-surface';
    banner.innerHTML = `
      <span class="material-symbols-outlined text-primary-container text-[20px] flex-shrink-0 mt-0.5">compare_arrows</span>
      <div class="flex-1">
        <div class="font-semibold text-primary-container">已启用产品对比模式</div>
        <div class="text-text-secondary mt-0.5">${typeNames} 各上传 ≥2 份 · 末尾已加入对比表 + 柱状图 + 最佳选择叙事</div>
      </div>
    `;
    main.insertBefore(banner, main.firstChild);
  }

  // Banner 2: 解析失败警告
  const errors = (state.parseErrors || []);
  if (errors.length > 0) {
    const names = errors.map((e) => e.file || e.pdfName || '?').join('、');
    const banner = document.createElement('div');
    banner.className = 'result-banner w-full mb-4 px-4 py-3 bg-status-warning/10 border border-status-warning/40 rounded-xl flex items-start gap-2 text-sm text-on-surface';
    banner.innerHTML = `
      <span class="material-symbols-outlined text-status-warning text-[20px] flex-shrink-0 mt-0.5">warning</span>
      <div class="flex-1">
        <div class="font-semibold text-status-warning">⚠️ ${errors.length} 个文件解析失败</div>
        <div class="text-text-secondary mt-0.5">${names} · 已跳过, 不影响其他文件渲染</div>
      </div>
    `;
    main.insertBefore(banner, main.firstChild);
  }
}

async function downloadFile(url, filename, btnId) {
  if (!url) { toast('下载地址无效', 'error'); return; }
  const btn = document.getElementById(btnId);
  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 准备下载...';
  }
  try {
    // 2026-07-30: downloadSignedFile 内部已 window.location.href 直跳,
    //   浏览器立即接管流式下载并弹保存框 (不再 await 整个 blob)
    //   filename 由 server 的 Content-Disposition 提供, 不需要前端设
    await downloadSignedFile(url);
    toast('已开始下载', 'success');
    if (btn) {
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-variation-settings:\'FILL\' 1">check_circle</span> 已下载';
      setTimeout(() => {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
      }, 1800);
    }
  } catch (err) {
    toast('下载失败: ' + err.message, 'error');
    if (btn) {
      btn.innerHTML = oldHtml;
      btn.disabled = false;
    }
  }
}

export function initResult() {
  render();

  document.getElementById('resultDownloadBtn').onclick = () => {
    downloadFile(state.downloadUrl, state.resultFilename, 'resultDownloadBtn');
  };
  document.getElementById('resultDownloadMdBtn').onclick = () => {
    let fn = 'plan.md';
    try {
      fn = decodeURIComponent(new URL(state.markdownUrl, location.origin).pathname.split('/').pop() || 'plan.md');
    } catch {}
    downloadFile(state.markdownUrl, fn, 'resultDownloadMdBtn');
  };
  document.getElementById('resultNewBtn').onclick = () => {
    resetState();
    goStep('upload');
  };
  const backChatBtn = document.getElementById('resultBackChatBtn');
  if (backChatBtn) backChatBtn.onclick = () => { goStep('chat'); };
  const regenBtn = document.getElementById('resultRegenerateBtn');
  if (regenBtn) regenBtn.onclick = () => { goStep('generate'); };

  // 仅储蓄险显示保单摘要图功能
  const summaryBtn = document.getElementById('resultSummaryBtn');
  if (summaryBtn) {
    const types = [...new Set((state.extractions || []).map(e => e.planType).filter(Boolean))];
    if (types.length === 1 && types[0] === 'savings') {
      summaryBtn.style.display = 'flex';
      summaryBtn.onclick = () => { showIntervalDialog(); };
    } else {
      summaryBtn.style.display = 'none';
    }
  }
}
