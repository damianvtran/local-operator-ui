# R15: legacy binding retention (current storage contract)

This supersedes the earlier release-note-only disposition of R12/U12 and the
claim that a binary downgrade alone could not restore newly reserved mappings.
It prevents deletion in this change; it cannot reconstruct values already lost
by a previous unsafe build without a pre-upgrade backup.

## Implementation contract

The same existing `shortcutBindings` map keeps normalized legacy assignments for
exactly primary+R, Shift+R, T, Shift+T, L and 1–9 (14 values). No shadow/backup,
new schema, storage-version change or browser capability. `effectiveChord`
returns the action default (or null) for a reserved stored string. Dispatch,
Settings values, shortcut captions and capture collision checks share this
function. Newly captured reserved values remain rejected, including direct
store setter calls. A dormant entry claims its effective default during
sanitizer collision ordering, never its saved chord. Pre-existing reserved,
invalid and duplicate-active overrides retain their existing rejection rules.

The current store hydrates through the sanitizer and serializes the existing
map on unrelated preference writes, so retained raw data survives both paths.
Explicit Reset deletes its raw entry; Clear writes null; a valid reassignment
replaces it. Neither repeated hydration nor later unrelated writes resurrects
the replaced legacy assignment. Settings already no-ops when the candidate is
the currently displayed effective chord: re-pressing that default is NOT Reset
and can leave the dormant mapping retained. Use the existing Reset button to
explicitly discard it. No rendered Settings component changed.

## Actual execution (lightweight, synthetic storage, no live profile)

`node scripts/run-desktop-tests.mjs --test-concurrency=1
scripts/keymap-retention.test.mjs scripts/keymap-chords.test.mjs
scripts/keymap-registry.test.mjs scripts/keymap-dispatch.test.mjs
scripts/lane-registration.test.mjs`

Run through the existing isolated HOME/config test wrapper and machine lease.
Actual terminal result: **19 PASS, 0 FAIL**. The real-store test printed:

```text
R15 actual store: 28 hydration/save/reload/downgrade cases + 3 explicit-edit roundtrips PASS; no live profile
```

The test bundles the actual `useUiPreferencesStore` and uses in-memory
localStorage, not a rewritten persist implementation:

- Every one of the 14 values, with both version4 and version3 saved profiles:
  hydrate -> unrelated `setTheme` -> serialize -> rehydrate retains raw value;
  runtime remains console default primary+J, never the reserved chord.
- Same-version hydration alone writes zero times; version3 migration writes
  once. Saved mapping survives either path and the subsequent unrelated write.
- Valid unrelated canvas override and explicit run null remain unchanged.
- The SAVED post-write map is consumed by the frozen pre-PR 8057f32 sanitizer
  and effective reader; each original console mapping becomes effective again.
- New capture and setter attempts at those chords remain refused, including
  attempts to set a different previously untouched action.
- Explicit Reset, Clear and valid rebind each survive save/reload without
  resurrecting the original entry.
- Pure tests pin all14 dormant values, default-unbound actions, active dispatch
  exclusion, default-claim collision ordering and rejection of older invalid
  and reserved inputs.

Negative control: restored the OLD keymap-chord.ts from 290a80c13 while keeping
this real-store test; **0 PASS, 1 FAIL**, actual undefined vs expected
`primary+r` at the first retained mapping assertion. Restored new source before
rerunning the final targeted pass. The earlier destructive baseline experiment
also showed unrelated setTheme removing the mapping from persisted storage.

Frozen downgrade reader: `scripts/fixtures/keymap-pre-browser-8057f32.mjs` was
bundled from git objects at 8057f32ff24d0087e035eb0dd4d52947dfa0876c,
keymap-chord.ts and keymap-registry.ts, exporting only sanitizer/effectiveChord.
Immutable generated `var` declarations were changed to `const` and Biome
formatted; algorithm/registry unchanged. This intentionally does NOT track the
new implementation and requires no historical git objects during CI.

No product compile, Electron, browser, physical OS input or whole-suite rerun.
Earlier native/design evidence stays at its stated build identity. This delta
changes storage retention and the shared effective-read boundary; rendered
components are byte-identical and continue receiving the same effective values
for the affected old profiles (defaults/null, just as before retention).

## Public release copy

Release: patch — browser shortcuts follow browser focus; conflicting custom
shortcuts fall back to defaults while their saved assignments are retained for
older versions.

Impact: Mappings on newly reserved browser chords remain saved but inactive in
this version; unrelated shortcuts are unchanged. An older version can use the
retained mappings again unless you explicitly reset, clear or replace them.
