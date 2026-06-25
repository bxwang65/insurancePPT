/* =========================================================================
   保单摘要长图生成器 - 关键指标 + 完整数据表
   ========================================================================= */

import { state } from '../state.js';

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (typeof n === 'number') return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n;
}

function calcMilestones(bi, paidTotal) {
  let payback = null, double = null, triple = null;
  const sorted = [...bi].sort((a, b) => a.policy_year - b.policy_year);
  for (const r of sorted) {
    const y = r.policy_year;
    const total = r.total_surrender_value || 0;
    if (total <= 0) continue;
    const mult = paidTotal > 0 ? total / paidTotal : 0;
    if (payback === null && total >= paidTotal) payback = y;
    if (double === null && mult >= 2.0) double = y;
    if (triple === null && mult >= 3.0) triple = y;
  }
  return { payback, double, triple };
}

function getCompanyId(planType) {
  if (planType === 'ci') return state.ciCompany;
  if (planType === 'iul') return state.iulCompany;
  return state.savingsCompany;
}

function buildFullSummaryHTML(interval = 5) {
  const extractions = state.extractions || [];
  if (!extractions.length) return '<div style="padding:40px;text-align:center;color:#999;">暂无提取数据</div>';

  let allHtml = '';

  extractions.forEach((extraction, idx) => {
    const data = extraction.data || {};
    const ins = data.insured || {};
    const pol = data.policy || {};
    const bi = (data.benefit_illustration || []).filter(r => r.total_surrender_value > 0);
    const payPeriod = Math.max(parseInt(String(pol.premium_payment_period || '5').replace('年','')) || 5, 5);
    const paidTotal = (pol.annual_premium || 0) * payPeriod;
    const milestones = calcMilestones(bi, paidTotal);
    const currency = pol.currency || 'USD';
    const productName = data.product_name || pol.product_name || '—';
    const planType = extraction.planType || 'savings';
    const typeLabel = { savings: '储蓄险', ci: '重疾险', iul: 'IUL' }[planType] || '保险';
    const companyId = getCompanyId(planType);
    const heroUrl = companyId ? `/assets/library/companies/${companyId}/company-hero-01.png` : '';

    // 按间隔过滤
    let displayYears = bi
      .filter(r => r.policy_year === 1 || r.policy_year % interval === 0)
      .sort((a, b) => a.policy_year - b.policy_year);
    const lastYear = bi.length ? bi[bi.length - 1].policy_year : 0;
    if (lastYear > 0 && !displayYears.find(d => d.policy_year === lastYear)) {
      const last = bi.find(r => r.policy_year === lastYear);
      if (last) displayYears.push(last);
    }

    const msItems = [
      milestones.payback ? `<div style="background:rgba(255,255,255,.18);border-radius:10px;padding:6px 10px;text-align:center;"><div style="font-size:9px;opacity:.7;">回本</div><div style="font-size:16px;font-weight:700;">第${milestones.payback}年</div></div>` : '',
      milestones.double ? `<div style="background:rgba(255,255,255,.18);border-radius:10px;padding:6px 10px;text-align:center;"><div style="font-size:9px;opacity:.7;">翻倍</div><div style="font-size:16px;font-weight:700;">第${milestones.double}年</div></div>` : '',
      milestones.triple ? `<div style="background:rgba(255,255,255,.18);border-radius:10px;padding:6px 10px;text-align:center;"><div style="font-size:9px;opacity:.7;">三倍</div><div style="font-size:16px;font-weight:700;">第${milestones.triple}年</div></div>` : '',
    ].filter(Boolean).join('');

    const intervalLabel = { 1: '每年', 5: '每5年', 10: '每10年' }[interval] || `每${interval}年`;
    const rowFontSize = displayYears.length > 80 ? '9px' : '10px';
    const tableRows = displayYears.map(r => {
      const y = r.policy_year;
      const prem = r.total_premium_paid || 0;
      const total = r.total_surrender_value || 0;
      const guar = r.guaranteed_cash_value || 0;
      const nonGuar = total - guar;
      const mult = paidTotal > 0 ? (total / paidTotal) : 0;
      const irr = (total > paidTotal && y > 0) ? (Math.pow(total / paidTotal, 1 / y) - 1) : null;
      const bg = y % 2 === 0 ? 'background:#f8f9fb;' : '';
      return `<tr style="${bg}">
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:center;color:#666;">${y}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:center;color:#666;">${ins.age ? Number(ins.age) + y - 1 : '—'}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:right;">${fmtNum(prem)}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:right;">${fmtNum(guar)}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:right;color:#2563eb;">${fmtNum(nonGuar > 0 ? nonGuar : 0)}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:right;font-weight:600;">${fmtNum(total)}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:center;font-weight:600;">${(mult > 0 && isFinite(mult)) ? mult.toFixed(2) + 'x' : '—'}</td>
        <td style="padding:2px 2px;border-bottom:1px solid #f0f0f0;font-size:${rowFontSize};text-align:center;color:#999;">${(irr && isFinite(irr)) ? (irr * 100).toFixed(2) + '%' : '—'}</td>
      </tr>`;
    }).join('');

    allHtml += `
      <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);margin-bottom:24px;">
        <div style="background:${heroUrl ? `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.65)),url(${heroUrl})` : 'linear-gradient(135deg,#1a2a4a,#2d4a6a)'};background-size:cover;background-position:center;color:#fff;padding:20px 16px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div>
              <div style="font-size:9px;opacity:.6;letter-spacing:.1em;margin-bottom:3px;">${typeLabel.toUpperCase()} · 保单摘要 · ${intervalLabel}</div>
              <div style="font-size:18px;font-weight:700;line-height:1.3;">${productName}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:9px;opacity:.6;">受保人</div>
              <div style="font-size:14px;font-weight:600;">${ins.name || '—'}${ins.age ? `（${ins.age}岁）` : ''}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;">
            <div style="background:rgba(255,255,255,.12);border-radius:8px;padding:8px 6px;text-align:center;">
              <div style="font-size:9px;opacity:.7;margin-bottom:2px;">年缴保费</div>
              <div style="font-size:14px;font-weight:700;">${currency} ${(pol.annual_premium || 0).toLocaleString()}</div>
            </div>
            <div style="background:rgba(255,255,255,.12);border-radius:8px;padding:8px 6px;text-align:center;">
              <div style="font-size:9px;opacity:.7;margin-bottom:2px;">缴费年期</div>
              <div style="font-size:14px;font-weight:700;">${pol.premium_payment_period || '—'}</div>
            </div>
            <div style="background:rgba(255,255,255,.12);border-radius:8px;padding:8px 6px;text-align:center;">
              <div style="font-size:9px;opacity:.7;margin-bottom:2px;">总缴保费</div>
              <div style="font-size:14px;font-weight:700;">${currency} ${paidTotal.toLocaleString()}</div>
            </div>
          </div>
          ${msItems ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(msItems.split('</div>').length - 1, 3)},1fr);gap:6px;">${msItems}</div>` : ''}
        </div>
        <div style="padding:12px 8px;">
          <div style="font-size:12px;font-weight:600;color:#1a1a2e;margin-bottom:8px;">📋 利益演示（${intervalLabel} · 共 ${displayYears.length} 行）</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-family:monospace,'Courier New',sans-serif;">
              <thead>
                <tr style="background:#f0f2f5;">
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:center;border-bottom:2px solid #ddd;">年度</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:center;border-bottom:2px solid #ddd;">年龄</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:right;border-bottom:2px solid #ddd;">已缴保费</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:right;border-bottom:2px solid #ddd;">保证现价</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:right;border-bottom:2px solid #ddd;">非保证</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:right;border-bottom:2px solid #ddd;">总退保价值</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:center;border-bottom:2px solid #ddd;">倍数</th>
                  <th style="padding:4px 2px;font-size:9px;color:#666;font-weight:600;text-align:center;border-bottom:2px solid #ddd;">IRR</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
        <div style="padding:8px 12px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:8px;color:#999;">
          <span>由 AI Insurance 生成</span>
          <span>${new Date().toLocaleDateString('zh-CN')}</span>
        </div>
      </div>`;
  });

  return `<div style="padding:16px 10px;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${allHtml}</div>`;
}

export function renderSummaryTo(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = buildFullSummaryHTML();
}

/** 弹出间隔选择器 */
export function showIntervalDialog() {
  const existing = document.getElementById('summaryIntervalOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'summaryIntervalOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  overlay.innerHTML = [
    '<div style="background:#fff;border-radius:20px;padding:28px 24px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center;">',
    '  <div style="font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">📸 导出摘要图</div>',
    '  <div style="font-size:12px;color:#94a3b8;margin-bottom:20px;">选择数据显示间隔</div>',
    '  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">',
    '    <button class="interval-opt" data-interval="1" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;background:#fff;font-size:15px;font-weight:600;color:#0f172a;cursor:pointer;width:100%;">📋 每年显示<span style="font-weight:400;font-size:12px;color:#94a3b8;display:block;margin-top:2px;">完整展示所有年份</span></button>',
    '    <button class="interval-opt" data-interval="5" style="padding:14px;border:2px solid #2563eb;border-radius:12px;background:#eff6ff;font-size:15px;font-weight:600;color:#1e40af;cursor:pointer;width:100%;">📊 每5年显示<span style="font-weight:400;font-size:12px;color:#64748b;display:block;margin-top:2px;">推荐，兼顾完整与简洁</span></button>',
    '    <button class="interval-opt" data-interval="10" style="padding:14px;border:2px solid #e2e8f0;border-radius:12px;background:#fff;font-size:15px;font-weight:600;color:#0f172a;cursor:pointer;width:100%;">📈 每10年显示<span style="font-weight:400;font-size:12px;color:#94a3b8;display:block;margin-top:2px;">最简洁，突出趋势</span></button>',
    '  </div>',
    '  <button id="intervalCancelBtn" style="padding:8px 20px;border:none;border-radius:8px;background:#f1f5f9;font-size:13px;color:#64748b;cursor:pointer;">取消</button>',
    '</div>',
  ].join('');
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.interval-opt').forEach(btn => {
    btn.onclick = async () => {
      const interval = parseInt(btn.dataset.interval);
      overlay.remove();
      await exportSummaryAsImage(interval);
    };
  });
  document.getElementById('intervalCancelBtn').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

async function exportSummaryAsImage(interval = 5) {
  const container = document.getElementById('summaryExportArea');
  if (!container) { console.error('summaryExportArea not found'); return; }

  container.innerHTML = buildFullSummaryHTML(interval);
  await new Promise(r => setTimeout(r, 400));

  try {
    container.style.display = 'block';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.zIndex = '-1';
    container.style.width = '460px';

    await new Promise(r => setTimeout(r, 400));

    const rowCount = container.querySelectorAll('tbody tr').length;
    const scale = rowCount > 100 ? 1.2 : rowCount > 60 ? 1.5 : 2.0;

    const canvas = await html2canvas(container, {
      scale,
      useCORS: true,
      backgroundColor: '#f0f2f5',
      logging: false,
      width: 460,
      height: container.scrollHeight,
    });

    container.style.display = 'none';
    container.style.position = '';
    container.style.left = '';
    container.style.top = '';
    container.style.zIndex = '';
    container.style.width = '';

    const link = document.createElement('a');
    const suffix = interval === 1 ? '每年' : interval === 5 ? '每5年' : '每10年';
    link.download = `保单摘要_${suffix}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('导出摘要图失败:', err);
    container.style.display = 'none';
    alert('导出失败: ' + (err.message || '未知错误'));
  }
}
