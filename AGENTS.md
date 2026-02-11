# AGENTS.md

This file defines project-specific operating guidelines for AI coding agents working in this repository.

## Repository Context

- Project: `local-operator-ui`
- Stack: Electron + React + TypeScript
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

## Useful Commands

- Install deps: `pnpm install`
- Dev app: `pnpm dev`
- Lint: `pnpm lint`
- Lint fix: `pnpm lint:fix`
- Typecheck: `pnpm check-types`
- Build: `pnpm build`

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
