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

---

## Scope B — the configuration run, end to end (frames `scopeB-*`)

These six come from a DIFFERENT, second rig run, and the difference is the
point: they were taken against a backend that HAS the feature. The backend is an
isolated `local_operator.cli serve` run from the core tree at the merge of
`damianvtran/local-operator#1819` (`feat/agents-config-run-0930`, built from the
core worktree) on its own scratch `HOME`/config root — never the operator's
daemon, which keeps its own port and was not touched. The app is the same build
of this branch, headless, private profile, `--use-mock-keychain`, `CMUX_*`/`LOP_*`
stripped, reaped by pid, and the run's model is the deterministic mock
(`hosting: test`, `model_name: mock-model`), written through the app's own
settings bridge rather than by hand.

The frames `after-*` above were taken against the INSTALLED runtime
(`lop serve` v0.64.9), which does not advertise `agents_config` — so they show
the page with the composer correctly disabled and its "needs a newer backend"
sentence. Both sets are real; they are two supported backends, not two takes of
one.

| frame | state | what it shows |
|---|---|---|
| scopeB-01-composer-enabled | idle | all four capability keys present: the composer is live, with its example chips and the "does not appear in your conversation" line |
| scopeB-02-request-typed | typing | the request as typed |
| scopeB-03-running | running | the strip: state dot, "Working on your request", elapsed, Stop |
| scopeB-04-settled | done | "Finished without changing anything" + "The run answered without changing any agent or team." (the zero-touched case, said honestly rather than as an empty changelist) |
| scopeB-05-stopped | stopped | Stop pressed while the turn was live: "Stopped. Changes it had already made were kept." |
| scopeB-06-error | error | hosting cleared, so the backend refuses the turn: its own sentence, plus "Nothing else was changed by this run." |

Readings taken beside the frames, from the same page: the run's session id never
enters the chats list (0 chat rows before and after every send), and the sidebar
never shows the requested agent's name — the run is not a conversation the app
lists.

**Not exercised by these frames**: a run that actually WRITES a definition. The
deterministic mock provider can emit text and an `echo` tool call and nothing
else, so no `agent`/`team` tool call can be produced from it; the summary's rules
for created/updated/read-only-touched are pinned instead by
`scripts/agents-config-summary.test.mjs` (which is what found the read-vs-write
defect in the touched set).
