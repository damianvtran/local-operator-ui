#!/bin/bash
# Execution log for the S16d round-2 es audit. Every line below is a real run.
set -u
SP="$LOCAL_OPERATOR_SCRATCHPAD"
M="$SP/mirror"
WT="/Users/damian/local-operator-ui/.worktrees/i18n-s16d"
LOG="$SP/audit.log"
ES="src/i18n/catalogues/es/ui.common.time.json"
PARITY="scripts/i18n/locale-parity.test.mjs"
run() { echo "\$ $*" >>"$LOG"; eval "$@" >>"$LOG" 2>&1; echo "(exit $?)" >>"$LOG"; echo >>"$LOG"; }

: >"$LOG"
echo "S16d round-2 independent audit, locale es, namespace ui.common.time" >>"$LOG"
echo "auditor: i18n-auditor / deepseek/deepseek-flash / session 70b1568077eb" >>"$LOG"
echo "date: 2026-11-12 (UTC session date)" >>"$LOG"
echo "worktree (manager-owned, read-only): $WT" >>"$LOG"
echo "scratch mirror: git archive of src/i18n, scripts/i18n, i18n, package.json; node_modules symlinked" >>"$LOG"
echo >>"$LOG"

cd "$WT"
run "git rev-parse HEAD"
run "git status --porcelain"
run "shasum -a 256 src/i18n/catalogues/es/ui.common.time.json src/i18n/catalogues/en/ui.common.time.json src/i18n/catalogues/en/ui.common.time.context.json"
run "git show HEAD:i18n/catalogues/es/ui.common.time.json | shasum -a 256"

cd "$M"
run "node scripts/i18n/generate.mjs --check"
run "node scripts/i18n/check-coverage.mjs"
run "node scripts/i18n/check-duplicates.mjs"
run "node scripts/i18n/context-parity.mjs"
run "node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs"
run "node --test scripts/i18n/es-activation.test.mjs"
run "node $SP/compose-es.mjs"
run "node $SP/grid-es.mjs"
run "node -e 'const fs=require(\"fs\");const s=fs.readFileSync(\"$ES\",\"utf8\");console.log(\"NFC identical:\",s===s.normalize(\"NFC\"));console.log(\"bidi controls:\",/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u061c]/.test(s));console.log(\"keys:\",Object.keys(JSON.parse(s)).length)'"
cd "$WT"
run "./node_modules/.bin/biome check src/i18n/catalogues/es/ui.common.time.json"

# ---- negative controls on in-memory mutants of the scratch MIRROR ----
cd "$M"
echo "=== NEGATIVE CONTROLS (mutants in the mirror only; the repo is never touched) ===" >>"$LOG"
echo >>"$LOG"

node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));j["ui.common.time.weekday_at"]="{weekday} {time}";fs.writeFileSync(p,JSON.stringify(j,null,"\t")+"\n")' "$ES"
echo "--- M1: revert weekday_at to the English-identical pre-round-1 value \"{weekday} {time}\"" >>"$LOG"
run "node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs"
cp "$WT/$ES" "$ES"

node -e 'const fs=require("fs");const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));j["ui.common.time.today_at"]="Hoy {hora}";fs.writeFileSync(p,JSON.stringify(j,null,"\t")+"\n")' "$ES"
echo "--- M2: rename today_at's placeholder to {hora}" >>"$LOG"
run "node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs"
cp "$WT/$ES" "$ES"

cp "$PARITY" "$SP/parity-pristine.mjs"
node -e 'const fs=require("fs");const p=process.argv[1];let s=fs.readFileSync(p,"utf8");s=s.replace("\"es:ui.common.time.date_at\"","\"xx:DISABLED-ROW\"");fs.writeFileSync(p,s)' "$PARITY"
echo "--- M3: disable the es:ui.common.time.date_at IDENTICAL_OK row (is it load-bearing?)" >>"$LOG"
run "node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs"
cp "$SP/parity-pristine.mjs" "$PARITY"

echo "--- restored: the mirror's es file and parity test are byte-identical again" >>"$LOG"
run "shasum -a 256 $ES"
run "cmp -s '$WT/$ES' '$ES' && echo 'es file byte-identical to the worktree'"
run "cmp -s '$WT/$PARITY' '$PARITY' && echo 'parity test byte-identical to the worktree'"
run "node --test --test-name-pattern '\[es\]' scripts/i18n/locale-parity.test.mjs"

# ---- ledger receipt ----
echo "=== LEDGER (receipt, assemble, check) ===" >>"$LOG"
echo >>"$LOG"
run "git -C '$WT' show HEAD:i18n/ledger.json > i18n/ledger.json"
run "node scripts/i18n/ledger-assemble.mjs --locale es --file $ES --auditor-instance 70b1568077eb --auditor-model deepseek/deepseek-flash --result clean-with-findings --receipt '$SP/receipt-es-s16d-r2.json' --scope 'es ui.common.time round 2: the four S16d keys (today_at, yesterday, weekday_at, date_at) plus the unchanged yesterday_at sibling, on b2110ea9cd9f' --note 'R2 es on b2110ea9cd9f: 0 blocker/major on all 5 time words; weekday_at comma = Intl es own composition; date_at IDENTICAL_OK row verified load-bearing and es-scoped. ES-1 nit: row lacks provenance. Record: i18n/audits/evidence/es/ui.common.time/s16d-r2-70b1568077eb/record.json'"
run "node scripts/i18n/ledger-check.mjs 2>&1 | grep '^ledger-check: es/' ; echo 'es findings above (none = clean)'"
run "node scripts/i18n/ledger-check.mjs 2>&1 | tail -1"
run "node -e 'const l=require(\"./i18n/ledger.json\");const r=l.entries.find(e=>e.locale===\"es\"&&e.namespace===\"ui.common.time\");console.log(JSON.stringify(r,null,2))'"
run "shasum -a 256 i18n/receipts/70b1568077eb.json '$SP/receipt-es-s16d-r2.json'"
echo "=== END ===" >>"$LOG"
echo "log written: $(wc -l <"$LOG") lines"
