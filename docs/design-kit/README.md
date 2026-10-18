# The vendored design-kit slice

`docs/design-kit/` is this app's pinned slice of the Local Operator design kit —
[`damianvtran/local-operator-design`](https://github.com/damianvtran/local-operator-design)
(public, MIT), tag `v1.2.0`. The kit is the **home of record** for the brand: a
colour or role change lands there first, with its measurement, and arrives here
by a deliberate pin bump. This directory records exactly which kit revision
this app is built against, and lets `pnpm check-themes` prove it.

The app-side rules that sit *around* the kit — how a desktop app should behave —
live in [`../branding.md`](../branding.md); the kit wins on brand values, that
file wins on behaviour.

## What is here

| File | Why it is consumed |
| --- | --- |
| `app-family.json` | The kit's snapshot of this app's two brand palettes (`localOperatorDark`, `localOperatorLight`) and the `ThemePalette` role contract. The parity gate re-derives both from this tree and compares against it. |
| `divergences.json` | The kit's sanctioned-difference register. The escape hatch: a departure from the kit is recorded here *first*, never invented locally. |
| `LICENSE` | The kit's MIT licence, kept beside the files it covers. |
| `lock.json` | The pin: kit, version, ref, and a sha256 per consumed file, taken from the kit's `digests.json`. |

The three consumed files are byte copies and are never edited here — `lock.json`
records their hashes, and the gate fails if any of them stops matching.

## How consumption works

Consumption is a **pinned slice plus a parity gate, never a build-time import**
and **never an npm dependency**: nothing under `src/` imports from this
directory, and no build step reads it. The kit is upstream of the brand values;
`src/renderer/src/shared/themes/palettes/*.ts` remains the single source the app
renders from — the gate is an additional *consumer* of that source, not a third
source beside it.

`node scripts/check-design-kit.mjs` (wired into `pnpm check-themes`) proves two
things:

1. **The pin is honest.** Each slice file hashes to what `lock.json` records, no
   stray files sit beside them, and the kit at `ref` still ships the same bytes
   (an anonymous fetch of `raw.githubusercontent.com`).
2. **The brand is the kit's.** It re-derives the two `localOperator*` palettes by
   executing `palettes/local-operator.ts`, scans the `ThemePalette` member list
   from `palette-contract.ts`, and compares value-for-value and
   member-for-member against the vendored `app-family.json`.

## The two failures this exists to catch

- **The pin is lying** — the slice no longer equals the kit at the locked ref (a
  hand-edit, a dropped file, a lock that moved without the files, or the kit's
  bytes at `ref` having changed). Fix by re-vendoring and re-locking from the
  kit's `digests.json` at the pinned ref; if the kit legitimately changed, land a
  deliberate pin bump whose PR records the reason.
- **Someone edited brand values locally** — the palettes or the role contract no
  longer re-derive to the vendored `app-family.json`. The kit is the home of
  record, so a brand change lands in the kit first with its measurement. A
  sanctioned departure is recorded in the kit's `divergences.json` *before* it
  lands here; nothing is ever edited into this slice, or into the palettes, to
  dodge that.

A network failure is not drift: the gate reports the pin as **unverified**
(exit 2, never a silent skip) and rerunning with network access verifies it.

## Bumping the pin

Pins bump deliberately, never drift forward. A pin-bump PR re-vendors the kit
files, updates `lock.json` from the kit's `digests.json` at the new tag, and
records in its description why the bump happened — what moved in the kit and
what follows here.
