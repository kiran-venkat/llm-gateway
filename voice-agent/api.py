import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jose import jwt
from pydantic import BaseModel

from config import settings
from metrics import store

app = FastAPI(title="Voice Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TokenRequest(BaseModel):
    room_name: str
    participant_name: str


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "gateway_url": settings.GATEWAY_URL,
        "livekit_url": settings.LIVEKIT_URL,
    }


@app.get("/voice/config")
async def voice_config():
    return {
        "livekit_url": settings.LIVEKIT_URL,
        "livekit_api_key": settings.LIVEKIT_API_KEY,
    }


@app.post("/voice/token")
async def create_token(body: TokenRequest):
    if not body.room_name or not body.participant_name:
        raise HTTPException(status_code=400, detail="room_name and participant_name are required")

    now = int(time.time())
    claims = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": body.participant_name,
        "iat": now,
        "exp": now + 3600,  # 1 hour
        "video": {
            "roomJoin": True,
            "room": body.room_name,
            "canPublish": True,
            "canSubscribe": True,
        },
    }
    token = jwt.encode(claims, settings.LIVEKIT_API_SECRET, algorithm="HS256")
    return {"token": token}


@app.get("/voice/metrics")
async def get_metrics():
    """Returns last 50 turns with per-turn STT/LLM/TTS latencies."""
    return {
        "summary": store.get_summary(),
        "turns": [
            {
                "turn_id": t.turn_id,
                "session_id": t.session_id,
                "timestamp": t.timestamp,
                "stt_latency_ms": t.stt_latency_ms,
                "llm_ttfb_ms": t.llm_ttfb_ms,
                "tts_ttfb_ms": t.tts_ttfb_ms,
                "total_latency_ms": t.total_latency_ms,
                "transcript": t.transcript,
            }
            for t in store.get_all()
        ],
    }


@app.get("/voice/metrics/summary")
async def get_metrics_summary():
    """Quick summary — just the averages."""
    return store.get_summary()
