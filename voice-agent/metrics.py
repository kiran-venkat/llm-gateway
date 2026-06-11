import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class TurnMetrics:
    turn_id: str
    session_id: str
    timestamp: str
    stt_latency_ms: float | None = None
    llm_ttfb_ms: float | None = None
    tts_ttfb_ms: float | None = None
    total_latency_ms: float | None = None
    transcript: str | None = None
    provider: str = "gateway"
    cost_usd: float | None = None


class MetricsStore:
    def __init__(self, maxlen: int = 50):
        self._turns: deque[TurnMetrics] = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def record(self, turn: TurnMetrics) -> None:
        with self._lock:
            self._turns.append(turn)

    def get_all(self) -> list[TurnMetrics]:
        with self._lock:
            return list(self._turns)

    def get_session_cost(self) -> float:
        """Total cost of all turns recorded in this session."""
        return sum(t.cost_usd for t in self._turns if t.cost_usd is not None)

    def get_summary(self) -> dict:
        turns = self.get_all()
        if not turns:
            return {
                "total_turns": 0,
                "avg_stt_ms": None,
                "avg_llm_ttfb_ms": None,
                "avg_tts_ttfb_ms": None,
                "avg_total_ms": None,
                "total_cost_usd": 0.0,
            }

        def avg(vals):
            v = [x for x in vals if x is not None]
            return round(sum(v) / len(v), 1) if v else None

        return {
            "total_turns": len(turns),
            "avg_stt_ms": avg(t.stt_latency_ms for t in turns),
            "avg_llm_ttfb_ms": avg(t.llm_ttfb_ms for t in turns),
            "avg_tts_ttfb_ms": avg(t.tts_ttfb_ms for t in turns),
            "avg_total_ms": avg(t.total_latency_ms for t in turns),
            "total_cost_usd": self.get_session_cost(),
        }


# Global singleton — shared between agent.py and api.py
store = MetricsStore()
