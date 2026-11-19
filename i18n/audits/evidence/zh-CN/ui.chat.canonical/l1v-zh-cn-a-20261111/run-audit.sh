#!/bin/bash
# Reproduces the mechanical half of this audit and is what wrote audit.log.
# Read-only: it parses the three inputs, runs checks.py and prints hashes.
set -u
UI=~/local-operator-ui/.worktrees/i18n-l1-tool-verbs
PREP=~/local-operator-ui/.worktrees/_l1-prep
BUNDLE=$(cd "$(dirname "$0")" && pwd)
echo "# L1 tool-row verbs, zh-CN, audit suffix A — mechanical run"
echo "# date(UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# branch: $(git -C "$UI" rev-parse --abbrev-ref HEAD) @ $(git -C "$UI" rev-parse HEAD)"
echo
echo '== 1. JSON validity and key identity (node, repo-native parser)'
node -e '
const fs=require("fs");
const P=process.env.HOME+"/local-operator-ui/.worktrees/_l1-prep";
const k=JSON.parse(fs.readFileSync(P+"/keys.json","utf8"));
const t=JSON.parse(fs.readFileSync(P+"/zh-CN.json","utf8"));
const ke=Object.keys(k), te=Object.keys(t);
console.log("en+context keys:", ke.length, "target keys:", te.length);
console.log("key sets equal:", ke.length===te.length && ke.every((x,i)=>x===te[i]) && te.every(x=>x in k));
console.log("all values non-empty strings:", Object.values(t).every(v=>typeof v==="string" && v.trim().length>0));
'
echo
echo '== 2. Mechanical rules (checks.py)'
python3 "$BUNDLE/checks.py"
echo
echo '== 3. Generic-verb leakage (sidecar: never generalise to called/used)'
python3 - <<'PY'
import json
P="/Users/damian/local-operator-ui/.worktrees/_l1-prep"
zh=json.load(open(P+"/zh-CN.json"))
gen=["调用","使用","执行了","处理"]
print("hits for 调用/使用/执行了/处理:", {k:v for k,v in zh.items() if any(g in v for g in gen)})
PY
echo
echo '== 4. Input hashes'
shasum -a 256 "$PREP/keys.json" "$PREP/zh-CN.json" \
  "$UI/src/i18n/catalogues/en/ui.chat.canonical.json" \
  "$UI/src/i18n/catalogues/en/ui.chat.canonical.context.json" \
  "$UI/src/i18n/catalogues/zh-CN/ui.chat.canonical.json"
echo
echo '== 5. Repo ledger gate (read-only; prep-stage state)'
node "$UI/scripts/i18n/ledger-check.mjs"; echo "ledger-check exit=$?"
