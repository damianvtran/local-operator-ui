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

## Targeted test evidence

Paste the `pnpm test:affected --run --evidence` block, re-run on the current head.

- Range: `<base-sha>..<head-sha>`
- Command(s): the exact commands, including any extra tests and any exempt `pnpm test:*` the helper named
- Result: the actual pass/fail counts and wall time for each command
- Not run, and why: UNREACHED or BROAD paths, and exempt tests you skipped
- Merge gate: `Merge gate (full suite)` — the full suite's one run — is green on the
  head this PR merges at, or this line names why it is not armed yet. It starts
  when `ready-to-merge` is added to a clean, final head (`pnpm merge-gate <n>`);
  a push after it ran strands the check on the old SHA, so re-arm. Do not paste a
  local full-suite run here: that suite is not run locally.

## Checklist

- [ ] My code follows the style guidelines of this project.
- [ ] I have performed a self-review of my code.
- [ ] I have added tests that prove my changes work as intended.
- [ ] The gates pass: `pnpm lint`, `pnpm check-types`, `pnpm check-themes`.
- [ ] Targeted tests pass, recorded below on the current head: `pnpm test:affected --run --evidence` plus the callers and neighbours I judged it missed. I did not run the full desktop suite locally; it runs on `main`, nightly, and once at this PR's merge gate.
- [ ] The merge gate is armed on the FINAL head: review rounds clean, then `pnpm merge-gate <n>` added `ready-to-merge` and `Merge gate (full suite)` is green there. Any later push needs the ritual again (see AGENTS.md, "The merge gate (full suite)").
- [ ] This PR does not change the `version` line in `package.json` — only a `chore(release):` PR may, and the release owner cuts that one.
- [ ] If this PR touches `docs/evidence/manifest.json` or changes files under `src/` or `scripts/`, it joins the serialized fold window (see AGENTS.md).
- [ ] I have updated the documentation when required.
- [ ] Security considerations are addressed (especially for code execution features).
- [ ] I have linked all related issues.

## Screenshots (Optional)

If applicable, please attach screenshots that illustrate the changes or new features.
