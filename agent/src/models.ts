// The model behind the agent, behind one small interface, so the agent runs on whichever key you
// have: Claude (ANTHROPIC_API_KEY) or any OpenAI-compatible chat API with tool calling (LLM_API_KEY):
// Google Gemini (free tier), Groq, OpenRouter or OpenAI.

import Anthropic from '@anthropic-ai/sdk'

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema of the input. */
  schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  id: string
  content: string
  isError: boolean
}

export interface Model {
  label: string
  /** One model turn: any text it said, and the tools it wants run (none: it is finished). */
  turn(): Promise<{ text: string[]; calls: ToolCall[] }>
  /** The results of the calls from the last turn, in one message. */
  answer(results: ToolResult[]): void
  /** The user's reply, when the model stopped to ask something. */
  reply(text: string): void
}

/** Known OpenAI-compatible endpoints. Any other: set LLM_BASE_URL and LLM_MODEL. */
const PROVIDERS: Record<string, { baseUrl: string; model: string; fallbacks?: string[] }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash', fallbacks: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
}

/** Claude if ANTHROPIC_API_KEY is set (or LLM_PROVIDER=anthropic), otherwise the OpenAI-compatible LLM_* settings. */
export function modelFromEnv(system: string, prompt: string, tools: ToolDef[]): Model {
  const provider = (process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'gemini')).toLowerCase()
  if (provider === 'anthropic') return claude(system, prompt, tools)
  const key = process.env.LLM_API_KEY
  if (!key) {
    throw new Error(
      'no model key. Set ANTHROPIC_API_KEY, or LLM_API_KEY with LLM_PROVIDER=gemini|groq|openrouter|openai ' +
        '(a free Gemini key: aistudio.google.com/apikey), or LLM_BASE_URL + LLM_MODEL for any OpenAI-compatible API',
    )
  }
  const preset = PROVIDERS[provider]
  const baseUrl = (process.env.LLM_BASE_URL ?? preset?.baseUrl)?.replace(/\/$/, '')
  const model = process.env.LLM_MODEL ?? preset?.model
  if (!baseUrl || !model) throw new Error(`unknown LLM_PROVIDER ${provider}: set LLM_BASE_URL and LLM_MODEL`)
  // when the model is overloaded, the next one in line answers instead
  const fallbacks = process.env.LLM_FALLBACK_MODELS !== undefined ? process.env.LLM_FALLBACK_MODELS.split(',').map((m) => m.trim()).filter(Boolean) : (preset?.fallbacks ?? [])
  return openaiCompatible(baseUrl, key, [model, ...fallbacks.filter((m) => m !== model)], system, prompt, tools)
}

function claude(system: string, prompt: string, tools: ToolDef[]): Model {
  const client = new Anthropic()
  const model = process.env.LLM_MODEL ?? 'claude-opus-5-5'
  const defs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool.InputSchema }))
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  return {
    label: `Anthropic · ${model}`,
    async turn() {
      for (;;) {
        const res = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system,
          tools: defs,
          messages,
        })
        if (res.stop_reason === 'refusal') throw new Error('the model declined this request')
        if (res.stop_reason === 'max_tokens') throw new Error('the reply was cut off (max_tokens)')
        messages.push({ role: 'assistant', content: res.content })
        if (res.stop_reason === 'pause_turn') continue
        const text = res.content.flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text.trim()] : []))
        const calls = res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : []))
        return { text, calls }
      }
    },
    answer(results) {
      messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError })) })
    },
    reply(text) {
      messages.push({ role: 'user', content: text })
    },
  }
}

/** JSON Schema keywords some OpenAI-compatible APIs (Gemini's, notably) refuse in tool parameters. */
const UNSUPPORTED = new Set(['$schema', 'additionalProperties', 'strict', '$id', 'examples'])
function portable(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(portable)
  if (!schema || typeof schema !== 'object') return schema
  return Object.fromEntries(Object.entries(schema).filter(([k]) => !UNSUPPORTED.has(k)).map(([k, v]) => [k, portable(v)]))
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

const RETRY_MS = [2_000, 6_000]

function openaiCompatible(baseUrl: string, key: string, models: string[], system: string, prompt: string, tools: ToolDef[]): Model {
  const model = models[0]!
  const defs = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: portable(t.schema) } }))
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
  return {
    label: `${baseUrl.replace(/^https:\/\//, '').split('/')[0]} · ${model}`,
    async turn() {
      type Body = { choices?: { message: ChatMessage; finish_reason?: string }[]; error?: { message?: string } | string } | null
      let res: Response | undefined
      let body: Body = null
      let used = model
      // 429 / 503 (rate limit, overload): wait and retry, then move to the next model
      attempts: for (const m of models) {
        for (let i = 0; i <= RETRY_MS.length; i++) {
          res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: m, messages, tools: defs, tool_choice: 'auto' }),
            signal: AbortSignal.timeout(120_000),
          })
          body = (await res.json().catch(() => null)) as Body
          used = m
          if (res.status !== 429 && res.status !== 503) break attempts
          if (i < RETRY_MS.length) await new Promise((r) => setTimeout(r, RETRY_MS[i]))
        }
      }
      const choice = body?.choices?.[0]
      if (!res?.ok || !choice) {
        const e = Array.isArray(body) ? (body[0] as { error?: { message?: string } })?.error : body?.error
        throw new Error(`${used}: ${typeof e === 'string' ? e : (e?.message ?? `HTTP ${res?.status}`)}`)
      }
      if (choice.finish_reason === 'length') throw new Error('the reply was cut off (length)')
      const m = choice.message
      messages.push({ role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) })
      const calls = (m.tool_calls ?? []).map((c) => {
        let input: Record<string, unknown> = {}
        try {
          input = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {}
        } catch {
          input = { _unparsed: c.function.arguments }
        }
        return { id: c.id, name: c.function.name, input }
      })
      return { text: m.content?.trim() ? [m.content.trim()] : [], calls }
    },
    answer(results) {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `error: ${r.content}` : r.content })
    },
    reply(text) {
      messages.push({ role: 'user', content: text })
    },
  }
}
