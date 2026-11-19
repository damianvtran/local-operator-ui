# Union re-audit — `fr` / `ui.chat` — local-operator-ui PR #1449

Audit id `union-chat-fr-b3efc4d36922` · session `b3efc4d36922` · agent `i18n-auditor` ·
route `radient/auto` (no fallback observed) · 2026-10-28 · team `lopdev`.
Independent of the translator: this session wrote no catalogue, context, script or
ledger byte and edited nothing in the repository.

## Scope and binding

The union head is `c5e19ecec883b45e281d696f06dac86bcb0d90f3`, the merge of
`i18n-wave-a` with main `1d631be71fb7a674b117aab61508d6dd822708b4` (which carries
wave B). `src/i18n/catalogues/fr/ui.chat.json` at that head is
`a0f70787c5faddb059246b07ed5266374945d6a2da0279ba5d0dae89efdcbe6d`; the English
source is `d3bc8ec097540b123500005e941093dbc73eaaa46fa1152643a04d51b6f259e4`; the
English context sidecar is
`994de1d3c61cdc19ba61bb8b0995e4e96e17e80c531c9b3dafb4572d3c8bca3e`.

Both hashes were read from disk in a throw-away `git archive` export and cross-checked
against `git show <head>:<path>` (identical). The shared checkout was never read as the
audited bytes and never written.

## Delta proof (parsed-JSON, not text diff)

The union file is 142 keys: 115 base keys, 18 wave-A keys, 9 wave-B keys, pairwise
disjoint. The proof (`tools/delta-proof.py`, log: `audit.log` §3) asserts:

- every one of the 18 wave-A values is byte-identical to the bytes the wave-A receipt
  `6c78c3706206` bound (`80ee119bbd`, fr `c31f2943…`);
- every one of the 9 wave-B values is byte-identical to the bytes the wave-B receipt
  `c3a8965266e3` bound (`a5356ce91c`, fr `e9b9512e…`);
- every one of the 115 base values is byte-identical to main pre-union (`1d631be71f`)
  and to the wave-A branch base (`6216167f4464`); the older 44-key snapshot
  (`20225f33d0`) is a subset and agrees;
- the English side moves in lockstep: same three groups, same ids, same values.

Result: 18 PASS checks, 0 counterexamples.

The context sidecar is a clean union as well: the union equals `e5f7c8daea`'s 127
entries plus main's 9 wave-B entries, and matches all 118 of main's entries. Three
wave-A entries (`checkpoint.turn`, `header_identity.aria_agent_closed`,
`header_identity.aria_team_closed`) differ from the `1df3ad0e` context the wave-A
receipt signed — the wave-A branch's merge commit had already rewritten those notes —
while their fr values are unchanged. The repository's own
`catalogue-union-parity.mjs` reports exactly those three as value differences against
the PR side and reports no missing key and no value difference in the en and fr
catalogues. This is disclosed rather than hidden; the audit read and judged the union
context, so the verdict covers the text that ships.

## Gates actually run (all on the exported union bytes)

| gate | result |
|---|---|
| `generate.mjs --check` | PASS — `keys.gen.ts` byte-identical to a fresh generation |
| `check-duplicates.mjs` | PASS — 889 files, 0 duplicate keys |
| `context-parity.mjs` | PASS — 131 allowed gaps in 4 namespaces (shrink-only) |
| `locale-parity.test.mjs` | PASS — 44/44 tests (fr: no unknown keys, ICU parity, not an English stub) |
| `check-coverage.mjs` | PASS — 7 gated languages over 99 namespaces, 0 allowances |
| `ledger-check.mjs` | EXPECTED FAIL — 21 diagnostics = 7 locale×`ui.chat` rows × 3; this receipt is the missing input |
| `catalogue-union-parity.mjs` | en + fr catalogues: no key missing, no value difference; context sibling: the 3 disclosed value differences |
| ICU parity (real `@formatjs` parser) | PASS — argument names/types identical for all 142 keys |
| CLDR categories | PASS — fr `one/many/other` only, `other` present, no `few` |
| real render (`intl-messageformat` 12.1.3) | PASS — 147 message/argument combinations under `fr`, no throw, no leftover ICU |
| text hygiene | PASS — NFC, no bidi controls, `’` only, U+202F before `; : ! ?` and inside `« »`, no straight quotes, no double spaces, whitespace parity with EN |
| backticks | PASS — none in this namespace, so no code span can drift |
| English identity | 0 values byte-identical to EN |

`check-strings.mjs` scanned **0 files** in the catalogue-only export (it reads the
renderer sources), so its green line is not evidence and is not claimed. CLI output is
in `audit.log`; `check-added-strings.mjs` needs a git base and was not run.

Negative controls: a scratch copy with an injected dropped `{total}`, an injected
`few` plural arm and an injected ASCII apostrophe was caught 3/3 by the same checker,
so the green run is discriminating.

## The read

All 142 values were read against English, the sidecar's role/tone/notes, the fr style
guide and the core glossary, with the union treated as one file: the A keys against
the B keys, both against the base copy, and every family checked for one term per
concept (goal → objectif, loop → boucle, wake → réveil, job → tâche, monitor →
surveillance, subagent → sous-agent, run → exécution, transcript → transcription,
device/appareil, skill/compétence, team/équipe). Register is `vous` throughout; no
Title Case, no `Veuillez`, no calque; statuses are past participles; U+202F spacing is
consistent; plural categories are the locale's own.

Verdict: **passed**, 0 blocker / 0 major / 0 minor / 0 nit.

## Observations (not findings)

1. `region.conversation` = « Transcription » — accepted, not re-opened. The region is
   the `role=log` holding the messages; the fr sidebar nav landmark is already
   « Conversations », and the transcript-display setting on the same surface says
   « Affichage de la transcription ». A second « Conversation » landmark one letter
   from the nav name is the worse outcome.
2. `composer.status.goal_dismiss` = « Ignorer » against three base « Masquer » for EN
   `Dismiss` — not a collision: the fr goal-dismiss family is « ignorer » throughout
   (`ui.chat.pickers`, `ui.notices`), the three `Masquer` keys hide banners, and the
   corpus splits the same way outside this namespace (7/8).
3. `composer.status.monitors_action` = « Ouvrir la surveillance » — the singular
   matches the destination's own fr heading `ui.chat.run_details.monitors.title`
   « Surveillance ».
4. The approval hint names the card's buttons « Approve ou Deny »: those are the
   literal labels the component draws (`approval-words.ts`, English by design because
   the label doubles as the wire verdict), and the typed tokens `yes/no/1/2` must stay
   English. The English labels are a source-level gap, not a catalogue error.
5. `header_identity.aria_agent_closed` / `aria_team_closed` embed `{reason}`, now
   documented as a UI-composed English sentence mirroring a core cross-repo contract.
   The fr value correctly passes it through; a French AT user hears one English clause.
6. The three context entries whose notes changed before the union (see above).
7. Base-only, unchanged-by-proof: `skill_invocation.instructions_label` says
   « Instructions de compétence… » while its sibling says « Instructions de la
   compétence {token} »; a future pass may align the article.

## Limits

Catalogue and call-site evidence only: no build, no rendered frame, no browser, no
native-render claim, no native-speaker sign-off. Widths are cell counts against the
sidecar's `maxCells` hints, not measurements. The English copy was read as the source,
not audited as English. The upstream model behind the `radient/auto` route is not
exposed to this session and is not invented.
