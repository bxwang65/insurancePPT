import crypto from "crypto";
import path from "path";

export function normalizeDownloadPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

/**
 * 2026-09-12: URL 有效期从硬编码 3600 改为可配 —— 用户需要把结果链接外发给
 * 客户/同事, 1 小时就失效不可用. 默认改为 7 天 (604800s).
 * 设 DOWNLOAD_URL_TTL_SEC=3600 可回到旧行为; 非法/空值回退默认.
 */
function defaultTtlSec(): number {
  const raw = process.env.DOWNLOAD_URL_TTL_SEC;
  const v = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(v) && v > 0 ? v : 604800;
}

export function buildSignedDownloadUrl(params: {
  relativePath: string;
  signingSecret: string;
  ttlSec?: number;
  nowSec?: number;
}): string {
  const normalized = normalizeDownloadPath(params.relativePath);
  const base = `/downloads/${normalized.split("/").map((seg) => encodeURIComponent(seg)).join("/")}`;
  if (!params.signingSecret) return base;
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const expires = now + (params.ttlSec ?? defaultTtlSec());
  const token = crypto.createHmac("sha256", params.signingSecret).update(`${normalized}:${expires}`).digest("hex");
  return `${base}?expires=${expires}&token=${token}`;
}

/**
 * 2026-07-26: 给所有下载 URL 加 `?v=<mtime>` 强制 CF cache-bust。
 * 之前 CF 把 /downloads/local/* 错 cache 成 404 持续 4 小时,
 * SPA 缩略图全部 broken (自然图片 alt text 显示)。
 * 加上 mtime 后, CF 不会命中旧 cache, 总走 origin。
 * bun 端 Cache-Control: no-store 也设置; 这里 query 只是兜底应对已 cache 的旧 404。
 */
export function appendCacheBustQuery(url: string, mtimeMs?: number): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const ts = mtimeMs ?? Date.now();
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${ts}`;
}

export function verifyDownloadSignature(params: {
  relativePath: string;
  signingSecret: string;
  expires: number;
  token: string;
  nowSec?: number;
}): boolean {
  if (!params.signingSecret) return true;
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  if (!params.expires || params.expires < now || !params.token) return false;
  const normalized = normalizeDownloadPath(params.relativePath);
  const expected = crypto.createHmac("sha256", params.signingSecret).update(`${normalized}:${params.expires}`).digest("hex");
  return params.token.length === expected.length && crypto.timingSafeEqual(Buffer.from(params.token), Buffer.from(expected));
}

