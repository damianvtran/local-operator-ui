/**
 * Linux Installation Script
 *
 * This module exports the installation script for Linux as a string.
 */

export const linuxScript = `#!/bin/bash
# Local Operator Backend Installation Script for Linux
# This script installs pyenv, Python 3.12, and sets up a virtual environment for the Local Operator backend.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
PYTHON_VERSION="3.12.0"
VENV_NAME="local-operator-venv"
APP_DATA_DIR="$HOME/.config/local-operator"
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

# Detect package manager
if command_exists apt-get; then
  PKG_MANAGER="apt-get"
  PKG_INSTALL="apt-get install -y"
  PKG_UPDATE="apt-get update"
  PKG_DEPS="make build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev libncursesw5-dev xz-utils tk-dev libffi-dev liblzma-dev python-openssl git"
elif command_exists dnf; then
  PKG_MANAGER="dnf"
  PKG_INSTALL="dnf install -y"
  PKG_UPDATE="dnf check-update"
  PKG_DEPS="make gcc zlib-devel bzip2 bzip2-devel readline-devel sqlite sqlite-devel openssl-devel tk-devel libffi-devel xz-devel"
elif command_exists yum; then
  PKG_MANAGER="yum"
  PKG_INSTALL="yum install -y"
  PKG_UPDATE="yum check-update"
  PKG_DEPS="make gcc zlib-devel bzip2 bzip2-devel readline-devel sqlite sqlite-devel openssl-devel tk-devel libffi-devel xz-devel"
elif command_exists pacman; then
  PKG_MANAGER="pacman"
  PKG_INSTALL="pacman -S --noconfirm"
  PKG_UPDATE="pacman -Sy"
  PKG_DEPS="base-devel openssl zlib bzip2 readline sqlite curl llvm xz tk libffi python-pyopenssl git"
else
  echo "Error: Unsupported package manager. Please install dependencies manually."
  exit 1
fi

# Install dependencies
echo "Installing dependencies using $PKG_MANAGER..."
$PKG_UPDATE
$PKG_INSTALL $PKG_DEPS

# Install pyenv if not installed
if ! command_exists pyenv; then
  echo "Installing pyenv..."
  curl https://pyenv.run | bash
  
  # Add pyenv to PATH
  if [[ -f ~/.bashrc ]]; then
    echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.bashrc
    echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.bashrc
    echo 'eval "$(pyenv init -)"' >> ~/.bashrc
    
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"
  elif [[ -f ~/.zshrc ]]; then
    echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.zshrc
    echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.zshrc
    echo 'eval "$(pyenv init -)"' >> ~/.zshrc
    
    export PYENV_ROOT="$HOME/.pyenv"
    export PATH="$PYENV_ROOT/bin:$PATH"
    eval "$(pyenv init -)"
  else
    echo 'export PYENV_ROOT="$HOME/.pyenv"' >> ~/.profile
    echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"' >> ~/.profile
    echo 'eval "$(pyenv init -)"' >> ~/.profile
    
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
`;
