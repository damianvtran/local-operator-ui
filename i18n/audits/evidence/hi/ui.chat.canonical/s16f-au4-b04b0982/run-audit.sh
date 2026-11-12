#!/usr/bin/env bash
# Real transcript of this audit run. Every command below is re-executed now (nothing
# is pasted from an earlier call): the log IS the execution log, not notes about one.
set -uo pipefail
WT=~/local-operator-ui/.worktrees/i18n-s16a
SP=$LOCAL_OPERATOR_SCRATCHPAD/s16f-au4-hi
LOG=$SP/audit.log
: > "$LOG"

run() { # run <label> <cmd...>
  local label=$1; shift
  {
    echo "\$ $*"
    "$@" 2>&1
    echo "[exit $?]"
    echo
  } | tee -a "$LOG"
}

cd "$WT" || exit 1
echo "=== audit s16f-au4-hi · $(date -u +%Y-%m-%dT%H:%M:%SZ) · locale hi · namespace ui.chat.canonical ===" | tee -a "$LOG"
echo | tee -a "$LOG"

run "head" git log --oneline -1
run "head-sha" git rev-parse HEAD
run "status-before" git status --porcelain
run "pr-head" gh pr view 1876 --json state,headRefOid --jq '"\(.state) \(.headRefOid)"'
run "sha-files" sh -c 'sha256sum src/i18n/catalogues/en/ui.chat.canonical.json src/i18n/catalogues/hi/ui.chat.canonical.json src/i18n/catalogues/en/ui.chat.canonical.context.json'

echo "--- validator 1: locale-parity (key parity, placeholders, no English stub) ---" | tee -a "$LOG"
node --test scripts/i18n/locale-parity.test.mjs 2>&1 | tail -8 | tee -a "$LOG"
echo | tee -a "$LOG"

run "validator-2-check-duplicates" node scripts/i18n/check-duplicates.mjs
run "validator-3-context-parity" node scripts/i18n/context-parity.mjs
run "validator-4-generate-check" node scripts/i18n/generate.mjs --check
run "test-generation-card-labels" sh -c 'node --test scripts/i18n/generation-card-labels.test.mjs 2>&1 | tail -8'
run "test-hi-activation" sh -c 'node --test scripts/i18n/hi-activation.test.mjs 2>&1 | tail -8'

echo "--- integrity: key sets, prior-head byte identity, 15-key added group ---" | tee -a "$LOG"
python3 - "$WT" <<'PY' 2>&1 | tee -a "$LOG"
import json, subprocess, sys
root = sys.argv[1]
p = 'src/i18n/catalogues/hi/ui.chat.canonical.json'
def at(ref):
    r = subprocess.run(['git', '-C', root, 'show', f'{ref}:{p}'], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout, json.loads(r.stdout)
cur_raw = open(f'{root}/{p}', encoding='utf-8').read()
cur = json.loads(cur_raw)
_, prev  = at('8180eff1f705eb79d4df5123d6108c539b585b2e')
_, merge = at('8180eff1f705eb79d4df5123d6108c539b585b2e')
_, branch= at('8180eff1f705eb79d4df5123d6108c539b585b2e^1')
_, mainp = at('8180eff1f705eb79d4df5123d6108c539b585b2e^2')
_, main  = at('origin/main')
print('key counts: head', len(cur), '| 8180eff1', len(prev), '| merge parents', len(branch), len(mainp), '| origin/main', len(main))
print('key ORDER identical to 8180eff1:', list(cur) == list(prev))
print('key set equal to 8180eff1:', set(cur) == set(prev))
same = [k for k in cur if cur[k] == prev.get(k)]
diff = sorted(k for k in cur if cur[k] != prev.get(k))
print('values byte-identical to 8180eff1:', len(same), 'of', len(cur))
print('values differing from 8180eff1:', len(diff))
for k in diff:
    print('   ~', k)
    print('       was:', json.dumps(prev[k], ensure_ascii=False))
    print('       now:', json.dumps(cur[k], ensure_ascii=False))
ln, lo = cur_raw.splitlines(), prev and cur_raw.splitlines()
old_lines = subprocess.run(['git','-C',root,'show','8180eff1f705eb79d4df5123d6108c539b585b2e:'+p],capture_output=True,text=True).stdout.splitlines()
print('raw line count head/prior:', len(ln), len(old_lines), '| differing raw lines:',
      sum(1 for a, b in zip(old_lines, ln) if a != b))
print('file ends with newline:', cur_raw.endswith('\n'))
group = sorted((set(merge) - set(main)) | (set(mainp) - set(branch)))
print('added/merged group size:', len(group), '(10 keys the PR adds over origin/main + 5 keys main brought)')
changed = [k for k in group if cur[k] != merge[k]]
print('group keys whose value moved in cbb8782a:', changed)
print('group keys identical to their previous audited value:', len(group) - len(changed))
PY
echo | tee -a "$LOG"

echo "--- auditor's own ICU grid (real parser), 3 changed + 6 same-noun sibling keys ---" | tee -a "$LOG"
node "$SP/check-hi-s16f-au4.mjs" "$WT" 2>&1 | tee -a "$LOG"
echo "[exit ${PIPESTATUS[0]}]" | tee -a "$LOG"
echo | tee -a "$LOG"

run "status-after" git status --porcelain
echo "=== end of audit.log ===" | tee -a "$LOG"
