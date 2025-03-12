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

This project is proudly open source under the GPL-3.0 license. We believe AI tools should be accessible to everyone, given their transformative impact on productivity. Your contributions and feedback help make this vision a reality!

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

- **Node.js**: Version 22.13.1 or higher. It's recommended to use [nvm](https://github.com/nvm-sh/nvm) for managing Node.js versions.
- **Local Operator Backend**: The UI connects to the Local Operator backend API. See the [Local Operator GitHub repository](https://github.com/damianvtran/local-operator) for installation instructions.  Install it globally or in a virtual environment with `pip install local-operator` and then boot it up on `localhost:1111` with `local-operator serve`.

### NPM Installation

You can install and run Local Operator UI directly using [npx](https://docs.n8n.io/hosting/installation/npm/).

```bash
# Install and run in one command
npx local-operator-ui
```

This will download and execute the latest version of the Local Operator UI, launching the application immediately.

### Manual Installation

Alternatively, without npx, you can install the package globally with standard npm:

```bash
# Install globally
npm install -g local-operator-ui

# Run the application
local-operator-ui
```

After installation, the application will automatically connect to the Local Operator backend API at `http://localhost:1111` by default.

### Desktop Applications

Pre-built desktop applications are available for macOS, Windows, and Linux. Visit the [Releases](https://github.com/damianvtran/local-operator-ui/releases) page to download the latest version for your platform.

- **macOS**: Download the `.dmg` file and drag the application to your Applications folder.
- **Windows**: Download the `.exe` installer and follow the installation prompts.
- **Linux**: Download the appropriate package (`.deb`, `.rpm`, or `.AppImage`) for your distribution.

### Building from Source

If you want to build the application from source, see the [BUILD.md](./BUILD.md) file for detailed instructions.

## ✨ Features

The Local Operator UI provides a comprehensive interface for interacting with AI agents:

### Chat Interface

- Real-time chat with AI agents
- Markdown rendering for code blocks and formatted text
- Syntax highlighting for code snippets
- Message history and conversation management

### Agent Management

- Create, update, and delete AI agents
- Configure agent settings:
  - General settings (name, description, model)
  - Chat settings (temperature, top_p, etc.)
  - Security settings (security prompt, execution permissions)

### Settings

- System prompt configuration
- API credentials management
- Application configuration

### API Integration

- Seamless integration with the Local Operator backend API
- Real-time status updates for long-running operations
- Error handling and retry mechanisms

## 🤝 Contributing

Contributions are welcome! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on how to get started with development, code style guidelines, and our contribution process.

## 🐛 Troubleshooting

### Common Issues

#### Application fails to connect to the backend

- Ensure the Local Operator backend is running and hosting on `http://localhost:1111`
- Check that the `VITE_LOCAL_OPERATOR_API_URL` environment variable has not been set to a different URL.  This value is set automatically to `http://localhost:1111` if a custom `.env` doesn't specify otherwise.
- Verify network connectivity between the UI and the backend

#### Development server crashes

- Check the console for error messages
- Ensure all dependencies are installed correctly
- Try clearing the node_modules folder and reinstalling dependencies

#### UI rendering issues

- Check for console errors in the developer tools
- Ensure you're using a compatible version of Node.js
- Try restarting the development server

### Getting Help

If you encounter issues not covered here, please:

1. Check the [GitHub Issues](https://github.com/local-operator/local-operator-ui/issues) for similar problems
2. Open a new issue if your problem hasn't been reported

## 📄 License

This project is licensed under the GPL-3.0 License - see the [LICENSE](LICENSE) file for details.
