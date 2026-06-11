import time

import httpx

from config import get_settings

# T89 — replaced by openai.LLM base_url in agent for real-time calls (T90)


async def get_latest_request_cost(session_id: str) -> float | None:
    """
    Fetch the cost of the most recent LLM request recorded by the gateway.
    Called ~2 s after each assistant turn to backfill cost_usd on TurnMetrics.

    Uses GET /api/v1/analytics/requests?page=1&limit=1 — sufficient because
    voice turns are sequential; the most recent request after the sleep is the
    turn's LLM call.  Returns None on any error so the caller can skip silently.
    """
    settings = get_settings()
    url = f"{settings.GATEWAY_URL}/api/v1/analytics/requests"
    headers = {"Authorization": f"Bearer {settings.GATEWAY_API_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, params={"page": 1, "limit": 1}, headers=headers)
        if r.status_code != 200:
            return None
        data = r.json()
        entries = data.get("data") or []
        if not entries:
            return None
        raw = entries[0].get("costUsd")
        return float(raw) if raw is not None else None
    except Exception:
        return None


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
