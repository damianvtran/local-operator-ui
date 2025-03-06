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
- **Local Operator Backend**: The UI connects to the Local Operator backend API. See the [Local Operator GitHub repository](https://github.com/damianvtran/local-operator) for installation instructions.

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

**Configure environment variables:**

Copy the `.env.template` file to `.env` and update the values as needed:

```bash
cp .env.template .env
```

The main environment variable is:

- `VITE_LOCAL_OPERATOR_API_URL`: URL of the Local Operator backend API (default: `http://localhost:1111`)

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

## 🏗️ Project Structure

The project follows a modular architecture with clear separation of concerns:

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
└── README.md                   # Project documentation
```

### Key Directories

- **src/main**: Contains the Electron main process code
- **src/preload**: Contains the Electron preload scripts
- **src/renderer**: Contains the React application code
  - **api**: API clients for communicating with the Local Operator backend
  - **components**: React components organized by feature
  - **hooks**: Custom React hooks for data fetching and state management
  - **store**: Global state management using Zustand

## 🛠️ Technology Stack

The Local Operator UI is built with the following technologies:

### Core Technologies

- **Electron**: Cross-platform desktop application framework
- **React**: UI library for building component-based interfaces
- **TypeScript**: Typed superset of JavaScript for improved developer experience
- **Vite**: Modern frontend build tool

### UI Framework and Styling

- **Material UI (MUI)**: React component library implementing Google's Material Design
- **Styled Components**: CSS-in-JS library for component styling
- **Emotion**: CSS-in-JS library used by MUI
- **FontAwesome**: Icon library

### State Management and Data Fetching

- **Zustand**: Lightweight state management library
- **React Query**: Data fetching and caching library
- **Zod**: TypeScript-first schema validation

### Development Tools

- **Biome**: Fast linter and formatter for JavaScript and TypeScript
- **ESLint**: JavaScript and TypeScript linter
- **TypeScript**: Static type checking

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

## 🧪 Testing

The project uses Jest for testing. To run tests:

```bash
yarn test
```

## 🔧 Linting and Formatting

The project uses Biome for linting and formatting. To lint and format the code:

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

## 🤝 Contributing

Contributions are welcome! Here's how you can contribute:

1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature-name`)
3. Make your changes
4. Run tests and linting (`yarn test && yarn lint`)
5. Commit your changes (`git commit -m 'Add some feature'`)
6. Push to the branch (`git push origin feature/your-feature-name`)
7. Open a Pull Request

Please ensure your code follows the project's coding standards:

- Use TypeScript for all new code
- Follow the existing code style and patterns
- Write tests for new features
- Update documentation as needed

### Code Style Guidelines

- Use `type` instead of `interface` for type definitions
- Use kebab-case for file names and PascalCase for component names
- Use named exports instead of default exports
- Include JSDoc documentation where appropriate
- Follow Biome linting conventions

## 🐛 Troubleshooting

### Common Issues

#### Application fails to connect to the backend

- Ensure the Local Operator backend is running
- Check that the `VITE_LOCAL_OPERATOR_API_URL` environment variable is set correctly
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

This project is licensed under the MIT License - see the LICENSE file for details.
