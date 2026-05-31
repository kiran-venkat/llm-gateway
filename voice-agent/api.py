import time

from fastapi import FastAPI, HTTPException
from jose import jwt
from pydantic import BaseModel

from config import settings

app = FastAPI(title="Voice Agent API")


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
