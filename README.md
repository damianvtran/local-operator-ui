# First-run onboarding — before/after frames (desktop)

Evidence for the PR from `feat/first-run-onboarding` in `damianvtran/local-operator-ui`
(PR #899). These files are **not in that PR's tree**, per AGENTS.md; they live on
this branch and the PR body links to them with `?raw=true`.

- `before/` — a base worktree at `15a7a4ed522` (origin/main).
- `after/` — the PR head `3aa857e`.
- Each `<name>.png` has a `<name>.json` beside it: the geometry read out of the
  same live render, in the shape the design rounds here use (viewport, per-element
  box, border/padding/radius/background, `scrollHeight` vs `clientHeight` and a
  `clipped` flag, plus the transcript's record rows as `{id, kind, height}`).
- `readings-before.json` / `readings-after.json` — the one-line-per-frame summary
  (clipping flags, the installer's status text, the transcript's row kinds).
- `INDEX.md` — what each frame shows, the measured install timings, and the
  commands that produced both.

Readings list **visible elements only** (a box with no width or height is
dropped), because Storybook keeps its own error-display template in the
document — hidden, at zero size — and its list items would otherwise appear in
the installer rail's readings. The rule is stated here rather than applied
silently: a reader can see that `installRailRows` is the rail's four real steps.

Stand-ins, stated: the frames are the components mounted alone in Storybook (no
backend, no OS window chrome). The installer frames are the real `InstallPanel`
as a function of the view, at the installer window's own 640x480 — not a
photograph of the setup window on screen. The provider grid is driven by the
first-run census fixture (`scripts/fixtures/auth-providers-first-run.json`, 18
rows) through a stubbed desktop bridge, which is what the design rounds use.
The two greeting frames feed one real history page through the real reducer and
the real transcript; the only difference between them is `details.hidden`.

Not framed, and this is QA's pass rather than a gap this branch can close: the
live app's skip path, the 409 `aida_no_provider` landing, and a real greeting
delivery (which needs the backend lane runnable plus a provider configured).
