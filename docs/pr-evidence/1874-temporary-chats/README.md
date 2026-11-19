# Temporary chats: round-1 remediation frames (PR #1874)

Re-shot 2026-11-12 after the round-1 remediation, with the same rig as the round-1 set
(`docs/evidence/temporary-chats/README.md`): `scripts/renderer-driver.mjs --scene temporary-chats
--temporary-expect on`, the BUILT app headless under one Xvfb, a scratch profile and HOME, 1380x900,
against `docs/evidence/temporary-chats/harness/stub-daemon.mjs` (a fresh stub per palette). Both
palettes: 36 PASS / 0 FAIL per palette. Only the states the remediation moved are committed here;
the rest of the set is unchanged in substance and is re-derivable from the rig.

| Frame | Ledger id | What the scene checked before the shutter |
| --- | --- | --- |
| `after-draft-toggle-on-*` | U-2 (design D1) | Ctrl+Shift+N (a real CDP chord): toggle `aria-pressed="true"`, drawn on the selected-row ground with an accent edge; the composer's placeholder reads exactly "Temporary chat — not saved to your chats. Ask anything" |
| `after-sidebar-group-open-*` | U-6 (design D2/D3, QA Q-3) | sidebar at 260 px (`SIDEBAR_DEFAULT_WIDTH`): every row's dashed mark at the ordinary rows' lead and under the header's own mark (x 34 = 34 = 34 in CSS px), the state line below the title (title box 182 px wide) |
| `after-sidebar-group-open-220-*` | U-6 | the same at 220 px (`SIDEBAR_MIN_WIDTH`): marks at x 34, title box 142 px wide, all three titles whole ("Quick regex question", "Scratch: curl flags", "Try the new parser") |
| `after-menu-keep-*` | U-10 (design D5) | the menu reads Copy session ID · Move to another device… · Transcript display · **Keep chat** · \| · Archive conversation · \| · Delete conversation… |
| `after-menu-make-*` | U-10 | `[data-temporary-make]` present; the frame shows Make temporary… in the same slot, above Archive (the order is asserted on the Keep menu) |

The group rows also show U-8 and U-9: a 22-minute row reads "Deletes in 21 min" or "22 min"
(rounded down, so a fresh 30-minute chat reads 30), the 4.5-minute row reads "Deletes in 4 min"
in the warning colour, and the held row reads "Kept while it runs" (the TUI's wording).

The 220 px row was measured, not inferred: before the change the one-line row gave the title 93 px
at 260 px (design round 1, D3) and one character beside a hold sentence (QA Q-3).

`Reconnecting` and the `56y` stamps come from the stub, as in the round-1 set.
