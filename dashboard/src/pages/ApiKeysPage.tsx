import { useState, useEffect, useCallback } from 'react'
import { Plus, Copy, Check, Trash2, AlertTriangle } from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getKeys, createKey, deleteKey, type ApiKey, type ApiKeyCreated } from '@/lib/api-client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-800 ${className ?? ''}`} />
}

// ─── Key reveal panel ─────────────────────────────────────────────────────────

/**
 * T48 "shown once" requirement:
 *
 * After createKey() succeeds, the raw key lives only in `createdKey` state
 * inside this component. We render it in a read-only Input inside a warning
 * box. The user must copy it before clicking "Done" — once they dismiss,
 * `createdKey` is cleared and the key is gone from the UI forever (matching
 * the backend: we only store the SHA-256 hash, never the raw value).
 *
 * The copy button shows a ✓ checkmark for 2 seconds via `copied` state to
 * give tactile confirmation without an alert or toast.
 */
function KeyRevealPanel({
  apiKey,
  onDone,
}: {
  apiKey: ApiKeyCreated
  onDone: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-700 bg-amber-950/40 px-3 py-3">
        <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300 leading-relaxed">
          <span className="font-semibold">Copy this key now.</span> It will never be shown
          again. The server stores only a SHA-256 hash.
        </p>
      </div>

      {/* Raw key + copy button */}
      <div className="flex gap-2">
        <Input
          readOnly
          value={apiKey.key}
          className="font-mono text-xs bg-slate-950 border-slate-700 text-slate-100 select-all"
          onFocus={(e) => e.target.select()}
        />
        <Button
          onClick={handleCopy}
          variant="outline"
          size="sm"
          className="shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800 w-9 px-0"
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
        </Button>
      </div>

      <div className="text-xs text-slate-500">
        Prefix: <span className="font-mono text-slate-300">{apiKey.key_prefix}</span>
      </div>

      <Button
        onClick={onDone}
        className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100"
      >
        {copied ? "Key copied — Done" : "I've saved the key — Done"}
      </Button>
    </div>
  )
}

// ─── Generate dialog ──────────────────────────────────────────────────────────

function GenerateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (key: ApiKeyCreated) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)

  function handleClose() {
    // Only allow close once user has seen/copied the key
    if (createdKey) onCreated(createdKey)
    onOpenChange(false)
    setName('')
    setError(null)
    setCreatedKey(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await createKey({ name: name.trim() || undefined })
      setCreatedKey(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-slate-100">
            {createdKey ? 'Your new API key' : 'Generate API key'}
          </DialogTitle>
        </DialogHeader>

        {createdKey ? (
          /* ── Post-creation: show raw key once ── */
          <KeyRevealPanel apiKey={createdKey} onDone={handleClose} />
        ) : (
          /* ── Pre-creation: name form ── */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Key name (optional)</Label>
              <Input
                placeholder="e.g. production-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-slate-950 border-slate-700 text-slate-100 placeholder-slate-600"
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                className="text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? 'Generating…' : 'Generate'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Revoke confirm dialog ────────────────────────────────────────────────────

function RevokeDialog({
  apiKey,
  onConfirm,
  onCancel,
}: {
  apiKey: ApiKey
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Revoke API key?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Revoke key{' '}
          <span className="font-mono text-slate-200">{apiKey.key_prefix}…</span>
          {apiKey.name && (
            <> ({apiKey.name})</>
          )}
          ? Any requests using this key will immediately return 401.
        </p>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-red-700 hover:bg-red-600 text-white"
          >
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGenerate, setShowGenerate] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await getKeys()
      setKeys(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  async function handleRevoke() {
    if (!revoking) return
    try {
      await deleteKey(revoking.id)
      await fetchKeys()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key')
    } finally {
      setRevoking(null)
    }
  }

  function handleCreated() {
    fetchKeys()
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <Button
          onClick={() => setShowGenerate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white h-8 text-sm"
        >
          <Plus size={14} className="mr-1.5" />
          Generate New Key
        </Button>
      </div>

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
                <TableHead className="text-slate-400 font-medium">Name</TableHead>
                <TableHead className="text-slate-400 font-medium">Prefix</TableHead>
                <TableHead className="text-slate-400 font-medium">Created</TableHead>
                <TableHead className="text-slate-400 font-medium">Last Used</TableHead>
                <TableHead className="text-slate-400 font-medium">Status</TableHead>
                <TableHead className="text-slate-400 font-medium w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="border-slate-800">
                    {['w-28', 'w-24', 'w-20', 'w-20', 'w-16', 'w-8'].map((w, j) => (
                      <TableCell key={j}>
                        <Skeleton className={`h-4 ${w}`} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : keys.length === 0 ? (
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center text-slate-600 text-sm py-12">
                    No API keys yet. Generate one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((k) => (
                  <TableRow key={k.id} className="border-slate-800 hover:bg-slate-800/40 text-sm">
                    <TableCell className="text-slate-200">
                      {k.name ?? <span className="text-slate-600 italic">unnamed</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-400">
                      {k.key_prefix}…
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {formatDate(k.created_at)}
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {k.last_used_at ? formatDate(k.last_used_at) : (
                        <span className="text-slate-600">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!k.is_active ? (
                        <Badge className="bg-slate-700 text-slate-400 border border-slate-600 text-xs px-1.5 py-0">
                          Revoked
                        </Badge>
                      ) : (
                        <Badge className="bg-green-900 text-green-300 border border-green-700 text-xs px-1.5 py-0">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {k.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevoking(k)}
                          className="h-7 px-2 text-slate-600 hover:text-red-400 hover:bg-red-950/30"
                          title="Revoke key"
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Dialogs ── */}
      <GenerateDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        onCreated={handleCreated}
      />
      {revoking && (
        <RevokeDialog
          apiKey={revoking}
          onConfirm={handleRevoke}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  )
}
