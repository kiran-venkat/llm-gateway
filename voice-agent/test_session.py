"""
T95 — session_id wiring test.
Requires uvicorn api:app running on http://localhost:8000.
Run: python test_session.py
"""
import re
import sys
import httpx

API = "http://localhost:8000"
ROOM = f"test-room-t95"

PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"


def check(label: str, ok: bool, detail: str = "") -> None:
    mark = PASS if ok else FAIL
    print(f"  {mark}  {label}" + (f"  ({detail})" if detail else ""))
    if not ok:
        sys.exit(1)


def main() -> None:
    print("\nT95 session_id tests\n")

    with httpx.Client(base_url=API, timeout=5.0) as client:

        # ── Test 1: POST /voice/token returns session_id ──────────────────────
        try:
            r = client.post(
                "/voice/token",
                json={"room_name": ROOM, "participant_name": "tester"},
            )
        except httpx.ConnectError:
            print(f"  {FAIL}  Could not connect to {API} — is uvicorn running?")
            sys.exit(1)

        check("POST /voice/token returns 200", r.status_code == 200, str(r.status_code))
        body = r.json()

        check("response contains 'token'",      "token"      in body)
        check("response contains 'session_id'", "session_id" in body)

        session_id = body.get("session_id", "")
        check(
            f"session_id format is voice-<room>-<hex8>  got: {session_id!r}",
            bool(re.fullmatch(rf"voice-{re.escape(ROOM)}-[0-9a-f]{{8}}", session_id)),
        )

        # ── Test 2: GET /voice/session/{room_name} returns same session_id ────
        r2 = client.get(f"/voice/session/{ROOM}")
        check("GET /voice/session/{room} returns 200", r2.status_code == 200, str(r2.status_code))

        body2 = r2.json()
        check("response contains 'session_id'",          "session_id" in body2)
        check(
            "session_id matches the one from /voice/token",
            body2.get("session_id") == session_id,
            f"{body2.get('session_id')!r} == {session_id!r}",
        )

        # ── Test 3: 404 for unknown room ──────────────────────────────────────
        r3 = client.get("/voice/session/nonexistent-room-xyz")
        check("GET /voice/session/<unknown> returns 404", r3.status_code == 404, str(r3.status_code))

    print("\nAll tests passed.\n")


if __name__ == "__main__":
    main()
