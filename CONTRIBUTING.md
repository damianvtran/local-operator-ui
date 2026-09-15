# Contributing to Local Operator UI

Thank you for your interest in contributing to Local Operator UI! We welcome all contributions, including bug reports, feature requests, documentation improvements, and code contributions. By participating in this project, you agree to abide by its [MIT License](LICENSE).

## Project Structure

```
local-operator-ui/
├── resources/                  # Application resources (icons, images)
├── src/                        # Source code
│   ├── main/                   # Electron main process
│   │   └── index.ts            # Main process entry point
│   ├── preload/                # Electron preload scripts
│   │   ├── index.d.ts          # Type definitions
│   │   └── index.ts            # Preload script
│   └── renderer/               # Renderer process (React application)
│       ├── index.html          # HTML template
│       └── src/                # React application source
│           ├── api/            # API clients and utilities
│           │   ├── query-client.ts                # React Query client setup
│           │   └── local-operator/               # Local Operator API client
│           │       ├── agents-api.ts             # Agents API endpoints
│           │       ├── chat-api.ts               # Chat API endpoints
│           │       ├── config-api.ts             # Config API endpoints
│           │       ├── credentials-api.ts        # Credentials API endpoints
│           │       ├── health-api.ts             # Health API endpoints
│           │       ├── jobs-api.ts               # Jobs API endpoints
│           │       ├── types.ts                  # API type definitions
│           │       └── index.ts                  # API client exports
│           ├── assets/         # Static assets
│           ├── components/     # React components
│           │   ├── agents/     # Agent management components
│           │   ├── chat/       # Chat interface components
│           │   ├── common/     # Shared/common components
│           │   ├── navigation/ # Navigation components
│           │   └── settings/   # Settings components
│           ├── hooks/          # Custom React hooks
│           ├── store/          # State management (Zustand)
│           ├── app.tsx         # Main application component
│           ├── config.ts       # Application configuration
│           ├── main.tsx        # Application entry point
│           ├── theme.ts        # MUI theme configuration
│           └── vite-env.d.ts   # Vite environment type definitions
├── .env.template               # Environment variables template
├── biome.json                  # Biome configuration
├── electron.vite.config.js     # Electron Vite configuration
├── eslint.config.js            # ESLint configuration
├── package.json                # Project dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── CONTRIBUTING.md             # Contribution guidelines
├── LICENSE                     # Project license
└── README.md                   # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (version specified in `.nvmrc`)
- pnpm package manager
- Local Operator Backend (for full functionality testing)

### Development Setup

1. If you don't have contributor access, **Fork** the repository on GitHub
2. **Clone** your forked repository:

   ```bash
   git clone https://github.com/your-username/local-operator-ui.git
   ```

3. Install dependencies:

   ```bash
   cd local-operator-ui
   pnpm install
   ```

4. Set up environment variables:

   ```bash
   cp .env.template .env
   ```

   Edit the `.env` file to configure the connection to your Local Operator backend.

5. Start the development server:

   ```bash
   pnpm dev
   ```

## Code Style & Quality

We enforce consistent code style and quality checks:

- **Formatting & Linting**: Uses Biome

  ```bash
  # Check for linting issues
  pnpm lint

  # Fix linting issues
  pnpm lint:fix

  # Format code
  pnpm format

  # Fix formatting issues
  pnpm format:fix
  ```

- **TypeScript**: Strict type checking is enforced

Always run these tools before submitting a pull request. They will also be run in the CI pipeline on any branches with the `dev-` prefix and on PRs merged to `main`.

### Code Style Guidelines

- Use `type` instead of `interface` for type definitions
- Use kebab-case for file names and PascalCase for component names
- Use named exports instead of default exports
- Include JSDoc documentation where appropriate
- Follow Biome linting conventions
- Break large components into smaller, manageable, testable components
- Use styled components and MUI for UI elements

## Testing

We use Jest for testing:

```bash
pnpm test
```

- Keep tests in the same directory as the components they test
- Aim for 80%+ test coverage for new features
- Use React Testing Library for component tests

## Contribution Workflow

Please follow the following steps to contribute:

1. For accounts without contributor access, create your fork of the repository
2. Create a new branch for your changes with the `dev-` prefix

   ```bash
   git checkout -b dev-my-feature
   # or
   git checkout -b dev-issue-number-description
   ```

3. Commit changes with descriptive messages

   - Use the present tense
   - Keep commits small and atomic

   ```bash
   git add .
   git commit -m "Add feature for specific component"
   ```

4. Update documentation if adding new features or changing behavior

5. Push your changes to your fork

   ```bash
   git push origin dev-my-feature
   ```

6. Create a Pull Request against the main branch of the upstream repository

## Release Process

**Contributors do not bump the version.** `package.json` stays at the last
released version on every feature and fix branch. A pull request that changes the
`version` line fails the `Version Bump Guard` workflow unless its title starts
with `chore(release):`, and a reviewer treats such a change inside a feature PR
as a finding. A PR argues for its bump with a `Release: <patch|minor> — <one-line
user impact>` line in its body; it never applies one.

Releases here are **combined releases**: one version bump, one tag and one GitHub
Release covering every PR merged since the previous tag, cut by a single
**release owner** for that window. Merging is therefore decoupled from releasing —
a merged PR that has not been released yet is the normal state of `main`, not a
problem to fix — and whoever owns a PR merges it as soon as its review rounds are
clean and fresh and CI is green. There is no release queue and no reserved
version number. The full doctrine, including how a window is claimed by its one
owner and how the bump is chosen by materiality rather than by commit type, is in
`AGENTS.md` § "Releasing: one owner per window, and no version bumps inside
feature PRs".

The release owner's procedure, in short:

1. Collect the window: every PR merged since the last tag, with its merge SHA and
   its `Release:` line.
2. Pick **one** bump for the whole window by materiality — patch unless a single
   PR in the window is a step-function capability in its own right.
3. Land a one-commit PR titled `chore(release): bump version to X.Y.Z`, touching
   `package.json` only. It is still an agent-authored PR, so it still needs an
   independent review round; a bump commit that also carries code is a defect.
4. Write the notes by hand, from the committed template. GitHub has no native
   release template, so this is a file you copy and edit outside the repository:

   ```bash
   cp .github/RELEASE_TEMPLATE.md /tmp/vX.Y.Z.md
   $EDITOR /tmp/vX.Y.Z.md
   ```

   `.github/RELEASE_TEMPLATE.md` carries the rules and the shape: a two-to-four
   sentence `## What's New` written as prose about what a user gets, one bullet per
   significant change with its constraint or trade-off, an `## Impact` section, every
   PR in the window under `## PRs`, and the compare link last. **Never
   `gh release create --generate-notes`, and never the web UI's "Generate release
   notes".** The GitHub draft is refused rather than published: `publish.yml`'s second
   job reads the Release body and fails the run on an empty body or on GitHub's
   `## What's Changed` heading. That refusal is recoverable without re-releasing —
   edit the Release body and re-run the failed run, which replays the release event
   and re-reads the Release — but a fix to the workflow's own code is not picked up
   by a re-run.
5. Tag and publish in one step, on that bump's merge commit:

   ```bash
   gh release create vX.Y.Z --target <bump-merge-sha> \
     --prerelease --title 'X.Y.Z: <theme>' --notes-file /tmp/vX.Y.Z.md
   ```

   `--target` creates the tag on exactly that SHA, and it is *publishing the
   Release* — not pushing a tag — that triggers CD
   (`.github/workflows/publish.yml`), which builds and attaches the installers for
   every platform and then promotes the Release out of pre-release once this
   Release's assets are verified. `--prerelease` is deliberate and not a
   formality: `electron-updater` reads `/releases/latest`, which ignores
   pre-releases, so users keep being offered the last complete Release until this
   one's installers exist. Publishing the Release as a full release first is what
   once told every running app it was up to date while a newer version was
   already out.

   Publishing the Release is the last manual step: `publish.yml` validates the tag,
   holds the Release out of `/releases/latest`, publishes to npm, builds and attaches
   every platform's artifacts, dispatches the signed-update verification and promotes
   the Release — with nothing to start, approve or finish by hand on the pipeline.
6. Post the tag and the Release URL on every PR in the window.

**For pre-release versions**: use an `alpha` or `beta` suffix (for example
`v0.2.0-alpha.1`), which the publish workflow builds and never promotes into
`latest` — its name says it is not the stable channel. The suffix is the release
owner's choice at tag time and the same combined-release rules apply to it; a
pre-release is not a reason for any branch to carry its own `package.json`
version.

## Pull Request Checklist

- Tests added/updated
- Documentation updated (README, JSDoc comments)
- Code formatted with Biome
- Linting passes
- Type checking passes
- All CI checks pass
- UI/UX considerations addressed (for user-facing features)
- Responsive design considerations addressed

## Reporting Issues

When filing an issue, please include:

1. Local Operator UI version
2. Operating system
3. Node.js version
4. Steps to reproduce
5. Expected vs actual behavior
6. Error logs (if applicable)
7. Screenshots (for UI issues)

## Feature Requests

We welcome innovative ideas! When proposing new features:

- Explain the use case and target audience
- Outline potential implementation strategy
- Suggest UI/UX design if applicable
- Discuss performance implications
- Suggest documentation needs

## Documentation

Help us improve documentation by:

- Fixing typos/outdated information
- Adding usage examples
- Improving section organization
- Translating documentation (if applicable)
- Adding screenshots or GIFs for UI features

## Need Help?

Join our Discussions to:

- Ask questions about implementation
- Discuss architectural decisions
- Propose major changes before coding
- Share your use cases

Thank you for helping make Local Operator UI better! 🚀
