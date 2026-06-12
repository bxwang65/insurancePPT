/* =========================================================================
   Screen 5: Result - 完成 + 下载
   ========================================================================= */

import { state, resetState } from '../state.js';
import { downloadSignedFile } from '../api.js';
import { goStep, toast } from '../steps.js';

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
  renderThumbs();
  setPreview(0);
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
    const blob = await downloadSignedFile(url);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
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
  document.getElementById('resultBackChatBtn').onclick = () => {
    goStep('chat');
  };
  document.getElementById('resultRegenerateBtn').onclick = () => {
    goStep('generate');
  };
}
