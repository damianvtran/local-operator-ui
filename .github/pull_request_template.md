# PR Description

## Summary of Changes

Provide a brief overview of the changes introduced in this PR.

- What does this change address (e.g., bug fix, new feature, refactoring)?
- What are the key improvements or modifications?

<!-- Every PR carries exactly one Release line for the release owner to
     aggregate. Keep the shape: the literal word `Release:`, then `patch` or
     `minor`, then the user impact after the em dash. `patch` is the default;
     `minor` needs to be a step-function capability namable in the release title.
     Do NOT bump the version in package.json for it — the release owner does that,
     once per window. See AGENTS.md, "Releasing: one owner per window, and no
     version bumps inside feature PRs". -->

Release: patch — <one-line user impact>

## Related Issue(s)

Link any related issue or feature request (e.g., closes #123):

- Related: #...

## Impact

Describe the impact of these changes on the codebase:

- Does this change introduce any breaking changes?
- Are there any dependency updates?
- Are there any performance or security implications?

## Testing Details

- How were these changes tested?
- What specific scenarios were validated?
- Mention any automated tests that were added or updated.

## Checklist

- [ ] My code follows the style guidelines of this project.
- [ ] I have performed a self-review of my code.
- [ ] I have added tests that prove my changes work as intended.
- [ ] The gates pass: `pnpm lint`, `pnpm check-types`, `pnpm check-themes`, `pnpm test:desktop`.
- [ ] This PR does not change the `version` line in `package.json` — only a `chore(release):` PR may, and the release owner cuts that one.
- [ ] I have updated the documentation when required.
- [ ] Security considerations are addressed (especially for code execution features).
- [ ] I have linked all related issues.

## Screenshots (Optional)

If applicable, please attach screenshots that illustrate the changes or new features.
