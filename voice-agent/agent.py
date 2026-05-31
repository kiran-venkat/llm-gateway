import logging
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv()

from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
)
from livekit.agents.llm import ChatMessage
from livekit.plugins import deepgram, openai, silero

from config import get_settings
from metrics import TurnMetrics, store

settings = get_settings()
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger("voice-agent")

SYSTEM_PROMPT = """You are a helpful voice assistant built on top \
of an LLM gateway that handles routing, caching, and cost tracking. \
Keep your responses concise and conversational — you are speaking \
out loud, not writing text. Avoid bullet points, markdown, or long \
lists. Speak naturally in 1-3 sentences where possible."""


async def entrypoint(ctx: JobContext):
    settings = get_settings()
    logger.info(
        "Agent starting",
        extra={"room": ctx.room.name, "gateway": settings.GATEWAY_URL},
    )

    await ctx.connect()

    # VAD — Silero runs locally, no API key needed
    try:
        vad = silero.VAD.load()
    except Exception as e:
        print(f"ERROR: Could not load Silero VAD model: {e}")
        print("Run: python agent.py download-files first")
        sys.exit(1)

    # STT — Deepgram nova-2, pass key explicitly (plugins read env independently)
    stt = deepgram.STT(
        model="nova-2",
        language="en-US",
        punctuate=True,
        api_key=settings.DEEPGRAM_API_KEY,
    )

    # LLM — points at NestJS gateway via OpenAI-compatible API.
    # All LLM calls flow through the gateway: rate limiting, cost tracking,
    # and caching apply automatically to every voice conversation turn.
    llm = openai.LLM(
        model=settings.GATEWAY_MODEL,
        base_url=f"{settings.GATEWAY_URL}/v1",
        api_key=settings.GATEWAY_API_KEY,
    )

    # TTS — Deepgram Aura 2 (same Deepgram API key, no extra signup)
    tts = deepgram.TTS(
        model="aura-2-andromeda-en",
        api_key=settings.DEEPGRAM_API_KEY,
    )

    agent = Agent(instructions=SYSTEM_PROMPT)

    session = AgentSession(
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts,
    )

    # Per-turn metrics capture.
    # conversation_item_added fires twice per turn: once for the user message
    # (has STT timing) and once for the assistant message (has LLM + TTS timing).
    # We stash the user-side STT data and complete the record on the assistant side.
    _pending_stt: dict[str, tuple[float | None, str | None]] = {}

    @session.on("conversation_item_added")
    def on_item_added(ev) -> None:
        if not isinstance(ev.item, ChatMessage):
            return

        m = ev.item.metrics  # MetricsReport TypedDict

        if ev.item.role == "user":
            delay = m.get("transcription_delay")
            transcript = ev.item.text_content
            _pending_stt[ctx.room.name] = (
                round(delay * 1000, 1) if delay else None,
                transcript,
            )
            logger.debug(
                "STT metrics",
                extra={"stt_latency_ms": _pending_stt[ctx.room.name][0]},
            )

        elif ev.item.role == "assistant":
            stt_ms, transcript = _pending_stt.pop(ctx.room.name, (None, None))

            llm_ttfb = m.get("llm_node_ttft")
            tts_ttfb = m.get("tts_node_ttfb")
            e2e = m.get("e2e_latency")

            turn = TurnMetrics(
                turn_id=str(uuid.uuid4()),
                session_id=ctx.room.name,
                timestamp=datetime.now(timezone.utc).isoformat(),
                stt_latency_ms=stt_ms,
                llm_ttfb_ms=round(llm_ttfb * 1000, 1) if llm_ttfb else None,
                tts_ttfb_ms=round(tts_ttfb * 1000, 1) if tts_ttfb else None,
                total_latency_ms=round(e2e * 1000, 1) if e2e else None,
                transcript=transcript,
            )
            store.record(turn)
            logger.info(
                "turn metrics recorded",
                extra={
                    "session_id": turn.session_id,
                    "stt_ms": turn.stt_latency_ms,
                    "llm_ttfb_ms": turn.llm_ttfb_ms,
                    "tts_ttfb_ms": turn.tts_ttfb_ms,
                    "total_ms": turn.total_latency_ms,
                },
            )

    # start() blocks until the room closes
    await session.start(
        agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(
            noise_cancellation=None,
        ),
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
        )
    )
