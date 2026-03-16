import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { getUsage, type UsagePoint } from '@/lib/api-client'
import { cn, subDays, toDateStr, today, formatCost, formatChartDate } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_RANGES = [7, 30, 90] as const
type DateRange = (typeof DATE_RANGES)[number]

const PROVIDERS = ['All Providers', 'openai', 'anthropic', 'gemini'] as const
type ProviderFilter = (typeof PROVIDERS)[number]

// ─── Shared primitives ────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-800', className)} />
}

function DateRangeButtons({
  value,
  onChange,
}: {
  value: DateRange
  onChange: (v: DateRange) => void
}) {
  return (
    <div className="flex gap-1">
      {DATE_RANGES.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            value === d
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200',
          )}
        >
          Last {d}d
        </button>
      ))}
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueClass = 'text-slate-100',
  loading,
}: {
  label: string
  value: string
  valueClass?: string
  loading: boolean
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-xs text-slate-500 mb-2">{label}</div>
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <div className={cn('text-2xl font-bold font-mono', valueClass)}>{value}</div>
      )}
    </div>
  )
}

// ─── Custom tooltips ─────────────────────────────────────────────────────────

/**
 * Recharts passes these props to the `content` prop of <Tooltip />.
 * We type them manually rather than importing TooltipProps to avoid
 * Recharts' generic complexity with ValueType/NameType.
 */
interface TooltipPayload {
  name: string
  value: number
  color: string
  dataKey: string
}

function RequestsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-400 mb-1.5">{label ? formatChartDate(label) : ''}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex gap-3 items-center">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-slate-300">{p.name}</span>
          <span className="font-mono text-slate-100 ml-auto">{p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function CostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-slate-400 mb-1.5">{label ? formatChartDate(label) : ''}</div>
      <div className="flex gap-3 items-center">
        <span className="w-2 h-2 rounded-full shrink-0 bg-orange-500" />
        <span className="text-slate-300">Cost</span>
        <span className="font-mono text-orange-400 ml-auto">
          {formatCost(payload[0]?.value ?? 0)}
        </span>
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

/**
 * Rendered in place of a chart when there is no data for the period.
 * Using a fixed height matching ResponsiveContainer so the layout doesn't
 * shift when data arrives.
 */
function EmptyChart({ height = 300 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-slate-600 text-sm border border-dashed border-slate-800 rounded-lg"
      style={{ height }}
    >
      No data for this period
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const [dateRange, setDateRange] = useState<DateRange>(7)
  const [provider, setProvider] = useState<ProviderFilter>('All Providers')
  const [data, setData] = useState<UsagePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const end = today()
    const start = toDateStr(subDays(end, dateRange))
    const providerParam = provider === 'All Providers' ? undefined : provider

    getUsage({ start, end, granularity: 'day', provider: providerParam })
      .then((res) => {
        if (!cancelled) setData(res.data.series)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [dateRange, provider])

  // ── Derived stats (weighted correctly per CLAUDE.md architecture note) ──
  const totalRequests = data.reduce((s, d) => s + d.requests, 0)
  const totalCost = data.reduce((s, d) => s + d.cost_usd, 0)
  const totalCacheHits = data.reduce((s, d) => s + d.cache_hits, 0)
  const hitRate = totalRequests > 0 ? (totalCacheHits / totalRequests) * 100 : 0
  // Weighted average: SUM(avg_latency * requests) / SUM(requests)
  const weightedLatencySum = data.reduce((s, d) => s + d.avg_latency_ms * d.requests, 0)
  const avgLatency = totalRequests > 0 ? weightedLatencySum / totalRequests : 0

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-xl font-semibold">Usage</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Provider filter */}
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderFilter)}
            className="h-8 bg-slate-900 border border-slate-700 text-slate-100 rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <DateRangeButtons value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          Failed to load usage data: {error}
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          loading={loading}
        />
        <StatCard
          label="Total Cost"
          value={formatCost(totalCost)}
          valueClass="text-orange-400"
          loading={loading}
        />
        <StatCard
          label="Cache Hit Rate"
          value={`${hitRate.toFixed(1)}%`}
          valueClass="text-green-400"
          loading={loading}
        />
        <StatCard
          label="Avg Latency"
          value={`${Math.round(avgLatency)}ms`}
          loading={loading}
        />
      </div>

      {/* ── Requests LineChart ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="text-sm font-medium text-slate-300 mb-4">Requests over time</div>

        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : data.length === 0 ? (
          /**
           * EMPTY STATE: rendered instead of the chart when there are no data
           * points for the selected period. Uses the same fixed height as
           * ResponsiveContainer so the layout doesn't shift when data arrives.
           * A dashed border signals "there should be something here" without
           * using an intrusive error color.
           */
          <EmptyChart height={300} />
        ) : (
          /**
           * RECHARTS LINECHART:
           *
           * ResponsiveContainer width="100%" makes the chart fill its parent.
           * height={300} is absolute pixels — Recharts needs at least one
           * dimension to be a fixed number.
           *
           * data: array of UsagePoint objects. Recharts reads `dataKey` props
           * off each object — no transformation needed.
           *
           * XAxis tickFormatter: converts "2026-03-16" → "Mar 16". Without
           * this, Recharts would print the full ISO string and overflow the axis.
           *
           * YAxis width={50}: prevents labels clipping on the left edge.
           *
           * Two Lines share the same XAxis/YAxis so they're directly comparable.
           * dot={false}: omits per-point circles on dense data (7-90 points).
           * activeDot renders on hover only.
           *
           * Tooltip content={<RequestsTooltip />}: custom dark-themed tooltip.
           */
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: '#1e293b' }}
                tickLine={false}
              />
              <YAxis
                width={50}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <Tooltip content={<RequestsTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 12 }}
              />
              <Line
                type="monotone"
                dataKey="requests"
                name="Total requests"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6' }}
              />
              <Line
                type="monotone"
                dataKey="cache_hits"
                name="Cache hits"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#22c55e' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Cost AreaChart ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="text-sm font-medium text-slate-300 mb-4">Cost over time (USD)</div>

        {loading ? (
          <Skeleton className="h-[300px]" />
        ) : data.length === 0 ? (
          <EmptyChart height={300} />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                {/* Orange fill at 20% opacity below the line */}
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: '#1e293b' }}
                tickLine={false}
              />
              <YAxis
                width={70}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatCost(v)}
              />
              <Tooltip content={<CostTooltip />} />
              <Area
                type="monotone"
                dataKey="cost_usd"
                name="Cost"
                stroke="#f97316"
                strokeWidth={2}
                fill="url(#costGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#f97316' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
