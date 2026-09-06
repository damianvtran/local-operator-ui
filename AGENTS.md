# AGENTS.md

This file defines project-specific operating guidelines for AI coding agents working in this repository.

## Repository Context

- Project: `local-operator-ui`
- Stack: Electron + React + TypeScript, **Tailwind v4 + shadcn** (migrating off MUI 6 + Emotion)
- Primary branch for releases: `main`
- Version source of truth: `package.json` (`version`)
- Release tag format: `v<semver>` (example: `v0.12.8`)
- Package/build tooling: `pnpm` scripts in `package.json`

## General Project Guidelines

- Keep changes scoped to the requested task; do not refactor unrelated areas.
- Do not revert or overwrite user changes that are outside your task.
- Prefer small, explicit commits with clear conventional-style messages.
- Before finalizing, run the narrowest relevant checks for touched code.
- Follow existing code style and project conventions (Biomes/TS settings already configured).
- No emojis in code, comments, UI copy, or commit messages.

## Design and branding — read before any visual change

**`docs/branding.md` is the design contract.** Read it before changing any
visual surface, and read § 7 before touching anything that renders agent
output. The short version of the parts most often got wrong:

- **Name roles, never colours.** `bg-surface`, `text-ink-muted`,
  `border-control` — never a hex, never `theme.palette.*` in ported files. If a
  value maps to no role, the system is missing one; add it to the contract
  rather than working around it.
- **Twelve themes are user-selectable.** A "Dracula" theme is a promise to a
  user, so the brand ports as roles with contrast floors, not as brand green
  applied everywhere. Only the two `localOperator*` palettes are the brand.
- **`hairline` vs `border-control`.** Decorative rules vs the sole boundary of
  a control. The second has a 3:1 floor; conflating them is how the app once
  shipped inputs bounded at 1.25:1.
- **Elevation is a lightness step, not a shadow.** One shadow exists, only for
  things that leave the flow (menu, dialog, drawer, popover, tooltip, select).
- **Disabled changes colour, never opacity. Focus is `outline`, never
  `box-shadow`** — this app is mostly scroll containers, and box-shadow rings
  get clipped by `overflow: hidden`.
- **Nothing lifts, scales or translates on hover.** Hover is a colour step.
- **Agent output has a hierarchy** (§ 7): a question for the user is the most
  prominent thing on screen; internal reasoning is hidden by default. A
  completed action is one quiet line, not a card.
- Sentence case everywhere. Monospace is machine voice only.

### Where colour comes from

One source, two consumers. `shared/themes/palettes/*.ts` holds twelve
`ThemePalette` objects; MUI consumes them as hex (≈299 `alpha()` call sites
cannot take a `var()`), and Tailwind consumes CSS variables generated from the
same objects. After editing any palette run `pnpm gen-themes`, and never
hand-edit `styles/themes.generated.css`.

`pnpm check-themes` enforces both freshness and the contrast floors, asserting
over component triples (ground + fill + border + ink) rather than token pairs.
**Adding a component with its own fill and border means adding a row to
`CONTROLS` in `scripts/contrast-contract.mjs`** — green output about a
component nobody listed is not evidence about that component.

### One trap worth knowing

Always route `className` through `cn` from `@shared/lib/utils`. It registers
our custom scales with `tailwind-merge`; without that, a type step and an ink
role in the same call collide and one is dropped **silently** — the component
still looks right because colour inherits from `body`, until it renders on a
ground where it does not.

## Useful Commands

- Install deps: `pnpm install`
- Dev app: `pnpm dev` (needs `.env`; copy from `.env.template`)
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Typecheck: `pnpm check-types`
- Build: `pnpm build`
- Theme gates: `pnpm check-themes` (freshness + contrast floors)
- Regenerate theme CSS: `pnpm gen-themes`
- Bundle size: `pnpm bundle-size`, `pnpm startup-closure`
- Component gallery: `pnpm storybook`

`pnpm test:desktop` runs focused desktop transport/security contract checks with
Node's built-in runner. It bundles the actual TypeScript modules in memory and
uses real loopback HTTP; its Electron IPC fixture is not native-app or visual
proof. Broader verification remains typecheck, lint, the theme gates, a real
build, and rendered evidence from the live app or Storybook as appropriate.

## Release Bump Runbook (Major/Minor/Patch)

Use this process whenever asked to cut a release.

1. Preflight
- Confirm you are on `main`: `git branch --show-current`
- Check working tree: `git status --short --branch`
- Sync refs/tags: `git fetch --tags origin`

2. Determine new semver
- Current version: `node -p "require('./package.json').version"`
- Bump rule:
  - Patch: `X.Y.Z -> X.Y.(Z+1)`
  - Minor: `X.Y.Z -> X.(Y+1).0`
  - Major: `X.Y.Z -> (X+1).0.0`

3. Update version
- Edit `package.json` version to the target release version.
- Verify: `node -p "require('./package.json').version"`

4. Commit and push branch
- Commit message format:
  - `chore(release): bump version to <version>`
- Commands:
  - `git add package.json`
  - `git commit -m "chore(release): bump version to <version>"`
  - `git push origin main`

5. Create and push tag
- Annotated tag:
  - `git tag -a v<version> -m "v<version>"`
  - `git push origin v<version>`

6. Review diff vs previous tag
- Previous tag: `git describe --tags --abbrev=0 v<version>^`
- Commit range: `git log --oneline <prev_tag>..v<version>`
- File/stat summary: `git diff --stat <prev_tag>..v<version>`

7. Review prior release style
- Inspect recent releases:
  - `gh release list --limit 5`
  - `gh release view <prev_tag> --json name,tagName,body,publishedAt`

8. Draft release notes (match existing template)
- Use this structure:

```md
## What's New

<1-2 sentence summary>

- **<Change Area>**: <description>
- **<Change Area>**: <description>

## Impact

- **No Breaking Changes**: <or explicitly call out breaking changes>
- **<User/Developer Impact>**: <description>

## PRs
- Direct commits included in this release range:
  - `<short_sha>` <commit subject>
  - `<short_sha>` <commit subject>

**Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/<prev_tag>...v<version>
```

9. Create GitHub release with gh CLI
- `gh release create v<version> --title "<release title>" --notes-file <notes_file>`

10. Post-release verification
- Confirm release exists: `gh release view v<version> --json url,name,tagName,publishedAt`
- Confirm branch/tag pushed:
  - `git ls-remote --heads origin main`
  - `git ls-remote --tags origin v<version>`

## Notes for Future Agents

- If the user asks for a release bump, execute the full workflow end-to-end unless told otherwise.
- If there are unrelated uncommitted changes, do not discard them; proceed carefully and scope your commit.
- Keep release notes aligned with prior repository style and include a compare-link changelog.

## Who may merge: agent review is sufficient for a code owner

Code owners are listed in `.github/CODEOWNERS`. **This repository has no
ruleset requiring an approving review**, so there is no approval gate to clear
here — `CODEOWNERS` routes review requests, it does not block merges. The rule
below is therefore about what makes a merge *legitimate*, not about what the
forge will let through.

When the agent is **acting for a code owner** — running on a code owner's
machine and under their account, which is the normal case here — the standing
agent review gate is what authorizes the merge. A clean, fresh, independent
agent review round plus green CI is sufficient; do not wait for a second human
to click approve. Nothing here is permission to merge on a *weaker* basis than
that just because the forge would allow it: with no ruleset in the way, the
agent review round is the only real control this repository has.

If a code-owner ruleset is ever enabled here, read the backend's
`AGENTS.md` § "Who may merge" first — it documents a self-approval limitation
that bites the moment such a rule exists.

This is a statement about *authority*, not about rigour. Every requirement
still holds in full: an **independent** reviewer subagent (never the agent that
wrote the code), rounds repeated until no blocker or major remains, review
freshness against the current head, QA evidence from the real running surface,
and a design/UX round for anything user-visible — which, in this repository, is
most changes. Merging is authorized by the review being genuinely clean, never
by the merger being entitled to it.

Two things this does not license:

- **Never approve your own work to satisfy the rule.** The author and the
  reviewer must be different agents. GitHub cannot tell them apart, because
  every agent here pushes as the same account — so this separation is a
  discipline the agents keep, not one the forge enforces.
- **`--admin` stays a last resort, and stays disclosed.** If a bypass is ever
  genuinely necessary, say plainly on the PR and in the release notes that the
  merge bypassed rather than cleared review. A tag that implies a review it
  never had is the failure this section exists to prevent.

An agent that is **not** acting for a code owner prepares the PR, records the
review rounds, and hands it to an owner to merge.
