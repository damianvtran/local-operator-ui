#!/usr/bin/env bash
#
# Produce the `scratchpad://` Files-panel evidence, end to end, in one command.
#
# WHY: the claim under review is about a RUNNING app - that a note's result text,
# which prints an absolute path under the session's `scratchpad/` directory, becomes a
# tile, and that clicking one opens the note in the canvas. Nothing in
# `test:desktop` can show that, and the tiles are inferred from transcript text,
# so the transcript has to be real too.
#
# Everything is isolated: scratch HOME / LOCAL_OPERATOR_CONFIG_DIR, its own
# `local-operator serve` on a port this script owns, a scratch Electron profile,
# and `headless` window mode throughout. The operator's own config dir, backend,
# sessions and profile are never read or written; the app is launched with a
# scratch cwd and an absolute app path precisely so the worktree's own `.env`
# cannot point it at the operator's backend.
#
#   bash docs/evidence/scratchpad-files/harness/run-scratchpad-files.sh            # full run (builds)
#   SKIP_BUILD=1 bash docs/evidence/scratchpad-files/harness/run-scratchpad-files.sh
#
# Requires: the sibling backend worktree with the `scratchpad://` feature (its own
# `.venv`), `ffmpeg`-free (no media in this set), and a provider credential the
# backend can read for the one real agent turn that writes the notes.

set -euo pipefail

UI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="${BACKEND_ROOT:-$HOME/workspace/repos/lo-notes-protocol}"
PORT="${PORT:-1149}"
ISO="${ISO:-$(mktemp -d /private/tmp/lo-scratchpad-evidence.XXXXXX)}"
MODEL="${MODEL:-deepseek/deepseek-v4.1-flash}"

# The PHYSICAL path, once. macOS's `/tmp` is a symlink to `/private/tmp`, and the
# backend resolves every scratchpad path with a realpath - so a scratch tree named by
# one spelling and resolved by the other yields TWO tiles for one note (measured:
# a panel of nine tiles for four notes before this line was added).
ISO="$(cd "$ISO" && pwd -P)"

echo "scratch: $ISO"
echo "ui:      $UI_ROOT"
echo "backend: $BACKEND_ROOT"

mkdir -p "$ISO/home" "$ISO/config" "$ISO/work" "$ISO/frames" "$ISO/app-cwd" "$ISO/logs" "$ISO/profile"

# The provider credential for the one real turn. Copied, never read: the file's
# bytes never enter a log, a report or this script's output.
cp "$HOME/.local-operator/credentials.env" "$ISO/config/credentials.env"
chmod 600 "$ISO/config/credentials.env"

# 1. One REAL agent turn, on the isolated config dir, asking the model to read the
#    scheme's guide and then write four files through `scratchpad://`. The tool
#    results are therefore the backend's own - `Created scratchpad://run/perf.md
#    -> /…/scratchpad/run/perf.md (N chars).` - and, because the guide is read
#    first, the transcript ALSO carries the guide's own example lines, which are
#    the two path-shaped placeholders the panel must not turn into tiles
#    (`/…/sessions/<id>/scratchpad/logs/run.md` and `/…/scratchpad/probe.sh`).
#    That is the point of asking for the read rather than hoping for it: the
#    panel reading `4 files` for this session is the extractor fix's evidence.
SID_LOG="$ISO/exec.log"
if ! (
  cd "$BACKEND_ROOT"
  env -i HOME="$ISO/home" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin" TERM=xterm-256color \
    LOCAL_OPERATOR_CONFIG_DIR="$ISO/config" \
    .venv/bin/local-operator exec --hosting openrouter --model "$MODEL" --yolo \
    --run-in "$ISO/work" \
    "First read the scratchpad guide with read(path=\"guide://scratchpad\") so you follow its conventions. Then use the scratchpad:// scheme for everything here. Write four files for this session:
1. scratchpad://run/perf.md — a short markdown note: a heading and three bullet points about p50, p95 and the rollout window.
2. scratchpad://run/metrics.csv — header name,p50_ms,p95_ms and three data rows.
3. scratchpad://run/session-log.txt — three short log lines.
4. scratchpad://run/run-config.json — keys model, effort, rollout.
Then read all four back. Do not create any other file." 2>&1 | tee "$SID_LOG"
); then
  echo "the agent turn failed; see $SID_LOG" >&2
  exit 1
fi
# One `grep` over the finished log rather than a pipeline after the tee: `head`
# closes its end early, and under `pipefail` that SIGPIPE would fail the whole run
# on the success path.
SID="$(grep -o 'session_id=[0-9a-f]*' "$SID_LOG" 2>/dev/null | head -1 | cut -d= -f2 || true)"
if [ -z "$SID" ]; then
  echo "could not read the session id out of the run; see $SID_LOG" >&2
  exit 1
fi
echo "session: $SID"

# 2. Replay the two path-shaped placeholder lines the guide used to print, so the
#    panel's extractor is exercised by the text that actually produced the phantom
#    tiles (see seed-placeholder-lines.py for why this is a replay and not a hope).
if [ "${WITH_PLACEHOLDERS:-1}" = "1" ]; then
  python3 "$HARNESS/seed-placeholder-lines.py" "$ISO/config/sessions/$SID/transcript.jsonl"
fi

# 3. The isolated backend the app will read that session from.
TOK="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
printf '%s' "$TOK" > "$ISO/token.txt"
chmod 600 "$ISO/token.txt"
(
  cd "$BACKEND_ROOT"
  env -i HOME="$ISO/home" PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin" \
    LOCAL_OPERATOR_CONFIG_DIR="$ISO/config" LOCAL_OPERATOR_DESKTOP_TOKEN="$TOK" \
    .venv/bin/local-operator serve --port "$PORT" > "$ISO/backend.log" 2>&1 &
  echo $! > "$ISO/backend.pid"
)
sleep 12
curl -sf -H "Authorization: Bearer $TOK" "http://127.0.0.1:$PORT/v1/desktop/sessions" >/dev/null \
  || { echo "the isolated backend did not answer; see $ISO/backend.log" >&2; exit 1; }

# 4. The scratch cwd the app is launched from: its own `.env` names THIS run's
#    backend. `src/main/backend/config.ts` loads `.env` from `process.cwd()` with
#    dotenv `override: true`, so this file - not the worktree's - is what the app
#    resolves, which is what keeps every request off the operator's backend.
printf 'VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:%s\nVITE_DISABLE_BACKEND_MANAGER=true\n' "$PORT" \
  > "$ISO/app-cwd/.env"

# 5. Build the renderer against that address: it is inlined at build time.
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  ( cd "$UI_ROOT" && VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$PORT" pnpm build )
fi

# 6. Drive the built app headless and capture the frames.
(cd "$UI_ROOT" && \
  NOTES_EVIDENCE_SCRATCH="$ISO" \
  LOCAL_OPERATOR_CONFIG_DIR="$ISO/config" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOK" \
  node docs/evidence/scratchpad-files/harness/scratchpad-files-proof.mjs "$ISO/frames" "$SID" \
  | tee "$ISO/report.json" >&2)

echo "frames: $ISO/frames"
echo "report: $ISO/report.json"
echo "copy them into docs/evidence/scratchpad-files/ and re-stamp the manifest."
echo "backend pid $(cat "$ISO/backend.pid") is still running; stop it with: kill \$(cat $ISO/backend.pid)"
