import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getRequests, type RequestEntry } from '@/lib/api-client'
import { cn, formatCost } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const POLL_MS = 30_000

const PROVIDERS = ['All', 'openai', 'anthropic', 'gemini'] as const
const STATUSES = ['All', 'success', 'error', 'cached', 'rate_limited'] as const

type ProviderFilter = (typeof PROVIDERS)[number]
type StatusFilter = (typeof STATUSES)[number]

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

// ─── Badges ──────────────────────────────────────────────────────────────────

function ProviderBadge({ provider }: { provider: string }) {
  const classes: Record<string, string> = {
    openai: 'bg-green-900 text-green-300 border-green-700',
    anthropic: 'bg-red-900 text-red-300 border-red-700',
    gemini: 'bg-blue-900 text-blue-300 border-blue-700',
  }
  return (
    <Badge
      className={cn(
        'border text-xs px-1.5 py-0',
        classes[provider.toLowerCase()] ?? 'bg-slate-700 text-slate-300 border-slate-600',
      )}
    >
      {provider}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    success: 'bg-green-900 text-green-300 border-green-700',
    error: 'bg-red-900 text-red-300 border-red-700',
    cached: 'bg-blue-900 text-blue-300 border-blue-700',
    rate_limited: 'bg-yellow-900 text-yellow-300 border-yellow-700',
  }
  return (
    <Badge
      className={cn(
        'border text-xs px-1.5 py-0',
        classes[status.toLowerCase()] ?? 'bg-slate-700 text-slate-300 border-slate-600',
      )}
    >
      {status}
    </Badge>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <TableRow className="border-slate-800">
      {[120, 80, 140, 80, 50, 100, 80, 60].map((w, i) => (
        <TableCell key={i}>
          <div
            className="animate-pulse bg-slate-800 rounded h-4"
            style={{ width: w }}
          />
        </TableCell>
      ))}
    </TableRow>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RequestLogPage() {
  const [rows, setRows] = useState<RequestEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [provider, setProvider] = useState<ProviderFilter>('All')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setIsRefreshing(true)
      setError(null)

      try {
        const res = await getRequests({
          page,
          limit: PAGE_SIZE,
          provider: provider === 'All' ? undefined : provider,
          status: statusFilter === 'All' ? undefined : statusFilter,
        })
        setRows(res.data.data)
        setTotal(res.data.total)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load requests')
      } finally {
        setLoading(false)
        setIsRefreshing(false)
      }
    },
    [page, provider, statusFilter],
  )

  // Initial fetch + reset to page 1 when filters change
  useEffect(() => {
    setPage(1)
  }, [provider, statusFilter])

  // Fetch on page/filter change + auto-refresh every 30s
  useEffect(() => {
    fetchData()
    const id = setInterval(() => fetchData(true), POLL_MS)
    return () => clearInterval(id)
  }, [fetchData])

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Request Log</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Provider filter */}
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderFilter)}
            className="h-8 bg-slate-900 border border-slate-700 text-slate-100 rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p === 'All' ? 'All Providers' : p}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-8 bg-slate-900 border border-slate-700 text-slate-100 rounded-md px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Statuses' : s}
              </option>
            ))}
          </select>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="h-8 text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            <RefreshCw size={14} className={cn('mr-1.5', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400 font-medium w-24">Time</TableHead>
                <TableHead className="text-slate-400 font-medium">Provider</TableHead>
                <TableHead className="text-slate-400 font-medium">Model</TableHead>
                <TableHead className="text-slate-400 font-medium">Status</TableHead>
                <TableHead className="text-slate-400 font-medium w-14">Cache</TableHead>
                <TableHead className="text-slate-400 font-medium">Tokens</TableHead>
                <TableHead className="text-slate-400 font-medium text-right">Cost</TableHead>
                <TableHead className="text-slate-400 font-medium text-right">Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)
              ) : rows.length === 0 ? (
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="text-center text-slate-600 text-sm py-12"
                  >
                    No requests found
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-slate-800 hover:bg-slate-800/40 font-mono text-xs"
                  >
                    <TableCell className="text-slate-400 whitespace-nowrap">
                      {formatTime(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ProviderBadge provider={row.provider} />
                    </TableCell>
                    <TableCell
                      className="text-slate-300 max-w-[160px] truncate"
                      title={row.model}
                    >
                      {row.model}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      {row.cacheHit ? (
                        <Badge className="bg-blue-900 text-blue-300 border border-blue-700 text-xs px-1.5 py-0">
                          HIT
                        </Badge>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-300 whitespace-nowrap">
                      {!row.promptTokens && !row.completionTokens ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <>
                          <span className="text-slate-500">{row.promptTokens ?? 0}</span>
                          <span className="text-slate-600 mx-1">+</span>
                          <span className="text-slate-500">{row.completionTokens ?? 0}</span>
                          <span className="text-slate-600 mx-1">=</span>
                          <span className="text-slate-200">
                            {(row.promptTokens ?? 0) + (row.completionTokens ?? 0)}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-orange-400">
                      {!row.costUsd ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        formatCost(row.costUsd)
                      )}
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {row.latencyMs != null ? `${row.latencyMs}ms` : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Pagination ── */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
            <span className="text-xs text-slate-500">
              Showing {from}–{to} of {total.toLocaleString()} requests
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                className="h-7 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30"
              >
                Previous
              </Button>
              <span className="flex items-center text-xs text-slate-500 px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="h-7 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
