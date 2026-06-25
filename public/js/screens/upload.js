/* Screen 1: Upload - 三端口上传 */

import { state } from '../state.js';
import { uploadFiles, parseSession, getRenderOptions } from '../api.js';
import { goStep, toast } from '../steps.js';

const PORTS = ['savings', 'ci', 'iul'];
const PORT_LABELS = { savings: '储蓄险', ci: '重疾险', iul: 'IUL' };

// 当前各端口状态
const portFiles = { savings: null, ci: null, iul: null };
const portCompanies = { savings: '', ci: '', iul: '' };
let companiesList = [];

function initCompanySelects() {
  getRenderOptions().then((data) => {
    companiesList = data.companies || [];
    // IUL 专属公司列表（新加坡IUL市场）
    const IUL_COMPANIES = ['transamerica', 'sunlife', 'manulife'];
    const allOpts = companiesList.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    const iulOpts = companiesList
      .filter((c) => IUL_COMPANIES.includes(c.id))
      .map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    PORTS.forEach((p) => {
      const sel = document.getElementById(`company${p.charAt(0).toUpperCase() + p.slice(1)}`);
      if (sel) sel.innerHTML = '<option value="">选择公司...</option>' + (p === 'iul' ? iulOpts : allOpts);
    });
  }).catch(() => {});
}

function updateUI() {
  const count = PORTS.filter((p) => portFiles[p]).length;
  document.getElementById('uploadFileCount').textContent = count;
  const btn = document.getElementById('uploadStartBtn');
  if (btn) btn.disabled = count === 0;
}

function setupPort(portType) {
  const cap = portType.charAt(0).toUpperCase() + portType.slice(1);
  const dz = document.getElementById(`dropzone${cap}`);
  const input = dz?.querySelector('input[type="file"]');
  if (!dz || dz.dataset.bound) return;
  dz.dataset.bound = '1';

  dz.onclick = () => input?.click();
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast(`${file.name} 不是PDF`, 'warning'); return; }
    if (file.size > 30 * 1024 * 1024) { toast(`${file.name} 超过30MB`, 'error'); return; }
    portFiles[portType] = file;
    document.getElementById(`file${cap}Name`).textContent = file.name;
    document.getElementById(`file${cap}`).classList.remove('hidden');
    dz.querySelector('p').textContent = '✅ ' + file.name;
    dz.classList.add('border-primary-container');
    updateUI();
  };

  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag-active'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag-active'); }));
  dz.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files?.[0];
    if (file) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change'));
    }
  });

  // Company selector
  const sel = document.getElementById(`company${cap}`);
  if (sel) sel.onchange = () => { portCompanies[portType] = sel.value; };
}

export function initUpload() {
  PORTS.forEach(setupPort);
  initCompanySelects();

  document.getElementById('uploadClearBtn').onclick = () => {
    PORTS.forEach((p) => {
      portFiles[p] = null;
      const cap = p.charAt(0).toUpperCase() + p.slice(1);
      const dz = document.getElementById(`dropzone${cap}`);
      if (dz) {
        dz.querySelector('p').textContent = '点击上传' + PORT_LABELS[p] + ' (PDF)';
        dz.classList.remove('border-primary-container', 'drag-active');
      }
      document.getElementById(`file${cap}`).classList.add('hidden');
    });
    updateUI();
  };

  document.getElementById('uploadStartBtn').onclick = onStartParse;
  updateUI();
}

async function onStartParse() {
  // 验证: 已上传文件的端口必须选择公司
  const missing = PORTS.filter((p) => portFiles[p] && !portCompanies[p]);
  if (missing.length) {
    const names = missing.map((p) => PORT_LABELS[p]).join('、');
    toast(`请为 ${names} 选择公司`, 'warning');
    return;
  }

  const btn = document.getElementById('uploadStartBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> 上传中...';

  try {
    const files = PORTS.filter((p) => portFiles[p]).map((p) => ({ file: portFiles[p], type: p }));
    const { sessionId } = await uploadFiles(files, {
      savings: portCompanies.savings,
      ci: portCompanies.ci,
      iul: portCompanies.iul,
    });
    state.sessionId = sessionId;
    state.files = files.map((f) => ({ file: { name: f.file.name }, type: f.type }));
    // Save company selections
    state.savingsCompany = portCompanies.savings;
    state.ciCompany = portCompanies.ci;
    state.iulCompany = portCompanies.iul;

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
