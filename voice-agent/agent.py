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

    # Stable session ID for this conversation — injected as x-session-id
    # on every LLM call so the gateway groups all turns into one RequestSpan.
    session_id = f"voice-{ctx.room.name}-{uuid.uuid4().hex[:8]}"
    logger.info("session started", extra={"session_id": session_id})

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
        extra_headers={"x-session-id": session_id},
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

    @session.on("conversation_item_added")
    def on_item_added(ev):
        try:
            item = ev.item
            transcript = item.text_content
            role = item.role  # "user" or "assistant"

            turn = TurnMetrics(
                turn_id=str(uuid.uuid4()),
                session_id=ctx.room.name,
                timestamp=datetime.now(timezone.utc).isoformat(),
                transcript=transcript,
            )

            metrics_data = getattr(item, "metrics", None)
            if metrics_data is not None:
                if role == "user":
                    delay = metrics_data.get("transcription_delay")
                    if delay:
                        turn.stt_latency_ms = round(delay * 1000, 1)
                elif role == "assistant":
                    llm_ttft = metrics_data.get("llm_node_ttft")
                    tts_ttfb = metrics_data.get("tts_node_ttfb")
                    e2e = metrics_data.get("e2e_latency")
                    if llm_ttft:
                        turn.llm_ttfb_ms = round(llm_ttft * 1000, 1)
                    if tts_ttfb:
                        turn.tts_ttfb_ms = round(tts_ttfb * 1000, 1)
                    if e2e:
                        turn.total_latency_ms = round(e2e * 1000, 1)

            store.record(turn)
            logger.info(
                "turn metrics recorded",
                extra={
                    "role": role,
                    "stt_ms": turn.stt_latency_ms,
                    "llm_ttfb_ms": turn.llm_ttfb_ms,
                    "tts_ttfb_ms": turn.tts_ttfb_ms,
                    "total_ms": turn.total_latency_ms,
                },
            )
        except Exception as e:
            logger.warning(f"metrics capture failed: {e}")

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
