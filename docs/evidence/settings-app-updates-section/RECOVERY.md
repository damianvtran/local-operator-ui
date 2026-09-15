# PR #172 recovery: rebase continuity

Recovered from `238c2162c6b4f5e0222b67a1d070cf2ef6dbea8c`, based on
`142e869045508a258df2bd0ccae28c2f60c306c2`, onto fetched main
`915928a18a1d55fbe501c41cf6f68e6b8daa60ad`. The six-commit replay ends at
`572fe707ec9c4fbc9ad4412ad5c82e1a32c7a3ba`. Recovery changes only evidence
provenance after that replay. `package.json` remains main's `0.22.3`.

## Conflicts and limits of equivalence

Only `docs/evidence/manifest.json` conflicted, in the stamp/header blocks of
`bb55f4608` and `238c2162c`. The intermediate replay retained upstream's header;
the later capture commit restored this PR's capture header. This leaves that
capture's provenance intact but its source-tree stamps and rebased citations
stale. The recovery documentation commit repairs those fields explicitly; it
does **not** claim to have captured new frames.

Main's 27 supplementary sets survive unchanged. Its browser namespace additions
in both preload files auto-merged without conflicts. No code from unmerged
PR #174 was incorporated.

```sh
git range-diff 142e86904..238c2162c 915928a18..572fe707e
```

Result: four `=` pairs (implementation `e23f9dfd2`, first evidence `7394ba77d`,
R1 remediation `dbf911bdb`, citation documentation `48d9803cf`); two `!` pairs
(`bb55f4608`, `238c2162c`), solely the manifest conflict resolutions above.
The final manifest at `572fe707e` equals the original `238c2162c` manifest;
its diff against the new base differs because main changed its own stamps.
There is no claim that the entire six-commit range is `=`.

For each file, compare sorted added/deleted lines from `git diff --unified=0`
(exclude the `+++`/`---` file headers) in the two ranges above. All 14 text files
outside the manifest match byte-for-byte, including **every src/scripts file**.
All six WebPs match in bytes (`git diff 238c2162c 572fe707e --
'docs/evidence/**/*.webp'` is empty). Documentation provenance is the only
intentional exception after replay.

## Why existing frames remain applicable

An esbuild import-closure probe of
`src/renderer/src/features/settings/components/app-updates-section.stories.tsx`
with `bundle:true`, `write:false`, `metafile:true`, `format:"esm"`,
`platform:"browser"`, `packages:"external"`, and `tsconfig:"tsconfig.app.json"`
finds **55 local inputs**. Intersecting those paths with
`git diff --name-only 142e86904 915928a18` returns **[]**. The update story and its
entire local renderer import closure are unchanged by upstream, as are the
capture implementation and dependency lockfile. No Storybook rebuild or capture
was necessary for this rebase. This is source continuity plus unchanged existing
frames, **not** a new native Electron or browser end-to-end pass. During recovery
the existing 900×460 light before/after pair and both all-current palettes were
opened as images: the contradictory green toast is replaced by the server-offer
info toast, and both all-current frames show the application-and-server sentence
without an offer. Their geometry was not re-measured in a live page.

The prior capture at `48d9803cf` is mapped by the `=` range-diff pair to
`8dc25c727`; the manifest's capture citations use that reachable replay while its
original capture timestamps remain unchanged. Its top-level head/tree stamps
name `572fe707e`, whose src/scripts trees the docs-only repair does not change.
Older capture notes remain explicitly historical.

Count verification: **1507** WebPs total, **339** inside **28** supplementary
sets, **1168** swept; **163** capturer entries (main's 161 plus this PR's two),
**12** themes. This PR adds six frames, not the session-switch frames already
on main.

## Recovery verification

Executed serially with `LOCAL_OPERATOR_UI_TEST_CONCURRENCY=2`, `TERM=xterm-256color`,
`NO_COLOR`/`NODE_TEST_CONTEXT` removed, and every inherited `CMUX_*` removed.
This is the desktop TypeScript repository: its pnpm/Node gates, not the backend
repository's Python lint/unit commands, apply here.

| Command | Actual result |
| --- | --- |
| `pnpm lint` | exit 0; 502 files, 33 existing warnings, no fixes |
| `pnpm check-types` | exit 0; main and renderer |
| `pnpm check-themes` | exit 0; generated CSS current, 2303 assertions / 12 themes |
| `pnpm check-runtime-deps` | exit 0; 6 runtime dependencies on allowlist |
| `node scripts/check-vendored.mjs` | exit 0; 7 files match provenance |
| `pnpm test:desktop` | exit 1; 937 tests, 936 pass, 1 fail, 0 skipped; 142.14s |
| `pnpm check-evidence` | exit 0; all 1507 frames pass, worst ΔE00 18.1 |
| `pnpm build` with inert OAuth fixtures | exit 0; main/preload and renderer built; renderer 14.14s; existing chunk-size warning |

The first plain `pnpm build` exited 1 before compilation because
`VITE_GOOGLE_CLIENT_ID` was absent. The successful build explicitly set
`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`, `VITE_MICROSOFT_CLIENT_ID`,
and `VITE_MICROSOFT_TENANT_ID` each to `pr172-build-only-not-a-credential` in the
child environment. No credential file was created or read, and no OAuth sign-in
is claimed. `out/` now contains that local validation build, not a release build.

The desktop failure is `scripts/submit-latency.test.mjs:1472`,
`M1/M2/M3: the warm removes the engage from the send, and the control proves it`:
the first warm returned `state: "warm"`, not the asserted `"warming"`, against a
real isolated instance of the installed backend. The benchmark file has the same
blob `d5466aeafebc5a0e71cb2edcaf9a12f737c28076` on main, the old PR head, and the
rebased head; both local inputs of its bundled transport closure also match
main. This is not an update-check regression, and recovery did not alter the
warm flow or suppress the assertion. It remains a reported non-green full suite,
not a pass. The earlier host-specific installer/probe failures did not recur.
An isolated reproduction after the build, `node --test --test-concurrency=1
--test-name-pattern='M1/M2/M3:' scripts/submit-latency.test.mjs`, failed identically:
1 test / 0 pass / 1 fail, 3.97s. The whole suite was not rerun.

All seven update-verdict cases passed, including the real loopback `/health`
response plus invocation of the registered `check-for-all-updates` handler:

- server offer / app current: no affirmation;
- app offer / server current: no affirmation;
- both current: the application-and-server affirmation;
- absent options and `{manual:true}` preserve both channels' events;
  `{silent:true}` suppresses both events without changing the answer;
- two offers: no affirmation;
- errored app, unreadable server, or development mode: no false affirmation;
- pure rule: only current/current among all nine pairs earns the sentence.

These execute the shipped service and HTTP path with a fixture Electron bridge;
they are not native Electron IPC transport or a substitute for independent QA.

## Read-only review fixtures

The two relevant production Storybook routes are:

- `/iframe.html?id=settings-app-updates-section--server-update-offered&viewMode=story&globals=theme:localOperatorLight`
- `/iframe.html?id=settings-app-updates-section--all-current&viewMode=story&globals=theme:localOperatorLight`

Serve the existing historical build, if needed, from this worktree with
`python3 -m http.server 6034 --bind 127.0.0.1 --directory storybook-static` and use
`http://127.0.0.1:6034` with those paths. The static artifact is the prior capture
build, not a rebuilt recovery artifact; source continuity is established above.

Repeat with `localOperatorDark`. The production build matters: the real button
intentionally refuses checks when `import.meta.env.DEV` is true. The story
scripts `window.api.updater`, supplies fixture health/version values, and presses
the real button; it does not install an update. Existing committed frames are
under the adjacent `server-update-offered/` and `all-current/` directories, with
the historical before pair at `../update-check-affirmation-before/`.

Use only the browser tool for new page interactions or screenshots. The original
README's raw capture command is historical provenance, not the recovery
procedure. No server was started for this recovery at the time of the rebase.
