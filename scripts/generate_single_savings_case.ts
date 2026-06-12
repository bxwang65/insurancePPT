import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = '/Users/soldier/free-code/packages/insurance-ppt';
const OUT = path.join(ROOT, 'outputs', 'single_savings_case');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/1429c316_custom/base_savings.json'), 'utf8'));
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs/1429c316_custom/withdrawal_analysis.json'), 'utf8'));

const insured = base.insured || {};
const policy = base.policy || {};
const years = (base.benefit_illustration || []) as any[];
const byYear = new Map<number, any>(years.map((r: any) => [Number(r.policy_year), r]));
const y7 = byYear.get(7);
const y16 = byYear.get(16);
const y20 = byYear.get(20);
const y30 = byYear.get(30);

const k = analysis.key_ages || {};
const k18 = k.age_18 || {};
const k21 = k.age_21 || {};
const k45 = k.age_45 || {};
const k60 = k.age_60 || {};
const k65 = k.age_65 || {};
const wRows = (analysis.withdrawal_rows || []) as any[];

const chart1 = '../1429c316_custom/withdraw_vs_base.png';
const chart2 = '../1429c316_custom/guarantee_stack.png';
const chart3 = '../1429c316_custom/annual_withdrawal.png';
const chart4 = '../1429c316_custom/cumulative_withdrawal.png';

const assetsDir = path.join(OUT, 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
const imgCompany = path.join(assetsDir, 'company.jpg');
const imgEducation = path.join(assetsDir, 'education.jpg');
const imgRetire = path.join(assetsDir, 'retire.jpg');
const imgFamily = path.join(assetsDir, 'family.jpg');

const fmt = (n: number | undefined) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const annual = Number(policy.annual_premium || 0);
const totalPaid = annual * 5;
const insuredAge = Number(insured.age || 1);

function pickMilestones() {
  const ages = [6, 10, 20, 30, 45, 60];
  const out: any[] = [];
  for (const age of ages) {
    const r = wRows.find((x) => Number(x.age) === age);
    if (!r) continue;
    out.push(r);
  }
  return out;
}

function decadeRowsWithdraw() {
  const out: any[] = [];
  const baseByYear = new Map<number, any>(years.map((r: any) => [Number(r.policy_year), r]));
  for (const r of wRows) {
    const py = Number(r.policy_year || 0);
    if (py === 1 || py % 10 === 0 || py >= 120) {
      const b = baseByYear.get(py);
      const paid = Number(b?.total_premium_paid || r.total_premium_paid || 0);
      const principal = Math.max(paid, 1);
      const yearsHeld = Math.max(py, 1);
      const endVal = Number(r.surrender_value_after || 0);
      const simple = ((endVal / principal - 1) / yearsHeld) * 100;
      const cagr = (Math.pow(endVal / principal, 1 / yearsHeld) - 1) * 100;
      out.push({ ...r, total_premium_paid: paid, simple_rate: simple, cagr_rate: cagr });
    }
  }
  return out.slice(0, 15);
}

function decadeRowsNoWithdraw() {
  const out: any[] = [];
  for (const r of years) {
    const py = Number(r.policy_year || 0);
    if (py === 1 || py % 10 === 0 || py >= 120) {
      out.push({
        age: insuredAge + py,
        policy_year: py,
        total_premium_paid: Number(r.total_premium_paid || 0),
        annual_withdrawal: 0,
        cumulative_withdrawal: 0,
        surrender_value_after: Number(r.total_surrender_value || 0),
        simple_rate: ((Number(r.total_surrender_value || 0) / Math.max(Number(r.total_premium_paid || 1), 1) - 1) / Math.max(py, 1)) * 100,
        cagr_rate: (Math.pow(Number(r.total_surrender_value || 0) / Math.max(Number(r.total_premium_paid || 1), 1), 1 / Math.max(py, 1)) - 1) * 100,
      });
    }
  }
  return out.slice(0, 15);
}

function tableHtml(rows: any[]) {
  const trs = rows.map((r) => `<tr>
    <td>${r.age}</td>
    <td>${r.policy_year}</td>
    <td>${fmt(r.total_premium_paid)}</td>
    <td>${fmt(r.annual_withdrawal)}</td>
    <td>${fmt(r.cumulative_withdrawal)}</td>
    <td>${fmt(r.surrender_value_after)}</td>
    <td>${(Number(r.simple_rate || 0)).toFixed(2)}%</td>
    <td>${(Number(r.cagr_rate || 0)).toFixed(2)}%</td>
  </tr>`).join('');
  return `<table class="data-table">
    <thead><tr><th>年龄</th><th>保单年度</th><th>已交总保费</th><th>领取金额</th><th>累计领取</th><th>退保现金价值</th><th>单利</th><th>复利</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

function firstYearHit(rows: any[], multiple: number, metricKey: string) {
  for (const r of rows) {
    const paid = Number(r.total_premium_paid || 0);
    const metric = Number(r[metricKey] || 0);
    if (paid > 0 && metric >= paid * multiple) return Number(r.policy_year || 0);
  }
  return null;
}

const milestones = pickMilestones();
const timelineCards = milestones.map((m) => `<div class="mile">
  <div class="age">${m.age}岁</div>
  <div class="line1">每年提领 US$ ${fmt(m.annual_withdrawal)}</div>
  <div class="line2">累计提领 US$ ${fmt(m.cumulative_withdrawal)}</div>
  <div class="line2">剩余退保值 US$ ${fmt(m.surrender_value_after)}</div>
</div>`).join('');
const tableW = tableHtml(decadeRowsWithdraw());
const tableN = tableHtml(decadeRowsNoWithdraw());
const noRows = years.map((r: any) => ({ ...r, metric: Number(r.total_surrender_value || 0) }));
const wdRowsForHit = wRows.map((r: any) => ({ ...r, metric: Number(r.surrender_plus_withdrawal || 0) }));
const noDouble = firstYearHit(noRows, 2, 'metric');
const noTriple = firstYearHit(noRows, 3, 'metric');
const wdDouble = firstYearHit(wdRowsForHit, 2, 'metric');
const wdTriple = firstYearHit(wdRowsForHit, 3, 'metric');

const md = `---
marp: true
theme: savings-case
paginate: true
size: 16:9
---

<!-- _class: cover -->
# ${insured.name || '客户家庭'} 储蓄险定制计划书
## 「匠X・传承」储蓄寿险计划2（尊尚版）
<p class="sub">以 1 岁被保人为核心，围绕教育金与养老金双目标</p>

---
## 公司介绍与资质
<div class="split">
  <div class="media"><img src="./assets/company.jpg" /></div>
  <div class="panel">
    <h3>周大福人寿（CTF Life）</h3>
    <ul>
      <li>Fitch 财务实力评级：A-</li>
      <li>Moody's 财务实力评级：A3</li>
      <li>香港RBC偿付能力充足率：282%（截至2025-12-31）</li>
      <li>定位：长期保障 + 家庭财富传承</li>
    </ul>
    <p class="explain">这页的作用是先建立客户对保险公司的信任，再进入产品方案细节。</p>
  </div>
</div>

---
## 保单参数总览
<div class="grid4">
<div class="kpi"><span>被保人</span><b>${insured.name || '-'}（${insured.age || '-'}岁）</b></div>
<div class="kpi"><span>缴费期</span><b>${policy.premium_payment_period || '-'}</b></div>
<div class="kpi"><span>年缴保费</span><b>US$ ${fmt(annual)}</b></div>
<div class="kpi"><span>总缴保费</span><b>US$ ${fmt(totalPaid)}</b></div>
</div>
<div class="note">第7年退保价值约 US$ ${fmt(y7?.total_surrender_value)}；第16年约 US$ ${fmt(y16?.total_surrender_value)}；第20年约 US$ ${fmt(y20?.total_surrender_value)}。</div>

---
## 教育金场景（18-21岁）
<div class="split">
  <div class="media"><img src="./assets/education.jpg" /></div>
  <div class="panel">
    <h3>1 岁投保 -> 18 岁进入教育金窗口</h3>
    <ul>
      <li>18岁累计可提领：US$ ${fmt(k18.cumulative_withdrawal)}</li>
      <li>21岁累计可提领：US$ ${fmt(k21.cumulative_withdrawal)}</li>
      <li>适配用途：学费、住宿、海外交换与研究经费</li>
    </ul>
    <p class="explain">这部分强调“资金什么时候可用、能支持哪些教育节点”，避免只讲收益不讲场景。</p>
  </div>
</div>

---
## 图表解读：提领前后退保价值
<div class="split chart-slide">
  <div class="media chart"><img src="${chart1}" /></div>
  <div class="panel">
    <h3>看什么？</h3>
    <ul>
      <li>蓝线：不提领时的退保价值</li>
      <li>金线：持续提领后的退保价值</li>
      <li>两条线都向上，说明提领后仍保留长期价值</li>
    </ul>
    <p class="explain">这张图用于回答客户最关心的问题：提款之后，保单会不会“被掏空”。</p>
  </div>
</div>

---
## 图表解读：保证与非保证构成
<div class="split chart-slide">
  <div class="media chart"><img src="${chart2}" /></div>
  <div class="panel">
    <h3>看什么？</h3>
    <ul>
      <li>深蓝：保证现金价值</li>
      <li>金色：非保证红利价值</li>
      <li>时间越长，非保证部分对总价值贡献越明显</li>
    </ul>
    <p class="explain">这页帮助客户理解“稳健底盘 + 红利弹性”的结构，不把产品讲成单一收益模型。</p>
  </div>
</div>

---
## 提领里程碑时间轴（代表年度）
<div class="timeline">
  ${timelineCards}
</div>
<div class="explain">从第6年开始可形成稳定提领，20岁阶段重点覆盖教育金，30-45岁覆盖家庭现金流，60岁后可转养老金用途。</div>

---
## 提领方案数据表（每10年展示）
<div class="split wide">
  <div class="table-wrap">${tableW}</div>
  <div class="panel side-note">
    <h3>提领方案解读</h3>
    <ul>
      <li>缴费方式：10万美金 × 5年</li>
      <li>以「退保价值+累计提领」口径：约第${wdDouble || '-'}年达到2倍</li>
      <li>以同口径：约第${wdTriple || '-'}年达到3倍</li>
      <li>表内单利/复利用于观察各阶段年化效率变化</li>
    </ul>
  </div>
</div>
<div class="explain">说明：该表为“提领后口径”，展示流动性与剩余资产并存的路径。</div>

---
## 不提领方案数据表（每10年展示）
<div class="split wide">
  <div class="table-wrap">${tableN}</div>
  <div class="panel side-note">
    <h3>不提领方案解读</h3>
    <ul>
      <li>缴费方式：10万美金 × 5年</li>
      <li>仅看退保价值：约第${noDouble || '-'}年达到2倍</li>
      <li>仅看退保价值：约第${noTriple || '-'}年达到3倍</li>
      <li>该路径更偏长期增值，不提供中途现金流</li>
    </ul>
  </div>
</div>
<div class="explain">说明：该表为“不提领口径”，适合与提领方案并排解释“收益 vs 流动性”差异。</div>

---
## 图表解读：年度提领节奏（优化版）
<div class="split chart-slide">
  <div class="media chart"><img src="${chart3}" /></div>
  <div class="panel">
    <h3>看什么？</h3>
    <ul>
      <li>柱形代表每年提领金额，整体节奏平稳</li>
      <li>适合做家庭预算中的“长期现金流模块”</li>
      <li>可与教育金或退休支出按年匹配</li>
    </ul>
    <p class="explain">这页作用是把保单从“收益产品”转换成“现金流工具”来沟通。</p>
  </div>
</div>

---
## 图表解读：累计提领现金流（优化版）
<div class="split chart-slide">
  <div class="media chart"><img src="${chart4}" /></div>
  <div class="panel">
    <h3>看什么？</h3>
    <ul>
      <li>累计提领随时间持续增长</li>
      <li>45岁累计提领：US$ ${fmt(k45.cumulative_withdrawal)}</li>
      <li>60岁累计提领：US$ ${fmt(k60.cumulative_withdrawal)}</li>
    </ul>
    <p class="explain">用累计线展示“拿走了多少钱”，让客户清晰感知长期兑现能力。</p>
  </div>
</div>

---
## 养老金场景（60岁后）
<div class="split">
  <div class="media"><img src="./assets/retire.jpg" /></div>
  <div class="panel">
    <h3>退休收入补充</h3>
    <ul>
      <li>60岁累计提领：US$ ${fmt(k60.cumulative_withdrawal)}</li>
      <li>65岁累计提领：US$ ${fmt(k65.cumulative_withdrawal)}</li>
      <li>65岁提领后退保价值：US$ ${fmt(k65.surrender_value_after)}</li>
      <li>65岁总量（退保值+累计提领）：US$ ${fmt(k65.surrender_plus_withdrawal)}</li>
    </ul>
    <p class="explain">这一页直连养老目标：不是抽象回报率，而是可领取金额与剩余资产。</p>
  </div>
</div>

---
## 家庭资产配置落地建议
<div class="split">
  <div class="media"><img src="./assets/family.jpg" /></div>
  <div class="panel">
    <h3>执行框架</h3>
    <ul>
      <li>阶段1（1-18岁）：以教育金为目标，重视资金准备时间</li>
      <li>阶段2（32-45岁）：提领用于家庭现金流补充</li>
      <li>阶段3（60岁后）：作为养老金现金流模块</li>
      <li>每3年复盘：提领额度、保单现价、家庭负债变化</li>
    </ul>
    <p class="explain">用“目标-现金流-复盘”闭环，避免方案只停留在纸面。</p>
  </div>
</div>
`;

const css = `/* @theme savings-case */
@import 'default';
section { background: linear-gradient(145deg,#f6efe3 0%,#f8fbff 50%,#eef4fb 100%); color:#10253b; font-family: 'Avenir Next','PingFang SC','Microsoft YaHei',sans-serif; padding:38px 48px; }
section.cover { background: linear-gradient(135deg,rgba(10,30,46,.88),rgba(16,57,87,.84)), url('https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?auto=format&fit=crop&w=1800&q=80'); background-size: cover; color:#fff; }
h1 { font-size:52px; color:#f4d08a; margin:0 0 8px; }
h2 { font-size:34px; color:#12304c; margin:0 0 10px; }
section.cover h2 { color:#e8f3ff; }
.sub { color:#d9e9ff; font-size:20px; }
.split { display:flex; gap:16px; align-items:stretch; }
.media { width:48%; background:#fff; border:1.5px solid #d6c199; border-radius:16px; padding:10px; box-shadow: 0 8px 20px rgba(18,41,64,.08); }
.media img { width:100%; height:100%; object-fit:cover; border-radius:12px; }
.chart-slide .media { width:56%; }
.panel { width:52%; background:#fff; border:1.5px solid #d6c199; border-radius:16px; padding:14px 16px; box-shadow: 0 8px 20px rgba(18,41,64,.08); }
.chart-slide .panel { width:44%; }
.grid4 { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.kpi { background:#fff; border:1.5px solid #d6c199; border-radius:14px; padding:12px 14px; }
.kpi span { display:block; color:#5c6f81; font-size:16px; }
.kpi b { color:#142f4a; font-size:24px; }
h3 { margin:0 0 8px; color:#12304c; font-size:25px; }
li { font-size:19px; line-height:1.42; margin:4px 0; }
.note { margin-top:10px; font-size:18px; color:#3b546d; }
.explain { margin-top:8px; font-size:16px; line-height:1.45; color:#47627f; background:#f6f9fd; border-left:4px solid #c59a49; padding:8px 10px; border-radius:8px; }
.timeline { display:flex; gap:10px; margin-bottom:8px; }
.mile { flex:1; background:#fff; border:1.5px solid #d6c199; border-radius:12px; padding:10px; box-shadow: 0 4px 14px rgba(18,41,64,.06); }
.mile .age { font-size:24px; color:#12304c; font-weight:800; margin-bottom:6px; }
.mile .line1 { font-size:15px; color:#21425f; }
.mile .line2 { font-size:14px; color:#48637e; margin-top:2px; }
.data-table { width:100%; border-collapse:collapse; background:#fff; border-radius:12px; overflow:hidden; font-size:14px; }
.data-table th { background:#12304c; color:#fff; padding:6px 8px; text-align:center; }
.data-table td { border-bottom:1px solid #e5edf5; padding:6px 8px; text-align:center; color:#1e3b56; }
.split.wide { align-items:flex-start; }
.table-wrap { width:74%; }
.side-note { width:26%; }
`;

const mdPath = path.join(OUT, 'single_savings_case.marp.md');
const themePath = path.join(OUT, 'savings-case.css');
const pptxPath = path.join(OUT, 'single_savings_case.pptx');
const pdfPath = path.join(OUT, 'single_savings_case.pdf');
fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(themePath, css, 'utf8');

async function fetchImage(url: string, outPath: string) {
  if (fs.existsSync(outPath)) return;
  await new Promise<void>((resolve, reject) => {
    const p = spawn('curl', ['-L', '--fail', '-o', outPath, url], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`curl exit ${code}`)));
  });
}

function ensurePlaceholder(p: string, label: string) {
  if (fs.existsSync(p)) return;
  const fallback = path.join(ROOT, 'outputs/1429c316_custom/withdraw_vs_base.png');
  if (fs.existsSync(fallback)) {
    fs.copyFileSync(fallback, p);
    return;
  }
  fs.writeFileSync(p, label, 'utf8');
}

async function render(flag: '--pptx' | '--pdf', output: string) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('npx', ['@marp-team/marp-cli@latest', mdPath, flag, '--allow-local-files', '--theme-set', themePath, '--theme', 'savings-case', '-o', output], { cwd: OUT, stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`marp exit ${code}`)));
  });
}

for (const [u, p, label] of [
  ['https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80', imgCompany, '公司形象图'],
  ['https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1600&q=80', imgEducation, '教育金场景图'],
  ['https://images.unsplash.com/photo-1516307365426-bea591f05011?auto=format&fit=crop&w=1600&q=80', imgRetire, '养老金场景图'],
  ['https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1600&q=80', imgFamily, '家庭现金流场景图'],
] as Array<[string, string, string]>) {
  try {
    await fetchImage(u, p);
  } catch {
    ensurePlaceholder(p, label);
  }
}

await render('--pptx', pptxPath);
await render('--pdf', pdfPath);
console.log(JSON.stringify({ mdPath, pptxPath, pdfPath }, null, 2));
