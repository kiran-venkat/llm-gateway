import logging

from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli

from config import settings

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)


async def entrypoint(ctx: JobContext):
    # T90 — VoicePipelineAgent wired here
    logger.info("Agent job started", extra={"room": ctx.room.name})
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
            ws_url=settings.LIVEKIT_URL,
        )
    )
