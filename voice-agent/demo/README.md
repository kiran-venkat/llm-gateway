# Voice Demo

Start services: `docker-compose -f docker-compose.voice.yml up livekit` · `uvicorn api:app --reload --port 8000` · `python agent.py dev`

Open: `voice-agent/demo/index.html` directly in Chrome (no server needed).

Expect: click Connect → grant mic → speak → agent transcribes your speech (right bubble), replies in voice (left bubble), latency panel updates every 2 s.
