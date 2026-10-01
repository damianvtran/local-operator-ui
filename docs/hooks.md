# Local Operator UI — git hooks

This repository gates a `git push` on a delta-scoped check of the commit you are
pushing. The gate is `.githooks/pre-push` (tracked, reviewable) and it is wired
into this clone's git config by `scripts/hooks-install.mjs`.

## Why

Two failures motivated it. First, the cheap local mistakes — a formatter diff, an
import that TypeScript rejects — cost a pipeline run to find, and nothing told the
pusher about them before the push. Second, the same fleet that needed the gate
also produced four *disclosed* bypasses in one night, every one of them a hook
that could not finish inside this host's memory budget. A gate that cannot run
and a gate that does not exist fail the same way, so the cost of this one is
bounded by the diff and the escape hatch is a sentence rather than a silent flag.

## What the hook runs

| Leg | Command | Scope |
| --- | --- | --- |
| Lint, `scripts/` | `node scripts/check-scripts-lint.mjs --since <base>` | the `scripts/` files this change touches |
| Lint, `src/` and `bin/` | `node_modules/.bin/biome check --reporter=json <files>` | the changed files themselves |
| Types | `node_modules/.bin/tsc --noEmit -p tsconfig.node.json`, then `tsconfig.app.json` | the whole project — see below |

Which legs apply is not decided here: `scripts/ci-scope.mjs` — the same module the
`Change Scope` CI job and `pnpm check-changed` run — classifies the diff, and the
gate runs the legs its flags select. A prose-only diff runs nothing.

The types leg is the exception to "cost proportional to the diff" and it is kept
anyway, deliberately: TypeScript has no per-file mode, so this leg costs the tree.
It therefore runs only when a diff touches a TypeScript file, and its two projects
run **serially** — two concurrent `tsc` processes are what the memory budget on
this host cannot absorb.

## What the hook deliberately does NOT run

CI remains the authority. The gate does not run the desktop suite, `pnpm build`,
the pack/npx launch, the audit, or the runtime-dependency allowlist: none of them
is delta-scoped, and the desktop suite alone is a 345-file run. A green push means
"the cheap local mistakes are absent", never "this is tested". `node
scripts/ci-scope.mjs --since "$(git merge-base origin/main HEAD)" --run` is the
spelling of everything the classifier selects; `scripts/ci-scope.mjs` prints what
it deliberately excludes locally and why.

Measured wall time and peak RSS are recorded in `AGENTS.md`, *The pre-push gate* —
and as of 2026-10-01 they are recorded there as NOT RUN, because the host was
below the fleet's floor when this landed. The commands are in that section; do not
quote a number this file does not carry.

This is a macOS/Linux gate: the tracked hook is a `#!/usr/bin/env node` script, so
a Windows checkout without a Node-aware hook runner is not gated. Say so rather
than assuming it is.

## Wiring, and what happens in a fresh worktree

```sh
pnpm install            # runs `prepare` -> node scripts/hooks-install.mjs
pnpm hooks:install      # the same thing, run by hand
pnpm hooks:check        # read-only: are pushes from this clone gated?
```

`hooks-install.mjs` creates `<common git dir>/lop-hooks/pre-push` and points
`core.hooksPath` at it. The path is **absolute** and lives in the clone's *shared*
git directory, so one install wires every worktree of that clone; a relative
`core.hooksPath` is resolved against the working directory, and a path that does
not resolve is skipped by git in silence.

That dispatcher runs the gate **the current worktree carries**. A worktree whose
branch predates `.githooks/pre-push` is therefore *refused*, loudly, naming how to
fix it — it does not push ungated. This is the state the fleet hit: a worktree with
no hook directory, a `core.hooksPath` pointing at nothing, and a push that ran no
check while reporting no problem.

## When a leg cannot run: never `--no-verify`

If a leg cannot run in your environment — no `node_modules`, a memory budget that
will not take a `tsc`, an unbuilt worktree — do not push with `--no-verify`, which
is indistinguishable from "the gate ran and passed" in every log that follows.

Run the equivalent legs **by hand** and record that you did, in the PR:

```sh
node scripts/check-scripts-lint.mjs --since "$(git merge-base origin/main HEAD)"
node_modules/.bin/biome check <changed files>
node_modules/.bin/tsc --noEmit -p tsconfig.node.json
node_modules/.bin/tsc --noEmit -p tsconfig.app.json
```

`PREPUSH_BYPASS="<reason>"` is the disclosed form of a bypass: it prints a banner
naming the reason on the push itself, and it exists so the disclosed path is
cheaper than the silent one. It is honoured by both the dispatcher and the gate,
and it is only for a leg that could not run — never for one that failed.

A worktree with no `node_modules` needs none installed: the fleet convention is to
link the primary checkout's tree —

```sh
rm -rf node_modules && ln -s ../../node_modules node_modules   # from the worktree root
```

— which works when the worktree sits at `<repo>/.worktrees/<name>`; a sibling
worktree (`../<repo>-<name>`) resolves outside the repo, so clone it instead:
`cp -Rc <checkout>/node_modules <worktree>/node_modules`.

## What this cannot see

- Pre-existing violations in files a change does not touch, and the whole-tree
  lint backlog in `scripts/` — that burn-down is `scripts/check-scripts-lint.mjs`'s
  ratchet, and this gate is the same ratchet.
- Anything about behaviour. No test runs here.
- A stale `core.hooksPath` in a *second clone*: this gate wires the clone it runs
  in, and nothing installs itself into another.
- The types leg may be incremental in a shared `node_modules`: `tsconfig.*.json`
  writes its build info to `node_modules/.tmp/`, which an agent worktree links to
  the primary checkout's, so two worktrees can share incremental state.
