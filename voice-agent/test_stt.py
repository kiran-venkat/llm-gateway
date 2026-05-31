import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from adapters.stt import DeepgramSTTAdapter

TEST_AUDIO_URL = (
    "https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav"
)
TEST_AUDIO_PATH = "/tmp/test_speech.wav"


async def main():
    from config import get_settings
    settings = get_settings()
    if not settings.DEEPGRAM_API_KEY:
        print("ERROR: DEEPGRAM_API_KEY not set in .env")
        sys.exit(1)

    import httpx

    print("Downloading test audio...")
    async with httpx.AsyncClient(follow_redirects=True) as client:
        r = await client.get(TEST_AUDIO_URL)
        r.raise_for_status()
    with open(TEST_AUDIO_PATH, "wb") as f:
        f.write(r.content)
    print(f"Downloaded {len(r.content)} bytes → {TEST_AUDIO_PATH}")

    print("Transcribing...")
    adapter = DeepgramSTTAdapter()
    result = await adapter.transcribe_file(TEST_AUDIO_PATH)

    print(f"\nTranscript : {result['transcript']}")
    print(f"Confidence : {result['confidence']:.2%}")
    print(f"Latency    : {result['latency_ms']}ms")

    if not result["transcript"].strip():
        print("\nWARN: Empty transcript — check API key and audio file")
        sys.exit(1)

    print("\nT88 STT adapter working correctly.")


if __name__ == "__main__":
    asyncio.run(main())
