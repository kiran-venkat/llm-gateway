import { useState, useEffect } from 'react'
import {
  TerminalSquare,
  BarChart2,
  List,
  DollarSign,
  Key,
  Server,
  Settings,
  LogOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '@/lib/api-client'
import PlaygroundPage from '@/pages/PlaygroundPage'
import UsagePage from '@/pages/UsagePage'
import RequestLogPage from '@/pages/RequestLogPage'
import CostPage from '@/pages/CostPage'
import ApiKeysPage from '@/pages/ApiKeysPage'
import ProvidersPage from '@/pages/ProvidersPage'
import SettingsPage from '@/pages/SettingsPage'

type Page = 'playground' | 'usage' | 'requests' | 'cost' | 'keys' | 'providers' | 'settings'

const NAV: { id: Page; label: string; Icon: React.ElementType }[] = [
  { id: 'playground', label: 'Playground', Icon: TerminalSquare },
  { id: 'usage', label: 'Usage', Icon: BarChart2 },
  { id: 'requests', label: 'Request Log', Icon: List },
  { id: 'cost', label: 'Cost', Icon: DollarSign },
  { id: 'keys', label: 'API Keys', Icon: Key },
  { id: 'providers', label: 'Providers', Icon: Server },
  { id: 'settings', label: 'Settings', Icon: Settings },
]

function ApiKeyModal({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onSave(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg shadow-lg p-8 w-full max-w-sm space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Enter your API key</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your key is stored in localStorage and sent as{' '}
            <code className="text-xs font-mono bg-muted px-1 rounded">
              Authorization: Bearer …
            </code>
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="lgk_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={!value.trim()}>
            Save &amp; continue
          </Button>
        </form>
      </div>
    </div>
  )
}

function Sidebar({
  active,
  onNavigate,
  onLogout,
}: {
  active: Page
  onNavigate: (p: Page) => void
  onLogout: () => void
}) {
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r bg-card h-screen sticky top-0">
      <div className="px-4 py-5 border-b">
        <span className="font-bold text-base tracking-tight">LLM Gateway</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={cn(
              'flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors',
              active === id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="px-2 py-3 border-t">
        <button
          onClick={onLogout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}

const PAGE_COMPONENTS: Record<Page, React.ComponentType> = {
  playground: PlaygroundPage,
  usage: UsagePage,
  requests: RequestLogPage,
  cost: CostPage,
  keys: ApiKeysPage,
  providers: ProvidersPage,
  settings: SettingsPage,
}

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(getStoredApiKey)
  const [activePage, setActivePage] = useState<Page>('playground')

  // Listen for 401 events fired by the axios interceptor
  useEffect(() => {
    const handler = () => setApiKey(null)
    window.addEventListener('lgk:unauthorized', handler)
    return () => window.removeEventListener('lgk:unauthorized', handler)
  }, [])

  function handleSaveKey(key: string) {
    setStoredApiKey(key)
    setApiKey(key)
  }

  function handleLogout() {
    clearStoredApiKey()
    setApiKey(null)
  }

  if (!apiKey) {
    return <ApiKeyModal onSave={handleSaveKey} />
  }

  const PageComponent = PAGE_COMPONENTS[activePage]

  return (
    <div className="flex min-h-screen">
      <Sidebar active={activePage} onNavigate={setActivePage} onLogout={handleLogout} />
      <main className="flex-1 overflow-auto">
        <PageComponent />
      </main>
    </div>
  )
}
