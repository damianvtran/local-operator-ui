"""Seed a scratch analytics ledger so the /analytics panel renders a FULL panel.

Usage: python seed-analytics.py <config_dir> [days]

Synthetic data only: the runs this feeds are photographs of geometry, and the
numbers in them are not claims about anything. Sessions are named through the
store's own upsert so the session table shows titles rather than hex ids.
"""

import random
import sys
import time

from local_operator.analytics.model import CallSnapshot
from local_operator.analytics.store import AnalyticsStore

random.seed(7)

config_dir = sys.argv[1]
days = int(sys.argv[2]) if len(sys.argv) > 2 else 10

store = AnalyticsStore(f"{config_dir}/analytics.db")

now_ms = int(time.time() * 1000)
DAY_MS = 86_400_000
MODELS = [
    ("anthropic", "claude-sonnet-4-5"),
    ("anthropic", "claude-haiku-4-5"),
    ("openai", "gpt-5.1"),
    ("deepseek", "deepseek-flash"),
    ("google", "gemini-3-pro-preview"),
]
TITLES = [
    "Analytics panel geometry",
    "Composer send path",
    "Sidebar row spacing",
    "Canvas freshness checks",
    "Browser approvals dock",
    "Top inset audit",
    "Streaming trace order",
    "Pin and archive flows",
    "Install smoke (windows)",
    "Dialog hit zones",
    "Theme contrast sweep",
    "Scroll paging budget",
]

snapshots = []
for day in range(days):
    # A different subset each day so the chart has a real shape.
    session_count = 3 + (day * 2) % 6
    model_count = 2 + day % len(MODELS)
    for s_index in range(session_count):
        session_id = f"{(0xA1000 + s_index):012x}"
        for m_index in range(model_count):
            provider, model_id = MODELS[(m_index + day) % len(MODELS)]
            calls_that_day = 1 + (s_index * 7 + m_index * 5 + day) % 4
            for call in range(calls_that_day):
                ts_ms = (
                    now_ms
                    - day * DAY_MS
                    - (call * 3_600_000)
                    - (s_index * 137_000)
                    - (m_index * 211_000)
                )
                input_tokens = 9_000 + int(14_000 * random.random())
                output_tokens = 1_200 + int(900 * random.random())
                snapshots.append(
                    CallSnapshot(
                        ts_ms=ts_ms,
                        session_id=session_id,
                        provider=provider,
                        model_id=model_id,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cache_read_tokens=int(3_000 * random.random()),
                        cache_write_tokens=int(600 * random.random()),
                        reasoning_tokens=int(500 * random.random()),
                        context_tokens=input_tokens,
                        ok=True,
                        duration_ms=900.0 + 800.0 * random.random(),
                        ttft_ms=250.0 + 400.0 * random.random(),
                        request_id=f"seed-{day}-{s_index}-{m_index}-{call}",
                    )
                )

written = store.record_batch(snapshots)
for index, title in enumerate(TITLES):
    store.upsert_session_name(f"{(0xA1000 + index):012x}", title)

aggregate = store.aggregate()
print(f"recorded {written} calls in {len(snapshots)} snapshots")
print(f"aggregate sessions: {len(aggregate.by_session)}")
print(f"daily series days: {len(store.daily_series(30))}")
store.close()
