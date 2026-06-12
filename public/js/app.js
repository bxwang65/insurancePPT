/* =========================================================================
   Insurance Plan AI - 启动入口
   ========================================================================= */

import { goStep, buildStepsNav, toast } from './steps.js';
import { state } from './state.js';
import { getSession } from './api.js';

// 启动时挂载顶部步骤指示器
document.addEventListener('DOMContentLoaded', async () => {
  if (location.protocol === 'file:') {
    toast('已检测到本地文件模式，页面将自动连接 http://localhost:3000 的后端服务', 'info');
  }

  // 1) 步骤指示器
  const navHost = document.getElementById('stepsNavHost');
  if (navHost) navHost.innerHTML = buildStepsNav();

  // 2) 默认进入 upload 屏
  goStep('upload');

  // 3) 如果有 sessionId 在 URL 上 (从分享链接回来), 自动恢复
  const params = new URLSearchParams(location.search);
  const sid = params.get('session');
  if (sid) {
    try {
      const session = await getSession(sid);
      state.sessionId = sid;
      state.extractions = session.extractions || [];
      state.files = (session.files || []).map((f) => ({
        file: { name: f.name, size: 0 },
        type: f.type || 'savings',
      }));
      if (session.status === 'parsed' && state.extractions.length > 0) {
        const last = (session.chatHistory || []).slice(-1)[0];
        state.initialChatMsg = last?.content || '';
        toast('已恢复上次会话', 'success');
        goStep('chat');
      } else if (session.status === 'done' && session.hasPpt) {
        state.downloadUrl = session.downloadUrl || '';
        state.markdownUrl = session.markdownUrl || '';
        state.previewUrls = session.previewUrls || [];
        state.previewPdfUrl = session.previewPdfUrl || '';
        state.slideCount = session.slideCount || 0;
        state.resultFilename = (() => {
          try {
            const parsed = new URL(session.downloadUrl, location.origin);
            return decodeURIComponent(parsed.pathname.split('/').pop() || 'plan.pptx');
          } catch {
            return 'plan.pptx';
          }
        })();
        goStep('result');
      } else if (session.status === 'parsing') {
        goStep('parsing');
        setTimeout(() => window.__triggerParse?.(), 300);
      }
    } catch (err) {
      console.warn('恢复会话失败:', err);
    }
  }
});
