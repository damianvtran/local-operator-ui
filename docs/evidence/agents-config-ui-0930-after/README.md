# Agents/Teams overhaul — after frames (scratch, not for `main`)

Eight frames of the REAL app (built from `feat/agents-config-ui-0930`) against a
REAL isolated `lop serve` v0.64.9 on a scratch `HOME`/config root, captured over
the DevTools protocol from the app's own renderer (`Page.captureScreenshot`).
No window was shown and nothing was focused at any point.

Rig: a scratch script (not committed) that launches the built app with
`--window-mode=headless --use-mock-keychain --password-store=basic`, a private
`--user-data-dir`, a scratch `HOME`, `CMUX_*`/`LOP_*` stripped, and a scratch
cwd whose `.env` points the app at the isolated daemon rather than the
operator's own. Processes were reaped by pid.

| frame | state |
|---|---|
| after-01-agents-empty | nothing selected: the composer leads, `Add agent manually` below it |
| after-02-detail-read | a built-in's read view: prose, chips, bounded instructions, one primary action |
| after-03-detail-edit | Edit mode: structured sections, effort/tools controls, pinned Save/Cancel |
| after-04-detail-dirty | a dirty draft (Unsaved changes) |
| after-05-discard-confirm | Escape on a dirty draft: the discard confirmation |
| after-06-teams-empty | Teams empty state |
| after-07-team-create | the manual team form, with the composer held ("finish or cancel your edit first") |
| after-08-team-detail | `release-crew` created through the form and read back |

The "before" set is the design consult's 76 PNGs in the designer session's
scratchpad (`~/.local-operator/sessions/5351fc35e2b0/scratchpad/frames/`), taken
against `origin/main` = `9dd18ab318`.

**What these frames show about Scope B:** the composer is DISABLED, with the
page's own sentence "Ask for this change needs a newer backend." — the
capability gate (`agents_config`) working against a backend that does not
advertise it. The run itself cannot be exercised until the core sibling change
lands.
