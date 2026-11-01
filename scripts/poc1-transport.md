# Bounded synthetic transport-shape POC

This is an opt-in source rig, not a browser/native benchmark or a visible-latency
SLO check. It bundles the shipped hook/reducer/transcript once and drives six
synthetic transport shapes serially through the existing load-sequence harness.
No raw journal, live session, service or new dependency installation is needed.

## Reproduce

Use an isolated `.worktrees/` checkout with matching existing pnpm dependencies.
Set `LOCAL_OPERATOR_SCRATCHPAD` to owned scratch outside the checkout, then run:

```sh
python3 scripts/run-poc1.py --selftest
python3 scripts/run-poc1.py "$LOCAL_OPERATOR_SCRATCHPAD/poc1-evidence"
```

The runner strips inherited CMUX/XPC flags, isolates HOME/config, checks the exact
fresh child identity before a timeout signal and uses no process-group signals.
Timeout descendant cleanup is not guaranteed; stop dispatch on a timeout.
Each selected test has a 60-second limit; the wrapper has a total deadline.

Generated ESM lives in a fresh scratch directory. Its node_modules symlink shares
the checkout's dependency tree without copying or installing dependencies. The
same esbuild options and inline shipped composition are used regardless of the
bundle's location. Build/import errors cross a finally cleanup; the directory is
removed before exports reach test assertions. Abrupt process death can leave a
scratch directory, never generated code beside the source. Outside this harness,
CI uses RUNNER_TEMP; a portable local fallback is the user's cache directory.

The six cells vary cold/warm cache, resident reapply after bounded prior paging,
one large user or tool body, and checkpoint manifest size. Resident reapply is
not a switch retaining an oversized cache. Pending follow-up pages, run facts,
order witnesses, frontend seed, sequence and cursor flags stay explicit.

The output JSON contains raw process CPU and source-rig wall samples, proxy
parse/work counts, DOM/commit observations and controls. CPU substages, native
layout/paint/sendability and arbitrary DOM listener accounting are unobserved.
One synthetic residual RAF is a documented source-rig limitation, not proof of
all callbacks being reaped. Unrelated upstream metadata work is not an input at
this transport boundary and cannot be benchmarked by inventing protocol fields.

Keep generated output outside Git. Historical PR #1567 evidence is preserved in
its comments (raw samples and provenance), not loaded by this script. Historical
script hashes describe the code actually measured; later loader-only changes
need an explicit compatibility/provenance addendum, not rewritten old hashes.

## Scoped loader regression checks

```sh
node --test --experimental-test-isolation=none --test-concurrency=1 \
  --test-timeout=60000 scripts/scratch-esm-bundle.test.mjs
```

These exercise real React identity, failed real esbuild compilation, failed real
ESM import and a failing test body after import. Normal cleanup is checked by
reading the scratch directory, not inferred from a successful exit.
