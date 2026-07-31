// Standalone IUL data fixer — reads session JSON, fixes IUL benefit rows, writes back
import { readFileSync, writeFileSync } from "fs";

const sessionPath = process.argv[2];
if (!sessionPath) { console.error("Usage: node fix_iul_data.mjs <session.json>"); process.exit(1); }

const session = JSON.parse(readFileSync(sessionPath, "utf-8"));
let changed = false;

for (const ext of session.extractions) {
  if (ext.planType === "iul" && ext.data?.benefit_illustration) {
    ext.data.benefit_illustration = ext.data.benefit_illustration.map((r) => ({
      ...r,
      non_guaranteed_account_value: r.non_guaranteed_account_value || r.account_value || 0,
      non_guaranteed_cash_value: r.non_guaranteed_cash_value || r.cash_value || 0,
      non_guaranteed_death_benefit: r.non_guaranteed_death_benefit || r.death_benefit || undefined,
    }));
    changed = true;
  }
}

if (changed) {
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  console.log("IUL data fixed in", sessionPath);
} else {
  console.log("No IUL data to fix");
}
