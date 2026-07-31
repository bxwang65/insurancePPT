/* =========================================================================
   Insurance Plan AI - 状态机 + 屏幕切换
   ========================================================================= */

import { state, resetState } from './state.js';

const STEPS = [
  { id: 'upload',   label: '上传' },
  { id: 'parsing',  label: '解析' },
  { id: 'generate', label: '生成' },
  { id: 'result',   label: '完成' },
];

const STEP_ORDER = STEPS.map(s => s.id);

// 各 screen 的 init 函数, 动态 import 避免一次性加载
const INIT_FNS = {
  upload:   () => import('./screens/upload.js').then(m => m.initUpload()).catch(e => console.error(e)),
  parsing:  () => import('./screens/parsing.js').then(m => m.initParsing()).catch(e => console.error(e)),
  generate: () => import('./screens/generate.js').then(m => m.initGenerate()).catch(e => console.error(e)),
  result:   () => import('./screens/result.js').then(m => m.initResult()).catch(e => console.error(e)),
};

/* 切换到指定屏幕 */
export function goStep(stepId) {
  // 隐藏所有 screen
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + stepId);
  if (target) target.classList.add('active');

  // 滚到顶
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 触发 screen 的 init (动态加载, fire-and-forget, 不阻塞)
  if (INIT_FNS[stepId]) {
    try {
      INIT_FNS[stepId]();
    } catch (e) { console.error('[init]', stepId, e); }
  }

  // 更新步骤指示器
  updateStepsNav(stepId);
}

/* 更新顶部 5 步指示器 */
function updateStepsNav(currentStep) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  document.querySelectorAll('#stepsNav .step-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < currentIndex) el.classList.add('done');
    else if (i === currentIndex) el.classList.add('active');
  });
  document.querySelectorAll('#stepsNav .step-divider').forEach((el, i) => {
    el.classList.toggle('done', i < currentIndex);
  });
}

/* 构建步骤指示器 HTML */
export function buildStepsNav() {
  const items = STEPS.map((s, i) => {
    const isLast = i === STEPS.length - 1;
    return `
      <div class="step-item" data-step="${s.id}">
        <span class="step-dot">${i + 1}</span>
        <span>${s.label}</span>
      </div>
      ${!isLast ? '<span class="step-divider"></span>' : ''}
    `;
  }).join('');
  return `<nav id="stepsNav" class="steps-nav">${items}</nav>`;
}

/* 返回首页 (新建会话) */
export function goHome() {
  if (confirm('确定要新建方案吗？当前所有数据将被清空。')) {
    resetState();
    goStep('upload');
  }
}

/* 简单 toast 提示 (右上角浮窗) */
export function toast(message, type = 'info') {
  const colors = {
    info:    '#007AFF',
    success: '#34C759',
    warning: '#FF9500',
    error:   '#FF3B30',
  };
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; top: 80px; right: 24px; z-index: 9999;
    background: ${colors[type]}; color: white;
    padding: 12px 20px; border-radius: 14px;
    font-size: 14px; font-weight: 500;
    box-shadow: 0 12px 32px rgba(0,0,0,0.15);
    animation: toastIn 0.3s ease-out;
    max-width: 360px;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease-in forwards';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

/* 注入 toast 动画 */
const toastStyle = document.createElement('style');
toastStyle.textContent = `
@keyframes toastIn  { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toastOut { from { opacity: 1; transform: translateX(0); }     to { opacity: 0; transform: translateX(40px); } }
`;
document.head.appendChild(toastStyle);
