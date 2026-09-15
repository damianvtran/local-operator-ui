<!--
RELEASE NOTES TEMPLATE. GitHub has no native release template, so this is a file a
person copies and edits outside the repository:

    cp .github/RELEASE_TEMPLATE.md /tmp/vX.Y.Z.md
    $EDITOR /tmp/vX.Y.Z.md          # fill in the placeholders, delete this block
    gh release create vX.Y.Z --target "$MERGE_SHA" --prerelease \
      --title 'X.Y.Z: <theme>' --notes-file /tmp/vX.Y.Z.md

RULES, and they are enforced rather than advisory:

1. THESE NOTES ARE WRITTEN BY HAND. Never `gh release create --generate-notes`,
   and never the web UI's "Generate release notes": GitHub's draft is refused by
   `scripts/release-state.mjs` before anything is built (its heading,
   `## What's Changed`, is what the gate matches). A release whose body is empty
   is refused the same way. Both refusals are recoverable without re-releasing:
   edit the Release body, then re-run the failed run - the re-run replays the
   release event and the script re-reads the Release, so the corrected body
   passes. A fix to the workflow's own code is NOT picked up by a re-run.
2. EVERY PULL REQUEST IN THE WINDOW APPEARS UNDER `## PRs`. The window is the PRs
   merged since the previous tag; derive it from the commits, not from the commit
   shape:

       git log --first-parent --oneline v<PREV>..origin/main
       gh pr list --state merged --limit 60 --json number,title,mergedAt,mergeCommit

   `--merges` is the wrong form and is not a shortcut: this repository's merge
   button produces a merge commit that `--merges` sees, while a squashed PR is a
   single-parent commit that it silently drops - so a wrong window is not empty,
   it is partially listed, and a partial window looks right.
3. `## What's New` states what the version does FOR A USER, in prose. No commit
   subjects and no PR numbers in that section - the numbers belong under
   `## PRs`, the subjects are quoted there verbatim, and each bullet carries the
   constraint or trade-off worth knowing rather than the change alone.
4. KEEP THE COMPARE LINK. `**Full Changelog**: ...compare/v<PREV>...v<NEW>` is the
   only part of this file that can be derived, and a body carrying neither it nor
   a `## What's New` heading is reported as an annotation (not a refusal) so the
   omission is visible on the run page.
5. DELETE THIS COMMENT BLOCK before you pass the file to `gh`. It is a comment
   rather than prose, so a forgotten one renders as nothing - but the raw body
   would still carry the rules, and the raw body is what the Release shows to
   anyone reading the JSON.
-->

## What's New

<REPLACE WITH 2-4 SENTENCES OF PROSE: what this version does for a user, in the
repo's own voice. Names the theme of the window - the one thing that changed how
the app feels - and then the smaller changes ride the bullets below.>

- **<theme>**: <what changed, and what a user can now do instead> - <the
  constraint or trade-off worth knowing: what was deliberately left out, what the
  limit is, how it behaves in the case that fails>.
- **<theme>**: <change> - <constraint>.

## Impact

- **No breaking changes.**
<!--
  Or, when something does break:
- **Breaking:** <what breaks, for whom, and what to do about it>.
-->
- <upgrade consequences worth knowing: what happens on the first update, what is
  rebuilt, what a user may have to redo>.

## PRs

- #<N> `<subject as merged>` - merge `<merge sha>` - `Release: <patch|minor> - <the one-line impact the author claimed, verbatim>`

**Full Changelog**: https://github.com/damianvtran/local-operator-ui/compare/v<PREV>...v<NEW>
