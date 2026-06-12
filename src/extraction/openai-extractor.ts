/**
 * OpenAI 兼容 API extractor (用于 DeepSeek / OpenAI / MiniMax)
 * 与 GeminiExtractor 接口一致 (extractJSON), 内部走 OpenAI Chat Completions
 */
import fs from "fs";
import crypto from "crypto";

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  // 按 ~/.hermes/config.yaml: model=deepseek-v4-flash, provider=deepseek
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  minimax: { baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-Text-01" },
  gemini: { baseUrl: "", model: "gemini-2.5-flash" },  // 占位
};

export interface OpenAIConfig {
  apiKey: string;
  provider?: "deepseek" | "openai" | "minimax";
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  timeout?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class OpenAIExtractor {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private provider: string;
  private maxRetries: number;
  private timeout: number;

  constructor(config: OpenAIConfig) {
    this.apiKey = config.apiKey;
    this.provider = config.provider || "deepseek";
    const defaults = PROVIDER_DEFAULTS[this.provider] || PROVIDER_DEFAULTS.deepseek;
    this.baseUrl = config.baseUrl || defaults.baseUrl;
    this.model = config.model || defaults.model;
    this.maxRetries = config.maxRetries ?? 2;
    this.timeout = config.timeout ?? 180_000;
  }

  /**
   * 提取结构化 JSON — 等价 GeminiExtractor.extractJSON
   * 用 prompt 注入 (system + user), 强制 JSON output
   */
  async extractJSON<T = any>(pdfPath: string, systemPrompt: string): Promise<{ data: T; usage?: TokenUsage; durationMs: number }> {
    const start = Date.now();
    // 读 PDF base64
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString("base64");
    const pdfHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

    // 先读 PDF 文本前 10 页 (用 PyMuPDF 之类 — 但我们用纯 Node, 让 LLM 自己解析 base64)
    // OpenAI 的 gpt-4o-mini 支持 PDF input! DeepSeek 也支持文件引用
    // 简化: 我们用 PDF 文本 (pymupdf) 替代 — 通过 fetch text
    // 注: 当前 server.ts 已经能 import pymupdf via Python
    // 这里用最简方案: 调 pymupdf CLI 提取文本, 然后作为 user content 发给 LLM
    const { execSync } = await import("child_process");
    let pdfText = "";
    try {
      // 优先用 pymupdf 提取 (Mac 自带)
      pdfText = execSync(
        `python3.11 -c "import fitz; doc=fitz.open('${pdfPath.replace(/'/g, "'\\''")}'); print('\\n'.join(p.get_text() for p in doc))"`,
        { timeout: 30000, encoding: "utf-8" }
      );
    } catch (e) {
      pdfText = `[PDF text extraction failed: ${(e as Error).message}]`;
    }
    // 截断: 防止超 token 限制 (DeepSeek 4K上下文, 只发前15页)
    const MAX_CHARS = 30_000;
    if (pdfText.length > MAX_CHARS) {
      pdfText = pdfText.substring(0, MAX_CHARS) + "\n\n[... TRUNCATED ...]";
    }

    const userContent = `PDF 文件路径: ${pdfPath}\nPDF SHA256: ${pdfHash}\n\n=== PDF 文本内容 ===\n${pdfText}\n\n=== 任务 ===\n请严格按 system prompt 要求输出 JSON (不要 markdown 代码块包裹)。`;

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt + "\n\n重要: 你的输出必须是合法 JSON。不要任何推理过程, 不要 ```json 包裹, 不要其他解释文字。只输出 JSON 本身。" },
        { role: "user", content: userContent },
      ],
      response_format: this.provider === "openai" ? { type: "json_object" } : undefined,
      temperature: 0.1,
      max_tokens: 32000,
      // DeepSeek V4 Flash 会输出 reasoning_content, 需要足够 token 预算
    };

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeout);
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${errText.substring(0, 500)}`);
        }
        const json: any = await res.json();
        const content = json.choices?.[0]?.message?.content || "";
        const usage = json.usage ? {
          promptTokens: json.usage.prompt_tokens || 0,
          completionTokens: json.usage.completion_tokens || 0,
          totalTokens: json.usage.total_tokens || 0,
        } : undefined;
        // 解析 JSON (可能含 markdown 包裹)
        const data = this._parseJson(content);
        // DIAG: log raw AI output for failed IUL
        if (data && data.product_type === "iul" && Array.isArray(data.benefit_illustration)) {
          const row0 = data.benefit_illustration[0] || {};
          console.log(`[openai-extractor] IUL row0 keys: ${Object.keys(row0).join(",")}`);
          console.log(`[openai-extractor] IUL row0 sample: ${JSON.stringify(row0)}`);
          // IUL 字段映射: AI 输出 cash_value/death_benefit → schema 期待 non_guaranteed_*
          data.benefit_illustration = data.benefit_illustration.map((r: any) => ({
            ...r,
            non_guaranteed_account_value: r.non_guaranteed_account_value ?? r.account_value ?? 0,
            non_guaranteed_cash_value: r.non_guaranteed_cash_value ?? r.cash_value ?? 0,
            non_guaranteed_death_benefit: r.non_guaranteed_death_benefit ?? r.death_benefit ?? undefined,
          }));
        }
        return { data, usage, durationMs: Date.now() - start };
      } catch (e) {
        lastErr = e as Error;
        if (attempt < this.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
    throw new Error(`[${this.provider}] ${this.model} 失败: ${lastErr?.message || "unknown"}`);
  }

  private _parseJson(content: string): any {
    const trimmed = content.trim();
    // 尝试 1: 整个 content 就是 JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return JSON.parse(trimmed); } catch {}
    }
    // 尝试 2: 抽取 ```json ... ``` 块
    const m = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (m) {
      try { return JSON.parse(m[1]); } catch {}
    }
    // 尝试 3: 抽取第一个 { ... } 块 (可能截断, 尝试补全)
    const m2 = trimmed.match(/\{[\s\S]+\}/);
    if (m2) {
      try { return JSON.parse(m2[0]); } catch {
        // 尝试补全截断的 JSON: 加尾部引号和括号
        let partial = m2[0];
        if (partial.endsWith('"') || partial.endsWith("'")) partial += "}";
        if (!partial.endsWith("}")) partial += '"}';
        if (!partial.endsWith("}")) partial += "}";
        try { return JSON.parse(partial); } catch {}
      }
    }
    throw new Error(`LLM 返回非 JSON 内容: ${trimmed.substring(0, 200)}`);
  }
}
