# The before half: a not-answering row drawn as a failed one

`wedged` and `error` rendered **byte-identically** before this change — the same
`CircleAlert` in the same `text-danger` — and the row's tooltip carried no remedy.
This set is those two states on the tree the branch was cut from, under the
branch's own stories and fixtures, so the pair is visible rather than asserted.

## What is here, and where its other half lives

| Directory | Story | Its after half |
|---|---|---|
| `chat-sidebar-status-feed/wedged-owner/` | the sidebar, with a not-answering row and a failed row directly under it | `chat-sidebar-status-feed/wedged-owner/` |
| `chat-session-status/neighbours/` | the specimen matrix, every code twice beside its own name | `chat-session-status/neighbours/` |

All twelve sweep themes in both directories, at the same viewports as the after
frames. The two halves differ only in `chat-session-status.tsx` (the glyph and
the ink) and `chat-sidebar.tsx` (the tooltip clause).

## How it was taken

`scripts/capture-evidence.mjs http://localhost:<port> --only=<story> --allow-backend`
on this worktree **before the first source edit**, i.e. against unmodified
`origin/main` — the branch is cut from that commit, so no detached worktree was
needed. `chat-sidebar-status-feed/wedged-owner/` had to be captured here rather
than copied from a committed frame: the story is new on this branch, so `main`
has no frame of it. `chat-session-status/neighbours/` is the frame committed on
`main`, copied verbatim — re-capturing it would have produced the same bytes.

`--allow-backend` is the documented opt-in for a machine where the operator's own
backend answers on the configured port. None of these stories talks to it: the
feed story stubs the transport below `useDesktopFeed`, and the specimen renders
the component over built rows.

## The words are in the frames

The row tooltip is a native `title`, which is not photographable, and the remedy
clause this change adds lives in it. So the feed story's readout prints each
on-screen row's **composed tooltip**, read off the document — `Row tooltips: …`
in the caption — and the before frames show the string without the clause. That
line is measured from the DOM rather than rebuilt from the store for the same
reason the readout's other measured lines are: a caption that re-implemented the
expression could agree with itself while disagreeing with the screen.
