import { tryFastExtraction } from "../src/extraction/fast-path.ts";
import { toSavingsPlanFromSignature } from "../src/extraction/fast-path-adapter.ts";
import { normalizeSavingsPlan } from "../src/savings/savings-normalizer.ts";
import { validateFormalSavingsPlan } from "../src/savings/formal-deck-validator.ts";
import crypto from "crypto";
import fs from "fs";

const PDF = "/Users/soldier/Downloads/宏挚家传承保险计划.pdf";
const fast = await tryFastExtraction(PDF, { minConfidence: 0.5 });
console.log("Fast matched:", fast.matched, "reason:", fast.reason);
console.log("Signature:", fast.signature?.id);

if (fast.matched && fast.data) {
  console.log("\n[No-withdraw] first 5 rows:");
  for (const y of ["1", "2", "3", "4", "5", "10", "20", "30"]) {
    const r = (fast.data.no_withdraw as any)[y];
    if (r) console.log(`  Y${y} Paid=${r.Paid} Guar_CV=${r.Guar_CV} Rev=${r.Rev} Term=${r.Term} Total=${r.Total} SourcePage=${r.SourcePage}`);
  }
  console.log("\n[Withdraw] first 5 rows:");
  for (const y of ["1", "2", "3", "5", "10", "20", "30"]) {
    const r = (fast.data.withdraw as any)[y];
    if (r) console.log(`  Y${y} Paid=${r.Paid} Annual_WD=${r.Annual_WD} Cum_WD=${r.Cum_WD} Total=${r.Total} SourcePage=${r.SourcePage}`);
  }

  const plan = toSavingsPlanFromSignature(fast.data, fast.signature!.id, fast.signature!.productName);
  const fileBuf = fs.readFileSync(PDF);
  const pdfHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
  (plan as any).source = { pdfHash, pdfPath: PDF, parser: "debug", signatureId: fast.signature!.id };
  const normalized = normalizeSavingsPlan(plan, { pdfPath: PDF, parser: "debug", signatureId: fast.signature!.id } as any);

  console.log("\n[Validation issues]:");
  for (const issue of validateFormalSavingsPlan(normalized)) {
    if (issue.level === "error") {
      console.log(`  E ${issue.code}: ${issue.message}`);
    }
  }
  console.log("\n[Normalized benefit rows] first 3 + last 3:");
  const nws = normalized.benefitRows;
  console.log(`  total: ${nws.length}`);
  for (const i of [0, 1, 2, nws.length - 3, nws.length - 2, nws.length - 1]) {
    const r = nws[i];
    if (r) console.log(`  Y${r.policyYear} Paid=${r.totalPremiumPaid} Guar=${r.guaranteedCashValue} Rev=${r.reversionaryBonus} Term=${r.terminalDividend} Total=${r.totalSurrenderValue}`);
  }
}
