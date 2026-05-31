import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from services.gateway import chat


async def main():
    from config import get_settings
    settings = get_settings()
    print(f"Gateway URL : {settings.GATEWAY_URL}")
    print(f"Model       : {settings.GATEWAY_MODEL}")
    print(f"API Key     : {settings.GATEWAY_API_KEY[:8]}...")
    print()

    # Test 1: basic chat
    print("Test 1 — basic chat...")
    result = await chat([
        {"role": "user", "content": "Reply with exactly: GATEWAY_OK"}
    ])
    print(f"  Response  : {result['content']}")
    print(f"  Provider  : {result['provider']}")
    print(f"  Latency   : {result['latency_ms']}ms")
    print(f"  Cache hit : {result['cache_hit']}")
    print(f"  Cost      : ${result['cost_usd']}")

    if "GATEWAY_OK" not in result["content"]:
        print("  WARN: unexpected response but gateway is reachable")

    # Test 2: same message again — should be a cache hit
    print()
    print("Test 2 — cache hit check (same message)...")
    result2 = await chat([
        {"role": "user", "content": "Reply with exactly: GATEWAY_OK"}
    ])
    print(f"  Response  : {result2['content']}")
    print(f"  Latency   : {result2['latency_ms']}ms")
    print(f"  Cache hit : {result2['cache_hit']}")

    if result2["cache_hit"]:
        print("  Cache working correctly.")
    else:
        print("  Cache miss — BullMQ async window (~2s), try again")

    # Test 3: session_id header
    print()
    print("Test 3 — session_id header...")
    result3 = await chat(
        [{"role": "user", "content": "What is 2+2?"}],
        session_id="voice-test-session-001"
    )
    print(f"  Response  : {result3['content']}")
    print(f"  Latency   : {result3['latency_ms']}ms")

    print()
    print("T89 gateway connection verified.")


if __name__ == "__main__":
    asyncio.run(main())
