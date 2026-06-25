import assert from "node:assert/strict";
import { buildSignedDownloadUrl, verifyDownloadSignature } from "../src/api/download-auth.ts";

const secret = "test-secret";
const now = 1_700_000_000;
const url = buildSignedDownloadUrl({
  relativePath: "user_a/abc_综合方案.pptx",
  signingSecret: secret,
  nowSec: now,
  ttlSec: 3600,
});
const parsed = new URL(`http://localhost:3000${url}`);
const expires = Number(parsed.searchParams.get("expires") || 0);
const token = parsed.searchParams.get("token") || "";

assert.equal(
  verifyDownloadSignature({
    relativePath: "user_a/abc_综合方案.pptx",
    signingSecret: secret,
    expires,
    token,
    nowSec: now + 100,
  }),
  true,
);

assert.equal(
  verifyDownloadSignature({
    relativePath: "user_b/abc_综合方案.pptx",
    signingSecret: secret,
    expires,
    token,
    nowSec: now + 100,
  }),
  false,
);

assert.equal(
  verifyDownloadSignature({
    relativePath: "user_a/abc_综合方案.pptx",
    signingSecret: secret,
    expires,
    token,
    nowSec: now + 4000,
  }),
  false,
);

console.log(JSON.stringify({
  status: "ok",
  signedPath: "user_a/abc_综合方案.pptx",
  crossOwnerReplayBlocked: true,
  expirationGuard: true,
}, null, 2));

