import fs from "fs";
import crypto from "crypto";

const SUPPORTED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
] as const;

type GeminiModel = (typeof SUPPORTED_MODELS)[number];

export interface GeminiConfig {
  apiKey: string;
  model?: GeminiModel;
  maxRetries?: number;
  timeout?: number;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens?: number;
  totalTokens: number;
}

export class GeminiExtractor {
  private apiKey: string;
  private model: GeminiModel;
  private maxRetries: number;
  private timeout: number;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) throw new Error("Gemini API key is required");
    this.apiKey = config.apiKey;
    this.model = config.model || "gemini-2.5-flash";
    this.maxRetries = config.maxRetries ?? 3;
    this.timeout = config.timeout ?? 180_000;
  }

  /**
   * Read a PDF and extract structured JSON using Gemini's native PDF understanding.
   */
  async extractJSON<T>(pdfPath: string, prompt: string): Promise<{ data: T; usage: TokenUsage }> {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64PDF = pdfBuffer.toString("base64");

    let currentPrompt = prompt;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callGemini(base64PDF, currentPrompt);
        const parsed = this.parseJSON(result.text);
        if (parsed === null) {
          throw new Error("No valid JSON found in response");
        }
        return { data: parsed as T, usage: result.usage };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          currentPrompt = `${prompt}\n\nPrevious attempt failed: ${lastError.message}\nIMPORTANT: Output ONLY valid JSON, no explanations.`;
        }
      }
    }

    throw new Error(`Extraction failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private async callGemini(
    base64PDF: string,
    prompt: string
  ): Promise<{ text: string; usage: TokenUsage }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const requestBody = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64PDF,
                },
              },
              { text: prompt },
            ],
          },
        ],
      };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      );

      const result = await response.json();

      if (result.error) {
        throw new Error(`Gemini API error: ${result.error.message} (code: ${result.error.code})`);
      }

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from Gemini API");
      }

      const usage: TokenUsage = {
        promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: result.usageMetadata?.totalTokenCount ?? 0,
        thoughtsTokens: result.usageMetadata?.thoughtsTokenCount,
      };

      return { text, usage };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Parse JSON from Gemini response, handling markdown-wrapped JSON. */
  private parseJSON(text: string): unknown | null {
    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch {
      // Try extracting from markdown code block
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        try {
          return JSON.parse(match[1].trim());
        } catch {
          return null;
        }
      }
      // Try finding a JSON object or array
      const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  getModelInfo(): { model: string; provider: string } {
    return { model: this.model, provider: "Google Gemini" };
  }
}

/** Compute SHA-256 hash of a file for caching */
export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Cache directory for extraction results */
export const CACHE_DIR = ".cache/insurance-ppt";

export function getCachePath(pdfPath: string): string {
  const hash = hashFile(pdfPath);
  return `${CACHE_DIR}/${hash}.json`;
}
