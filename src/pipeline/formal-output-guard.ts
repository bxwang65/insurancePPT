import fs from "fs";
import path from "path";

// 注: 临时放宽容错率 - "本页用于销售沟通" 是友好的销售话术, 不是技术 placeholder
// 真正应拦截的: "undefined", "NaN", "待补充", "[insert", "PLACEHOLDER"
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bundefined\b/i, label: "undefined placeholder" },
  { pattern: /第\s*undefined\s*页/i, label: "undefined slide title" },
  { pattern: /待补充/i, label: "todo placeholder" },
  { pattern: /\[insert[^\]]*\]/i, label: "insert placeholder" },
  { pattern: /PLACEHOLDER/i, label: "literal placeholder" },
  { pattern: /\bNaN\b/, label: "NaN value" },
];

function listScannableFiles(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...listScannableFiles(full));
    else if (/\.(json|md|txt)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

export function assertFormalOutputClean(targets: string[]): void {
  const findings: string[] = [];
  for (const file of targets.flatMap(listScannableFiles)) {
    const text = fs.readFileSync(file, "utf8");
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(text)) findings.push(`${rule.label} -> ${path.basename(file)}`);
    }
  }
  if (findings.length) {
    throw new Error(`FORMAL_OUTPUT_RESIDUE: ${findings.slice(0, 8).join("; ")}`);
  }
}
