<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./resources/local-operator-icon-2-dark-clear.png">
  <source media="(prefers-color-scheme: light)" srcset="./resources/local-operator-icon-2-light-clear.png">
  <img alt="Shows a black Local Operator Logo in light color mode and a white one in dark color mode."
       src="./resources/local-operator-icon-2-light-clear.png">
</picture>

<h1 align="center">Local Operator: AI Agent Assistants On Your Device</h1>
<div align="center">
  <h2>🤖 Your Personal Assistant that Gets Things Done with Python</h2>
  <p><i>Real-time code execution on your device through natural conversation</i></p>
</div>

**<span style="color: #38C96A">Local Operator</span>** empowers you to run Python code safely on your own machine through an intuitive chat interface. The AI agent:

🎯 **Plans & Executes** - Breaks down complex goals into manageable steps and executes them with precision.

🔒 **Prioritizes Security** - Built-in safety checks by independent AI review and user confirmations keep your system protected

🌐 **Flexible Deployment** - Run completely locally with Ollama models or leverage cloud providers like OpenAI

🔧 **Problem Solving** - Intelligently handles errors and roadblocks by adapting approaches and finding alternative solutions

This project is proudly open source under the MIT license. We believe AI tools should be accessible to everyone, given their transformative impact on productivity. Your contributions and feedback help make this vision a reality!

> "Democratizing AI-powered productivity, one conversation at a time."

<div align="center">
  <a href="https://github.com/damianvtran/local-operator">Agent Backend</a> •
  <a href="https://local-operator.com">Learn More</a> •
  <a href="https://github.com/damianvtran/local-operator/tree/main/examples/notebooks">Examples</a>
</div>

## 💡 Overview

The Local Operator UI is a user interface for managing and interacting with the Local Operator agent environment. It is built using Electron, React, and TypeScript, leveraging modern web technologies for a rich and responsive user experience.

👉 For the agent environment CLI and Server backend, see the [Local Operator GitHub repository](https://github.com/damianvtran/local-operator).

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version specified in `.nvmrc`. It's recommended to use [nvm](https://github.com/nvm-sh/nvm) for managing Node.js versions.
- **yarn**: Installable via `npm install -g yarn`.

### Installation

**Clone the repository:**

```bash
git clone https://github.com/local-operator/local-operator-ui.git
cd local-operator-ui
```

**Install dependencies:**

```bash
yarn install
```

### Development

For local development, follow these steps:

**Start the development server:**

```bash
yarn dev
```

This command will start the Electron application in development mode, with hot reloading enabled for both the main process and the renderer process.

### Production

To build and run the application in production mode:

**Build and start the application:**

```bash
yarn start
```

This command will run the pre-build script and then start the Electron application in production mode, loading the compiled assets.
