# Wave-B delta re-audit — locale `ur` — `ui.chat.pickers` — the nib

- **Audit id:** `waveb-urnib-20261027`
- **Head audited (bytes on disk):** `4772ed26451c1118c927a0aec722428eb88f3cd3f26c80dfae183ec2b14af0c1`, committed at `fbd334629fab274a2b65337bd1490767d39baee1` — *"fix(i18n): apply the final wave B audit nits to ur and zh-CN"* (`a5356ce91c` + this nib). The worktree then moved to `e90a9ac4094fed38dea41bf17470904ffedeb9da` while the audit ran (peers' evidence, the ledger bind, a test-lane fix): the two named gates were **re-run there** and the audited bytes hash identically, with no catalogue, renderer or i18n-script change between the two heads (`audit.log` §9).
- **Base:** `a5356ce91c4f37bf4c4d1c4518070e3a9b2505cb` (the previous nine-namespace delta receipt, `c89cee263ac2`)
- **Auditor:** agent `i18n-auditor`, session `181144042069`, team `lopdev`
- **Model route:** `radient/auto` (effort `auto`). **Fallback:** none observed.
- **Independence:** not the session that wrote `UR-WBD-01` (that was `c89cee263ac2`), not the session that applied the amendment (the coordinator did), not the translator. Edited no catalogue, context, ledger, generated file or `package.json`; created only this bundle and the receipt.

**Verdict: `passed` — no blocker, no major, no minor, no nit open.** The single previous minor (`UR-WBD-01`) is resolved and verified independently.

## The change, proved byte-for-byte

| | |
|---|---|
| File | `src/i18n/catalogues/ur/ui.chat.pickers.json` |
| sha256 on disk | `4772ed26451c1118c927a0aec722428eb88f3cd3f26c80dfae183ec2b14af0c1` |
| sha256 at base `a5356ce91c` | `7802b5fdd2e5a8c3847c8cc97dfb1faabbc0c9064ba50caab7f93aec3de01925` |
| Whole-file delta | **+2 bytes** — one insertion of `U+06D4 ARABIC FULL STOP` at char offset 68284, line 737. Common prefix 68284 chars, common suffix 113 chars, base middle `''`, disk middle `'۔'`. |
| Keys | 738 before and after, **identical key list in identical document order**; exactly **one** value changed (`ui.chat.pickers.slash.enter_needs_a_pick`). |
| English source | unchanged (`d91585397b3314c5ffd81d93c3fd7d9fdb1e0a54cc6ddd57ba082f55d666522c`) |
| Context sidecar | unchanged (`6861dbfbdbc9af23c8c09332670a6f7d77c2a12b5724afc91d0054660ef904d0`) |

The new value is **byte-identical** to the `proposed` string recorded in `UR-WBD-01` — extracted from that report by script, not retyped: 134 bytes, 83 code points, NFC, no manual bidi controls. Formatted through the repo's own `intl-messageformat` 12.1.3 at locale `ur`, it renders identical to the stored value (the value is a plain literal: zero ICU arguments, so the plural/category surface is empty by construction).

## The strip it lives in

`src/renderer/src/features/chat/components/slash-commands.tsx:2258-2269` paints **one bordered div with two block `<p>`s**: `{footerText}` then `{clickText}`. After this change **both lines are stopped**:

```
Enter کے لیے قطار منتخب کرنی ہو گی: پہلے ↓ پھر Enter · Tab اس قطار کو مکمل کرتا ہے۔
کلک کرنے سے /{label} چل جائے گی۔
```

All five `click.*` lines of that family end in `۔` (verified after rendering). The English value of this key ends in `.`; so do `es`, `fr`, `hi` (`।`), `ru`, `vi`. Before this change `ur` was the only SOV sibling reading bare, directly above a line that was not.

## RTL

GNU FriBidi 1.0.16, order proved from `--novisual --vtol` (the visual→logical map) rather than the shaped visual string, because this build applies Arabic shaping and merges lam-alef into a ligature. For the changed line and all five sibling lines:

- the final `۔` sits at **visual index 0 — the visually leftmost character**, which is where an Urdu reader needs the full stop;
- zero manual bidi controls (the render layer applies FSI/PDI; a control in the catalogue would be double-applied);
- every maximal bidi run lands on one contiguous visual block, LTR runs ascending inside themselves, RTL runs reversed, and the blocks are laid out right-to-left;
- the Latin islands (`Enter` ×2, `Tab`) stay contiguous and internally un-reversed;
- NFC stable; the reordering is a permutation of the same code points (nothing lost or duplicated).

## Findings

### `UR-WBD-01` — MINOR — **RESOLVED**

`ui.chat.pickers.slash.enter_needs_a_pick` now carries the terminal `۔`. Byte-equal to the proposal; the strip reads with both lines stopped; the stop is visually leftmost; every gate below is green.

### `NIB-OBS-1` — observation (info, uncounted, **source-side, not a catalogue defect**)

The English sidecar entry for this key says `"tone": "instruction, sentence case, no trailing period, two clauses separated by a middle dot"` — while the English value it describes ends in `.` (`Enter needs a row you pick: ↓ then Enter · Tab completes this row.`). That contradiction is the premise the translator declined `UR-WB-06` on, so it will re-open on the next wave unless it is settled at source: either update that tone line, or run a separate source-side change dropping the stop from the English value **and** from the `click.*` family in all locales. `context-parity` cannot see this (it checks coverage, not tone). Not a blocker for this delta; the source string is what the catalogue must follow.

### `NIB-OBS-2` — observation (info, uncounted, **out of locale**)

After this change `zh-CN` is the only shipped locale whose line has no terminal stop (it ends `…Tab补全此行`). Not audited here — zh-CN has its own auditor and record; noted only so the coordinator can see the cross-locale picture it asked about.

## Gates executed (actual output in `audit.log`)

```
node scripts/i18n/generate.mjs --check      keys.gen.ts byte-identical to a fresh generation
node scripts/i18n/check-duplicates.mjs     ok — 853 files, 0 duplicate keys
node scripts/i18n/context-parity.mjs       ok — every English key covered, 131 allowed gaps
node scripts/i18n/check-coverage.mjs       ok — 7 gated languages, 95 namespaces, 0 allowed keys
node scripts/i18n/check-strings.mjs        ok — 1377 files, 77 literals at/below baseline
node --test scripts/i18n/locale-parity.test.mjs          44/44 pass (six [ur] checks included)
node --test scripts/i18n/ur-activation.test.mjs          3/3 pass (no manual bidi controls)
node --test scripts/i18n-wave-b-keyed-copy.test.mjs     10/10 pass
node scripts/…/ns-sweep.mjs (this bundle)  all 738 ur values parsed: 0 errors, 0 argument/type mismatches vs en
```

No `ledger-assemble` was run and no ledger, catalogue or `package.json` was edited: the coordinator assembles the ledger. A suggested ledger row (not applied) is carried in the receipt.

## The other eight namespaces

`ui.agents.config`, `ui.chat`, `ui.chat.canonical`, `ui.chat.device`, `ui.chat.run_details`, `ui.chat.status`, `ui.common.connection`, `ui.common.layout` — **ur, en and context hashes all identical to receipt `c89cee263ac2`**, so only the `ui.chat.pickers` row needs re-binding.

## Limits

Catalogue-level audit: no browser, no rendered frame, no pixel measurement (no `maxCells`/`maxChars` budget exists for this key, and the strip is a full-width `text-meta` line, so fit is call-site geometry plus the +1 glyph). No native-speaker sign-off. Bidi was verified with a local FriBidi pass, never a translation or MT service.
