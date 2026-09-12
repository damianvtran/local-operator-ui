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

`scripts/verify-macos-artifacts.mjs` runs five checks against the artifacts the
build actually produced, and any failure fails the release before upload:

| Check | Command |
| --- | --- |
| App is sealed | `codesign --verify --deep --strict` on the `.app` |
| App is accepted | `spctl -a -vvv -t exec` on the `.app` |
| App ticket is stapled | `xcrun stapler validate` on the `.app` |
| Image is accepted | `spctl -a -vvv -t open --context context:primary-signature` on the `.dmg` |
| Image ticket is stapled | `xcrun stapler validate` on the `.dmg` |

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
