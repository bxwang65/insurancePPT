/**
 * 批量 fast-path 测试 (本地, 不调 LLM)
 * 用法: bun run scripts/batch_fast_path.ts
 */
import fs from "fs";
import path from "path";
import { tryFastExtraction } from "../src/extraction/fast-path.ts";

const ROOT = "/Users/soldier/Downloads";
const TARGETS = [
  // 储蓄险 (用户公网测试过的)
  { pdf: `${ROOT}/计划书.pdf`, label: "AIA 環宇盈活" },
  { pdf: `${ROOT}/官方计划书案例/友邦——環宇盈活儲蓄保險計劃.pdf`, label: "AIA 環宇盈活 (官方)" },
  { pdf: `${ROOT}/官方计划书案例/友邦——環宇盈活儲蓄保險計劃(1).pdf`, label: "AIA 環宇盈活 (官方-1)" },
  { pdf: `${ROOT}/官方计划书案例/友邦——财富盈活储蓄保险计划.pdf`, label: "AIA 财富盈活" },
  { pdf: `${ROOT}/官方计划书案例/愛伴航保險計劃2.pdf`, label: "AIA 愛伴航2" },
  { pdf: `${ROOT}/官方计划书案例/愛伴航保險計劃2(1).pdf`, label: "AIA 愛伴航2 (1)" },
  { pdf: `${ROOT}/官方计划书案例/愛伴航保險計劃2(2).pdf`, label: "AIA 愛伴航2 (2)" },
  { pdf: `${ROOT}/官方计划书案例/保诚——信守明天多元貨幣計劃.pdf`, label: "PRU 信守明天" },
  { pdf: `${ROOT}/官方计划书案例/中国人寿——傲瓏盛世儲蓄保險計劃.pdf`, label: "中国人寿 傲珑盛世 C540" },
  { pdf: `${ROOT}/官方计划书案例/太平洋保险——鑫安逸储蓄保险计划.pdf`, label: "中国太平 鑫安逸 AAXNA1U" },
  { pdf: `${ROOT}/官方计划书案例/太平保险——頤年樂享儲蓄保險計劃尊享版.pdf`, label: "太平 颐年乐享尊享版" },
  { pdf: `${ROOT}/官方计划书案例/周大福——匠心傳承儲蓄計劃2尊尚版.pdf`, label: "CTF 匠心传承2尊尚版" },
  { pdf: `${ROOT}/官方计划书案例/周大福——匠心傳承儲蓄計劃2尊尚版(1).pdf`, label: "CTF 匠心传承2尊尚版 (1)" },
  { pdf: `${ROOT}/官方计划书案例/周大福——匠心飛越儲蓄保險計劃.pdf`, label: "CTF 匠心飞越" },
  { pdf: `${ROOT}/官方计划书案例/万通——富饒萬家儲蓄保險計劃.pdf`, label: "YFLife 富饶万家 BISP5" },
  { pdf: `${ROOT}/官方计划书案例/安盛——盛利II儲蓄保險至尊.pdf`, label: "AXA 盛利II 至尊" },
  { pdf: `${ROOT}/官方计划书案例/忠意人寿——啟航創富卓越版.pdf`, label: "Generali 启航创富" },
  { pdf: `${ROOT}/官方计划书案例/富卫——盈聚天下II保險計劃.pdf`, label: "FWD 盈聚天下II" },
  { pdf: `${ROOT}/官方计划书案例/宏利——宏挚传承保障计划.pdf`, label: "Manulife 宏挚传承" },
  { pdf: `${ROOT}/官方计划书案例/宏利——宏挚家传承保险计划.pdf`, label: "Manulife 宏挚家" },
  { pdf: `${ROOT}/官方计划书案例/守護家倍198.pdf`, label: "AIA 守护家倍198" },
  { pdf: `${ROOT}/官方计划书案例/守護家倍198(1).pdf`, label: "AIA 守护家倍198 (1)" },
  { pdf: `${ROOT}/官方计划书案例/守護家倍198(2).pdf`, label: "AIA 守护家倍198 (2)" },
  { pdf: `${ROOT}/世代悅享儲蓄保險計劃3.pdf`, label: "YFLife 世代悦享3" },
];

async function main() {
  console.log(`=== 批量 fast-path 测试 (${TARGETS.length} 个 PDF) ===\n`);
  console.log("PDF                                  | 命中签名                       | 行数              | 耗时   | 备注");
  console.log("-".repeat(120));

  let matched = 0;
  let empty = 0;
  let noSig = 0;
  let fail = 0;

  for (const t of TARGETS) {
    if (!fs.existsSync(t.pdf)) {
      console.log(`${pad(t.label, 36)} | MISSING FILE`);
      fail++;
      continue;
    }
    try {
      const r = await tryFastExtraction(t.pdf);
      const sig = r.signature?.id || "-";
      const nw = r.data ? Object.keys(r.data.no_withdraw).length : 0;
      const wd = r.data ? Object.keys(r.data.withdraw).length : 0;
      const rows = nw + wd > 0 ? `nw=${nw} wd=${wd}` : "0 行";
      const ms = `${r.durationMs}ms`;
      const reason = r.matched ? "" : `[${r.reason || "no_match"}]`;

      if (r.matched && nw + wd > 0) {
        matched++;
      } else if (r.matched && nw + wd === 0) {
        empty++;
      } else {
        noSig++;
      }

      console.log(`${pad(t.label, 36)} | ${pad(sig, 30)} | ${pad(rows, 17)} | ${pad(ms, 7)} | ${reason}`);
    } catch (e: any) {
      console.log(`${pad(t.label, 36)} | ERROR: ${e.message?.substring(0, 50)}`);
      fail++;
    }
  }

  console.log("\n=== 汇总 ===");
  console.log(`总计: ${TARGETS.length}`);
  console.log(`✓ fast-path 命中且提取数据: ${matched} (${pct(matched, TARGETS.length)})`);
  console.log(`⚠ 命中签名但 0 行 (需 LLM): ${empty} (${pct(empty, TARGETS.length)})`);
  console.log(`✗ 无签名匹配 (需 LLM):      ${noSig} (${pct(noSig, TARGETS.length)})`);
  console.log(`! 失败/缺失:                ${fail} (${pct(fail, TARGETS.length)})`);
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.substring(0, n);
  return s + " ".repeat(n - s.length);
}
function pct(a: number, b: number): string {
  return b === 0 ? "0%" : `${Math.round((a / b) * 100)}%`;
}

main().catch(console.error);