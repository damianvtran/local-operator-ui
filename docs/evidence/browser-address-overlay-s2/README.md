# S2 browser address overlay — native evidence

Probe-only slices: a visual mirror of the in-flow address list in a native child
this app owns. The parent keeps the input, DOM focus, IME, every key and the
accessible combobox; the child document is `aria-hidden` with no roles, no focus
targets and no preload. This set is evidence for the probe, not a product claim:
native-composite pixels (V2) and native hit routing/focus (V3) are **BLOCKED**
and are not claimed anywhere in `matrix.md`.

- `matrix.md` — the built app's own rows, each with the command's actual output.
  Status vocabulary: PASS (observed), asserted-only (pure/unit only),
  BLOCKED (not provable here).
- `facts.json` — every probe receipt in order, derived from the run's
  append-only `events.jsonl`.
- `build-identity.json` — the exact built artifacts (SHA-256) and the emitted S2
  document's CSP, which is compared with the pinned policy before any boot.
- `plan.json` — the planned rows and their final assignment.
- `teardown.json` — SIGTERM result and survivor list for the S2 matrix boot.
- `s1-control-matrix.md` — the **same build** with the S2 opt-in unset, run as
  the same-code control: all 24 S1 rows PASS and the 5 asserted-only rows are
  unchanged, so S2 off is S1 behaviour.

## Commands

```sh
python ~/local-operator/scripts/run_bounded.py --timeout 300 --memory-mb 2600 -- \
  env LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm exec electron-vite build
python ~/local-operator/scripts/run_bounded.py --timeout 900 --memory-mb 2600 -- \
  node scripts/browser-address-overlay-probe.mjs --s2 --out "$LOCAL_OPERATOR_SCRATCHPAD/address-overlay-s2/native"
node scripts/browser-address-overlay-probe.mjs --out "$LOCAL_OPERATOR_SCRATCHPAD/address-overlay-s2/s1-control"
```

## Frames

`child-rows3.png`, `child-rows5-active.png`, `child-notice.png`,
`child-hostile.png`, `child-ru.png`, `child-ur.png` were captured with CDP
`Page.captureScreenshot` **on the child target** (not `capturePage`) and viewed.
They are not committed: `scripts/check-evidence-structure.mjs` forbids frame
containers under `docs/evidence/**`. Their byte sizes and paths are in the V1/R5
rows of `matrix.md`; the run's scratch directory is the regenerable source.

## Known deviations recorded in the brief

- System mono (`ui-monospace, Menlo`) instead of the app's Geist Mono webfont,
  because the child's CSP forbids font loads. S4 owns final type.
- The headless window throttles its frame loop, so a native resize can defer;
  the child pins its own layout height from the model (the view is the paint
  box), which is why row measurements are independent of resize timing.
- `--window-mode=inactive`/`normal` are refused by the gate by design; every
  pixel here is child-only, as the brief requires.
