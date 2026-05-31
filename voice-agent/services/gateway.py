import httpx

from config import settings

# T89 — replaced by openai.LLM base_url in agent


async def chat(messages: list[dict], model: str | None = None) -> str:
    model = model or settings.GATEWAY_MODEL
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.GATEWAY_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.GATEWAY_API_KEY}"},
            json={"model": model, "messages": messages},
            timeout=60.0,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
