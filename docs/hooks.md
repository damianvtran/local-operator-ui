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

**The subject is the ref being pushed, not `HEAD`.** Git writes the refs it is
about to push to the hook's stdin (`<local ref> <local sha> <remote ref> <remote
sha>` per line) and that is what this gate classifies — so a push of the branch you
are on is judged against the commit it carries, and a push of anything else is
refused (see below) rather than judged against whatever `HEAD` happens to be.
`--ref <sha>` is the by-hand spelling for a checkout with no push in flight.

**And the gate only speaks when it is reading exactly what is being pushed.** The
legs run the repository's own tools over **files on disk**, so anything that would
make those files something other than the pushed blobs is refused, loudly, rather
than judged:

- **A subject other than the checked-out `HEAD`** — a foreign branch, a tag, or an
  **ancestor of `HEAD` whose files the working tree has since changed**. An
  ancestor looks safe (the checkout carries it) and is not: pushing an old commit
  while the worktree holds its fix reported "lint (scripts/) passed" for content
  the gate never examined. Only the commit the checkout *is* can be judged from
  disk.
- **A file a leg would read that has uncommitted edits.** biome and `tsc` would
  judge the worktree's copy while the push carries the committed blob — a verdict
  about somebody else's bytes, in *either* direction, so it refuses and names the
  files. `pnpm check-changed` and `pnpm lint:scripts` are the spellings that see
  uncommitted work.

  **This refusal is deliberate and settled, not a rough edge awaiting a softening.**
  It was weighed against a warning, and a warning is the same defect in a quieter
  voice: it still prints a green over bytes nobody pushed. The refusal names the
  files, never suggests `--no-verify`, and offers `PREPUSH_BYPASS="<reason>"`. The
  cost — the scope is the branch's whole delta, so one work-in-progress edit blocks
  every push until it is dealt with — is answered by `git stash`, and that is the
  answer rather than a downgrade of the check.
- **A stdin that exists but cannot be read.** git wrote refs this gate could not
  read, so it does not know what is being pushed; it does not fall back to `HEAD`.
  (A terminal, or a pipe with nothing in it, is the by-hand case, and that *is*
  answered as "check `HEAD`", saying so.)

One deliberate asymmetry, said rather than discovered: **the `scripts/` leg ADDS
files instead of substituting them.** It is `scripts/check-scripts-lint.mjs`, the
repository's worktree-scoped ratchet — the same spelling `pnpm lint:scripts` runs —
so it also lints *untracked* scripts. Those can only add files to the check, never
remove one: they can refuse about a file you have not committed, and can never
pass about a file you are pushing.

The two positional arguments git appends to a pre-push hook (the remote's name and
URL) are **accepted and ignored**, and more than those two is refused rather than
dropped. This is not decoration: an earlier revision forwarded them into the
gate's parser, which threw on them, so every push from a correctly wired clone was
refused with `unknown argument 'origin'` — the failure mode this whole gate exists
to remove, in the gate itself.

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

The gate's own contract is `scripts/pre-push-gate.test.mjs`, run inside
`pnpm test:desktop`. Its fixtures carry the REAL hook, the REAL dispatcher, the
REAL gate and the REAL classifier, copied from the checkout under test, and push
for real: a stub standing in for the hook is what let a gate that refused every
push pass a green suite once already.

This is a macOS/Linux gate: the tracked hook is a `#!/usr/bin/env node` script, so
a Windows checkout without a Node-aware hook runner is not gated. Say so rather
than assuming it is.

## Wiring, and what happens in a fresh worktree

```sh
pnpm install            # runs `prepare` -> node scripts/hooks-install.mjs --tolerate-failure
pnpm hooks:install      # the same thing, run by hand, strict: exit 1 when it cannot wire
pnpm hooks:check        # read-only: are pushes from this clone gated?
```

`prepare` passes `--tolerate-failure` on purpose: **an install must never be broken
by a hook helper.** A wiring that cannot be verified still says so loudly (the
warning names exactly what is not gated) but does not fail `pnpm install`; the
`hooks:install` and `hooks:check` spellings are the ones that exit non-zero.

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

Three details of the wiring that are there for a reason:

- **The config is written to the LOCAL scope explicitly** (`git config --local`). A
  bare `git config` writes wherever the ambient configuration points, so a nested
  checkout under a rig's `GIT_CONFIG_GLOBAL` could set the OUTER repository's
  `core.hooksPath` and gate a repository nobody was working in.
- **A `core.hooksPath` configured elsewhere is named, not replaced in silence.**
  The local value wins; the warning says which value it superseded.
- **`.git/hooks/pre-push` being disowned is said out loud.** git ignores the hooks
  directory entirely once `core.hooksPath` is set, so an existing hook there is not
  chained, it stops running; the warning names the file and says to move it into
  `.githooks/` if it still needs to run.

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
and it is only for a leg that could not run — never for one that failed. **It is
not a per-leg skip: it skips EVERY leg at once**, so the push it admits is
ungated end to end. The banner says so and names each leg it dropped, because the
failure mode this variable's wording caused was a report that read as "only the
`tsc` leg was skipped" when the `scripts/` and `biome` legs went unrun with it —
so the PR carries the equivalent runs and the reason, never a claim that the one
missing leg was the only thing bypassed. A reason
is required in both places: whitespace-only is refused rather than treated as a
bypass, because a bypass nobody had to think about is not a disclosure.

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
