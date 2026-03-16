import { useState, useEffect } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getCost, type CostByProvider } from '@/lib/api-client'
import { cn, subDays, toDateStr, today, formatCost } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_RANGES = [7, 30, 90] as const
type DateRange = (typeof DATE_RANGES)[number]

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#22c55e',
  anthropic: '#f87171',
  gemini: '#60a5fa',
}

function providerColor(name: string): string {
  return PROVIDER_COLORS[name.toLowerCase()] ?? '#94a3b8'
}

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

function EmptyChart({ height = 300 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-slate-600 text-sm border border-dashed border-slate-800 rounded-lg"
      style={{ height }}
    >
      No cost data for this period
    </div>
  )
}

// ─── Custom tooltips ─────────────────────────────────────────────────────────

interface TooltipPayload {
  name: string
  value: number
  color: string
  dataKey: string
  payload: CostByProvider
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayload[]
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-slate-100 mb-1 capitalize">{entry.payload.provider}</div>
      <div className="flex gap-3">
        <span className="text-slate-400">Cost</span>
        <span className="font-mono text-orange-400">{formatCost(entry.payload.cost_usd)}</span>
      </div>
      <div className="flex gap-3">
        <span className="text-slate-400">Share</span>
        <span className="font-mono text-slate-200">{entry.payload.pct.toFixed(1)}%</span>
      </div>
    </div>
  )
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayload[]
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-slate-100 mb-1 capitalize">{entry.payload.provider}</div>
      <div className="flex gap-3">
        <span className="text-slate-400">Cost</span>
        <span className="font-mono text-orange-400">{formatCost(entry.payload.cost_usd)}</span>
      </div>
      <div className="flex gap-3">
        <span className="text-slate-400">Share</span>
        <span className="font-mono text-slate-200">{entry.payload.pct.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// ─── Pie center label (renders inside the donut hole) ────────────────────────

/**
 * Recharts' `<Label>` renders inside `<Pie>` at position "center".
 * We use a custom render prop to control font/color independently of the
 * outer chart theme.
 */
function PieCenterLabel({
  viewBox,
  totalCost,
}: {
  viewBox?: { cx?: number; cy?: number }
  totalCost: number
}) {
  const cx = viewBox?.cx ?? 0
  const cy = viewBox?.cy ?? 0
  return (
    <>
      <text x={cx} y={cy - 8} textAnchor="middle" fill="#f97316" fontSize={14} fontWeight={600}>
        {formatCost(totalCost)}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#64748b" fontSize={11}>
        total
      </text>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CostPage() {
  const [dateRange, setDateRange] = useState<DateRange>(7)
  const [byProvider, setByProvider] = useState<CostByProvider[]>([])
  const [totalCost, setTotalCost] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const end = today()
    const start = toDateStr(subDays(end, dateRange))

    getCost({ start, end })
      .then((res) => {
        if (!cancelled) {
          setByProvider(res.data.by_provider)
          setTotalCost(res.data.total_cost_usd)
        }
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
  }, [dateRange])

  const hasData = byProvider.length > 0

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold">Cost Breakdown</h1>
          {loading ? (
            <Skeleton className="h-8 w-40 mt-2" />
          ) : (
            <div className="text-3xl font-bold font-mono text-orange-400 mt-1">
              {formatCost(totalCost)}
            </div>
          )}
        </div>
        <DateRangeButtons value={dateRange} onChange={setDateRange} />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          Failed to load cost data: {error}
        </div>
      )}

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Pie chart — by provider */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-sm font-medium text-slate-300 mb-4">Cost by provider</div>

          {loading ? (
            <Skeleton className="h-[280px]" />
          ) : !hasData ? (
            <EmptyChart height={280} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={byProvider}
                  cx="50%"
                  cy="45%"
                  innerRadius={65}
                  outerRadius={100}
                  dataKey="cost_usd"
                  nameKey="provider"
                  paddingAngle={2}
                >
                  {/*
                   * PieCenterLabel sits in the donut hole. Recharts passes
                   * `viewBox` (containing cx/cy of the pie center) to label
                   * render functions — we use this to position both text elements.
                   */}
                  <PieCenterLabel viewBox={undefined} totalCost={totalCost} />
                  {byProvider.map((entry) => (
                    <Cell
                      key={entry.provider}
                      fill={providerColor(entry.provider)}
                      stroke="transparent"
                    />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend
                  formatter={(value: string) => (
                    <span className="text-slate-300 capitalize text-xs">{value}</span>
                  )}
                  wrapperStyle={{ paddingTop: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Horizontal bar chart — cost per provider, sorted by cost DESC */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-sm font-medium text-slate-300 mb-4">
            Cost comparison (horizontal)
          </div>

          {loading ? (
            <Skeleton className="h-[280px]" />
          ) : !hasData ? (
            <EmptyChart height={280} />
          ) : (
            /*
             * layout="vertical" swaps X and Y: the category axis (provider
             * names) runs vertically and the value axis (cost) runs horizontally.
             * This is Recharts' idiomatic horizontal bar chart.
             */
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                layout="vertical"
                data={[...byProvider].sort((a, b) => b.cost_usd - a.cost_usd)}
                margin={{ top: 4, right: 24, bottom: 4, left: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis
                  type="number"
                  dataKey="cost_usd"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatCost(v)}
                />
                <YAxis
                  type="category"
                  dataKey="provider"
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="cost_usd" name="Cost" radius={[0, 4, 4, 0]}>
                  {byProvider.map((entry) => (
                    <Cell
                      key={entry.provider}
                      fill={providerColor(entry.provider)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Data table ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg">
        <div className="px-4 py-3 border-b border-slate-800 text-sm font-medium text-slate-300">
          Cost by provider
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !hasData ? (
          <div className="px-4 py-8 text-center text-sm text-slate-600">
            No cost data for this period
          </div>
        ) : (
          /*
           * shadcn Table uses HTML <table> under the hood.
           * The wrapper div clips overflowing content on small screens.
           * Sorted by cost DESC — same order as the bar chart.
           */
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-medium">Provider</TableHead>
                  <TableHead className="text-slate-400 font-medium text-right">Cost</TableHead>
                  <TableHead className="text-slate-400 font-medium text-right">
                    % of Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...byProvider]
                  .sort((a, b) => b.cost_usd - a.cost_usd)
                  .map((row) => (
                    <TableRow
                      key={row.provider}
                      className="border-slate-800 hover:bg-slate-800/50"
                    >
                      <TableCell className="text-slate-100">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: providerColor(row.provider) }}
                          />
                          <span className="capitalize">{row.provider}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-orange-400">
                        {formatCost(row.cost_usd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-slate-300">
                        {row.pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
