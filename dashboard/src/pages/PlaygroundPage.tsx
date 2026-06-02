import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, RotateCcw, ChevronDown, ChevronRight, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getStoredApiKey,
  streamCompletion,
  completeChat,
  getRequests,
  type RequestEntry,
} from '@/lib/api-client'
import { VoiceMode } from '@/components/VoiceMode'

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  'claude-haiku-4-5-20251001',
  'gpt-4o-mini',
  'gemini-1.5-flash',
  'gpt-4o',
  'claude-3-5-sonnet-20241022',
] as const

/** Gateway response headers to display in the metadata panel, in order */
const HEADER_ROWS: { key: string; label: string }[] = [
  { key: 'x-request-id', label: 'Request-Id' },
  { key: 'x-gateway-provider', label: 'Provider' },
  { key: 'x-gateway-model', label: 'Model' },
  { key: 'x-cache-hit', label: 'Cache-Hit' },
  { key: 'x-cache-type', label: 'Cache-Type' },
  { key: 'x-latency-ms', label: 'Latency-Ms' },
  { key: 'x-cost-usd', label: 'Cost-Usd' },
  { key: 'x-ratelimit-remaining-rpm', label: 'RPM-Remaining' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`max-w-[80%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <span className={`text-xs font-mono mb-1 ${isUser ? 'text-blue-400' : 'text-slate-500'}`}>
          {message.role}
        </span>
        <div
          className={`rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-100'
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  )
}

/**
 * In-progress assistant bubble — appends content as chunks arrive.
 *
 * STREAMING CURSOR:
 *   A 2px-wide inline-block element with `.animate-cursor` (defined in
 *   index.css). It uses `step-end` timing so opacity snaps between 1 and 0 —
 *   matching a real terminal cursor rather than fading. It is only mounted
 *   while `isStreaming` is true; removing it from the DOM stops the animation
 *   with no stale character left behind.
 *
 * CHUNK APPEND:
 *   The parent calls `setCurrentResponse(prev => prev + chunk)` for every
 *   arriving chunk. This component simply renders the `content` prop — a single
 *   string that grows from '' to the full response. There is no batching,
 *   throttling, or local state: every setState triggers a re-render and React
 *   updates only the text node, so the cursor stays in place.
 */
function StreamingBubble({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  return (
    <div className="flex flex-row">
      <div className="max-w-[80%] flex flex-col items-start">
        <span className="text-xs font-mono mb-1 text-slate-500">assistant</span>
        <div className="bg-slate-800 rounded-lg px-4 py-3 text-sm leading-relaxed text-slate-100">
          {/* Content accumulates in-place; cursor sits immediately after last char */}
          <span className="whitespace-pre-wrap">{content}</span>
          {isStreaming && (
            <span
              className="inline-block w-0.5 h-[1em] bg-blue-400 ml-0.5 align-middle animate-cursor"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StatBox({
  label,
  value,
  valueClass = 'text-slate-100',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="bg-slate-800 rounded-md p-2 text-center">
      <div className={`text-sm font-mono font-semibold ${valueClass}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function MetadataPanel({
  headers,
  lastRequest,
}: {
  headers: Record<string, string>
  lastRequest: RequestEntry | null
}) {
  const hasData = Object.keys(headers).length > 0

  const cacheHit = headers['x-cache-hit']
  const latencyMs = headers['x-latency-ms'] ?? lastRequest?.latencyMs?.toString()
  const costUsd = headers['x-cost-usd'] ?? lastRequest?.costUsd?.toString()

  return (
    <div className="p-4 space-y-5">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Response Metadata
      </div>

      {!hasData && (
        <p className="text-xs text-slate-600">Send a request to see metadata.</p>
      )}

      {/* Cache badge */}
      {cacheHit !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Cache</span>
          {cacheHit === 'true' ? (
            <Badge className="bg-green-900 text-green-300 border border-green-700 text-xs px-2 py-0">
              HIT
            </Badge>
          ) : (
            <Badge className="bg-slate-700 text-slate-400 border border-slate-600 text-xs px-2 py-0">
              MISS
            </Badge>
          )}
        </div>
      )}

      {/* Latency + Cost from response headers (available immediately after stream) */}
      {(latencyMs || costUsd) && (
        <div className="grid grid-cols-2 gap-2">
          {latencyMs && <StatBox label="Latency" value={`${latencyMs}ms`} />}
          {costUsd && (
            <StatBox
              label="Cost"
              value={`$${parseFloat(costUsd).toFixed(8)}`}
              valueClass="text-orange-400"
            />
          )}
        </div>
      )}

      {/* Token counts — arrives ~2.5s after stream ends via BullMQ → DB */}
      {lastRequest && (
        <div>
          <div className="text-xs text-slate-500 mb-2">Token usage</div>
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Prompt" value={String(lastRequest.promptTokens)} />
            <StatBox label="Compl." value={String(lastRequest.completionTokens)} />
            <StatBox
              label="Total"
              value={String((lastRequest.promptTokens ?? 0) + (lastRequest.completionTokens ?? 0))}
              valueClass="text-blue-400"
            />
          </div>
        </div>
      )}

      {/* Raw response headers */}
      {hasData && (
        <div>
          <div className="text-xs text-slate-500 mb-2">Response headers</div>
          <div className="space-y-1.5 font-mono text-xs">
            {HEADER_ROWS.map(({ key, label }) =>
              headers[key] ? (
                <div key={key} className="flex gap-2 min-w-0">
                  <span className="text-slate-500 shrink-0 w-28">{label}</span>
                  <span className="text-slate-300 truncate">{headers[key]}</span>
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [history, setHistory] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>(MODELS[0])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1024)
  const [useStream, setUseStream] = useState(true)

  // In-progress streaming state — separate from `history` so the live bubble
  // can be rendered independently from completed messages.
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')

  // Metadata panel — populated after stream ends
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({})
  const [lastRequest, setLastRequest] = useState<RequestEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to the sentinel div after every history update or chunk arrival
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, currentResponse])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    const userMessage: Message = { role: 'user', content: trimmed }
    // Push user message before any await so the bubble appears immediately
    const nextHistory: Message[] = [...history, userMessage]
    setHistory(nextHistory)
    setInput('')
    setIsStreaming(true)
    setCurrentResponse('')
    setError(null)
    setResponseHeaders({})
    setLastRequest(null)

    const apiKey = getStoredApiKey()!
    const messages = [
      ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
      ...nextHistory,
    ]

    try {
      let fullResponse = ''

      if (useStream) {
        // streamCompletion() resolves once the HTTP response headers arrive —
        // before the body stream starts. setResponseHeaders runs synchronously
        // here so the metadata panel can show provider/cache info as soon as
        // the first byte of the body arrives.
        const { stream, headers } = await streamCompletion(apiKey, {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        })
        setResponseHeaders(headers)

        for await (const chunk of stream) {
          fullResponse += chunk
          // Functional update isn't needed here because fullResponse is a
          // local variable that accumulates correctly in this closure.
          setCurrentResponse(fullResponse)
        }
      } else {
        const res = await completeChat({ model, messages, temperature, max_tokens: maxTokens })
        fullResponse = res.data.choices[0].message.content
        const hdrs: Record<string, string> = {}
        Object.entries(res.headers).forEach(([k, v]) => {
          if (typeof v === 'string') hdrs[k] = v
        })
        setResponseHeaders(hdrs)
      }

      // Atomically commit the finished response to history and clear the
      // in-progress bubble. React batches these two setState calls in one
      // render, so the user never sees a blank frame between the two states.
      setHistory((prev) => [...prev, { role: 'assistant', content: fullResponse }])
      setCurrentResponse('')

      // BullMQ writes the request row to Postgres ~2s after the stream ends.
      // We wait 2.5s then pull the latest entry to get prompt/completion tokens.
      setTimeout(() => {
        getRequests({ limit: 1, page: 1 })
          .then((res) => {
            if (res.data.data[0]) setLastRequest(res.data.data[0])
          })
          .catch(() => {
            // best-effort — metadata panel already shows header data
          })
      }, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, history, systemPrompt, useStream, model, temperature, maxTokens])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleClear() {
    setHistory([])
    setCurrentResponse('')
    setResponseHeaders({})
    setLastRequest(null)
    setError(null)
    setIsStreaming(false)
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Mode toggle */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-slate-800">
        <span className="text-xs text-slate-500 mr-2">Mode</span>
        <button
          onClick={() => setMode('text')}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            mode === 'text' ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Text
        </button>
        <button
          onClick={() => setMode('voice')}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${
            mode === 'voice' ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Mic size={11} />
          Voice
        </button>
      </div>

      {mode === 'voice' ? <VoiceMode /> : (
      <div className="flex flex-1 min-h-0">
      {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Controls bar */}
        <div className="shrink-0 px-4 py-3 border-b border-slate-800 flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-56 bg-slate-900 border-slate-700 text-slate-100 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                {MODELS.map((m) => (
                  <SelectItem
                    key={m}
                    value={m}
                    className="text-xs focus:bg-slate-700 focus:text-slate-100"
                  >
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Temp: {temperature.toFixed(1)}</Label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-28 accent-blue-500 cursor-pointer block"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-slate-400 text-xs">Max tokens</Label>
            <Input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
              className="w-24 h-8 bg-slate-900 border-slate-700 text-slate-100 text-xs"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer pb-0.5">
            <input
              type="checkbox"
              checked={useStream}
              onChange={(e) => setUseStream(e.target.checked)}
              className="accent-blue-500 w-4 h-4 cursor-pointer"
            />
            <span className="text-sm text-slate-300">Stream</span>
          </label>

          <button
            onClick={() => setShowSystem((v) => !v)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 pb-0.5"
          >
            {showSystem ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            System prompt
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="ml-auto text-slate-400 hover:text-slate-100 hover:bg-slate-800 h-8"
          >
            <RotateCcw size={14} className="mr-1.5" />
            Clear
          </Button>
        </div>

        {/* System prompt (collapsible) */}
        {showSystem && (
          <div className="shrink-0 px-4 py-2 border-b border-slate-800">
            <textarea
              placeholder="System prompt…"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Messages — flex-1 + min-h-0 lets this region shrink and scroll */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
          {history.length === 0 && !isStreaming && !error && (
            <div className="flex h-full items-center justify-center text-slate-600 text-sm">
              Send a message to start
            </div>
          )}

          {history.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {/*
           * The in-progress bubble lives outside `history`. When the stream
           * finishes, setHistory(...) and setCurrentResponse('') are called
           * in the same synchronous block — React batches them into a single
           * render, so this bubble is replaced by a MessageBubble atomically
           * with no visible flash.
           */}
          {(isStreaming || currentResponse) && (
            <StreamingBubble content={currentResponse} isStreaming={isStreaming} />
          )}

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              <span className="font-semibold">Error: </span>
              {error}
            </div>
          )}

          {/* Sentinel — scrollIntoView targets this after every update */}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 px-4 py-3 border-t border-slate-800">
          <div className="flex gap-2 items-end">
            <textarea
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              disabled={isStreaming}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 h-10 px-4"
            >
              <Send size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Metadata ───────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-slate-800 bg-slate-900 overflow-y-auto">
        <MetadataPanel headers={responseHeaders} lastRequest={lastRequest} />
      </div>
      </div>
      )}
    </div>
  )
}
