# PR #1631 — retained native localization evidence

This is an archival wrapper, not a new QA execution or review verdict. The independent QA report is [QA-NATIVE.md](QA-NATIVE.md); its bounded PASS/TERMINAL conclusion and explicit limits remain authoritative. Independent design round 2 is [comment 6602893791](https://github.com/damianvtran/local-operator-ui/pull/1631#issuecomment-6602893791); QA's reconciled report is [comment 6601990769](https://github.com/damianvtran/local-operator-ui/pull/1631#issuecomment-6601990769).

## Identity and portable navigation

- Application/code/catalogue head captured: `6fe683b6d7aae8c80e4faeb215139d057b1e1400`. This retention changes documentation/evidence only.
- [artifact-manifest.json](artifact-manifest.json) maps every immutable supplied artifact to a path **relative to this directory**, with SHA-256 and byte size. Use these paths when archival command receipts contain historical machine-specific locations; those locations are provenance, not instructions to execute.
- [SHA256SUMS.txt](SHA256SUMS.txt) is the original QA checksum record. The wrapper does not rewrite QA reports, observations, command receipts, hashes or pixels.
- Visual overview: [effort contact sheet](effort-contact-sheet.png), [wake contact sheet](wake-contact-sheet.png), [Urdu reload before/after](ur-reload-before-after.png). Full first/settled frames are in [frames/](frames/); the earlier baseline's distinct source identity is in [retained-baseline/provenance.json](retained-baseline/provenance.json).
- Execution records: [build receipt](build-receipt.json), [command receipts](native-command-receipts.json), [observations](native1631-observations.json), [capture pairs](capture-pairs.json), [target pair checks](target-pair-checks.json), [negative admission](gate-negative.json), [actual admission](gate-actual.json), [cleanup verification](cleanup-verified.json).

## Limits preserved, not waived

The report discloses the build's load-limit overshoot, the build-only existing-plugin `NODE_PATH` accommodation, earlier failed setup/admission, synthetic OAuth fixtures, and exact-process cleanup. This was not a stock-default build pass. The narrow wake pane is clipped in the same-code English control and is **not** passed. First frames were captured after a 1.6-second settle delay, not at the earliest locale-change paint. Uncaptured native permutations remain unproved; this is not entire-UI completion.

## Retention verification

The retaining implementer verified all original checksum entries against this bundle, inspected both contact sheets, and scanned textual records for private keys, provider tokens, JWTs, bearer credentials and credential assignments without printing matched values. No unexplained sensitive-pattern hit was found. The independent QA report attributes the run to isolated synthetic HOME/config/session fixtures, an owned loopback daemon and explicit synthetic OAuth strings; retention does not claim another native run or a separate linguistic audit.

## Author provenance correction

After original retention commit `b0c7f1010c3d3a1bc0f324a5383711e87e6b9f23`, the independent QA author corrected only the reviewer-model lines in `QA-NATIVE.md` and `CHECKPOINT.md` using their persisted usage metadata: actual execution was `openai/gpt-6.1-sol`, not the requested Sonnet header. [correction-manifest.json](correction-manifest.json) preserves the author's exact before/after hashes and scope; the original report bytes remain available in that Git commit's history. The reports and checksum record here are the author's corrected bytes, not implementer rewrites. Pixels, machine receipts, captured application head, disclosures, scope and verdict are unchanged. The portable artifact manifest records the corrected report hashes and the correction record itself. No rerun or new review verdict is asserted.
