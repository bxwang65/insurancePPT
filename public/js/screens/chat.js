/* =========================================================================
   Screen 3: Chat - 解析摘要 + AI 对话
   ========================================================================= */

import { state } from '../state.js';
import { sendChat, validateExtraction } from '../api.js';
import { goStep, toast } from '../steps.js';

const TYPE_COLORS = {
  savings: { bg: '#E8F1FF', fg: '#007AFF' },
  ci:      { bg: '#FFF0F0', fg: '#FF3B30' },
  iul:     { bg: '#F0FFF4', fg: '#34C759' },
};
const TYPE_LABEL = { savings: '储蓄险', ci: '重疾险', iul: 'IUL' };

/* —— 渲染左侧摘要 —— */
function renderSummary() {
  const el = document.getElementById('chatSummary');
  if (!el) return;
  el.innerHTML = '';
  state.extractions.forEach((ext, idx) => {
    const ok = ext.status === 'success' || (!ext.error && ext.yearCount > 0);
    const color = TYPE_COLORS[ext.planType] || TYPE_COLORS.savings;
    const card = document.createElement('div');
    card.className = 'bg-surface-container-lowest border border-border-subtle rounded-2xl p-4';
    const d = ext.data || {};
    const pol = d.policy || {};
    let stats = '';
    if (ok) {
      if (ext.planType === 'savings') {
        stats = `
          <div class="grid grid-cols-2 gap-2 mt-3">
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">年缴保费</div><div class="text-base font-bold text-on-surface">$${fmt(pol.annual_premium)}</div></div>
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">缴费年期</div><div class="text-base font-bold text-on-surface">${pol.premium_payment_period || '-'}</div></div>
          </div>`;
      } else if (ext.planType === 'ci') {
        stats = `
          <div class="grid grid-cols-2 gap-2 mt-3">
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">危疾保额</div><div class="text-base font-bold text-on-surface">$${fmt(pol.sum_insured)}</div></div>
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">年缴保费</div><div class="text-base font-bold text-on-surface">$${fmt(pol.annual_premium)}</div></div>
          </div>`;
      } else if (ext.planType === 'iul') {
        const rate = d.index_accounts?.[0]?.current_assumed_rate || d.rates?.fixed_account_current_rate || '-';
        stats = `
          <div class="grid grid-cols-2 gap-2 mt-3">
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">身故保障</div><div class="text-base font-bold text-on-surface">$${fmt(pol.sum_insured)}</div></div>
            <div class="bg-surface-container-low rounded-lg p-2"><div class="text-[11px] text-text-secondary font-semibold tracking-wider">演示利率</div><div class="text-base font-bold text-on-surface">${rate}</div></div>
          </div>`;
      }
    }
    card.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-[11px] font-semibold tracking-wider px-2 py-0.5 rounded-md" style="background:${color.bg};color:${color.fg}">${TYPE_LABEL[ext.planType]}</span>
        <span class="text-[11px] font-semibold" style="color:${ok ? '#34C759' : '#FF3B30'}">${ok ? '✓ 已解析' : '✗ 失败'}</span>
      </div>
      <div class="text-sm font-semibold text-on-surface truncate">${ext.productName || ext.pdfName}</div>
      <div class="text-xs text-text-secondary mt-1">${ext.pdfName}${ext.yearCount ? ` · ${ext.yearCount} 年数据` : ''}</div>
      ${stats}
      ${ext.error ? `<div class="text-xs text-status-error mt-2">${ext.error}</div>` : ''}
    `;
    el.appendChild(card);
  });
}

function renderValidationSummary() {
  const summary = document.getElementById('chatValidationSummary');
  const list = document.getElementById('chatValidationList');
  if (!summary || !list) return;
  list.innerHTML = '';
  if (!state.validation) {
    summary.textContent = '正在加载校验结果...';
    return;
  }
  if (state.validation.validated) {
    summary.textContent = state.validation.warnCount > 0
      ? `校验通过，但有 ${state.validation.warnCount} 条提示`
      : '校验通过，当前数据可用于正式生成';
  } else {
    summary.textContent = `存在 ${state.validation.errorCount} 项错误，生成前建议先处理`;
  }
  (state.validation.issues || []).slice(0, 6).forEach((issue) => {
    const row = document.createElement('div');
    row.className = `rounded-xl px-4 py-3 border ${issue.severity === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`;
    row.innerHTML = `<div class="text-[11px] font-semibold tracking-[0.08em] mb-1">${issue.severity === 'error' ? 'ERROR' : 'WARN'} · ${issue.field}</div><div class="text-sm">${issue.message}</div>`;
    list.appendChild(row);
  });
}

/* —— 消息流管理 —— */
function appendMessage(role, content) {
  const wrap = document.getElementById('chatMessages');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = role === 'user'
    ? 'flex gap-3 max-w-[90%] self-end flex-row-reverse fade-enter'
    : 'flex gap-3 max-w-[95%] fade-enter';

  const avatar = role === 'user'
    ? `<div class="w-8 h-8 rounded-full bg-surface-container-high border border-border-subtle flex items-center justify-center shrink-0 mt-1">
         <span class="material-symbols-outlined text-[16px] text-secondary">person</span>
       </div>`
    : `<div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center shrink-0 text-white mt-1">
         <span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1;">auto_awesome</span>
       </div>`;

  const bubble = role === 'user'
    ? `<div class="flex flex-col gap-1 items-end">
         <span class="text-xs text-text-secondary mr-1">我</span>
         <div class="bg-primary-container text-white text-sm py-3 px-4 rounded-2xl rounded-tr-sm shadow-sm whitespace-pre-wrap">${escapeHtml(content)}</div>
       </div>`
    : `<div class="flex flex-col gap-1">
         <span class="text-xs text-text-secondary ml-1">AI 顾问</span>
         <div class="text-sm text-on-surface markdown-prose bg-surface-bright border border-border-subtle p-4 rounded-2xl rounded-tl-sm shadow-sm">${formatMarkdown(content)}</div>
       </div>`;

  div.innerHTML = avatar + bubble;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function appendTyping() {
  const wrap = document.getElementById('chatMessages');
  if (!wrap) return null;
  const div = document.createElement('div');
  div.id = 'typingIndicator';
  div.className = 'flex gap-3 max-w-[95%] fade-enter';
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center shrink-0 text-white mt-1">
      <span class="material-symbols-outlined text-[16px]" style="font-variation-settings:'FILL' 1;">auto_awesome</span>
    </div>
    <div class="bg-surface-bright border border-border-subtle p-4 rounded-2xl rounded-tl-sm shadow-sm flex gap-1.5 items-center">
      <span class="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style="animation-delay:0s"></span>
      <span class="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style="animation-delay:0.2s"></span>
      <span class="w-2 h-2 bg-text-tertiary rounded-full animate-bounce" style="animation-delay:0.4s"></span>
    </div>
  `;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}
function removeTyping() {
  document.getElementById('typingIndicator')?.remove();
}

function formatMarkdown(text) {
  if (!text) return '';
  // 极简:  **加粗**  +  换行 + 列表
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^•\s?(.+)$/gm, '<div style="display:flex;gap:8px;margin:4px 0;"><span>•</span><span>$1</span></div>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) {
  if (!n && n !== 0) return '-';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toLocaleString();
}

/* —— 初始消息 (后端给的) —— */
function renderInitial() {
  const wrap = document.getElementById('chatMessages');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (state.initialChatMsg) {
    appendMessage('assistant', state.initialChatMsg);
  } else {
    appendMessage('assistant', '解析已完成，我可以帮你解答关于这份计划书的任何问题。\n\n比如:\n• 这个产品的核心卖点是什么？\n• 20年后的预期回报是多少？\n• 和同类型产品相比有什么优势？');
  }
}

async function sendUserMessage() {
  const input = document.getElementById('chatInput');
  const btn   = document.getElementById('chatSendBtn');
  const text  = input.value.trim();
  if (!text) return;

  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  appendTyping();

  try {
    const { message } = await sendChat(state.sessionId, text);
    removeTyping();
    appendMessage('assistant', message);
  } catch (err) {
    removeTyping();
    appendMessage('assistant', '❌ ' + err.message);
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

export function initChat() {
  renderSummary();
  renderInitial();
  renderValidationSummary();

  if (state.sessionId && !state.validation) {
    validateExtraction(state.sessionId)
      .then((result) => {
        state.validation = result;
        renderValidationSummary();
      })
      .catch((err) => {
        state.validation = {
          validated: false,
          errorCount: 1,
          warnCount: 0,
          issues: [{ field: 'system', severity: 'error', message: err.message || '校验接口失败' }],
        };
        renderValidationSummary();
      });
  }

  const input = document.getElementById('chatInput');
  const btn   = document.getElementById('chatSendBtn');
  const goBtn = document.getElementById('chatGoGenerateBtn');
  const summaryBtn = document.getElementById('chatSummaryToggle');

  if (input && input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    // 自适应高度
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      // 切换发送按钮态
      if (btn) {
        const has = input.value.trim().length > 0;
        btn.disabled = !has;
        btn.classList.toggle('bg-primary-container', has);
        btn.classList.toggle('text-white', has);
        btn.classList.toggle('bg-surface-container-high', !has);
        btn.classList.toggle('text-text-tertiary', !has);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });
  }
  if (btn) btn.onclick = sendUserMessage;
  if (goBtn) goBtn.onclick = () => goStep('generate');
  if (summaryBtn) summaryBtn.onclick = () => {
    const m = document.getElementById('summaryModal');
    m?.classList.toggle('hidden');
  };
  const closeBtn = document.getElementById('summaryModalClose');
  if (closeBtn) closeBtn.onclick = () => {
    document.getElementById('summaryModal')?.classList.add('hidden');
  };
  // 快速提问 chips
  document.querySelectorAll('.chat-quick-chip').forEach(chip => {
    chip.onclick = () => {
      const text = chip.textContent.trim();
      input.value = text;
      sendUserMessage();
    };
  });
}
