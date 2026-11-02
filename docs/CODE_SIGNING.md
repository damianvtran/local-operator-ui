# Code Signing and Notarization Guide

This document explains how code signing and notarization are configured for the Local Operator UI application.

## Overview

Code signing is essential for distributing desktop applications as it:

- Verifies the authenticity of the application
- Prevents tampering with the application
- Improves user trust
- Is required by modern operating systems (especially macOS and Windows)

## Configuration

### Environment Variables

The following environment variables are used for code signing:

#### For All Platforms

- `CSC_CONTENT`: Base64-encoded signing certificate (p12 file)
- `CSC_KEY_PASSWORD`: Password for the signing certificate

#### For macOS Specific

- `APPLE_API_KEY`: Path to an App Store Connect API key (`.p8`) — notarytool's `--key`
- `APPLE_API_KEY_ID`: That key's id (`--key-id`)
- `APPLE_API_ISSUER`: The App Store Connect issuer id (`--issuer`)
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `NOTARIZE`: Set to "true" to enable notarization (optional)

`APPLE_ID` / `APPLE_ID_PASSWORD` remain a local-only fallback, used when no API
key is set. Under `NOTARIZE=true` on GitHub Actions a missing credential FAILS
the notarization step instead of skipping it.

#### What the release workflows bind

Both `publish.yml` and `signed-update-candidate.yml` sign with the Radient Inc.
organization's Developer ID Application identity and notarize with its App
Store Connect Team API key. Repository secrets (names only):

| Secret | Holds |
|---|---|
| `MACOS_DEVID_APP_P12_BASE64` / `MACOS_DEVID_APP_P12_PASSWORD` | the Developer ID Application identity (p12), imported into a job-local keychain (and used for the Windows signing step, as the old p12 was) |
| `MACOS_APP_PROFILE_BASE64` | the Developer ID provisioning profile for `com.local-operator`, which authorizes the passkey keychain group |
| `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | the notary API key; the `.p8` is decoded to a 0600 file under `$RUNNER_TEMP` and removed at job end |
| `APPLE_TEAM_ID` | the team id the main executable's entitlements are rendered for |

The previous individual-account secrets (`CSC_CONTENT`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_ID_PASSWORD`) stay in the repository for rollback and are
read by nothing (`scripts/mac-build-arch.test.mjs` fails a workflow that reads
one). The comment above `publish.yml`'s staging step is the authority for
renewal: the certificate expires 2027-12-02, and a new certificate needs a NEW
profile too, because a Developer ID profile embeds the certificate it was
issued for.

### How It Works

1. **Certificate Preparation**:
   - The CI/CD pipeline decodes the base64-encoded certificate (`MACOS_DEVID_APP_P12_BASE64`) and imports it into a job-local keychain
   - On Windows the same p12 is written to a file and passed as `CSC_LINK`

2. **Build Process**:
   - The application is built using `pnpm dist:mac`, `pnpm dist:win`, or `pnpm dist:linux`
   - electron-builder automatically signs the application using the provided certificate

3. **Notarization (macOS only)**:
   - After signing, the `scripts/notarize.js` script is executed (configured in package.json as `afterSign`)
   - This script submits the **app bundle** to Apple for notarization using `notarytool` (via `@electron/notarize`)
   - The notarization process uses the App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`)
   - `@electron/notarize` staples the returned ticket to the app as part of the same call

4. **Disk image signing, notarization and stapling (macOS only)**:
   - `dmg.sign` is `true`, so the DMG container is signed with the Developer ID
     certificate as electron-builder creates it
   - After electron-builder finishes, `pnpm notarize-dmg`
     (`scripts/notarize-artifacts.mjs`) runs: it submits each `.dmg` to Apple,
     staples the ticket to it, and rewrites that image's `sha512`/`size` in
     `latest-mac.yml`. Stapling changes the image's bytes and electron-builder
     hashes artifacts as it creates them, so without the rewrite the update
     metadata would describe a file that no longer exists
   - This is the step 0.17.0 was missing. The app inside the image was signed
     and notarized; the image itself was not, and
     `spctl -a -vvv -t open --context context:primary-signature` answered
     `rejected / source=no usable signature` for a freshly downloaded DMG

### Why `mac.notarize` stays `false`

It is not a second way of doing step 3. electron-builder's built-in
notarization reads the same `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER`
names this project now binds (measured in `app-builder-lib` 26.16.1,
`MacTargetHelper.getNotarizeOptions`), so turning it on would submit every app
bundle TWICE — once from `notarizeIfProvided`, once from `afterSign` — and
would bypass the fail-closed credential check `scripts/notarize.js` applies on
GitHub Actions. (Before the move to the API key it would have thrown
`APPLE_APP_SPECIFIC_PASSWORD env var needs to be set`, since the Apple ID
secrets used a different name.) `afterSign` owns app notarization, and
`dmg.sign: true` plus `scripts/notarize-artifacts.mjs` own the image.

## Setting Up for Local Development

1. **Create a `.env.build` file** in the project root with the following variables:

   ```
   # GitHub Token (for publishing releases)
   GH_TOKEN=your_github_token

   # macOS notarization (App Store Connect API key)
   APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
   APPLE_API_KEY_ID=XXXXXXXXXX
   APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000
   APPLE_TEAM_ID=your_team_id

   # Code Signing Certificate
   CSC_CONTENT=base64_encoded_certificate
   CSC_KEY_PASSWORD=your_certificate_password

   # Enable notarization for macOS builds
   NOTARIZE=true
   ```

2. **Generate a base64-encoded certificate**:
   - For macOS/Linux: `base64 -i your_certificate.p12 | pbcopy`
   - For Windows: `certutil -encode your_certificate.p12 temp.b64 && type temp.b64 | clip`

## CI/CD Configuration

The GitHub Actions workflow is configured to:

1. Decode the certificate from the `MACOS_DEVID_APP_P12_BASE64` secret, the provisioning profile from `MACOS_APP_PROFILE_BASE64`, and the notary key from `APPLE_API_KEY_P8_BASE64`
2. Set up the environment for code signing
3. Build and sign the application for each platform
4. Notarize the macOS application
5. Notarize and staple each macOS disk image (`pnpm notarize-dmg`)
6. Assert the real artifacts before they are uploaded (`pnpm verify-macos-artifacts`)

### The macOS artifact assertions

`scripts/verify-macos-artifacts.mjs` runs the checks below against the artifacts
the build actually produced, and any failure fails the release before upload:

| Check | Command |
| --- | --- |
| App is sealed | `codesign --verify --deep --strict` on the `.app` |
| App is accepted | `spctl -a -vvv -t exec` on the `.app` |
| App ticket is stapled | `xcrun stapler validate` on the `.app` |
| Image is accepted | `spctl -a -vvv -t open --context context:primary-signature` on the `.dmg` |
| Image ticket is stapled | `xcrun stapler validate` on the `.dmg` |
| No bytecode ships | Walks the private seed tree for `.pyc`/`.pyo` |
| Private seed ships | Asserts exactly one `python-runtime-seed/<arch>` and no `python`/`python_aarch64` name beside it - including a dangling symlink |
| One seed ships | Asserts the seed present is the one `lipo -archs` says this bundle's architecture resolves |
| The seed is the declared Python | Runs the seed's own `bin/python3 -I -B --version` and requires the patch release `src/shared/bundled-runtime-layout.json` declares - the only reading that sees a patch level, since the tree's own markers carry the major.minor |
| One uv ships, and it runs | Asserts exactly one `uv/<arch>`, that its `uv` is a plain file with the execute bit, and that `lipo -archs` on it matches the directory (and the artifact's own `-<arch>`). macOS-only: no other platform's artifact carries one |
| The seed's executables are executable | Asserts no non-Mach-O file carries an execute bit, every `MH_EXECUTE` Mach-O carries one, and `bin/python3` is one of them. Libraries are not required to carry a bit (`dlopen` mmaps them; upstream ships some at 0644) |
| The seed matches the filename | Asserts the artifact's `-<arch>` names the same architecture as the app inside it and the seed that app carries |
| The delivered containers are asserted | `hdiutil attach` the `.dmg` and `ditto` the app out, or `unzip -Z1` then `ditto -x -k` the `.zip`, then run the app checks above on the copy |
| Metadata describes delivered bytes | Every `latest*.yml` entry's `sha512`/`size` is recomputed from the final, stapled container |

The last four ask nothing of `codesign`: they are about what the build
assembled. A shipped `.pyc` is bytecode that must not exist in a code-sealed
bundle at all, and two runtime trees mean half of it is a binary the machine
cannot run (`afterPack` in `scripts/after-pack.mjs` removes the other one).

Both bytecode rows name the interpreter trees through
`src/shared/bundled-runtime-layout.json` - the same definition the app's own
update-time heal reads (`isPythonBytecodePath` in `src/main/update-install.ts`),
which lists the retired `python`/`python_aarch64` names *and*
`python-runtime-seed/<arch>`. That heal is the app deleting a `.pyc` a stray
process wrote beside the interpreter it ships; it is deliberately narrow (added
bytecode under those trees only, never a sealed file, never a `modified` entry),
and it has to know both layouts because the bundle being replaced is the old one
and the bundle being healed is either.

The bundled `uv` is asserted the same way and for the same reason: it is a
EXECUTABLE resource inside the sealed tree (unlike the seed, the app runs it in
place - see `docs/BUILD.md`), so an artifact that carries the wrong
architecture's build, or carries it without an execute bit, passes every signing
check and fails on the user's first install. `bundledUvToolCheck`
(`scripts/python-artifact-layout.mjs`) asserts the directory, the file, its mode
and its architecture against the artifact's own name. Its signature is its
publisher's, not ours: the staged release is Developer ID signed with the
hardened-runtime flag and notarized, which is what the seal and notarization
accept without a re-sign.

The container rows exist because the app checks used to run against
electron-builder's unpacked `dist` output and nothing else, so the bundle a user
actually downloads was never asked. That is not a cosmetic gap: the ZIP is what
Squirrel.Mac stages, and the disk image is what the download page serves, so a
build step that dropped the seed or reintroduced a legacy alias on the way into
them would have shipped with this gate green. Both containers are therefore
extracted into a temp directory owned by the check - the `.dmg` is mounted
read-only and the app copied out with `ditto` rather than checked in place,
because a read-only mount cannot answer a write question - and the same app
checks run against the copy.

Every app bundle and every disk image the build produced is asserted, not the
first of each: `mac.target` builds a dmg and a zip for each architecture, so a
malformed second bundle or image would otherwise ship unaudited by construction.
The architecture travels with it: each container's filename is the only place
that states which architecture it is meant to be, so the app extracted from a
`-x64.zip` is held to being x64 and to carrying the x64 seed. An arm64 bundle
under an x64 filename extracts and launches on the machine that built it and
cannot start on the machine it was built for, and no check that reads only the
app can see it.
A `dist` entry that cannot be read (a dangling symlink where a bundle should be)
fails the step with a reason rather than throwing out of discovery. Each image
also has to appear in the update metadata, or the step fails: a stapled image
that no `latest*.yml` describes would otherwise ship with the pre-staple hash
still in the file the updater verifies against — a release that is late rather
than wrong.

The negative direction is asserted too, in `scripts/managed-python.test.mjs`:
a container carrying a legacy `python`/`python_aarch64` name (even dangling), a
container carrying the other architecture's correct seed, a container whose
filename disagrees with the app inside it, and an archive with no application at
all are each driven through these checks for real - a real ZIP, and a real disk
image built with `hdiutil` and mounted - and each must be refused. A gate that
only ever sees good artifacts is a gate that has never been asked a question it
could fail.

The first three passed on 0.17.0 and the last two failed, which is exactly how a
release whose app could not be opened from its own download page got out: only
the app was ever asserted. `context:primary-signature` is what makes the fourth
check about the image's own signature rather than the app inside it, and
`spctl` prints `accepted`/`rejected` on stdout whether or not spctl itself
exited cleanly, so the script judges that check on the output rather than the
exit status.

### Required GitHub Secrets

Set up the following secrets in your GitHub repository:

- `MACOS_DEVID_APP_P12_BASE64`: Base64-encoded Developer ID Application identity (p12)
- `MACOS_DEVID_APP_P12_PASSWORD`: Password for that p12
- `MACOS_APP_PROFILE_BASE64`: Base64-encoded Developer ID provisioning profile for `com.local-operator`
- `APPLE_API_KEY_P8_BASE64`: Base64-encoded App Store Connect API key (`.p8`)
- `APPLE_API_KEY_ID`: That key's id
- `APPLE_API_ISSUER`: The App Store Connect issuer id
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `GITHUB_TOKEN`: Automatically provided by GitHub
- `NPM_TOKEN`: Not required when using npm Trusted Publisher (OIDC) with GitHub Actions

## Troubleshooting

### Common Issues

1. **Certificate not found**:
   - Ensure `MACOS_DEVID_APP_P12_BASE64` is properly base64-encoded
   - Check that the certificate decoding step is working correctly

2. **Notarization fails**:
   - Verify your Apple credentials are correct
   - Ensure the app has the proper entitlements (see `build/entitlements.mac.plist`)
   - Check the notarization logs for specific errors
   - For development builds, the app uses an ad-hoc signature (`"identity": null` in package.json) and skips signature verification (`skipVerify: true` in notarize.js)

3. **Code signing errors**:
   - If you see "code has no resources but signature indicates they must be present", ensure you're using the correct signing identity or use ad-hoc signing for development
   - For production builds, ensure you have a valid Developer ID certificate

4. **Windows signing fails**:
   - Ensure your certificate is valid for code signing
   - Verify the certificate password is correct

## References

- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Apple Developer Documentation on Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Microsoft Documentation on Code Signing](https://docs.microsoft.com/en-us/windows/win32/appxpkg/how-to-sign-a-package-using-signtool)
