#!/bin/bash
# Test the voice agent in console mode
# Speak when you see "User:" prompt
# Type 'q' to quit
cd "$(dirname "$0")"
echo "Starting voice agent in console mode..."
echo "LiveKit server must be running: docker-compose -f docker-compose.voice.yml up livekit"
echo ""
python agent.py console
