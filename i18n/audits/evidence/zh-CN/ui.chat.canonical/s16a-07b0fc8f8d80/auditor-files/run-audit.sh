#!/bin/bash
# s16a zh-CN independent audit runner. Read-only on the repo.
set -o pipefail
cd "$(dirname "$0")" || exit 1
echo "# audit run $(date -u +%Y-%m-%dT%H:%M:%SZ) — auditor session 07b0fc8f8d80 (i18n-auditor)"
echo "# repo: /Users/damian/local-operator-ui/.worktrees/i18n-s16a (read-only; no edits, no commits)"
echo "# HEAD: $(git -C /Users/damian/local-operator-ui/.worktrees/i18n-s16a rev-parse HEAD)"
echo
node checks.mjs
rc=$?
echo
echo "## exit status: checks.mjs=$rc"
