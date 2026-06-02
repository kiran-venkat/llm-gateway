import { useState, useEffect, useRef } from 'react'
import {
  Room,
  RoomEvent,
  ConnectionState,
  RemoteAudioTrack,
} from 'livekit-client'
import type { Participant, TrackPublication, TranscriptionSegment } from 'livekit-client'
import { Mic, PhoneOff, User } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Constants ────────────────────────────────────────────────────────────────

const VOICE_API = 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentState = 'disconnected' | 'connecting' | 'listening' | 'thinking' | 'speaking'

interface TranscriptEntry {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: string   // HH:MM:SS, set when entry is created
}

interface TurnLatency {
  stt_latency_ms: number | null
  llm_ttfb_ms: number | null
  tts_ttfb_ms: number | null
  total_latency_ms: number | null
}

interface MetricsSummary {
  total_turns: number
  avg_stt_ms: number | null
  avg_llm_ttfb_ms: number | null
  avg_tts_ttfb_ms: number | null
  avg_total_ms: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_STATE: Record<AgentState, { label: string; dot: string }> = {
  disconnected: { label: 'Disconnected', dot: 'bg-slate-600' },
  connecting:   { label: 'Connecting…',  dot: 'bg-slate-400 animate-pulse' },
  listening:    { label: 'Listening…',   dot: 'bg-green-500 animate-pulse' },
  thinking:     { label: 'Thinking…',    dot: 'bg-yellow-400' },
  speaking:     { label: 'Speaking…',    dot: 'bg-blue-500' },
}

const EMPTY_SUMMARY: MetricsSummary = {
  total_turns: 0,
  avg_stt_ms: null,
  avg_llm_ttfb_ms: null,
  avg_tts_ttfb_ms: null,
  avg_total_ms: null,
}

function fmt(ms: number | null): string {
  return ms == null ? '—' : `${Math.round(ms)}ms`
}

function nowHMS(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VoiceMode() {
  const [agentState, setAgentState] = useState<AgentState>('disconnected')
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [lastTurn, setLastTurn] = useState<TurnLatency>({
    stt_latency_ms: null,
    llm_ttfb_ms: null,
    tts_ttfb_ms: null,
    total_latency_ms: null,
  })
  const [summary, setSummary] = useState<MetricsSummary>(EMPTY_SUMMARY)
  const [error, setError] = useState<string | null>(null)

  const roomRef   = useRef<Room | null>(null)
  const audioRef  = useRef<HTMLDivElement>(null)
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Smooth-scroll to bottom whenever a new transcript entry arrives
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      roomRef.current?.disconnect()
    }
  }, [])

  // ── Metrics polling ─────────────────────────────────────────────────────────

  async function pollMetrics() {
    try {
      const res = await fetch(`${VOICE_API}/voice/metrics`)
      if (!res.ok) return
      const data = await res.json() as {
        turns: TurnLatency[]
        summary: MetricsSummary
      }
      const turns = data.turns ?? []
      if (turns.length > 0) {
        const last = turns[turns.length - 1]
        setLastTurn({
          stt_latency_ms: last.stt_latency_ms,
          llm_ttfb_ms: last.llm_ttfb_ms,
          tts_ttfb_ms: last.tts_ttfb_ms,
          total_latency_ms: last.total_latency_ms,
        })
      }
      setSummary(data.summary ?? EMPTY_SUMMARY)
    } catch {
      // silent — voice agent may not be running
    }
  }

  // ── Connect ─────────────────────────────────────────────────────────────────

  async function connect() {
    setError(null)
    setAgentState('connecting')

    try {
      // 1. Get LiveKit URL from voice agent config
      let livekitUrl: string
      try {
        const cfgRes = await fetch(`${VOICE_API}/voice/config`)
        if (!cfgRes.ok) throw new Error(`status ${cfgRes.status}`)
        const cfg = await cfgRes.json() as { livekit_url: string }
        livekitUrl = cfg.livekit_url
      } catch {
        throw new Error('AGENT_DOWN')
      }

      // 2. Get JWT token
      const roomName = `playground-${Math.random().toString(36).substr(2, 6)}`
      let token: string
      try {
        const tokRes = await fetch(`${VOICE_API}/voice/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_name: roomName, participant_name: 'user' }),
        })
        if (!tokRes.ok) throw new Error(`status ${tokRes.status}`)
        const body = await tokRes.json() as { token: string }
        token = body.token
      } catch {
        throw new Error('AGENT_DOWN')
      }

      // 3. Create room and wire events
      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        if (state === ConnectionState.Disconnected) handleDisconnect()
      })

      // Agent state via participant attributes
      room.on(
        RoomEvent.ParticipantAttributesChanged,
        (changedAttrs: Record<string, string>) => {
          const s = changedAttrs['lk.agent.state']
          if (s === 'listening' || s === 'thinking' || s === 'speaking') {
            setAgentState(s)
          }
        },
      )

      // Transcripts — livekit-agents 1.5.x publishes via TranscriptionReceived
      room.on(
        RoomEvent.TranscriptionReceived,
        (
          segments: TranscriptionSegment[],
          participant?: Participant,
          _publication?: TrackPublication,
        ) => {
          const finals = segments.filter((s) => s.final && s.text.trim())
          if (!finals.length) return
          const text = finals.map((s) => s.text).join(' ').trim()
          if (!text) return
          const isUser = participant?.identity === room.localParticipant.identity
          setTranscripts((prev) => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              role: isUser ? 'user' : 'agent',
              text,
              timestamp: nowHMS(),
            },
          ])
        },
      )

      // Remote audio — attach TTS output so user can hear the agent
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track instanceof RemoteAudioTrack && audioRef.current) {
          audioRef.current.appendChild(track.attach())
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track instanceof RemoteAudioTrack) {
          track.detach().forEach((el) => el.remove())
        }
      })

      // 4. Connect to LiveKit
      try {
        await room.connect(livekitUrl, token, {
          rtcConfig: { iceTransportPolicy: 'all' },
        })
      } catch {
        throw new Error('LIVEKIT_DOWN')
      }

      // 5. Enable microphone
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch {
        throw new Error('MIC_DENIED')
      }

      // 6. Read initial agent state if agent is already in the room
      for (const [, p] of room.remoteParticipants) {
        const s = p.attributes?.['lk.agent.state']
        if (s === 'listening' || s === 'thinking' || s === 'speaking') {
          setAgentState(s)
          break
        }
      }
      if (agentState === 'connecting') setAgentState('listening')

      // 7. Start metrics poll (immediate + every 2 s)
      void pollMetrics()
      pollRef.current = setInterval(() => void pollMetrics(), 2000)

    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      if (code === 'AGENT_DOWN') {
        setError('Voice agent not running. Start with: python agent.py dev')
      } else if (code === 'MIC_DENIED') {
        setError('Microphone access required for voice mode')
      } else if (code === 'LIVEKIT_DOWN') {
        setError(
          'Could not connect to LiveKit. Start with: docker-compose -f docker-compose.voice.yml up livekit',
        )
      } else {
        setError(`Connection failed: ${code}`)
      }
      setAgentState('disconnected')
      roomRef.current?.disconnect()
      roomRef.current = null
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────

  function stop() {
    roomRef.current?.disconnect()
    handleDisconnect()
  }

  function handleDisconnect() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (audioRef.current) audioRef.current.innerHTML = ''
    setAgentState('disconnected')
    setTranscripts([])
    setSummary(EMPTY_SUMMARY)
    setLastTurn({ stt_latency_ms: null, llm_ttfb_ms: null, tts_ttfb_ms: null, total_latency_ms: null })
    roomRef.current = null
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isConnected = agentState !== 'disconnected' && agentState !== 'connecting'
  const { label: stateLabel, dot: dotClass } = AGENT_STATE[agentState]

  return (
    <div className="flex flex-1 min-h-0">

      {/* ── LEFT: Transcript ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">

          {transcripts.length === 0 && !error && (
            <div className="flex h-full items-center justify-center text-slate-600 text-sm">
              {agentState === 'disconnected'
                ? 'Click "Start Voice" in the panel to begin'
                : 'Speak — your conversation will appear here'}
            </div>
          )}

          {transcripts.map((t, i) => {
            // Subtle separator when role switches
            const prevRole = i > 0 ? transcripts[i - 1].role : null
            const showSeparator = prevRole !== null && prevRole !== t.role

            return (
              <div key={t.id}>
                {showSeparator && (
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-800" />
                  </div>
                )}

                <div className={`flex items-end gap-2 ${t.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                  {/* Role icon */}
                  <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mb-0.5 ${
                    t.role === 'user' ? 'bg-blue-900' : 'bg-slate-700'
                  }`}>
                    {t.role === 'user'
                      ? <User size={13} className="text-blue-300" />
                      : <Mic  size={13} className="text-slate-400" />
                    }
                  </div>

                  {/* Bubble + meta */}
                  <div className={`max-w-[75%] flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <span className={`text-xs font-mono mb-1 flex items-center gap-2 ${
                      t.role === 'user' ? 'text-blue-400 flex-row-reverse' : 'text-slate-500'
                    }`}>
                      <span>{t.role === 'user' ? 'you' : 'agent'}</span>
                      <span className="text-slate-700">{t.timestamp}</span>
                    </span>
                    <div className={`rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      t.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-100'
                    }`}>
                      {t.text}
                    </div>
                  </div>

                </div>
              </div>
            )
          })}

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300 font-mono">
              {error}
            </div>
          )}

          {/* Scroll sentinel */}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* ── RIGHT: Status + Latency ───────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-slate-800 bg-slate-900 overflow-y-auto">
        <div className="p-4 space-y-5">

          <SectionLabel>Voice Mode</SectionLabel>

          {/* Agent state indicator */}
          <div className="flex items-center gap-2.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
            <span className="text-sm text-slate-300">{stateLabel}</span>
          </div>

          {/* Connect / Stop */}
          {!isConnected ? (
            <Button
              onClick={() => void connect()}
              disabled={agentState === 'connecting'}
              size="sm"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Mic size={14} className="mr-1.5" />
              {agentState === 'connecting' ? 'Connecting…' : 'Start Voice'}
            </Button>
          ) : (
            <Button
              onClick={stop}
              variant="outline"
              size="sm"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <PhoneOff size={14} className="mr-1.5" />
              Stop Voice
            </Button>
          )}

          {/* ── Last Turn ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>Last Turn</SectionLabel>
              {summary.total_turns > 0 && (
                <span className="text-xs font-mono text-slate-500">
                  {summary.total_turns} turn{summary.total_turns !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="STT"      value={fmt(lastTurn.stt_latency_ms)}   valueClass="text-green-400" />
              <StatBox label="LLM TTFB" value={fmt(lastTurn.llm_ttfb_ms)}     valueClass="text-yellow-400" />
              <StatBox label="TTS TTFB" value={fmt(lastTurn.tts_ttfb_ms)}     valueClass="text-blue-400" />
              <StatBox label="Total"    value={fmt(lastTurn.total_latency_ms)} />
            </div>
          </div>

          {/* ── Session Averages ── */}
          <div>
            <div className="mb-2">
              <SectionLabel>Session Stats</SectionLabel>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatBox
                label="Avg STT"
                value={fmt(summary.avg_stt_ms)}
                valueClass="text-green-400"
              />
              <StatBox
                label="Avg LLM"
                value={fmt(summary.avg_llm_ttfb_ms)}
                valueClass="text-yellow-400"
              />
              <StatBox
                label="Avg Total"
                value={fmt(summary.avg_total_ms)}
              />
              <StatBox
                label="Turns"
                value={summary.total_turns > 0 ? String(summary.total_turns) : '—'}
                valueClass="text-slate-400"
              />
            </div>
          </div>

        </div>
      </div>

      {/* Hidden audio sink for TTS playback */}
      <div ref={audioRef} className="hidden" aria-hidden="true" />
    </div>
  )
}
