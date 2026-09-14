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

- `APPLE_ID`: Your Apple Developer ID
- `APPLE_ID_PASSWORD`: App-specific password for your Apple ID
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `NOTARIZE`: Set to "true" to enable notarization (optional)

### How It Works

1. **Certificate Preparation**:
   - The CI/CD pipeline decodes the base64-encoded certificate (`CSC_CONTENT`) into a p12 file
   - The path to this file is set as `CSC_LINK` for electron-builder

2. **Build Process**:
   - The application is built using `pnpm dist:mac`, `pnpm dist:win`, or `pnpm dist:linux`
   - electron-builder automatically signs the application using the provided certificate

3. **Notarization (macOS only)**:
   - After signing, the `scripts/notarize.js` script is executed (configured in package.json as `afterSign`)
   - This script submits the **app bundle** to Apple for notarization using `notarytool` (via `@electron/notarize`)
   - The notarization process requires `APPLE_ID`, `APPLE_ID_PASSWORD`, and `APPLE_TEAM_ID`
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
notarization reads `APPLE_APP_SPECIFIC_PASSWORD`, while this project's secrets
and `.env.build` carry `APPLE_ID_PASSWORD`; enabling it would make
`notarizeIfProvided` throw `APPLE_APP_SPECIFIC_PASSWORD env var needs to be set`
partway through a release. `afterSign` owns app notarization, and
`dmg.sign: true` plus `scripts/notarize-artifacts.mjs` own the image.

## Setting Up for Local Development

1. **Create a `.env.build` file** in the project root with the following variables:

   ```
   # GitHub Token (for publishing releases)
   GH_TOKEN=your_github_token

   # macOS Code Signing
   APPLE_ID=your_apple_id@example.com
   APPLE_ID_PASSWORD=your_app_specific_password
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

1. Decode the certificate from the `CSC_CONTENT` secret
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
| The seed matches the filename | Asserts the artifact's `-<arch>` names the same architecture as the app inside it and the seed that app carries |
| The delivered containers are asserted | `hdiutil attach` the `.dmg` and `ditto` the app out, or `unzip -Z1` then `ditto -x -k` the `.zip`, then run the app checks above on the copy |
| Metadata describes delivered bytes | Every `latest*.yml` entry's `sha512`/`size` is recomputed from the final, stapled container |

The last four ask nothing of `codesign`: they are about what the build
assembled. A shipped `.pyc` is bytecode that must not exist in a code-sealed
bundle at all, and two seed trees mean half of it is an interpreter the machine
cannot run (`afterPack` in `scripts/after-pack.mjs` removes the other one).

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

- `CSC_CONTENT`: Base64-encoded signing certificate
- `CSC_KEY_PASSWORD`: Password for the signing certificate
- `APPLE_ID`: Your Apple Developer ID
- `APPLE_ID_PASSWORD`: App-specific password for your Apple ID
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `GITHUB_TOKEN`: Automatically provided by GitHub
- `NPM_TOKEN`: Not required when using npm Trusted Publisher (OIDC) with GitHub Actions

## Troubleshooting

### Common Issues

1. **Certificate not found**:
   - Ensure `CSC_CONTENT` is properly base64-encoded
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
