import fs from 'fs';
import path from 'path';
import { OutlineGenerator } from '../src/chat/outline-generator.ts';
import { spawn } from 'child_process';

const ROOT = '/Users/soldier/free-code/packages/insurance-ppt';
const sessionId = process.argv[2] || '0105113f';
const customerName = process.argv[3] || 'Boxie 家庭';
const sessionPath = path.join(ROOT, 'sessions', `${sessionId}.json`);

if (!fs.existsSync(sessionPath)) {
  console.error(`Session not found: ${sessionPath}`);
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const extractions = (session.extractions || []).filter((e: any) => e.data).map((e: any) => ({
  pdfName: e.pdfName,
  planType: e.planType,
  data: e.data,
}));

if (!extractions.length) {
  console.error('No parsed extractions in session');
  process.exit(1);
}

const og = new OutlineGenerator(process.env.GEMINI_API_KEY || '');
const outline = await og.generate({
  extractions,
  customerName,
  enhanceWithAI: false,
  companyInfo: '本方案用于家庭资产配置沟通，不构成投资承诺。',
});

const mdPath = path.join(ROOT, 'outputs', `${sessionId}_家庭资产配置定制方案.md`);
fs.writeFileSync(mdPath, outline, 'utf8');

const pptData = {
  extractions: extractions.map((e: any) => ({ pdf_name: e.pdfName, plan_type: e.planType, data: e.data })),
  customer_name: customerName,
  title: '家庭资产配置定制方案',
  date: new Date().toISOString().split('T')[0],
};

const pptPath = path.join(ROOT, 'outputs', `${sessionId}_家庭资产配置定制方案.pptx`);
const py = spawn('python3.11', [
  path.join(ROOT, 'scripts', 'ppt_generator.py'),
  '--data', JSON.stringify(pptData),
  '--style', 'professional',
  '--output', pptPath,
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stdout = '';
let stderr = '';
py.stdout.on('data', (d) => stdout += d.toString());
py.stderr.on('data', (d) => stderr += d.toString());

const code: number = await new Promise((resolve) => py.on('close', resolve));
if (code !== 0) {
  console.error(stderr || stdout);
  process.exit(code || 1);
}

console.log(JSON.stringify({ sessionId, mdPath, pptPath }, null, 2));
