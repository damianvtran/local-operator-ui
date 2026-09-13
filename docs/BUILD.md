# Building Local Operator UI

This document provides instructions for building Local Operator UI distributables for different platforms.

## Prerequisites

Before building the application, ensure you have the following installed:

- **Node.js**: Version 22.13.1 or higher
- **pnpm**: For package management
- **Git**: For version control

## Build Framework

Local Operator UI uses [electron-builder](https://www.electron.build/) for creating distributables. This framework provides:

- Cross-platform building capabilities
- Code signing integration
- Auto-update functionality
- Configurable output formats

## Building the Application

### Quick Start

To build the application for your current platform:

```bash
# Install dependencies
pnpm install

# Build the application
pnpm dist
```

The built distributables will be available in the `dist/` directory.

### Platform-Specific Builds

You can build for specific platforms using the following commands:

```bash
# Build for macOS
pnpm dist:mac

# Build for Windows
pnpm dist:win

# Build for Linux
pnpm dist:linux

# Build for all platforms (requires appropriate environment)
pnpm dist:all
```

## Code Signing

Code signing and notarization are essential for distributing desktop applications. For detailed information about the code signing and notarization process, see the [CODE_SIGNING.md](./docs/CODE_SIGNING.md) document.

### Environment Variables

The following environment variables are used for code signing across all platforms:

- `CSC_CONTENT`: Base64-encoded signing certificate (p12 file)
- `CSC_KEY_PASSWORD`: Password for the signing certificate

For macOS notarization, additional variables are required:

- `APPLE_ID`: Your Apple ID email
- `APPLE_ID_PASSWORD`: App-specific password for your Apple ID
- `APPLE_TEAM_ID`: Your Apple Developer Team ID
- `NOTARIZE`: Set to "true" to enable notarization (optional)

You can set these variables in your CI/CD pipeline or locally in a `.env.build` file before building.

### Local Development Setup

For local development and testing with code signing:

1. Create a `.env.build` file in the project root (see `.env.build.example` for reference)
2. Add your code signing credentials to this file
3. Run the build command for your platform (e.g., `pnpm dist:mac`)

The build process will automatically use the credentials from your `.env.build` file.

## Continuous Integration

The project includes GitHub Actions workflows for automated building, testing and publishing:

- `.github/workflows/ci.yml`: Runs lint, type checks, the release-contract scripts and the desktop test suite on pushes to `main` and `dev-*`
- `.github/workflows/version-bump-guard.yml`: Rejects a `package.json` version bump outside a `chore(release):` PR, on every pull request (any base branch)
- `.github/workflows/publish.yml`: Builds and publishes distributables for all platforms when a Release is published

`ci.yml` has no `pull_request` trigger: it runs when a commit lands on `main` or on
a `dev-*` branch, not when a pull request is opened. A feature branch therefore
gets no run from it, which is worth knowing before reading an empty checks list
on a PR as a passing one.

### Publishing a Release

The version is bumped by the **release owner**, not by feature PRs: `package.json`
stays at the last released version on every branch, and the `Version Bump Guard`
workflow rejects a PR that changes the version line unless its title starts with
`chore(release):`. See `AGENTS.md` § "Releasing: one owner per window, and no
version bumps inside feature PRs" for the full doctrine, which supersedes the
step-by-step list that used to live here.

Once the window's PRs have merged, the owner tags and publishes with a single
command:

```bash
gh release create vX.Y.Z --target <bump-merge-sha> \
  --prerelease --title 'X.Y.Z: <theme>' --notes-file <notes-file>
```

Publishing the Release is what triggers `.github/workflows/publish.yml`, which
builds and attaches the installers for every platform and then promotes the
Release. Merely pushing a tag publishes nothing, and `--prerelease` is the hold
that keeps an asset-less Release out of `/releases/latest` while the build runs.
The workflow can also be started by hand from the Actions tab
(`workflow_dispatch`), which repairs assets but deliberately never promotes a
Release — a repair must not mutate release metadata.

## Configuration

The build configuration is defined in the `build` section of `package.json`. You can modify this configuration to customize the build process.

### Key Configuration Options

- `appId`: The application identifier
- `productName`: The name of the application
- `copyright`: Copyright information
- `directories.output`: Output directory for distributables
- `mac`, `win`, `linux`: Platform-specific configurations

## Auto-Updates

Local Operator UI supports automatic updates using [electron-updater](https://www.electron.build/auto-update.html).

The update configuration is defined in the `publish` section of the build configuration:

```json
"publish": {
  "provider": "github",
  "owner": "damianvtran",
  "repo": "local-operator-ui",
  "releaseType": "release"
}
```

This configuration publishes updates to GitHub Releases, which users can automatically download and install.

## Troubleshooting

### Common Issues

#### Build fails with code signing errors

- Ensure you have the correct certificates installed
- Verify that environment variables are set correctly
- For macOS, check that your Apple Developer account has the necessary permissions

#### Windows build fails

- Ensure you have a valid code signing certificate
- Check that the certificate password is correct
- Verify that the certificate is not expired

#### Linux build fails

- Ensure you have the necessary dependencies installed
- Check that you have sufficient permissions to create the output files

For more detailed troubleshooting, refer to the [electron-builder documentation](https://www.electron.build/).
