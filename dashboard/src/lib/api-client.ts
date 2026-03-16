import axios from 'axios'

const API_KEY_STORAGE = 'lgk_api_key'
const apiUrl = import.meta.env.VITE_API_URL as string

// ---------- axios instance ----------

const api = axios.create({ baseURL: apiUrl })

api.interceptors.request.use((config) => {
  const key = localStorage.getItem(API_KEY_STORAGE)
  if (key) config.headers['Authorization'] = `Bearer ${key}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(API_KEY_STORAGE)
      window.dispatchEvent(new Event('lgk:unauthorized'))
    }
    return Promise.reject(err)
  },
)

// ---------- key helpers ----------

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE)
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key)
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE)
}

// ---------- response types ----------

export interface UsagePoint {
  date: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  avg_latency_ms: number
  cache_hits: number
}

export interface UsageResponse {
  data: UsagePoint[]
  granularity: string
  start: string
  end: string
}

export interface CostByProvider {
  provider: string
  cost_usd: number
  pct: number
}

export interface CostResponse {
  total_cost_usd: number
  by_provider: CostByProvider[]
  start: string
  end: string
}

export interface RequestEntry {
  id: string
  provider: string
  model: string
  status: string
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_ms: number
  cache_hit: boolean
  created_at: string
}

export interface RequestsResponse {
  data: RequestEntry[]
  total: number
  page: number
  limit: number
}

export interface CacheStats {
  hits: number
  misses: number
  total: number
  hit_rate: number
  tokens_saved: number
  estimated_cost_saved_usd: number
  top_entries: { key: string; hit_count: number }[]
}

export interface ApiKey {
  id: string
  name: string | null
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface ApiKeyCreated extends ApiKey {
  key: string
}

export interface ProviderConfig {
  id: string
  provider: string
  rateLimitRpm: number | null
  rateLimitTpm: number | null
  monthlySpendLimitUsd: number | null
  createdAt: string
}

export interface ProviderStatus {
  provider: string
  status: 'active' | 'degraded' | 'down'
  latency_ms: number | null
}

// ---------- analytics ----------

export interface UsageParams {
  start: string
  end: string
  granularity?: 'day' | 'hour'
  provider?: string
  model?: string
}

export const getUsage = (params: UsageParams) =>
  api.get<UsageResponse>('/api/v1/analytics/usage', { params })

export const getCost = (params: { start: string; end: string }) =>
  api.get<CostResponse>('/api/v1/analytics/cost', { params })

export const getRequests = (params: {
  page?: number
  limit?: number
  provider?: string
  status?: string
  start?: string
  end?: string
}) => api.get<RequestsResponse>('/api/v1/analytics/requests', { params })

export const getCacheStats = (params: { start: string; end: string }) =>
  api.get<CacheStats>('/api/v1/analytics/cache', { params })

// ---------- keys ----------

export const getKeys = () => api.get<ApiKey[]>('/api/v1/keys')

export const createKey = (data: { name?: string }) =>
  api.post<ApiKeyCreated>('/api/v1/keys', data)

export const deleteKey = (id: string) =>
  api.delete<void>(`/api/v1/keys/${id}`)

// ---------- providers ----------

export const getProviders = () =>
  api.get<ProviderConfig[]>('/api/v1/providers')

export const upsertProvider = (data: {
  provider: string
  api_key: string
  rate_limit_rpm?: number
  rate_limit_tpm?: number
  monthly_spend_limit_usd?: number
}) => api.post<ProviderConfig>('/api/v1/providers', data)

export const deleteProvider = (id: string) =>
  api.delete<void>(`/api/v1/providers/${id}`)

export const getProviderStatus = () =>
  api.get<ProviderStatus[]>('/api/v1/providers/status')

// ---------- non-streaming completion ----------

export const completeChat = (body: object) =>
  api.post<{
    id: string
    choices: { message: { role: string; content: string } }[]
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }>('/v1/chat/completions', body)

// ---------- streaming ----------

export interface StreamResult {
  stream: AsyncIterable<string>
  headers: Record<string, string>
}

export async function streamCompletion(
  apiKey: string,
  body: object,
): Promise<StreamResult> {
  const res = await fetch(`${apiUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  // Capture headers before consuming the body
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })

  async function* generate(): AsyncGenerator<string> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return

        try {
          const chunk = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; error?: boolean }[]
            error?: boolean
          }
          if (chunk.error || chunk.choices?.[0]?.error) {
            throw new Error('Stream error from provider')
          }
          const content = chunk.choices?.[0]?.delta?.content
          if (content) yield content
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  }

  return { stream: generate(), headers }
}
