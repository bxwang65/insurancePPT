/* =========================================================================
   保单简要海报 - 直接展示服务端生成的品牌 PNG (替换旧的 1/5/10 年 html2canvas 流程)
   ========================================================================= */

import { state } from '../state.js';
import { toast } from '../steps.js';

/** 打开海报预览: 单产品展示 1 张, 多产品展示可滚动列表 */
export function previewBrandedPoster() {
  const posters = (state.posterPerExtraction && state.posterPerExtraction.length > 0)
    ? state.posterPerExtraction
    : (state.posterUrl ? [state.posterUrl] : []);

  if (!posters.length) {
    toast('暂无海报, 请确认 PDF 已成功解析', 'warn');
    return;
  }
  showPosterLightbox(posters);
}

function showPosterLightbox(posters) {
  const existing = document.getElementById('posterLightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'posterLightbox';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'background:rgba(0,0,0,.7)',
    'display:flex', 'flex-direction:column',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
  ].join(';');

  const extractions = state.extractions || [];

  // 顶栏
  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:rgba(255,255,255,.95);border-bottom:1px solid #e2e8f0;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">🖼️ 保单简要海报 <span style="font-size:12px;color:#94a3b8;font-weight:400;margin-left:8px;">共 ${posters.length} 张</span></div>
      <button id="posterLbClose" style="border:none;background:transparent;font-size:24px;color:#64748b;cursor:pointer;padding:4px 10px;line-height:1;">×</button>
    </div>`;

  // 多产品左侧导航栏
  let navHtml = '';
  if (posters.length > 1) {
    const navItems = posters.map((url, i) => {
      const name = (extractions[i]?.pdfName || `产品 ${i + 1}`).replace(/\.pdf$/i, '');
      return `<button class="poster-nav-item" data-i="${i}" style="padding:12px 16px;border:none;background:transparent;font-size:13px;color:#1e293b;cursor:pointer;text-align:left;border-bottom:1px solid #f1f5f9;line-height:1.4;">
        <span style="display:block;font-weight:600;color:#0f172a;">${escapeHtml(truncate(name, 22))}</span>
        <span style="display:block;font-size:11px;color:#94a3b8;margin-top:2px;">第 ${i + 1} / ${posters.length} 张</span>
      </button>`;
    }).join('');
    navHtml = `
      <div id="posterNav" style="width:240px;flex-shrink:0;background:#fff;border-right:1px solid #e2e8f0;overflow-y:auto;max-height:calc(100vh - 60px);">
        ${navItems}
      </div>`;
  }

  // 主体: 海报图片滚动区
  const cardsHtml = posters.map((url, i) => {
    const name = (extractions[i]?.pdfName || `产品 ${i + 1}`).replace(/\.pdf$/i, '');
    return `
      <div class="poster-card" data-i="${i}" style="margin:0 auto 24px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;width:fit-content;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(name)}</div>
          <button class="poster-dl-btn" data-url="${escapeHtml(url)}" data-name="${escapeHtml(name)}" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:none;background:#2563eb;color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
            <span style="font-size:14px;">⬇</span>下载 PNG
          </button>
        </div>
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" style="display:block;max-width:540px;width:100%;height:auto;background:#f1f5f9;" />
      </div>`;
  }).join('');

  const mainHtml = `
    <div id="posterLbBody" style="flex:1;overflow-y:auto;padding:24px;background:#1e293b;">
      ${cardsHtml}
    </div>`;

  overlay.innerHTML = headerHtml + `<div style="display:flex;flex:1;overflow:hidden;min-height:0;">${navHtml}${mainHtml}</div>`;
  document.body.appendChild(overlay);

  // 关闭
  document.getElementById('posterLbClose').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
  });

  // 左侧导航: 点击滚动到对应卡片
  overlay.querySelectorAll('.poster-nav-item').forEach(btn => {
    btn.onclick = () => {
      const idx = btn.dataset.i;
      const card = overlay.querySelector(`.poster-card[data-i="${idx}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 高亮当前
      overlay.querySelectorAll('.poster-nav-item').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderLeft = '3px solid transparent';
      });
      btn.style.background = '#eff6ff';
      btn.style.borderLeft = '3px solid #2563eb';
    };
  });

  // 下载按钮
  overlay.querySelectorAll('.poster-dl-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const name = btn.dataset.name || 'poster';
      triggerDownload(url, `${name}.png`);
    };
  });
}

function triggerDownload(url, filename) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || '';
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
