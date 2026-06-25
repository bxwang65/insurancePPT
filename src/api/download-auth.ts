import crypto from "crypto";
import path from "path";

export function normalizeDownloadPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
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
  const expires = now + (params.ttlSec ?? 3600);
  const token = crypto.createHmac("sha256", params.signingSecret).update(`${normalized}:${expires}`).digest("hex");
  return `${base}?expires=${expires}&token=${token}`;
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

