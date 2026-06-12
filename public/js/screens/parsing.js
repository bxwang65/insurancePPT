/* =========================================================================
   Screen 2: Parsing - 解析进度
   ========================================================================= */

import { state } from '../state.js';
import { parseSession, getSession } from '../api.js';
import { goStep, toast } from '../steps.js';

const STAGES = [
  { min: 0,  headline: '正在提取数据对象', sub: '正在识别关键保险条款和数据表格...' },
  { min: 40, headline: '构建实体',         sub: '将数据映射到内部结构...' },
  { min: 70, headline: '完成索引',         sub: '为生成引擎准备上下文...' },
  { min: 99, headline: '解析完成',         sub: '所有文档均已成功处理，准备对话。' },
];

const HEADLINE_EL    = () => document.getElementById('parsingHeadline');
const SUBTEXT_EL     = () => document.getElementById('parsingSubtext');
const PERCENT_EL     = () => document.getElementById('parsingPercent');
const CIRCLE_EL      = () => document.getElementById('parsingCircle');
const FILE_LIST_EL   = () => document.getElementById('parsingFileList');
const CANCEL_BTN     = () => document.getElementById('parsingCancelBtn');
const CONTINUE_BTN   = () => document.getElementById('parsingContinueBtn');

let _polling = null;
let _simInterval = null;

function setStage(percent) {
  const stage = [...STAGES].reverse().find(s => percent >= s.min) || STAGES[0];
  if (HEADLINE_EL()) HEADLINE_EL().textContent = stage.headline;
  if (SUBTEXT_EL())  SUBTEXT_EL().textContent  = stage.sub;
  if (PERCENT_EL())  PERCENT_EL().textContent  = Math.round(percent) + '%';
  if (CIRCLE_EL()) {
    const C = 339.292; // 2 * π * 54
    const offset = C - (percent / 100) * C;
    CIRCLE_EL().style.strokeDashoffset = offset;
  }
}

function renderFiles() {
  const el = FILE_LIST_EL();
  if (!el) return;
  el.innerHTML = '';
  state.files.forEach((entry, idx) => {
    const sizeMB = (entry.file.size / 1024 / 1024).toFixed(1);
    const div = document.createElement('div');
    div.className = 'bg-surface-container-lowest border border-border-subtle rounded-xl p-3 flex items-center justify-between';
    div.dataset.idx = idx;
    div.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-10 h-10 rounded-lg bg-tertiary-fixed flex items-center justify-center text-tertiary shrink-0">
          <span class="material-symbols-outlined">description</span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-sm text-on-surface truncate">${entry.file.name}</div>
          <div class="text-xs text-text-secondary">${sizeMB} MB</div>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs font-medium" data-status>等待中...</span>
        <span class="material-symbols-outlined text-[20px]" data-icon>schedule</span>
      </div>
    `;
    el.appendChild(div);
  });
}

function setFileStatus(idx, status) {
  const el = FILE_LIST_EL()?.children[idx];
  if (!el) return;
  const statusEl = el.querySelector('[data-status]');
  const iconEl   = el.querySelector('[data-icon]');
  if (status === 'parsing') {
    statusEl.textContent = '解析中...';
    statusEl.className = 'text-xs font-medium text-status-warning';
    iconEl.textContent = 'progress_activity';
    iconEl.className = 'material-symbols-outlined text-status-warning text-[20px] animate-spin';
    el.classList.add('bg-brand-gold-soft');
  } else if (status === 'success') {
    statusEl.textContent = '成功';
    statusEl.className = 'text-xs font-medium text-status-success';
    iconEl.textContent = 'check_circle';
    iconEl.className = 'material-symbols-outlined text-status-success text-[20px]';
    iconEl.style.fontVariationSettings = "'FILL' 1";
    el.classList.remove('bg-brand-gold-soft');
  } else if (status === 'fail') {
    statusEl.textContent = '失败';
    statusEl.className = 'text-xs font-medium text-status-error';
    iconEl.textContent = 'error';
    iconEl.className = 'material-symbols-outlined text-status-error text-[20px]';
  } else { // pending
    statusEl.textContent = '等待中...';
    statusEl.className = 'text-xs font-medium text-text-secondary';
    iconEl.textContent = 'schedule';
    iconEl.className = 'material-symbols-outlined text-text-secondary text-[20px]';
  }
}

function completeAll() {
  state.files.forEach((_, i) => setFileStatus(i, 'success'));
  setStage(100);
  CANCEL_BTN()?.classList.add('hidden');
  CONTINUE_BTN()?.classList.remove('hidden');
  CONTINUE_BTN()?.classList.add('flex');
  if (_simInterval) { clearInterval(_simInterval); _simInterval = null; }
}

async function pollBackend() {
  if (_polling) return;
  _polling = setInterval(async () => {
    try {
      const session = await getSession(state.sessionId);
      if (session.status === 'parsed') {
        clearInterval(_polling); _polling = null;
        state.extractions = session.extractions || [];
        completeAll();
        toast('解析完成!', 'success');
      } else if (session.status === 'error') {
        clearInterval(_polling); _polling = null;
        state.files.forEach((_, i) => setFileStatus(i, 'fail'));
        toast('解析失败，请重试', 'error');
      }
    } catch (err) {
      console.warn('轮询失败:', err);
    }
  }, 2000);
}

/* 启动一个简短的本地进度模拟 (与后端并行, 仅作视觉反馈) */
function startLocalSim() {
  let progress = 5;
  setStage(progress);
  // 模拟文件状态切换
  state.files.forEach((_, i) => setFileStatus(i, 'pending'));
  if (state.files[0]) setFileStatus(0, 'parsing');

  // 关键: files 为空时, 立即让 progress 跑 (避免 UI 卡 0%)
  if (state.files.length === 0) {
    setStage(10);
  }

  _simInterval = setInterval(() => {
    progress += 1.5 + Math.random() * 2;
    if (progress > 95) progress = 95; // 留给后端确认
    setStage(progress);
    if (progress > 30 && state.files[1] && document.querySelector('[data-idx="1"] [data-status]')?.textContent === '等待中...') {
      setFileStatus(0, 'success');
      setFileStatus(1, 'parsing');
    }
  }, 500);
}

/* 外部触发 (upload.js 调用) */
window.__triggerParse = async function() {
  renderFiles();
  // 立即显示进度, 避免 0% 闪烁
  setStage(5);
  startLocalSim();
  pollBackend();
  // 关键: parseSession 不阻塞, 但收到响应后立即 completeAll
  // (pollBackend 仍会兜底, 但 explicit complete 避免 race condition)
  parseSession(state.sessionId).then((data) => {
    state.extractions = data.extractions || [];
    // 立即触发 completeAll, 不等 pollBackend
    if (_polling) { clearInterval(_polling); _polling = null; }
    completeAll();
    toast('解析完成!', 'success');
  }).catch((err) => {
    console.warn('parseSession 调用失败 (但 pollBackend 仍在跑):', err);
  });
};

export function initParsing() {
  renderFiles();
  if (CANCEL_BTN()) CANCEL_BTN().onclick = () => {
    if (_polling) clearInterval(_polling); _polling = null;
    if (_simInterval) clearInterval(_simInterval); _simInterval = null;
    toast('已取消', 'info');
    goStep('upload');
  };
  if (CONTINUE_BTN()) CONTINUE_BTN().onclick = () => {
    if (!state.extractions || state.extractions.length === 0) {
      toast('暂未解析成功', 'warning');
      return;
    }
    goStep('generate');
  };
}
