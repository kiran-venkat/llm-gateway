import time

import httpx

from config import get_settings


class DeepgramSTTAdapter:

    def get_plugin(self):
        """Returns livekit plugin instance for use in AgentSession (T90)"""
        from livekit.plugins import deepgram
        return deepgram.STT(
            model="nova-2",
            language="en-US",
            punctuate=True,
            interim_results=False,
        )

    async def transcribe_file(self, audio_path: str) -> dict:
        """
        Transcribe a local audio file using Deepgram REST API.
        Returns { transcript: str, latency_ms: int, confidence: float }
        """
        settings = get_settings()
        if not settings.DEEPGRAM_API_KEY:
            raise ValueError("DEEPGRAM_API_KEY not set")

        url = "https://api.deepgram.com/v1/listen"
        params = {
            "model": "nova-2",
            "punctuate": "true",
            "language": "en-US",
        }
        headers = {
            "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
            "Content-Type": "audio/wav",
        }

        start = time.monotonic()
        async with httpx.AsyncClient(timeout=30.0) as client:
            with open(audio_path, "rb") as f:
                audio_bytes = f.read()
            response = await client.post(
                url, params=params, headers=headers, content=audio_bytes
            )
            response.raise_for_status()

        latency_ms = int((time.monotonic() - start) * 1000)
        data = response.json()
        alt = data["results"]["channels"][0]["alternatives"][0]

        return {
            "transcript": alt["transcript"],
            "confidence": alt["confidence"],
            "latency_ms": latency_ms,
        }
