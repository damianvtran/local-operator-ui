# Update and install robustness evidence

The 0.17.0 auto-update downloaded, verified its checksum, called
`quitAndInstall`, and the app never came back. The same evening the operator
tried to install 0.17.0 from the website and macOS answered *"Local Operator" is
damaged and can't be opened. You should move it to the Trash.* Two different
failures with one shared root: nothing on the update path checked the state of
the thing being replaced, and nothing told the user when it went wrong.

This directory holds the evidence for both, and the frames for the states the
user now sees.

## The forensic files

Copied from the audit of the operator's machine
(`~/workspace/lo-update-audit/evidence/`, 2026-09-11):

| File | What it shows |
| --- | --- |
| [ShipIt_stderr.log](ShipIt_stderr.log) | Squirrel.Mac's ShipIt refusing the install: `Installation error: Error Domain=NSOSStatusErrorDomain Code=-67028` from `SecStaticCodeCreateWithPath` on the installed bundle, then `ShipIt quitting`. `-67028` is `errSecCSBadBundleFormat`. |
| [ShipItState.plist.txt](ShipItState.plist.txt) | ShipIt's own state after the failure: an install that stopped without relaunching anything. |
| [pending-update-info.json](pending-update-info.json) | The staged update left behind in `~/Library/Caches/local-operator-ui-updater/pending/`. |
| [bundle-validation-probe.txt](bundle-validation-probe.txt) | The probe that maps the Security framework codes: nonexistent path → `-67068 errSecCSStaticCodeNotFound`; a plain directory or a bundle without `Contents/MacOS/...` → **`-67028`**. This is what makes the ShipIt error conclusive rather than suggestive. |
| [artifacts-gatekeeper.txt](artifacts-gatekeeper.txt) | The release artifacts themselves. The app inside the mounted image: `codesign --verify: OK`, `spctl` **accepted / source=Notarized Developer ID**, `stapler validate` OK. The image as downloaded: `code object is not signed at all`, `spctl` **rejected / source=no usable signature**. |
| [update-service-log-excerpts.txt](update-service-log-excerpts.txt) | The update service's own log: the 22:36:48 `update-downloaded`, the pip offer made for a `GLOBAL_INSTALL` server, and the `APP_BUNDLED_VENV` offer an hour earlier. |
| [gate-on-shipped-0.17.0.txt](gate-on-shipped-0.17.0.txt) | The new release gate run against the real 0.17.0 artifacts (below). |
| [notarize-step-guards.txt](notarize-step-guards.txt) | What the disk image step does on a machine with no signing identity or Apple credentials, and why the positive direction is only exercised in CI. |

## The gate, run against the shipped 0.17.0 release

`node scripts/verify-macos-artifacts.mjs --app "/Volumes/Local Operator
0.17.0-universal/Local Operator.app" --dmg ~/Downloads/local-operator-ui-0.17.0-universal.dmg`
— the mounted app and the downloaded image, exactly as they shipped:

```
PASS app-codesign: codesign --verify --deep --strict on the app
PASS app-spctl: spctl -a -vvv -t exec on the app
PASS app-stapler: stapler validate on the app
FAIL dmg-spctl: spctl -a -vvv -t open on the disk image -> rejected | source=no usable signature
FAIL dmg-stapler: stapler validate on the disk image -> does not have a ticket stapled to it.
gate exit=1
```

Two things to take from that. The three app checks passed on the release users
could not open, which is why 0.17.0 shipped: the pipeline asserted the app and
never the container. And the two checks that failed are the ones now run before
upload, so this same artifact would not leave CI today.

## What could not be produced here, and where it is covered

There is no Developer ID identity on this machine (`security find-identity -v -p
codesigning` → `0 valid identities found`) and no `APPLE_ID` /
`APPLE_ID_PASSWORD` / `APPLE_TEAM_ID`, so a signed, notarized, stapled disk
image cannot be produced locally. The positive direction — all five checks
passing on a real release artifact — runs in the `build-macos` job of
`.github/workflows/publish.yml` on every release, where a failure fails the
release before anything is uploaded. The negative direction is a contract test:
`scripts/update-robustness.test.mjs` asserts the shipped-0.17.0 shape
(signed app, unsigned image) fails, asserts an accepted image passes, and runs
the real `spctl` and `xcrun stapler` against a synthetic unsigned image created
with `hdiutil` on this machine.

## The pre-flight, run against a real bundle

`scripts/update-robustness.test.mjs` builds a small bundle, signs it ad-hoc,
runs the real `/usr/bin/codesign --verify --deep --strict` on it, and then
re-runs it after changing a sealed resource — the audit's own "damaged"
reproduction. The first run exits 0 and the pre-flight proceeds; the second
exits 1 with `a sealed resource is missing or invalid` and the install is
refused without quitting. Ad-hoc signatures verify exactly like Developer ID
ones for this purpose, which is what lets the case run anywhere macOS does.

## The frames

Captured with `node scripts/capture-evidence.mjs http://localhost:6006
--only=common-updatenotification --themes=localOperatorDark,localOperatorLight
--allow-backend` against the running Storybook:

| Surface | Frame | State |
| --- | --- | --- |
| install-blocked | [dark](common-updatenotification/install-blocked/localOperatorDark.webp) · [light](common-updatenotification/install-blocked/localOperatorLight.webp) | The install refused before the app quit, with the remedy (open the download page) and codesign's own line in machine voice below it. |
| install-failed | [dark](common-updatenotification/install-failed/localOperatorDark.webp) · [light](common-updatenotification/install-failed/localOperatorLight.webp) | The next start after an install that never completed: the app came back on the old version and now says so instead of silently re-offering. |
| backend-manual-required | [dark](common-updatenotification/backend-manual-required/localOperatorDark.webp) · [light](common-updatenotification/backend-manual-required/localOperatorLight.webp) | A server the app does not own, with the command for how it was installed. |
| backend-update-non-managed | [dark](common-updatenotification/backend-update-non-managed/localOperatorDark.webp) · [light](common-updatenotification/backend-update-non-managed/localOperatorLight.webp) | A uv tool install: `uv tool upgrade local-operator`, no "Update server" button (`canManageUpdate: false` is now honoured rather than guessed from a substring). |

The four new surfaces are declared in `docs/evidence/manifest.json` under
`partialCapture`, so `pnpm check-evidence` accounts for every frame on disk.
