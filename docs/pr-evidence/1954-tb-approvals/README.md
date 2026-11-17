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
