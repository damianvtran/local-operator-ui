<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./resources/local-operator-icon-2-dark-clear.png">
  <source media="(prefers-color-scheme: light)" srcset="./resources/local-operator-icon-2-light-clear.png">
  <img alt="Shows a black Local Operator Logo in light color mode and a white one in dark color mode."
       src="./resources/local-operator-icon-2-light-clear.png">
</picture>

<h1 align="center">Local Operator</h1>

<p align="center"><i>AI agent assistants on your device — they plan, write, and run Python, and every step stays in the conversation.</i></p>

<p align="center">
  <a href="https://github.com/damianvtran/local-operator-ui/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/damianvtran/local-operator-ui"></a>
  <a href="https://github.com/damianvtran/local-operator-ui/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/damianvtran/local-operator-ui/ci.yml?branch=main"></a>
  <a href="https://www.npmjs.com/package/local-operator-ui"><img alt="npm version" src="https://img.shields.io/npm/v/local-operator-ui"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/damianvtran/local-operator-ui"></a>
  <img alt="Platforms: macOS, Windows, and Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
</p>

<br />

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./resources/readme/app-shell-chat-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="./resources/readme/app-shell-chat-light.webp">
    <img alt="The app's chat view: an agent's reply, the run details panel with two subagents running, and their shared to-do list." src="./resources/readme/app-shell-chat-light.webp">
  </picture>
  <br />
  <sub><code>the app at work</code> — a conversation with an agent, two subagents running beside it, and the to-do list they share.</sub>
</p>

<br />

**Local Operator** runs AI agent assistants on your own machine, from a desktop chat app. You give an agent a goal; it plans the work, writes and runs Python on your device, reads and writes files, and asks before it takes anything risky. The whole run — messages, tool calls, commands, and results — stays in the conversation in front of you.

For the agent environment CLI and server backend, see the [Local Operator repository](https://github.com/damianvtran/local-operator).

<p align="center">
  <a href="https://github.com/damianvtran/local-operator">Agent backend</a> •
  <a href="https://local-operator.com">Website</a> •
  <a href="https://github.com/damianvtran/local-operator/tree/main/examples/notebooks">Examples</a>
</p>

## Getting started

### Prerequisites

- **Node.js** 22.13.1 or newer, for the npm install paths below. [nvm](https://github.com/nvm-sh/nvm) is a good way to manage Node versions. The desktop installers need no toolchain.

### Run with npx

```bash
# Download and run in one command
npx local-operator-ui
```

This runs the latest version and launches the app.

### Install with npm

```bash
# Install globally
npm install -g local-operator-ui

# Run the application
local-operator-ui
```

### Desktop applications

Prebuilt apps are on the [download page](https://local-operator.com/download) and the [releases page](https://github.com/damianvtran/local-operator-ui/releases):

- **macOS**: Download the `.dmg` (or `.zip`) and open it.
- **Windows**: Download the `.exe` installer and follow the installation prompts.
- **Linux**: Download the `.deb`, `.rpm`, or `.AppImage` for your distribution.

The Local Operator backend is bundled with the application and is installed automatically on first run. If you already have a Local Operator backend installed, the application detects it and uses it instead; by default it connects to the backend API at `http://localhost:1111`.

## What it looks like

### Chat and agents

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/chat-trace-light.webp" alt="Light theme: a conversation showing tool rows, a blocked risky action, and a question the agent asked." width="420"> | <img src="./resources/readme/chat-trace-dark.webp" alt="Dark theme: the same conversation." width="420"> |

<sub><code>chat</code> — a working agent's tool rows, a blocked risky action, and the question it asked before continuing.</sub>

### Subagents

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/subagents-light.webp" alt="Light theme: the run details panel, two subagents running with their elapsed time and cost, a third child queued behind the capacity gate, and the shared to-do list." width="420"> | <img src="./resources/readme/subagents-dark.webp" alt="Dark theme: the same run details panel." width="420"> |

<sub><code>subagents</code> — two helpers working one request, each with its own elapsed time, context use and cost, and the next child queued behind the capacity gate.</sub>

### Teams

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/teams-light.webp" alt="Light theme: the agents and teams page, with the release-crew roster: its manager agent, members and collaboration instructions." width="420"> | <img src="./resources/readme/teams-dark.webp" alt="Dark theme: the same teams page." width="420"> |

<sub><code>teams</code> — agents grouped under a manager, with a roster, collaboration instructions and a project brief.</sub>

### Media in a conversation

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/media-in-conversation-light.webp" alt="Light theme: a conversation holding a pasted chart and a bar chart the agent plotted, rendered under the tool row that made it." width="420"> | <img src="./resources/readme/media-in-conversation-dark.webp" alt="Dark theme: the same conversation." width="420"> |

<sub><code>media</code> — a chart pasted in by hand and one the agent plotted, both rendered inline in the transcript.</sub>

### Agent hub

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/agent-hub-light.webp" alt="Light theme: the agent hub with categories and a grid of community agents." width="420"> | <img src="./resources/readme/agent-hub-dark.webp" alt="Dark theme: the agent hub grid." width="420"> |

<sub><code>agent hub</code> — community agents you can browse and download, by category.</sub>

### Schedules

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/schedules-light.webp" alt="Light theme: the schedules page, listing scheduled wakes with their cadence and run history." width="420"> | <img src="./resources/readme/schedules-dark.webp" alt="Dark theme: the schedules page." width="420"> |

<sub><code>schedules</code> — conversations that wake on a timer, with what ran and when they run next.</sub>

### Projects

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/projects-board-light.webp" alt="Light theme: the projects board with active, paused, and done columns." width="420"> | <img src="./resources/readme/projects-board-dark.webp" alt="Dark theme: the projects board." width="420"> |

<sub><code>projects</code> — workstreams you and your agents track across sessions, as a board or a timeline.</sub>

### Appearance

| Light | Dark |
| :---: | :---: |
| <img src="./resources/readme/appearance-light.webp" alt="Light theme: the appearance picker showing the Local Operator themes as swatches." width="420"> | <img src="./resources/readme/appearance-dark.webp" alt="Dark theme: the appearance picker." width="420"> |

<sub><code>appearance</code> — 59 colour themes ship with the app; Local Operator Dark is the default.</sub>

## Features

- **Chat with agents** — real-time conversation with markdown rendering for code blocks and formatted text, syntax highlighting, and per-conversation history.
- **Agent management** — create, update, and delete agents, and configure their settings: model and description (general), temperature and top_p (chat), and security prompt and execution permissions (security).
- **Settings** — system prompt configuration, API credentials management, and application configuration in one place.
- **Local Operator API integration** — the app talks to the Local Operator backend API and shows real-time status updates for long-running operations.
- **Bundled backend** — the Local Operator backend is installed automatically on first run on every platform; an existing backend installation is detected and used instead.

## Project structure

The codebase is organized for modularity and code reuse:

- `src/renderer/src/shared/`: Contains all shared code, including components, hooks, stores, configuration, themes, and utilities. Use the `@shared/` path alias for imports.
- `src/renderer/src/features/`: Contains feature-specific code for the UI, organized by domain.
- `src/renderer/src/app.tsx`, `main.tsx`, etc.: Entry points for the Electron renderer process.
- `build/`, `resources/`, `scripts/`: Build assets, static resources, and build scripts.

**Import conventions:**

- Use `@shared/` for shared modules (e.g., `import { useAgents } from "@shared/hooks/use-agents"`).
- Use `@features/` for feature-specific modules.
- The build also resolves the older aliases (`@renderer`, `@components`, `@hooks`, etc.) for the files that still import them.

For more details on building or contributing, see the [Contributing Guide](./CONTRIBUTING.md) and [BUILD.md](./docs/BUILD.md).

## Building from source

If you want to build the application from source, see the [BUILD.md](./docs/BUILD.md) file for detailed instructions.

### Python bundling

For macOS builds, the app bundles a standalone Python directly instead of requiring a Homebrew installation. This approach:

- Needs no admin privileges during installation
- Keeps the application self-contained
- Works offline
- Supports installing Python packages with pip

To set up the standalone Python for development:

```bash
# Run the setup script to download and configure standalone Python
pnpm setup-python-standalone
```

This uses [python-build-standalone](https://github.com/indygreg/python-build-standalone), the same approach used by Datasette Desktop and PyOxidizer.

For more details, see the [PYTHON_BUNDLING.md](./docs/PYTHON_BUNDLING.md) documentation.

### Code signing and notarization

All desktop applications are code signed and notarized to ensure security and trust:

- **macOS**: Applications are signed with an Apple Developer ID and notarized with Apple's notarization service
- **Windows**: Applications are signed with a trusted code signing certificate
- **Linux**: While code signing is less common on Linux, packages are built with integrity checks

For detailed information about the code signing and notarization process, see the [CODE_SIGNING.md](./docs/CODE_SIGNING.md) document.

## Contributing

Contributions are welcome! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on how to get started with development, code style guidelines, and our contribution process.

## Troubleshooting

### Common issues

#### Application fails to connect to the backend

- The application will automatically install and start the Local Operator backend if it's not already running
- If you have an existing backend running on `http://localhost:1111`, the application will use that instead
- Check that the `VITE_LOCAL_OPERATOR_API_URL` environment variable has not been set to a different URL. This value is set automatically to `http://localhost:1111` if a custom `.env` doesn't specify otherwise
- If you want to disable the automatic backend management, set the `VITE_DISABLE_BACKEND_MANAGER` environment variable to `true`
- Verify network connectivity between the UI and the backend

#### Backend installation fails

- Check the application logs for error messages
- For macOS, the application uses a bundled Python framework instead of requiring Homebrew and pyenv
- If you encounter issues with the bundled Python, see the [PYTHON_BUNDLING.md](./docs/PYTHON_BUNDLING.md) documentation
- As a fallback, you can try installing the backend manually with `pip install local-operator` and then start it with `local-operator serve`

#### Development server crashes

- Check the console for error messages
- Ensure all dependencies are installed correctly
- Try clearing the node_modules folder and reinstalling dependencies

#### UI rendering issues

- Check for console errors in the developer tools
- Ensure you're using a compatible version of Node.js
- Try restarting the development server

#### The window came to the front on its own, or a run never appeared

Every time the app brings a window to the front it writes one line to its own backend log (`~/Library/Application Support/Local Operator/logs/backend-service.log` on macOS; the `LOCAL_OPERATOR_LOG_DIR` environment variable moves it):

```
[window-raise] trigger=second-instance mode=normal requested=focus pid=9182 cwd=/Users/you/project applied=restore+show+focus
```

`trigger` names what asked: `initial-present` (the app starting up), `second-instance` (a second launch sharing this profile), `banner-click`, `viewer-focus` or `viewer-resume`. `pid` and `cwd`, when they are there, name the process that asked — that is the one to stop if something keeps doing it. A run that raises nothing writes nothing, so an app that never came forward has no line at all — although a conversation that is WAITING for a window does: a `headless` launch against an app with no window open writes `applied=parked`, `parked=<id>` rather than a raise, and that conversation opens the next window you give the app. In the line above, `mode` is the window mode the raise ran under and `applied` is what it actually did.

A second launch only brings the window as far as IT asked: a `headless` run never raises it (it can still load the conversation it names), an `inactive` one orders the window without activating the app and without pulling it back out of the Dock, and a launch that declares nothing — you double-clicking the app while it is already running — still comes to the front.

## Getting help

If you encounter issues not covered here, please:

1. Check the [GitHub Issues](https://github.com/damianvtran/local-operator-ui/issues) for similar problems
2. Open a new issue if your problem hasn't been reported

## Credits

Some general style and interaction UX here is inspired by [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details. It is open source because AI tools should be accessible to everyone, and your contributions and feedback help make that real.
