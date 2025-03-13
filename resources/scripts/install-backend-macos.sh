#!/bin/bash
# Local Operator Backend Installation Script for macOS
# This script installs pyenv, Python 3.12, and sets up a virtual environment for the Local Operator backend.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
PYTHON_VERSION="3.12.0"
VENV_NAME="local-operator-venv"
APP_DATA_DIR="$HOME/Library/Application Support/$APP_NAME"
VENV_PATH="$APP_DATA_DIR/$VENV_NAME"
LOG_FILE="$APP_DATA_DIR/backend-install.log"

# Create app data directory if it doesn't exist
mkdir -p "$APP_DATA_DIR"

# Start logging
exec > >(tee -a "$LOG_FILE") 2>&1
echo "$(date): Starting Local Operator backend installation..."

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Install Homebrew if not installed
if ! command_exists brew; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  
  # Add Homebrew to PATH
  if [[ -f ~/.zshrc ]]; then
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zshrc
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -f ~/.bash_profile ]]; then
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.bash_profile
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi

# Install pyenv if not installed
if ! command_exists pyenv; then
  echo "Installing pyenv..."
  brew install pyenv
  
  # Add pyenv to PATH
  if [[ -f ~/.zshrc ]]; then
    echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
    echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
    echo 'eval "$(pyenv init -)"' >> ~/.zshrc
    
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"
  elif [[ -f ~/.bash_profile ]]; then
    echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bash_profile
    echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bash_profile
    echo 'eval "$(pyenv init -)"' >> ~/.bash_profile
    
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"
  fi
fi

# Install Python 3.12 if not installed
if ! pyenv versions | grep -q "$PYTHON_VERSION"; then
  echo "Installing Python $PYTHON_VERSION..."
  pyenv install "$PYTHON_VERSION"
fi

# Set Python 3.12 as the local version
pyenv local "$PYTHON_VERSION"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_PATH" ]; then
  echo "Creating virtual environment at $VENV_PATH..."
  python -m venv "$VENV_PATH"
fi

# Activate virtual environment and install local-operator
echo "Installing local-operator in virtual environment..."
source "$VENV_PATH/bin/activate"
pip install --upgrade pip
pip install local-operator

# Verify installation
if command_exists local-operator; then
  echo "Local Operator backend installed successfully!"
  local-operator --version
else
  echo "Error: Failed to install Local Operator backend."
  exit 1
fi

echo "$(date): Installation completed successfully."
