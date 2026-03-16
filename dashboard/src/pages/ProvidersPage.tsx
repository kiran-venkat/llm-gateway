import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Edit2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  getProviders,
  getProviderStatus,
  upsertProvider,
  deleteProvider,
  type ProviderConfig,
  type ProviderStatus,
} from '@/lib/api-client'

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_MS = 30_000

const KNOWN_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', color: '#22c55e', placeholder: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', color: '#f87171', placeholder: 'sk-ant-…' },
  { id: 'gemini', label: 'Gemini', color: '#60a5fa', placeholder: 'AIza…' },
] as const

type ProviderId = (typeof KNOWN_PROVIDERS)[number]['id']

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-800 ${className ?? ''}`} />
}

// ─── Status indicator (T50) ───────────────────────────────────────────────────

/**
 * T50 pulsing green circle:
 *
 * Tailwind's `animate-ping` scales the element from 1→2 while fading from
 * opacity-75→0, then repeats. It's layered on top of a solid dot using
 * `absolute` positioning within a `relative` container — the solid dot
 * stays at rest while the ping ring expands outward. This is the canonical
 * Tailwind "live indicator" pattern.
 *
 * Only the `active` status gets the ping. `degraded` and `down` are static
 * circles — pulsing an error indicator would be distracting.
 */
function StatusDot({ status }: { status: 'active' | 'degraded' | 'down' | 'unknown' }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-3 w-3 shrink-0">
        {/* Expanding ping ring — fades out as it grows */}
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        {/* Solid center dot — stays fixed */}
        <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
      </span>
    )
  }
  const colors: Record<string, string> = {
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
    unknown: 'bg-slate-600',
  }
  return (
    <span className={`inline-flex h-3 w-3 rounded-full shrink-0 ${colors[status] ?? 'bg-slate-600'}`} />
  )
}

function StatusLabel({ status }: { status: 'active' | 'degraded' | 'down' | 'unknown' }) {
  const map: Record<string, { label: string; class: string }> = {
    active: { label: 'Active', class: 'bg-green-900 text-green-300 border-green-700' },
    degraded: { label: 'Degraded', class: 'bg-yellow-900 text-yellow-300 border-yellow-700' },
    down: { label: 'Down', class: 'bg-red-900 text-red-300 border-red-700' },
    unknown: { label: 'Unknown', class: 'bg-slate-700 text-slate-400 border-slate-600' },
  }
  const { label, class: cls } = map[status] ?? map.unknown
  return (
    <Badge className={`border text-xs px-1.5 py-0 ${cls}`}>{label}</Badge>
  )
}

// ─── Edit dialog (T49) ───────────────────────────────────────────────────────

interface EditForm {
  apiKey: string
  rateLimitRpm: string
  rateLimitTpm: string
  monthlySpendLimit: string
}

function EditDialog({
  providerId,
  existing,
  onSaved,
  onClose,
}: {
  providerId: ProviderId
  existing: ProviderConfig | undefined
  onSaved: () => void
  onClose: () => void
}) {
  const meta = KNOWN_PROVIDERS.find((p) => p.id === providerId)!
  const [form, setForm] = useState<EditForm>({
    apiKey: '',
    rateLimitRpm: existing?.rate_limit_rpm?.toString() ?? '',
    rateLimitTpm: existing?.rate_limit_tpm?.toString() ?? '',
    monthlySpendLimit: existing?.monthly_spend_limit_usd?.toString() ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(field: keyof EditForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.apiKey.trim() && !existing) {
      setError('API key is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await upsertProvider({
        provider: providerId,
        api_key: form.apiKey.trim() || '(unchanged)',
        rate_limit_rpm: form.rateLimitRpm ? parseInt(form.rateLimitRpm) : undefined,
        rate_limit_tpm: form.rateLimitTpm ? parseInt(form.rateLimitTpm) : undefined,
        monthly_spend_limit_usd: form.monthlySpendLimit
          ? parseFloat(form.monthlySpendLimit)
          : undefined,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!existing) return
    setRemoving(true)
    try {
      await deleteProvider(existing.id)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              style={{ backgroundColor: meta.color }}
            >
              {meta.label[0]}
            </span>
            Configure {meta.label}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-slate-300">
              API Key{existing && <span className="text-slate-500 ml-1">(leave blank to keep current)</span>}
            </Label>
            <Input
              type="password"
              placeholder={meta.placeholder}
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              className="bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-600 font-mono text-sm"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Rate limit (RPM)</Label>
              <Input
                type="number"
                placeholder="e.g. 60"
                value={form.rateLimitRpm}
                onChange={(e) => set('rateLimitRpm', e.target.value)}
                className="bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-600 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Rate limit (TPM)</Label>
              <Input
                type="number"
                placeholder="e.g. 100000"
                value={form.rateLimitTpm}
                onChange={(e) => set('rateLimitTpm', e.target.value)}
                className="bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-600 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300 text-xs">Monthly spend limit (USD, optional)</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="e.g. 50.00"
              value={form.monthlySpendLimit}
              onChange={(e) => set('monthlySpendLimit', e.target.value)}
              className="bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-600 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {existing && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleRemove}
                disabled={removing}
                className="text-red-400 hover:text-red-300 hover:bg-red-950/30 sm:mr-auto"
              >
                {removing ? 'Removing…' : 'Remove provider'}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Provider card (T49 + T50) ────────────────────────────────────────────────

function ProviderCard({
  meta,
  config,
  status,
  checking,
  onEdit,
  onTest,
}: {
  meta: (typeof KNOWN_PROVIDERS)[number]
  config: ProviderConfig | undefined
  status: ProviderStatus | undefined
  checking: boolean
  onEdit: () => void
  onTest: () => void
}) {
  const isConfigured = !!config
  const liveStatus = status?.status ?? 'unknown'
  const secondsAgo =
    status && !checking
      ? null  // we don't track per-provider timestamp, show nothing
      : null

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
      {/* ── Card header ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Provider avatar */}
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: meta.color }}
          >
            {meta.label[0]}
          </span>
          <div>
            <div className="font-medium text-slate-100">{meta.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {isConfigured ? (
                <span className="text-green-400">Configured</span>
              ) : (
                <span className="text-slate-600">Not configured</span>
              )}
            </div>
          </div>
        </div>

        {/* Live status */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {checking ? (
            <span className="text-xs text-slate-500 italic">checking…</span>
          ) : isConfigured ? (
            <>
              <StatusDot status={liveStatus} />
              <StatusLabel status={liveStatus} />
              {status?.latencyMs != null && (
                <span className="text-xs text-slate-500 font-mono ml-1">
                  {status.latencyMs}ms
                </span>
              )}
            </>
          ) : null}
          {secondsAgo}
        </div>
      </div>

      {/* ── Config details ── */}
      {isConfigured && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-slate-800 rounded-md p-2 text-center">
            <div className="font-mono font-semibold text-slate-100">
              {config.rate_limit_rpm ?? '∞'}
            </div>
            <div className="text-slate-500 mt-0.5">RPM</div>
          </div>
          <div className="bg-slate-800 rounded-md p-2 text-center">
            <div className="font-mono font-semibold text-slate-100">
              {config.rate_limit_tpm != null
                ? (config.rate_limit_tpm / 1000).toFixed(0) + 'K'
                : '∞'}
            </div>
            <div className="text-slate-500 mt-0.5">TPM</div>
          </div>
          <div className="bg-slate-800 rounded-md p-2 text-center">
            <div className="font-mono font-semibold text-slate-100">
              {config.monthly_spend_limit_usd != null
                ? `$${config.monthly_spend_limit_usd}`
                : '∞'}
            </div>
            <div className="text-slate-500 mt-0.5">Monthly</div>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-8 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex-1"
        >
          <Edit2 size={13} className="mr-1.5" />
          {isConfigured ? 'Edit' : 'Configure'}
        </Button>
        {isConfigured && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={checking}
            className="h-8 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex-1"
          >
            <Zap size={13} className="mr-1.5" />
            Test
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProvidersPage() {
  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(true)
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProviderId | null>(null)

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await getProviders()
      setConfigs(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers')
    } finally {
      setLoadingConfigs(false)
    }
  }, [])

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setChecking(true)
    try {
      const res = await getProviderStatus()
      setStatuses(res.data.providers)
      setLastChecked(new Date())
    } catch {
      // status check failing is non-fatal — keep last known status
    } finally {
      setChecking(false)
    }
  }, [])

  // Load configs once on mount
  useEffect(() => { fetchConfigs() }, [fetchConfigs])

  // Poll status every 30s
  useEffect(() => {
    fetchStatus()
    const id = setInterval(() => fetchStatus(true), POLL_MS)
    return () => clearInterval(id)
  }, [fetchStatus])

  function configFor(providerId: string): ProviderConfig | undefined {
    return configs.find((c) => c.provider === providerId)
  }

  function statusFor(providerId: string): ProviderStatus | undefined {
    return statuses.find((s) => s.provider === providerId)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Providers</h1>
          {lastChecked && (
            <p className="text-xs text-slate-600 mt-0.5">
              Status last checked {lastChecked.toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchStatus()}
          disabled={checking}
          className="h-8 text-slate-400 hover:text-slate-100 hover:bg-slate-800"
        >
          <RefreshCw size={14} className={`mr-1.5 ${checking ? 'animate-spin' : ''}`} />
          Refresh All
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Provider cards ── */}
      {loadingConfigs ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {KNOWN_PROVIDERS.map((p) => (
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-14" />
              <Skeleton className="h-8" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {KNOWN_PROVIDERS.map((meta) => (
            <ProviderCard
              key={meta.id}
              meta={meta}
              config={configFor(meta.id)}
              status={statusFor(meta.id)}
              checking={checking}
              onEdit={() => setEditing(meta.id)}
              onTest={() => fetchStatus()}
            />
          ))}
        </div>
      )}

      {/* ── Edit dialog ── */}
      {editing && (
        <EditDialog
          providerId={editing}
          existing={configFor(editing)}
          onSaved={fetchConfigs}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
