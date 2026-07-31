/**
 * 统一 LLM 客户端 — 多提供商自动切换 + 限流保护
 * 
 * 支持: DeepSeek (免费) → MiniMax (国内) → Gemini (商业API兜底)
 * 特点:
 *   - 限流保护：多用户并发时自动排队
 *   - 失败切换：一个provider失败自动切换下一个
 *   - 统一接口：所有LLM调用走这里
 * 
 * 使用方式:
 *   const client = new LLMClient()
 *   const result = await client.chat("prompt")
 *   const structured = await client.structuredOutput("prompt", schema)
 */

import crypto from "crypto"

// ─── 配置 ───────────────────────────────────────────────
interface LLMConfig {
  provider: "deepseek" | "minimax" | "gemini"
  apiKey: string
  baseUrl?: string
  model: string
  maxRetries: number
  rateLimit: number           // 每分钟请求数 (0=无限制)
}

const PROVIDERS: Record<string, Omit<LLMConfig, "apiKey">> = {
  deepseek: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    maxRetries: 2,
    rateLimit: 0              // DeepSeek免费额度相对宽松
  },
  minimax: {
    provider: "minimax",
    baseUrl: "https://api.minimax.chat/v1",
    model: "MiniMax-2.7-Flash",
    maxRetries: 2,
    rateLimit: 30             // MiniMax免费额度30RPM
  },
  gemini: {
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1/models",
    model: "gemini-2.5-flash",
    maxRetries: 1,
    rateLimit: 60             // Gemini商业API更高
  }
}

// ─── 限流器 ─────────────────────────────────────────────
class RateLimiter {
  private tokens: number[] = []
  private lastRefill = Date.now()
  
  constructor(private maxTokens: number, private refillMs: number = 60_000) {
    this.tokens = Array(maxTokens).fill(0)
  }

  async acquire(timeoutMs = 30_000): Promise<void> {
    if (this.maxTokens === 0) return  // 无限制

    const start = Date.now()
    while (true) {
      this.refillIfNeeded()
      const now = Date.now()
      
      // 找最早的可用token
      const elapsed = now - this.lastRefill
      const tokensToUse = Math.min(...this.tokens.map(t => Math.max(0, this.refillMs - (now - t))))
      
      if (elapsed < tokensToUse) {
        const waitTime = Math.min(tokensToUse - elapsed, timeoutMs)
        if (waitTime > 100 && Date.now() - start < timeoutMs) {
          await new Promise(r => setTimeout(r, Math.min(waitTime, 500)))
          continue
        }
      }
      
      // 找到一个可用位置
      for (let i = 0; i < this.tokens.length; i++) {
        if (now - this.tokens[i] >= this.refillMs) {
          this.tokens[i] = now
          return
        }
      }
      
      // 所有token都在使用中，等待最老的
      const oldest = Math.min(...this.tokens)
      const waitFor = Math.min(this.refillMs - (now - oldest), timeoutMs)
      if (waitFor <= 0 || Date.now() - start >= timeoutMs) break
      await new Promise(r => setTimeout(r, Math.min(waitFor, 2000)))
    }
  }

  private refillIfNeeded(): void {
    const now = Date.now()
    if (now - this.lastRefill >= this.refillMs) {
      this.tokens = this.tokens.map(() => 0)
      this.lastRefill = now
    }
  }
}

// ─── 单个Provider调用 ────────────────────────────────────
export interface LLMResponse {
  content: string
  provider: string
  tokens?: { input: number; output: number }
  latencyMs: number
}

async function callProvider(
  config: LLMConfig,
  messages: { role: string; content: string }[],
  timeoutMs = 60_000
): Promise<LLMResponse> {
  const start = Date.now()

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }

  let url = ""
  let body: any

  if (config.provider === "deepseek") {
    headers["Authorization"] = `Bearer ${config.apiKey}`
    url = `${config.baseUrl}/chat/completions`
    body = {
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096
    }
  } else if (config.provider === "minimax") {
    headers["Authorization"] = `Bearer ${config.apiKey}`
    url = `${config.baseUrl}/text/chatcompletion_v2`
    body = {
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096
    }
  } else if (config.provider === "gemini") {
    // Gemini使用不同的API格式
    const modelPart = config.model.includes(":") ? config.model : `${config.model}:generateContent`
    url = `${config.baseUrl}/${modelPart}?key=${config.apiKey}`
    body = {
      contents: messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!resp.ok) {
      const errorText = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${errorText}`)
    }

    const data = await resp.json()
    const latencyMs = Date.now() - start

    let content: string
    let tokens: { input: number; output: number } | undefined

    if (config.provider === "deepseek" || config.provider === "minimax") {
      content = data.choices?.[0]?.message?.content || ""
      tokens = data.usage ? {
        input: data.usage.prompt_tokens || 0,
        output: data.usage.completion_tokens || 0
      } : undefined
    } else {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
      tokens = data.usageMetadata ? {
        input: data.usageMetadata.promptTokenCount || 0,
        output: data.usageMetadata.candidatesTokenCount || 0
      } : undefined
    }

    return { content, provider: config.provider, tokens, latencyMs }

  } catch (err: any) {
    throw new Error(`[${config.provider}] ${err.message}`)
  }
}

// ─── 统一LLM客户端 ───────────────────────────────────────
export class LLMClient {
  private configs: LLMConfig[] = []
  private limiters: Map<string, RateLimiter> = new Map()
  private activeProvider = 0

  constructor() {
    // 从环境变量加载配置（优先级：DeepSeek > MiniMax > Gemini）
    const deepseekKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || ""
    const minimaxKey = process.env.MINIMAX_API_KEY || ""
    const geminiKey = process.env.GEMINI_API_KEY || ""

    if (deepseekKey) {
      this.configs.push({ ...PROVIDERS.deepseek, apiKey: deepseekKey })
      this.limiters.set("deepseek", new RateLimiter(PROVIDERS.deepseek.rateLimit))
    }
    if (minimaxKey) {
      this.configs.push({ ...PROVIDERS.minimax, apiKey: minimaxKey })
      this.limiters.set("minimax", new RateLimiter(PROVIDERS.minimax.rateLimit))
    }
    if (geminiKey) {
      this.configs.push({ ...PROVIDERS.gemini, apiKey: geminiKey })
      this.limiters.set("gemini", new RateLimiter(PROVIDERS.gemini.rateLimit))
    }

    if (this.configs.length === 0) {
      console.warn("[LLMClient] No API keys configured, using mock mode")
    }
  }

  /** 简单聊天 */
  async chat(prompt: string, systemPrompt = ""): Promise<LLMResponse> {
    const messages: { role: string; content: string }[] = []
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt })
    messages.push({ role: "user", content: prompt })

    return this._call(messages)
  }

  /** 结构化输出（返回JSON） */
  async structuredOutput<T = any>(
    prompt: string,
    systemPrompt = "",
    schema?: object
  ): Promise<{ data: T; response: LLMResponse }> {
    const messages: { role: string; content: string }[] = []
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt })

    let fullPrompt = prompt
    if (schema) {
      fullPrompt += `\n\n请以JSON格式输出，格式如下：\n${JSON.stringify(schema, null, 2)}`
      fullPrompt += `\n重要：只输出JSON，不要任何额外文字。`
    }
    messages.push({ role: "user", content: fullPrompt })

    const response = await this._call(messages)

    // 解析JSON（处理markdown代码块）
    let jsonStr = response.content.trim()
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```|(\{[\s\S]*\}|\[[\s\S]*\])$/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1] || jsonMatch[2]
    }

    try {
      const data = JSON.parse(jsonStr)
      return { data, response }
    } catch {
      // 尝试清理常见的JSON错误
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1')
      try {
        const data = JSON.parse(jsonStr)
        return { data, response }
      } catch {
        throw new Error(`[LLMClient] Failed to parse JSON: ${jsonStr.slice(0, 200)}`)
      }
    }
  }

  /** 多Provider自动切换调用 */
  private async _call(
    messages: { role: string; content: string }[],
    attempt = 0
  ): Promise<LLMResponse> {
    if (this.configs.length === 0) {
      return {
        content: "{}",
        provider: "mock",
        latencyMs: 0
      }
    }

    const startProvider = this.activeProvider
    const triedProviders = new Set<string>()

    for (let i = 0; i < this.configs.length; i++) {
      const idx = (startProvider + i) % this.configs.length
      const config = this.configs[idx]

      if (triedProviders.has(config.provider)) continue
      triedProviders.add(config.provider)

      // 限流检查
      const limiter = this.limiters.get(config.provider)
      if (limiter) {
        try {
          await limiter.acquire(30_000)
        } catch {
          console.warn(`[LLMClient] Rate limit timeout for ${config.provider}`)
          continue
        }
      }

      // 调用
      try {
        const response = await callProvider(config, messages, 60_000)
        
        // 更新活跃provider
        this.activeProvider = idx
        
        return response
      } catch (err: any) {
        console.warn(`[LLMClient] ${config.provider} failed: ${err.message}`)
        
        if (attempt < 3 && i < this.configs.length - 1) {
          this.activeProvider = (idx + 1) % this.configs.length
        }
      }
    }

    // 所有provider都失败
    throw new Error("All LLM providers failed")
  }

  /** 获取当前provider信息 */
  getStatus(): { available: string[]; active: string } {
    return {
      available: this.configs.map(c => c.provider),
      active: this.configs[this.activeProvider]?.provider || "none"
    }
  }
}

// ─── 导出单例 ───────────────────────────────────────────
export const llmClient = new LLMClient()
export default llmClient
