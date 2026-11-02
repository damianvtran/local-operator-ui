set -o pipefail
# GitHub surfaces only a BOUNDED number of error annotations per step
# and drops the rest with no trace on either surface; 10 is the bound
# the lanes that chased this one measured, so `head -20` was asking for
# ten drops nobody could see. The head and the bound now agree, and the
# count is printed beside them, so an 11th failure is still NAMED.
ANNOTATION_CAP=10
# THE CAPTURE DOES NOT DEPEND ON ERREXIT, BY CONSTRUCTION: a command
# in a `||` list is exempt from errexit, so this needs no `set +e` /
# `set -e` pair around it. That pair was the weaker shape - dropping it
# while keeping `SUITE_RC=$?` restored the entire original defect
# (measured: no rc line, no TAP summary, no annotations) and every
# string pin still matched the body.
SUITE_STARTED=$SECONDS
SUITE_RC=0
# Local pnpm test:desktop remains the full inventory; this wrapper
# parses that exact command and forwards one partition to its runner.
CHECKOUT_SHA=$(git rev-parse HEAD)
# Retain main's direct capture inside the supervisor too: putting tee here would
# reintroduce the streaming stall before either log guard can inspect the file.
node scripts/desktop-test-shards.mjs run --head "$DESKTOP_REQUESTED_HEAD" --checkout "$CHECKOUT_SHA" --index "$DESKTOP_SHARD_INDEX" > /tmp/desktop-tests.log 2>&1 || SUITE_RC=$?
# `|| true` so a log with no counts still reaches the guards below
# instead of tripping errexit on the way - the arms below are what name
# that case, and they cannot name it from here if grep kills the step.
PASS=$(grep -E '^# pass ' /tmp/desktop-tests.log | awk '{print $3}' || true)
FAIL=$(grep -E '^# fail ' /tmp/desktop-tests.log | awk '{print $3}' || true)
echo "desktop suite: rc=$SUITE_RC pass=$PASS fail=$FAIL"
echo "elapsed=$((SECONDS - SUITE_STARTED))" >> "$GITHUB_OUTPUT"
# WHERE THIS ACTUALLY REACHES A READER, stated rather than implied:
# everything printed below is written AFTER the suite finishes, so it
# lands at the very END of the job log (measured: byte 37,747,599 of
# 37,750,309 - 99.99%) and a `gh run view --log` reader never gets it.
# ONLY the annotations cross that cut. Read them back - they are not in
# the log at all - with:
#   gh api repos/<owner>/<repo>/check-runs/<id>/annotations --jq '.[].message'
# And do NOT "verify" this by grepping a truncated log for `::error::`:
# the runner echoes this whole `run:` body into the log, so the first
# hit is that echo (byte 25,750 of the attempt-1 view) and the green
# means nothing.
grep -E '^# (tests|pass|fail|skipped) ' /tmp/desktop-tests.log || true
NOT_OK=$(grep -cE '^not ok ' /tmp/desktop-tests.log || true)
echo "desktop suite: not-ok lines=$NOT_OK; annotating the first $ANNOTATION_CAP"
# Workflow commands need `%` and CR escaped, by the runner's own command
# rules, or a test name carrying one renders as a mangled annotation -
# the failure this step exists to make readable. `IFS= read -r` strips
# the line's own LF, so LF is the one of the three that cannot occur.
grep -E '^not ok ' /tmp/desktop-tests.log | head -n "$ANNOTATION_CAP" | while IFS= read -r line; do
  line=${line//%/%25}
  line=${line//$'\r'/%0D}
  echo "::error::$line"
done || true
# A log with no summary is TWO situations, and the exit status is what
# tells them apart: reported as one, a red run whose summary never
# printed reads as a coverage problem instead of as a failure.
if [ -z "$PASS" ]; then
  if [ "$SUITE_RC" != "0" ]; then
    echo "The desktop suite exited $SUITE_RC without printing a TAP summary."
    echo "The run died before the summary: read the suite's own failure, not this line."
  else
    echo "Desktop suite reported no pass count at all; expected at least 60."
    echo "Either tests were dropped or the runner matched no files."
  fi
  exit 1
fi
if [ "$PASS" -lt 60 ]; then
  echo "Desktop suite reported $PASS passing tests; expected at least 60."
  echo "Either tests were dropped or the runner matched no files."
  exit 1
fi
if [ "$FAIL" != "0" ]; then
  echo "Desktop suite reported $FAIL failing tests."
  exit 1
fi
if [ "$SUITE_RC" != "0" ]; then
  echo "The desktop suite exited $SUITE_RC while reporting pass=$PASS fail=$FAIL."
  exit 1
fi
