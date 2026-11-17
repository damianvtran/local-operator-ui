# PR #1954 — Team Bridge approvals, round-1 remediation frames

Every frame is a Storybook story captured through the harness browser (one tab,
one Storybook booted by `scripts/with-storybook.mjs` on port 6954 and reaped by
process group), in `localOperatorDark` (`-dark`) and `localOperatorLight`
(`-light`), at 2560×1440. Stories: `Team Bridge/Requests`, `Team Bridge/Page`
(`Requests*`) and `Shell/Sidebar attention badges` (`MoreOpen*`), all
presentational — the live daemon path is QA's rig, not these frames.

| Frames | Finding | What it shows |
|---|---|---|
| `results-mixed-*`, `results-all-sent-*` | R1-02, Q1, D7 | Results as their own list from the decide response (sender · word · outcome) under a counted heading; decided rows have left the list |
| `populated-*` | U3, U5, N1, C1, C7 | Name + email, received and expiry, "Open in chat", "Send approval" on the locked row, the no-card row's next step |
| `selection-preview-locked-*` | U6 | A locked row selected beside an open one: "Deny 1 of 2" before pressing |
| `sticky-bar-scrolled-*` | U8 | 12 rows scrolled: the batch bar pinned, Select all mixed (2 of 12) |
| `cooldown-*`, `cooldown-countdown-t0-dark`, `cooldown-countdown-t6-dark` | D3, D4, Q3 | Blocking refusal on the warning wash; the count read 8 → 4 → 1 s over ~7 s |
| `locked-refusal-*` | C1, C6, D3 | Locked refusal copy as a status line, not a card |
| `presence-required-*`, `presence-required-dismissed-*` | D5, U3, C4 | No batch controls, each row opens its card, and no Dismiss that would bring them back |
| `foreign-prompt-trace-*` | U7 | Traces of ended prompts this window did not start |
| `history-*` | U2, N2 | Excerpt + "Open in chat" for a decision made here; the other row (decided elsewhere) has who and when only |
| `notice-own-*`, `notice-foreign-*` | D2, D6, C2, C3, S-5 | Foreign variant leads with "Not started in this window" on the wash; unlisted and unrecognised items |
| `notice-over-dialog-*` | S-3 | The real notice host, portalled above an open Radix dialog |
| `page-rail-requests-3-*`, `page-rail-requests-0-*`, `page-requests-open-*` | D1, C11 | The Approvals rail entry with and without its badge, and opened |
| `nav-before-unread-only-*`, `nav-after-requests-takeover-*` | D1 | Sidebar row: unread count before, "2 requests waiting" after |
| `loading-*`, `empty-*`, `load-error-*`, `authorizing-*` | — | Unchanged states, re-shot on the new head for both themes |

## Round-2 remediation re-shoots

These were re-captured the same way: the harness browser against a Storybook booted on port 6954 by `scripts/with-storybook.mjs`, at 2560×1440, in both themes. Every other frame is unchanged from round 1.

| Frames | Finding | What it shows |
|---|---|---|
| `page-requests-open-*` | D8, D11 | Approvals carries the rail's `rowCurrent` fill while it is open, and its badge reads 1 for the one listed row |
| `cooldown-*`, `locked-refusal-*` | D10, C12 | Dismiss sits on the sentence line. Glyph tops are 345 for the sentence and 347 for Dismiss (cooldown), and 329 and 331 (locked), in device px; round 1 had a 10 px offset. The locked refusal uses the singular "Send it from its row to finish." |
| `load-error-*` | Q2 | The Requests error panel, with "Requests could not be loaded." and "Try again". The panel is presentational, so these are byte-identical to round 1. The Q2 fix sits in the container, and the live rig plus `scripts/team-bridge-approvals-page.test.mjs` prove it |

D9 has no visual change. The cooldown line now holds a static `sr-only` sentence for the live region, and the ticking sentence is `aria-hidden`.

## Merge gate remediation — round 1 (O-7 / O-8)

The Touch ID prompt notice now carries `data-glass-overlay` and `data-lo-floating`. Off glass nothing changes (no border before or after). On window glass it does: before, the notice painted opaque over the material (computed `background-color: rgb(47, 42, 31)`, dark). After, it takes the overlay fill and the meaning-colour rebind (`color(srgb 0.184 0.165 0.122 / 0.75)`, `border-top-width: 0px`). The foreign variant still opens with its warning-wash "Not started in this window" strip (D2). Captured with the harness browser against one Storybook (`scripts/with-storybook.mjs --port 6954`, reaped by process group) at 2560×1440, story args `theme:<id>;glass:on`.

| Frames | What it shows |
|---|---|
| `gate-notice-own-glass-before-*`, `gate-notice-own-glass-after-*` | The own notice on glass before and after, dark and light |
| `gate-notice-foreign-glass-before-*`, `gate-notice-foreign-glass-after-*` | The foreign notice on glass before and after. The warning-wash strip leads in both |
