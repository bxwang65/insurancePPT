/* =========================================================================
   Screen 4: Generate - 风格 + 公司选择
   ========================================================================= */

import { state } from '../state.js';
import { getRenderOptions, generatePPT, validateExtraction, sendChat } from '../api.js';
import { goStep, toast } from '../steps.js';

const STYLE_PRESETS = [
  { id: 'broker',   name: '券商风',   primary: 'linear-gradient(135deg,#0D1B2A,#1B2A4A)', accent: '#C8963E', tag: '专业高端' },
  { id: 'business', name: '商务风',   primary: 'linear-gradient(135deg,#17324D,#2A4866)', accent: '#C9A86A', tag: '稳重内敛' },
  { id: 'minimal',  name: '简洁风',   primary: 'linear-gradient(135deg,#1A1A2E,#2D2D44)', accent: '#E94560', tag: '极简有力' },
  { id: 'chinese',  name: '中国风',   primary: 'linear-gradient(135deg,#7B1E1E,#A02C2C)', accent: '#C8A24D', tag: '东方雅致' },
  { id: 'ink',      name: '水墨风',   primary: 'linear-gradient(135deg,#1F2D3D,#3A4D63)', accent: '#8FA3B8', tag: '写意留白' },
];

function renderValidation() {
  const badge = document.getElementById('validationStatusBadge');
  const summary = document.getElementById('validationSummary');
  const issuesEl = document.getElementById('validationIssues');
  if (!badge || !summary || !issuesEl) return;
  const result = state.validation;
  issuesEl.innerHTML = '';
  if (!result) {
    badge.textContent = '检查中';
    badge.className = 'text-caption text-text-secondary';
    summary.textContent = '正在检查年龄、保费、利益表与提领数据...';
    return;
  }
  if (result.validated) {
    badge.textContent = result.warnCount > 0 ? `通过 (${result.warnCount} 条提示)` : '通过';
    badge.className = `text-caption ${result.warnCount > 0 ? 'text-status-warning' : 'text-status-success'}`;
    summary.textContent = result.warnCount > 0 ? '数据可生成，但建议先看下面的提示。' : '核心数据校验通过，可以生成正式版。';
  } else {
    badge.textContent = `阻断 (${result.errorCount} 项错误)`;
    badge.className = 'text-caption text-status-error';
    summary.textContent = '存在会影响正式导出的数据问题，修复前不建议生成。';
  }
  const topIssues = (result.issues || []).slice(0, 6);
  topIssues.forEach((issue) => {
    const row = document.createElement('div');
    row.className = `rounded-lg px-3 py-2 border ${issue.severity === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`;
    row.innerHTML = `<div class="text-[11px] font-semibold tracking-[0.08em] mb-1">${issue.severity === 'error' ? 'ERROR' : 'WARN'} · ${issue.field}</div><div class="text-sm">${issue.message}</div>`;
    issuesEl.appendChild(row);
  });
}

function renderStyles() {
  const el = document.getElementById('styleGrid');
  if (!el) return;
  el.innerHTML = '';
  STYLE_PRESETS.forEach(s => {
    const isActive = s.id === state.selectedStyle;
    const div = document.createElement('div');
    div.className = `bg-surface-container-lowest rounded-lg p-base border cursor-pointer transition-all ${
      isActive ? 'border-2 border-primary-container shadow-md' : 'border-border-subtle shadow-sm hover:shadow-md hover:-translate-y-0.5'
    }`;
    div.innerHTML = `
      <div class="aspect-video rounded mb-2 flex flex-col justify-center px-3 relative overflow-hidden" style="background:${s.primary}">
        <div class="w-2/3 h-1.5 rounded mb-1" style="background:${s.accent};opacity:0.9"></div>
        <div class="w-1/2 h-1 rounded" style="background:rgba(255,255,255,0.3)"></div>
        ${isActive ? `<div class="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center" style="background:${s.accent}">
          <span class="material-symbols-outlined text-white text-[14px]" style="font-variation-settings:'FILL' 1">check</span>
        </div>` : ''}
      </div>
      <div class="text-center text-xs font-bold ${isActive ? 'text-primary-container' : 'text-text-secondary'}">${s.name}</div>
    `;
    div.onclick = () => {
      state.selectedStyle = s.id;
      renderStyles();
      updatePreview();
    };
    el.appendChild(div);
  });
}

function renderCompanies(companies) {
  const el = document.getElementById('companyGrid');
  if (!el) return;
  el.innerHTML = '';
  if (!companies || companies.length === 0) {
    el.innerHTML = '<div class="col-span-full text-center text-text-secondary text-sm py-8">暂无可选公司</div>';
    return;
  }
  companies.forEach(c => {
    const isActive = c.id === state.selectedCompanyId;
    const initial = c.name?.[0] || c.id?.[0]?.toUpperCase() || '?';
    const div = document.createElement('div');
    div.className = `bg-surface-container-lowest rounded-lg p-3 border cursor-pointer transition-all flex items-center gap-3 ${
      isActive ? 'border-2 border-primary-container bg-brand-gold-soft' : 'border-border-subtle hover:shadow-md'
    }`;
    div.innerHTML = `
      <div class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-base shrink-0 ${
        isActive ? 'bg-primary-container text-white' : 'bg-surface-container-high text-on-surface'
      }">${initial}</div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-on-surface truncate">${c.name}</div>
        <div class="text-[11px] text-text-secondary">${c.id}</div>
      </div>
      ${isActive ? `<span class="material-symbols-outlined text-primary-container text-[20px] shrink-0" style="font-variation-settings:'FILL' 1">check_circle</span>` : ''}
    `;
    div.onclick = () => {
      state.selectedCompanyId = c.id;
      renderCompanies(companies);
      updateGenerateBtn();
      updatePreview();
    };
    el.appendChild(div);
  });
}

function updatePreview() {
  const style = STYLE_PRESETS.find(s => s.id === state.selectedStyle);
  const canvas = document.getElementById('previewCanvas');
  if (canvas && style) canvas.style.background = style.primary;
}

function updateGenerateBtn() {
  const btn = document.getElementById('startGenerateBtn');
  if (btn) btn.disabled = false;
}

function renderFormatAndQuality() {
  const formatButtons = document.querySelectorAll('[data-format]');
  formatButtons.forEach((btn) => {
    const active = btn.dataset.format === state.selectedFormat;
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-on-primary', active);
    btn.classList.toggle('border-primary-container', active);
    btn.classList.toggle('bg-surface-container-lowest', !active);
    btn.classList.toggle('text-on-surface', !active);
    btn.onclick = () => {
      state.selectedFormat = btn.dataset.format;
      renderFormatAndQuality();
      const startBtn = document.getElementById('startGenerateBtn');
      if (startBtn) startBtn.innerHTML = `<span class="material-symbols-outlined text-[20px]">auto_awesome</span> 开始生成 ${state.selectedFormat.toUpperCase()}`;
    };
  });
  const qualityButtons = document.querySelectorAll('[data-quality]');
  qualityButtons.forEach((btn) => {
    const active = btn.dataset.quality === state.selectedQuality;
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-on-primary', active);
    btn.classList.toggle('border-primary-container', active);
    btn.classList.toggle('bg-surface-container-lowest', !active);
    btn.classList.toggle('text-on-surface', !active);
    btn.onclick = () => {
      state.selectedQuality = btn.dataset.quality;
      renderFormatAndQuality();
    };
  });
  const startBtn = document.getElementById('startGenerateBtn');
  if (startBtn) startBtn.innerHTML = `<span class="material-symbols-outlined text-[20px]">auto_awesome</span> 开始生成 ${state.selectedFormat.toUpperCase()}`;
}

async function onGenerate() {
  if (state.validation && !state.validation.validated) {
    toast(`存在 ${state.validation.errorCount} 项数据错误，请先修复后再生成`, 'error');
    return;
  }
  const btn = document.getElementById('startGenerateBtn');
  btn.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 生成中...';

  try {
    let aiNarrative = '';
    if (state.useAiSummary) {
      try {
        const aiRes = await sendChat(state.sessionId, '请根据以上对话，为这份保险计划书写一段简短的总结建议（100字以内），包括产品组合的核心优势和适合场景。');
        aiNarrative = aiRes?.message || '';
      } catch (e) { console.warn('AI建议获取失败，使用默认总结', e); }
    }

    const data = await generatePPT({
      sessionId: state.sessionId,
      style: state.selectedStyle,
      companyId: state.savingsCompany || state.ciCompany || state.iulCompany || 'ctf',
      savingsCompanyId: state.savingsCompany || '',
      ciCompanyId: state.ciCompany || '',
      iulCompanyId: state.iulCompany || '',
      companyInfo: state.companyInfo,
      format: state.selectedFormat,
      quality: state.selectedQuality,
      aiNarrative: aiNarrative,
    });
    state.downloadUrl = data.downloadUrl;
    state.markdownUrl = data.markdownUrl || '';
    state.previewUrls = data.previewUrls || [];
    state.previewPdfUrl = data.previewPdfUrl || '';
    state.slideCount = data.slideCount || 0;
    state.resultFilename = (() => {
      try {
        const parsed = new URL(data.downloadUrl, location.origin);
        return decodeURIComponent(parsed.pathname.split('/').pop() || `plan.${state.selectedFormat}`);
      } catch {
        return `plan.${state.selectedFormat}`;
      }
    })();
    toast('PPT 已生成!', 'success');
    goStep('result');
  } catch (err) {
    toast('生成失败: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = oldHtml;
  }
}

export async function initGenerate() {
  renderStyles();
  renderValidation();
  // 公司已经在上传时按产品选择，生成页不再需要选公司
  if (state.sessionId) {
    try {
      state.validation = await validateExtraction(state.sessionId);
    } catch (err) {
      state.validation = {
        validated: false,
        errorCount: 1,
        warnCount: 0,
        issues: [{ field: 'system', severity: 'error', message: err.message || '校验接口失败' }],
      };
    }
    renderValidation();
  }

  const textarea = document.getElementById('companyInfoTextarea');
  if (textarea && textarea.dataset.bound !== '1') {
    textarea.dataset.bound = '1';
    textarea.addEventListener('input', () => {
      state.companyInfo = textarea.value;
      const count = document.getElementById('companyInfoCount');
      if (count) {
        count.textContent = `${textarea.value.length} / 300`;
        count.style.color = textarea.value.length > 300 ? '#FF9500' : '';
      }
    });
  }
  const btn = document.getElementById('startGenerateBtn');
  if (btn) btn.onclick = onGenerate;
  const back = document.getElementById('generateBackBtn');
  if (back) back.onclick = () => goStep('upload');

  // AI 总结勾选框
  const aiCheck = document.getElementById('useAiSummary');
  if (aiCheck) {
    aiCheck.checked = state.useAiSummary || false;
    aiCheck.addEventListener('change', () => { state.useAiSummary = aiCheck.checked; });
  }

  renderFormatAndQuality();
  updateGenerateBtn();
  updatePreview();
}
