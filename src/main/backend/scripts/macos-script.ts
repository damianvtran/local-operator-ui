/**
 * macOS Installation Script
 *
 * This module exports the installation script for macOS as a string.
 * Uses bundled standalone Python instead of requiring Homebrew installation.
 */

export const macosScript = `#!/bin/bash
# Local Operator Backend Installation Script for macOS
# This script uses the bundled standalone Python and sets up a virtual environment for the Local Operator backend.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
VENV_NAME="local-operator-venv"
APP_DATA_DIR="\$HOME/Library/Application Support/\$APP_NAME"
VENV_PATH="\$APP_DATA_DIR/\$VENV_NAME"
LOG_FILE="\$APP_DATA_DIR/backend-install.log"

# Check if PYTHON_BIN is already set by the installer
if [[ -n "\$PYTHON_BIN" ]]; then
  echo "Using Python executable provided by installer: \$PYTHON_BIN"
else
  # Get the path to the bundled Python
  # Try multiple possible locations to find Python
  POSSIBLE_PYTHON_PATHS=(
    # From environment variable (set by the installer)
    "\$ELECTRON_RESOURCE_PATH/python/bin/python3"
    # Absolute paths for packaged app
    "/Applications/Local Operator.app/Contents/Resources/python/bin/python3"
    "\$HOME/Applications/Local Operator.app/Contents/Resources/python/bin/python3"
    # Development paths
    "\$(dirname "\$0")/../../../resources/python/bin/python3"
    "\$(pwd)/resources/python/bin/python3"
    # Legacy Python.framework paths
    "\$ELECTRON_RESOURCE_PATH/Python.framework/Versions/Current/bin/python3"
    "\$(dirname "\$0")/../../../resources/Python.framework/Versions/Current/bin/python3"
    # System Python as last resort
    "/usr/bin/python3"
  )

  # Find the first Python that exists
  PYTHON_BIN=""
  for path in "\${POSSIBLE_PYTHON_PATHS[@]}"; do
    if [[ -f "\$path" && -x "\$path" ]]; then
      PYTHON_BIN="\$path"
      echo "Found Python at \$path"
      break
    fi
  done

  # If we couldn't find Python, try to use the system Python
  if [[ -z "\$PYTHON_BIN" ]]; then
    if command -v python3 &>/dev/null; then
      PYTHON_BIN=\$(command -v python3)
      echo "Warning: Using system Python at \$PYTHON_BIN"
    else
      echo "Error: Could not find Python. Tried the following paths:"
      for path in "\${POSSIBLE_PYTHON_PATHS[@]}"; do
        echo "  - \$path"
      done
      exit 1
    fi
  fi
fi

# Create app data directory if it doesn't exist
mkdir -p "\$APP_DATA_DIR"

# Start logging
exec > >(tee -a "\$LOG_FILE") 2>&1
echo "\$(date): Starting Local Operator backend installation..."

# Verify bundled Python exists
if [ ! -f "\$PYTHON_BIN" ]; then
  echo "Error: Bundled Python not found at \$PYTHON_BIN"
  echo "Please ensure standalone Python is properly installed in the application resources."
  exit 1
fi

# Make sure Python binary is executable
chmod +x "\$PYTHON_BIN"
echo "Using bundled Python: \$PYTHON_BIN"
"\$PYTHON_BIN" --version

# Create virtual environment if it doesn't exist
if [ ! -d "\$VENV_PATH" ]; then
  echo "Creating virtual environment at \$VENV_PATH..."
  "\$PYTHON_BIN" -m venv "\$VENV_PATH"
fi

# Activate virtual environment and install local-operator
echo "Installing local-operator in virtual environment..."
source "\$VENV_PATH/bin/activate"
pip install --upgrade pip
pip install local-operator

# Verify installation
if [ -f "\$VENV_PATH/bin/local-operator" ]; then
  echo "Local Operator backend installed successfully!"
  "\$VENV_PATH/bin/local-operator" --version
else
  echo "Error: Failed to install Local Operator backend."
  exit 1
fi

echo "\$(date): Installation completed successfully."
`;
