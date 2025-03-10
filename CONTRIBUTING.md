# Contributing to Local Operator UI

Thank you for your interest in contributing to Local Operator UI! We welcome all contributions, including bug reports, feature requests, documentation improvements, and code contributions. By participating in this project, you agree to abide by its [GPL-3.0 License](LICENSE).

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
- yarn package manager
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
   yarn install
   ```

4. Set up environment variables:

   ```bash
   cp .env.template .env
   ```

   Edit the `.env` file to configure the connection to your Local Operator backend.

5. Start the development server:

   ```bash
   yarn dev
   ```

## Code Style & Quality

We enforce consistent code style and quality checks:

- **Formatting & Linting**: Uses Biome

  ```bash
  # Check for linting issues
  yarn lint
  
  # Fix linting issues
  yarn lint:fix
  
  # Format code
  yarn format
  
  # Fix formatting issues
  yarn format:fix
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
yarn test
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

Once approved and merged, maintainers will package changes into releases with the following procedure:

1. Update the version in `package.json`
2. Create a git tag with prefix `v` (for example `v0.2.0`)
3. Push the tag to the upstream repository on the commit to release on `main`
4. Create a release from the tag on GitHub with a concise release name and a description of the changes
5. CD will trigger on release creation and build the application for distribution on `npm`

**For pre-release versions**:

- Use the `alpha` or `beta` suffix (for example `v0.2.0-alpha.1`)
- Update the version in `package.json` on the `dev-` branch
- Releases can be created by maintainers from the `dev-` branch if they are not ready to be merged to main

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
