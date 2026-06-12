#!/usr/bin/env bun
import fs from "fs";
import os from "os";
import path from "path";
import { generationQueue } from "../src/api/generation-queue.ts";
import { fingerprintGenerationInputs, hydrateGenerationCache, loadGenerationCache, storeGenerationCache } from "../src/api/generation-cache.ts";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "insurance-ppt-gen-cache-"));
const srcPpt = path.join(tmpRoot, "source.pptx");
const srcMd = path.join(tmpRoot, "source.marp.md");
const dstPpt = path.join(tmpRoot, "hydrated.pptx");
const dstMd = path.join(tmpRoot, "hydrated.marp.md");
fs.writeFileSync(srcPpt, "pptx-binary-placeholder");
fs.writeFileSync(srcMd, "# markdown-placeholder");

const key = fingerprintGenerationInputs({
  ownerId: "owner-a",
  companyId: "ctf",
  stylePreset: "chinese",
  quality: "standard",
  outputFormat: "pptx",
  templateId: "chinese-savings",
  fastPath: true,
  extractionHashes: ["hash-1", "hash-2"],
  extractionKinds: ["savings"],
  chatHash: "chat-hash",
});

storeGenerationCache(key, { mode: "fast", pptPath: srcPpt, markdownPath: srcMd }, {
  ownerId: "owner-a",
  companyId: "ctf",
  stylePreset: "chinese",
  quality: "standard",
  outputFormat: "pptx",
  templateId: "chinese-savings",
  fastPath: true,
  extractionHashes: ["hash-1", "hash-2"],
  extractionKinds: ["savings"],
  chatHash: "chat-hash",
});

const cached = loadGenerationCache(key);
if (!cached) throw new Error("cache manifest missing");
if (!fs.existsSync(cached.pptPath)) throw new Error("cached ppt missing");
if (!hydrateGenerationCache(key, { pptPath: dstPpt, markdownPath: dstMd })) throw new Error("hydrate failed");
if (!fs.existsSync(dstPpt) || !fs.existsSync(dstMd)) throw new Error("hydrate output missing");

let runs = 0;
const a = generationQueue.run("same-key", async () => {
  runs += 1;
  await new Promise((r) => setTimeout(r, 100));
  return "ok";
});
const b = generationQueue.run("same-key", async () => {
  runs += 1;
  return "nope";
});
const [ra, rb] = await Promise.all([a, b]);
if (ra !== "ok" || rb !== "ok") throw new Error("dedupe failed");
if (runs !== 1) throw new Error(`expected single execution, got ${runs}`);

console.log("queue/cache regression PASS");
