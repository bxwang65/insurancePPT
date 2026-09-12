/* Screen 1: Upload - 多文件多公司 (per-port 多文件 + per-product 公司在生成页选) */

import { state } from '../state.js';
import { uploadFiles, parseSession } from '../api.js';
import { goStep, toast } from '../steps.js';

const PORTS = ['savings', 'ci', 'iul'];
const PORT_LABELS = { savings: '储蓄险', ci: '重疾险', iul: 'IUL' };

// 每端口文件列表 (数组, 允许多文件)
const portFiles = { savings: [], ci: [], iul: [] };

function updateUI() {
  const count = PORTS.reduce((n, p) => n + portFiles[p].length, 0);
  const el = document.getElementById('uploadFileCount');
  if (el) el.textContent = count;
  const btn = document.getElementById('uploadStartBtn');
  if (btn) btn.disabled = count === 0;
}

// 渲染单行: dropzone (空) 或 file row (已选)
function addFileRow(portType) {
  const cap = portType.charAt(0).toUpperCase() + portType.slice(1);
  const container = document.getElementById(`files${cap}`);
  if (!container) return;
  const idx = portFiles[portType].length;  // 即将 push 的位置

  // 空 dropzone 行
  const row = document.createElement('div');
  row.className = 'border-2 border-dashed border-border-subtle rounded-xl p-3 flex items-center gap-2 cursor-pointer hover:border-primary-container transition-colors';
  row.dataset.idx = idx;
  row.dataset.empty = '1';
  row.innerHTML = `
    <span class="material-symbols-outlined text-primary-container text-xl shrink-0">cloud_upload</span>
    <span class="text-sm text-text-secondary flex-1 truncate">点击或拖拽上传 PDF</span>
    <input type="file" accept=".pdf" class="hidden">
  `;
  container.appendChild(row);

  // 绑定事件
  const input = row.querySelector('input[type="file"]');
  const label = row.querySelector('span:last-of-type');

  const onPick = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast(`${file.name} 不是 PDF`, 'warning'); return; }
    if (file.size > 30 * 1024 * 1024) { toast(`${file.name} 超过 30MB`, 'error'); return; }
    // 检查重名
    if (portFiles[portType].some((f) => f.name === file.name)) {
      toast(`该端口已有同名文件: ${file.name}`, 'warning'); return;
    }
    portFiles[portType].push(file);
    renderRow(portType, idx, file);
    updateUI();
  };

  row.onclick = () => input.click();
  input.onchange = (e) => onPick(e.target.files?.[0]);
  ['dragenter', 'dragover'].forEach((ev) =>
    row.addEventListener(ev, (e) => { e.preventDefault(); row.classList.add('drag-active'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    row.addEventListener(ev, (e) => { e.preventDefault(); row.classList.remove('drag-active'); })
  );
  row.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files?.[0];
    if (f) {
      // 模拟 input change
      const dt = new DataTransfer();
      dt.items.add(f);
      input.files = dt.files;
      onPick(f);
    }
  });
}

// 已选文件后, 把空行替换为 file row (带文件名 + 删除按钮)
function renderRow(portType, idx, file) {
  const cap = portType.charAt(0).toUpperCase() + portType.slice(1);
  const container = document.getElementById(`files${cap}`);
  if (!container) return;
  const oldRow = container.querySelector(`[data-idx="${idx}"][data-empty="1"]`);
  if (!oldRow) return;
  const newRow = document.createElement('div');
  newRow.className = 'border border-border-subtle rounded-xl p-3 flex items-center gap-2 bg-brand-gold-soft/30';
  newRow.dataset.idx = idx;
  newRow.dataset.file = file.name;
  newRow.innerHTML = `
    <span class="material-symbols-outlined text-status-success text-xl shrink-0" style="font-variation-settings:'FILL' 1">check_circle</span>
    <span class="text-sm text-on-surface flex-1 truncate">${file.name}</span>
    <span class="text-[10px] text-text-secondary">${(file.size / 1024 / 1024).toFixed(1)} MB</span>
    <button class="material-symbols-outlined text-text-tertiary hover:text-status-error text-lg shrink-0" data-remove>close</button>
  `;
  newRow.querySelector('[data-remove]').onclick = () => removeRow(portType, idx);
  oldRow.replaceWith(newRow);
}

function removeRow(portType, idx) {
  portFiles[portType].splice(idx, 1);
  renderPort(portType);
  updateUI();
}

function renderPort(portType) {
  const cap = portType.charAt(0).toUpperCase() + portType.slice(1);
  const container = document.getElementById(`files${cap}`);
  if (!container) return;
  container.innerHTML = '';
  // 先渲染所有已选文件
  portFiles[portType].forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'border border-border-subtle rounded-xl p-3 flex items-center gap-2 bg-brand-gold-soft/30';
    row.dataset.idx = i;
    row.dataset.file = f.name;
    row.innerHTML = `
      <span class="material-symbols-outlined text-status-success text-xl shrink-0" style="font-variation-settings:'FILL' 1">check_circle</span>
      <span class="text-sm text-on-surface flex-1 truncate">${f.name}</span>
      <span class="text-[10px] text-text-secondary">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
      <button class="material-symbols-outlined text-text-tertiary hover:text-status-error text-lg shrink-0" data-remove>close</button>
    `;
    row.querySelector('[data-remove]').onclick = () => removeRow(portType, i);
    container.appendChild(row);
  });
  // 末尾追加 1 个空 dropzone (可继续添加)
  addFileRow(portType);
}

function setupPort(portType) {
  const cap = portType.charAt(0).toUpperCase() + portType.slice(1);
  const addBtn = document.getElementById(`addFile${cap}`);
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.onclick = () => addFileRow(portType);
  }
}

export function initUpload() {
  PORTS.forEach(setupPort);
  // 初始化每个端口第 1 行
  PORTS.forEach((p) => {
    const container = document.getElementById(`files${p.charAt(0).toUpperCase() + p.slice(1)}`);
    if (container && container.children.length === 0) addFileRow(p);
  });
  updateUI();

  document.getElementById('uploadClearBtn').onclick = () => {
    PORTS.forEach((p) => {
      portFiles[p] = [];
      renderPort(p);
    });
    updateUI();
  };
  document.getElementById('uploadStartBtn').onclick = onStartParse;
}

async function onStartParse() {
  const total = PORTS.reduce((n, p) => n + portFiles[p].length, 0);
  if (total === 0) {
    toast('请至少上传一份计划书', 'warning');
    return;
  }

  const btn = document.getElementById('uploadStartBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 上传中...';

  try {
    // 展开所有端口的文件成 [{file, type}] 列表
    const files = [];
    PORTS.forEach((p) => {
      portFiles[p].forEach((f) => files.push({ file: f, type: p }));
    });
    const { sessionId } = await uploadFiles(files);
    state.sessionId = sessionId;
    state.files = files.map((f) => ({ file: { name: f.file.name, size: f.file.size }, type: f.type }));
    // 清空 per-product 公司 (老 per-type 字段也清空, 解析完后由用户在生成页选)
    state.productCompanies = {};
    state.savingsCompany = '';
    state.ciCompany = '';
    state.iulCompany = '';

    toast('文件已上传，开始 AI 解析...', 'success');
    goStep('parsing');
    const waitParse = setInterval(() => {
      if (window.__triggerParse) { clearInterval(waitParse); window.__triggerParse(); }
    }, 100);
    setTimeout(() => clearInterval(waitParse), 5000);
  } catch (err) {
    toast('上传失败: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '开始 AI 解析';
  }
}
