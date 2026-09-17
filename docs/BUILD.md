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
- `.github/workflows/publish.yml`: Builds and publishes distributables for all platforms when a Release is published, and does the whole release from there — nothing else on the pipeline is started or finished by hand

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

Once the window's PRs have merged, the owner bumps, tags and publishes. The notes
are written by hand from the committed template — copy it out of the repository,
edit it, and pass the file:

```bash
cp .github/RELEASE_TEMPLATE.md /tmp/vX.Y.Z.md
$EDITOR /tmp/vX.Y.Z.md
gh release create vX.Y.Z --target <bump-merge-sha> \
  --prerelease --title 'X.Y.Z: <theme>' --notes-file /tmp/vX.Y.Z.md
```

Never `gh release create --generate-notes`, and never the web UI's "Generate release
notes": `.github/RELEASE_TEMPLATE.md` states the shape, and `publish.yml` refuses a
Release whose body is empty or is GitHub's generated draft. Publishing the Release is
what triggers `.github/workflows/publish.yml`, which builds and attaches the
installers for every platform and then promotes the Release. Merely pushing a tag
publishes nothing, and `--prerelease` is the hold that keeps an asset-less Release
out of `/releases/latest` while the build runs. From that point the published
Release drives everything: the workflow validates the tag, publishes to npm, builds
and attaches every platform's artifacts, dispatches the signed-update verification
and promotes the Release, with no manual step on the pipeline. The workflow can also
be started by hand from the Actions tab (`workflow_dispatch`), which repairs assets
but deliberately never promotes a Release — a repair must not mutate release
metadata, and it is not held to the writeup rule either, since an old Release's body
is whatever it shipped with.

## Configuration

The build configuration is defined in the `build` section of `package.json`. You can modify this configuration to customize the build process.

### Key Configuration Options

- `appId`: The application identifier
- `productName`: The name of the application
- `copyright`: Copyright information
- `directories.output`: Output directory for distributables
- `mac`, `win`, `linux`: Platform-specific configurations

### macOS: one artifact set per architecture, and one bundled interpreter

`mac.target` builds a `dmg` and a `zip` for `arm64` and `x64` separately, so
`artifactName` (`${name}-${version}-${arch}.${ext}`) produces
`local-operator-ui-<version>-arm64.dmg`, `-x64.dmg`, `-arm64.zip` and
`-x64.zip`. There is no universal image: a universal `.app` carries two copies
of the Electron framework and both bundled interpreters, so half of every
download is code the user's machine cannot run.

`extraResources` is not architecture-aware and copies both interpreters into
every build, as inert data under `Contents/Resources/python-runtime-seed/<arch>`
(`arm64`/`x64`) rather than under the old `python`/`python_aarch64` names. Two
steps in `scripts/after-pack.mjs` - which `package.json` names as the single
`afterPack` hook, and which is where anyone who followed an older revision of
this paragraph to `prune-python-resource.mjs` should look now - run there:

1. `scripts/prune-python-resource.mjs` deletes the tree the app cannot run, by
the same mapping `backend-installer.ts` resolves at runtime.
2. The hook refuses a bundle that still carries a legacy resource name, even a
dangling one. The seed is never executed from the `.app`, but an incumbent
install's venv still names `Contents/Resources/python[_aarch64]/bin` in its
`pyvenv.cfg`, and a directory there would let it reach the new bundle's tree in
the window between an update's swap and the app's first instruction.

Both have to run before signing: removing a file from a code-sealed `.app` is a
violation no update-time heal can repair. `pnpm verify-macos-artifacts` fails
the release if a delivered bundle does not carry exactly the seed its
architecture needs, or carries a legacy alias beside it.

**One definition of that layout.** The names above are spelled nowhere else.
`src/shared/bundled-python-layout.json` holds the seed namespace, both
architectures, the checkout spellings and the retired names; the app imports it
(`managed-python.ts`, `update-install.ts`) and the scripts read it through
`scripts/bundled-python-layout.mjs`. That is not tidiness - the previous six
spellings drifted apart in exactly one place (the heal's predicate kept the
retired names while the release gate was updated), which made every bytecode
violation on a bundle this branch builds unhealable by construction while the
gate that shares its job was green.

### What the app does with the seed at runtime

`Contents/Resources/python-runtime-seed/<arch>` is never executed. On first run
the app copies the complete tree to `~/Library/Application Support/Local
Operator/managed-python/<packaged|dev>/runtimes/<seed identity>-<uuid>`, creates
the venv at its final path under `environments/<seed identity>-<uuid>`, and only
then runs any Python - so every interpreter, stdlib and native dependency an
app-managed environment uses is outside every `.app`.

Three details are load-bearing and are pinned by tests:

- **The identity excludes bytecode caches.** It is the sha256 of the tree's
  signed bytes; a `.pyc` beside them is derived data. Counting them on one side
  and ignoring them on the other made a selection unusable the moment the seed
  picked one up.
- **A generation is addressed by identity AND a uuid.** A runtime whose bytes no
  longer match its identity is therefore not a candidate rather than a repair
  target, nothing is ever overwritten in place, and a broken runtime or
  environment is rebuilt beside the old one - which is what makes Retry work.
- **Superseded generations are reaped**, bounded: the selected one plus the most
  recent other in each root, and staging trees older than the preparation lock.
  Only names the module writes are considered, so nothing an operator or a later
  version put there is touched.

### macOS first-run

A first run on macOS does not show the "First-Time Setup Required" consent
prompt or the "Setup Complete" acknowledgement any more. The progress window
that follows carries its own Cancel, it is the surface a user actually watches,
and on macOS the preparation runs inside a lock a held-open modal would starve.
Windows and Linux keep both dialogs and their cancel paths.

### Windows: the union installer is load-bearing

Windows keeps **three** installers: `local-operator-ui-setup-<version>.exe`
containing both architectures, plus the per-architecture pair, because
`win.artifactName` carries `${arch}`. `electron-builder`'s
`nsis.buildUniversalInstaller` (default `true`) builds the union one, and it is
tempting to turn it off — it is 402 MB, roughly the sum of the other two.

Do not, unless the updater changes too. `NsisUpdater.doDownloadUpdate` resolves
its download with `findFile(resolveFiles(info), "exe")`, which takes the
**first** `.exe` in the feed and applies no architecture filter at all
(`MacUpdater` filters by architecture first; the Windows path does not), and
`latest.yml` lists the union installer first and as `path`. Every Windows user
is therefore served the union installer today, which is what gives a
Windows-on-ARM machine an ARM64 install. Remove it and the winner is whichever
of the two concurrent per-arch packaging tasks finished first — an x64 build,
emulated, for ARM64 users. Making the Windows feed architecture-aware is the
precondition for dropping the union installer, not a packaging tweak.

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

A probe line: this diff touches nothing any job in ci.yml reads.
