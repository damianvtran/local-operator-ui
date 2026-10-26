# Team Bridge account profiles — review evidence

This directory preserves the actual independent reviewers' historical records,
not a new review by the publishing agent. The reports and source manifests are
copied byte-for-byte from the reviewing sessions. Their working-tree scope atop
`acc6a5bc9c20ae9c92cfa3cf322271610b72c0b6` predates the source commit
`70a4c0cbbb06462cc797d0e56268eb9bd42c2c96`; the comparison below binds that reviewed content to the commit.
Actual review/remediation comments still belong to their authors on the PR.

## Source comparison at publication

- Code R2: **14/14 file hashes match** source commit `70a4c0cbbb06462cc797d0e56268eb9bd42c2c96`.
  Recomputed path-sorted SHA-256 manifest:
  `444baf427d9591198b9d62645a8b4bf0352890b5ec0f5763b8364b2bb92074dc`.
- Code R1: manifest
  `576c96967847d46868a452b5a65b3df3e3ac90d19dbba429185d293dec3ee278`.
  Only `scripts/team-bridge-avatar.test.mjs` and
  `src/renderer/src/features/team-bridge/use-team-bridge-avatar.ts` differ
  between R1 and the published source: the stale-completion ownership fix and
  regression test inspected by the R2 reviewer.
- Design: **7/8 recorded source hashes match**. The only later change is the
  avatar cache hook's R2 remediation, not card markup, styling, routing or story
  fixtures. Profile-card hash remains
  `a6644e695a4c0e3a58ee8b68b9409ee7cda525b7e3e1a084ac17e20a0191018e`.
  Reusing the recorded rendered evidence does not claim a fresh capture or
  production avatar authentication.
- Catalogue/context bytes match the frozen R2 i18n receipt in
  `i18n/receipts/teambridge-profile-audit-r2-3d4473001f4b.json`; its six non-gating
  findings remain deferred in the PR. No copy changes were made during publication.

## Recorded rendered evidence

The original designer report is [design-review-final.md](design-review-final.md).
It records the real browser/Storybook states, D1 clipping reproduction and fix,
320×568 geometry, 59 themes and eight locales. This is not a 59×8 Cartesian
sweep. Storybook DOM-event play is not trusted native pointer/keyboard input.
Thread roots/replies remain held and unreviewed; fixture avatars do not prove
production authentication. A pre-feature baseline was unavailable; the genuine
before/after pair is the D1 defect and fix.

Per repository policy, screenshots are not committed. The selected frames
were visually inspected again during publication and remain at
`~/.local-operator/sessions/b261491b2c63/scratchpad/`. Their immutable hashes
below identify the frames for the actual review comments. This local path is
not a remotely accessible screenshot attachment; the PR does not claim otherwise.
The full theme contact sheets were deliberately not copied into Git.

| Frame | SHA-256 |
| --- | --- |
| `profile-long-narrow-final.png` | `b47b6ddc3b8182052599390c7fe6d3437bdb3f0a1db70a68f50e0a980141e9ba` |
| `profile-narrow-fixed-first.png` | `73dda8c12ad2fdf4ff275547a8ee5a1288304210ca85fd158ba3349ae6b6f936` |
| `profile-narrow-fixed-settled.png` | `73dda8c12ad2fdf4ff275547a8ee5a1288304210ca85fd158ba3349ae6b6f936` |
| `profile-narrow-scrolled.png` | `1d4aed041e6a838010de7b3dfd2881cd0f88cef637eab9be137db94c58c88dcd` |
| `final-state-sheet-01.png` | `1744599e7e9721893c9660b2221afb56607b62e174fab0dbd694157f1f78370d` |
| `final-state-sheet-02.png` | `e1a8a43946a08e7cea8bc4f9caa17c24bc196b14c511520b58156f72603bd627` |

The first and settled fixed frames have the same hash, corroborating the
reviewer's no-reflow observation for that pair. The scrolled frame shows the
Message action reachable; the state sheets cover empty/loading/request-error/
decode-error/self/unavailable/chief/read-only fixtures.

## Fresh publishing gates

Renderer TypeScript; affected Biome including scripts (warnings, no errors);
three-file scripts ratchet; bounded avatar/directory/locale tests 96/96;
i18n ledger 595, generator freshness, parity 44/44, context, duplicate,
coverage and literal-baseline gates passed. The ordinary first push also
passed all three pre-push legs, including both node and renderer TypeScript.
No hook bypass, dependency install, full build, Electron, or browser engine
was used by the publishing pass. CI is a separate pending result.

## Provenance

- Code manifest origin: session `832baed7aef4`, scratch files named identically.
  The reviewer materialized these from its completed review transcript; the
  manifest's own provenance field states that limitation.
- Design origin: session `b261491b2c63`, scratch files named identically.
- This evidence-only addendum changes no source, catalogue, tests or runtime
  version. It does not authorize merge, release or thread enablement.
