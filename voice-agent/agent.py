import logging
import sys

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
from livekit.plugins import deepgram, openai, silero

from config import get_settings

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
