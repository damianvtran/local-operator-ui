# The managed Python runtime: the gates, the artifacts, and the refusals

This is the evidence set for the change that stops the managed backend resolving
anything inside a signed `.app` bundle (PR #183). Every file here is command
output, not a summary of one; the prose is only what a reader needs to know which
command produced which block. The incident this change answers is recorded in
[../update-robustness/README.md](../update-robustness/README.md), including the
three claims from that investigation that were retracted.

## What was run, and where the output is

```
pnpm lint                                     -> gates.txt
pnpm check-types                              -> gates.txt
pnpm check-themes                             -> gates.txt
pnpm build
CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm exec electron-builder --mac --arm64 --publish never   -> gates.txt
pnpm test:desktop                             -> unit-tests.txt (the suite, 0 failures)
node scripts/verify-macos-artifacts.mjs       -> release-gate.txt
node scripts/run-desktop-tests.mjs scripts/managed-python.test.mjs
                                              -> unit-tests.txt

# Round 1 of the review, QA and design rounds, answered in one pass:
node scripts/run-desktop-tests.mjs scripts/managed-python.test.mjs
node scripts/run-desktop-tests.mjs scripts/python-bytecode-cache.test.mjs
node scripts/run-desktop-tests.mjs scripts/update-robustness.test.mjs
pnpm setup-python && pnpm build && electron-builder --mac --publish never
node scripts/verify-macos-artifacts.mjs --dist dist
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=common-updatenotification --themes=localOperatorDark,localOperatorLight
                                              -> round1-remediation.txt
```

`--arm64` did not narrow the build as intended: `mac.target` lists both
architectures and electron-builder built both, which turned out to be useful -
the x64 half is the negative direction this pass needed.

## What the released layout is, measured on a real build

**Provenance, stated precisely:** the artifacts below were produced from the tree
at `ce724b36b` with the container-gate work (this branch's `7aa9c0439`) in the
working tree. The only difference to the head that carries this file is a comment
in `src/main/backend/venv-paths.ts` and a comment in the macOS install script, so
the bytes these checks were run against are the ones the head packages - but the
gate was not re-run on a repacked artifact after those commits, and that is said
rather than implied.

`gates.txt` carries the build's own lines. The two that matter:

```
Pruned bundled Python the x64 app cannot run: .../dist/mac/Local Operator.app/Contents/Resources/python-runtime-seed/arm64
No off-architecture bundled Python found for arm64 in .../dist/mac-arm64/Local Operator.app/Contents/Resources
```

and the resulting layout of the arm64 app:

```
$ ls ".../Local Operator.app/Contents/Resources" | grep -i python
python-runtime-seed
$ ls ".../Contents/Resources/python-runtime-seed"
arm64
$ du -sh .../python-runtime-seed/arm64
 47M    .../python-runtime-seed/arm64
```

No `Contents/Resources/python` and no `python_aarch64` beside it - the legacy
names the incumbent install's `pyvenv.cfg` still points at are absent from the
shipped bundle, which is the acceptance criterion this change is judged on.

## The container half, on the artifacts a user downloads

`container-arm64.txt` is `finalContainerChecks` run directly against
`dist/local-operator-ui-0.22.3-arm64.dmg` and `-arm64.zip` from that build, so
each row is visible rather than folded into a 41-row report:

- the `.dmg` is mounted read-only and the app copied out with `ditto`, and the
  `.zip` is extracted with `ditto -x -k`; all three assembly checks pass on the
  app copied out of **each** container;
- the three `codesign`/`spctl`/`stapler` rows fail, because this host has no
  Developer ID identity. That is the local state, not the change, and it is why
  the signed direction is `publish.yml`'s.

`container-negative.txt` is the same checks over a **real** arm64 ZIP from that
build with one thing changed, twice:

```
--- legacy alias reintroduced ---
FAIL app-private-python-seed: Legacy Python resource or alias exists: python_aarch64
--- seed removed ---
FAIL app-one-bundled-python: the arm64 app ships Contents/Resources/none, but it resolves Contents/Resources/python-runtime-seed/arm64
FAIL app-private-python-seed: ENOENT: no such file or directory, scandir '.../python-runtime-seed'
```

A gate that only ever sees good artifacts has never been asked a question it
could fail; these two are that question, and both are refused by name.

## Two defects this pass found, both fixed here

1. **The disk image could not be mounted, so the app inside it was never
   checked.** `electron-builder` treats `build/license_<lang>.txt` as the image's
   SLA by convention, so every image this project ships carries one. Measured on
   the artifact above: a bare `hdiutil attach` printed the agreement and then
   answered `hdiutil: attach canceled`, exit 1 - there is no TTY to answer on.
   `release-gate.txt` is the run that shows it (`FAIL final-container-app: ...
   hdiutil: attach canceled`) and `container-arm64.txt` is the same checks after
   the fix, with the agreement answered on stdin. Without it the gate would have
   failed every release on the one row that exists to check what the download
   page serves.

2. **`scripts/managed-python.test.mjs` was not in `pnpm test:desktop`**, so the
   module this change is built around had no test running in CI. It is now wired
   in, and grew the container cases above (a real ZIP, and a real image built with
   `hdiutil` and mounted).

## What is BLOCKED here, and why it is not a failure

- **The signed direction.** `security find-identity -v -p codesigning` on this
  host lists no identity, so no build of this checkout can produce a signed or
  notarized candidate. `release-gate.txt` reports those rows as FAIL with the
  reason a local unsigned build produces, and
  `scripts/verify-signed-update.mjs` reports the whole exercise BLOCKED with exit
  2 rather than a surrogate PASS - it consumes artifacts the `ci(mac)` candidate
  workflow signs, and it says so.
- **The x64 artifacts.** At the time the earlier pass ran, this checkout had no
  `resources/python` (the x64 interpreter was not downloaded), so the x64 app
  carried no seed and the gate refused it:

  ```
  FAIL app-one-bundled-python: ... the x86_64 app ships Contents/Resources/none, but it resolves Contents/Resources/python-runtime-seed/x64
  ```

  That is the check working: a bundle whose interpreter did not reach it is not a
  bundle to ship. `pnpm setup-python` supplies both on a checkout that has run
  it - and the remediation pass did run it, so the x64 rows above pass on the
  artifacts that pass built.

## Round 1 of the review, QA and design rounds

`round1-remediation.txt` is the raw output behind every finding worked in that
pass: the four provisioning-recovery fixtures, the seed-that-carries-bytecode
case, the pre-split environment report driven with a real pre-split venv, the
installer script run to its refusal, the setup dialog's copy, the Details line's
contrast measured at token level, the release gate on this head's own build for
BOTH architectures, and the container gate refusing two mutated copies of the
real arm64 archive by name.

Two things it records that the earlier pass could not:

- **The x64 rows pass now.** `pnpm setup-python` supplied `resources/python`, so
  all six app instances (two unpacked, four containers) pass the three seeded
  rows for both architectures. The BLOCKED bullet below about the x64 artifacts
  described the earlier pass's checkout, not this one.
- **Only two frames moved.** The start-up panel was re-captured on this head in
  both brand themes and 18 of the 20 frames came back byte-identical; the two
  that differ are the ones D1-D3 changed. The manifest records which.

## Handoff state

`docs/evidence/manifest.json`'s stamps describe the head that carries this file
(`scripts/evidence-manifest.test.mjs` binds them to `HEAD:src`/`HEAD:scripts`).
The signed-update exercise needs a nonpublishing candidate workflow registered on
the default branch before it can run at all; that is a separate change
(`ci(mac):`), and until it is dispatched this evidence set does not claim the
in-app update has been exercised against a signed candidate.
