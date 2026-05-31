import time

import httpx

from config import get_settings

# T89 — replaced by openai.LLM base_url in agent for real-time calls (T90)


async def chat(
    messages: list[dict],
    model: str | None = None,
    session_id: str | None = None,
) -> dict:
    """
    Send a chat request to the NestJS LLM gateway.
    Returns {
        content: str,
        model: str,
        provider: str,
        latency_ms: int,
        cache_hit: bool,
        cost_usd: float | None
    }
    """
    settings = get_settings()
    url = f"{settings.GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.GATEWAY_API_KEY}",
        "Content-Type": "application/json",
    }
    if session_id:
        headers["x-session-id"] = session_id

    payload = {
        "model": model or settings.GATEWAY_MODEL,
        "messages": messages,
        "stream": False,
    }

    start = time.monotonic()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    latency_ms = int((time.monotonic() - start) * 1000)

    data = response.json()
    content = data["choices"][0]["message"]["content"]

    return {
        "content": content,
        "model": data.get("model", ""),
        "provider": response.headers.get("x-gateway-provider", ""),
        "latency_ms": latency_ms,
        "cache_hit": response.headers.get("x-cache-hit", "false") == "true",
        "cost_usd": float(response.headers.get("x-cost-usd", 0)) or None,
    }
