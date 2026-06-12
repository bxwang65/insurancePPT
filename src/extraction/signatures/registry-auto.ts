/**
 * 自动从 config/products/ + config/companies/ 加载产品，生成默认签名
 * 用户上传新产品的 PDF 后，可以用此函数快速添加签名
 */
import fs from "fs";
import path from "path";
import { SIGNATURES } from "./registry.ts";
import type { PdfSignature } from "./types.ts";

const PRODUCTS_DIR = path.resolve(import.meta.dir, "../../../config/products");
const COMPANIES_DIR = path.resolve(import.meta.dir, "../../../config/companies");

interface ProductConfig {
  id: string;
  companyId: string;
  planType: "savings" | "ci" | "iul";
  displayName: string;
  aliases: string[];
  requiredModules: string[];
}

interface CompanyConfig {
  id: string;
  displayName: string;
  aliases: string[];
}

function readJsonFiles<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const out: T[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readJsonFiles<T>(full));
    else if (entry.name.endsWith(".json")) {
      try {
        out.push(JSON.parse(fs.readFileSync(full, "utf8")) as T);
      } catch {}
    }
  }
  return out;
}

export function getAutoSignatures(): PdfSignature[] {
  const products = readJsonFiles<ProductConfig>(PRODUCTS_DIR).filter((p) => p.planType === "savings");
  const companies = readJsonFiles<CompanyConfig>(COMPANIES_DIR);
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const out: PdfSignature[] = [];
  for (const p of products) {
    const company = companyMap.get(p.companyId);
    if (!company) continue;
    // 只为还没有签名的产品生成默认签名
    if (SIGNATURES.some((s) => s.productCodeAliases?.includes(p.id.replace(`${p.companyId}-`, "")) || s.productName === p.displayName)) {
      continue;
    }
    out.push({
      id: `auto-${p.id}-v1`,
      companyId: p.companyId,
      productCode: p.id.split("-").pop()?.toUpperCase() || p.id.toUpperCase(),
      productName: p.displayName,
      planType: p.planType,
      currency: "USD",
      titleKeywords: p.aliases.slice(0, 2),
      firstPageMustContain: ["受保人", "保单货币"],
      presentationHorizonYears: 80,
      pageTargets: { summary: 1, noWithdraw: [2, 3] },
    });
  }
  return out;
}

export function getAllSignatures(): PdfSignature[] {
  return [...SIGNATURES, ...getAutoSignatures()];
}
