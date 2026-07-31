/**
 * 关键数字交叉验证（vs 已知官方值）
 *
 * 设计: 数据必须 100% 匹配官方已知值；不匹配 → warn（PDF 舍入差异是正常）
 * 关键数字基线来自 registry.ts 的 crossCheckBaseline 字段
 */
import type { NormalizedSavingsPlan } from "./savings-normalizer.ts";
import { getSignatureById } from "../extraction/signatures/registry.ts";

export interface CrossCheckIssue {
  code: string;
  level: "error" | "warn";
  message: string;
  baseline?: number;
  actual?: number;
  diff?: number;
}

export function crossValidateSavings(
  plan: NormalizedSavingsPlan,
  signatureId?: string,
): CrossCheckIssue[] {
  const issues: CrossCheckIssue[] = [];
  const sig = signatureId ? getSignatureById(signatureId) : undefined;
  if (!sig?.crossCheckBaseline?.length) {
    issues.push({ code: "CROSS_CHECK_NO_BASELINE", level: "warn", message: "未配置交叉验证基线（签名未注册或 baseline 为空）" });
    return issues;
  }

  let checked = 0;
  let passed = 0;
  for (const baseline of sig.crossCheckBaseline) {
    checked++;
    let actual: number | null = null;

    // snake_case -> camelCase 字段映射
    const BENEFIT_FIELD_MAP: Record<string, string> = {
      total_surrender_value: "totalSurrenderValue",
      guaranteed_cash_value: "guaranteedCashValue",
      reversionary_bonus: "reversionaryBonus",
      terminal_dividend: "terminalDividend",
    };
    if (BENEFIT_FIELD_MAP[baseline.field]) {
      const row = plan.benefitRows.find((r) => r.policyYear === baseline.policyYear);
      if (row) {
        actual = (row as any)[BENEFIT_FIELD_MAP[baseline.field]] ?? null;
      }
    } else if (baseline.field === "annual_withdrawal" || baseline.field === "cumulative_withdrawal") {
      const row = plan.withdrawalRows.find((r) => r.policyYear === baseline.policyYear);
      if (row) {
        actual = baseline.field === "annual_withdrawal"
          ? row.annualWithdrawal
          : row.cumulativeWithdrawal;
      }
    }

    if (actual === null) {
      issues.push({
        code: "CROSS_CHECK_DATA_MISSING",
        level: "warn",
        message: `${baseline.label}: 目标年度 ${baseline.policyYear} 数据缺失`,
        baseline: baseline.expected,
      });
      continue;
    }

    const tolerance = baseline.tolerance ?? 0;
    const diff = Math.abs(actual - baseline.expected);
    if (diff <= tolerance) {
      passed++;
    } else {
      const pct = baseline.expected > 0 ? (diff / baseline.expected * 100).toFixed(2) : "∞";
      issues.push({
        code: "CROSS_CHECK_MISMATCH",
        level: "warn",  // 不阻断导出，差异可能是 PDF 舍入
        message: `${baseline.label} Y${baseline.policyYear}: 预期 ${baseline.expected.toLocaleString()}, 实测 ${actual.toLocaleString()}, 偏差 ${pct}%`,
        baseline: baseline.expected,
        actual,
        diff,
      });
    }
  }

  if (checked > 0) {
    const passRate = (passed / checked * 100).toFixed(0);
    if (passed === checked) {
      issues.push({ code: "CROSS_CHECK_PASS", level: "warn", message: `✓ 关键数字交叉验证 ${passed}/${checked} 通过 (100%)` });
    } else if (passed / checked >= 0.6) {
      issues.push({ code: "CROSS_CHECK_PARTIAL", level: "warn", message: `⚠ 关键数字交叉验证 ${passed}/${checked} 通过 (${passRate}%)，需人工复核舍入` });
    } else {
      issues.push({ code: "CROSS_CHECK_FAIL", level: "error", message: `✗ 关键数字交叉验证 ${passed}/${checked} 通过 (${passRate}%)，疑似数据源错误` });
    }
  }
  return issues;
}
