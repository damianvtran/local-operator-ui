#!/bin/bash
# Local Operator Backend Installation Script for macOS
# This script uses the bundled standalone Python and sets up a virtual environment for the Local Operator backend.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
VENV_NAME="local-operator-venv"
APP_DATA_DIR="$HOME/Library/Application Support/$APP_NAME"
VENV_PATH="$APP_DATA_DIR/$VENV_NAME"
LOG_FILE="$APP_DATA_DIR/backend-install.log"

# Check if PYTHON_BIN is already set by the installer
if [[ -n "$PYTHON_BIN" ]]; then
  echo "Using Python executable provided by installer: $PYTHON_BIN"
else
  # Get the path to the bundled Python
  # Try multiple possible locations to find Python
  POSSIBLE_PYTHON_PATHS=(
    # From environment variable (set by the installer)
    "$ELECTRON_RESOURCE_PATH/python/bin/python3"
    # Absolute paths for packaged app
    "/Applications/Local Operator.app/Contents/Resources/python/bin/python3"
    "$HOME/Applications/Local Operator.app/Contents/Resources/python/bin/python3"
    # Development paths
    "$(dirname "$0")/../../../resources/python/bin/python3"
    "$(pwd)/resources/python/bin/python3"
    # System Python as last resort
    "/usr/bin/python3"
  )

  # Find the first Python that exists
  PYTHON_BIN=""
  for path in "${POSSIBLE_PYTHON_PATHS[@]}"; do
    if [[ -f "$path" && -x "$path" ]]; then
      PYTHON_BIN="$path"
      echo "Found Python at $path"
      break
    fi
  done

  # If we couldn't find Python, try to use the system Python
  if [[ -z "$PYTHON_BIN" ]]; then
    if command -v python3 &>/dev/null; then
      PYTHON_BIN=$(command -v python3)
      echo "Warning: Using system Python at $PYTHON_BIN"
    else
      echo "Error: Could not find Python. Tried the following paths:"
      for path in "${POSSIBLE_PYTHON_PATHS[@]}"; do
        echo "  - $path"
      done
      exit 1
    fi
  fi
fi

# Create app data directory if it doesn't exist
mkdir -p "$APP_DATA_DIR"

# Start logging - capture everything and ensure it's visible to parent process
exec > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2)
echo "=============================================="
echo "$(date): Starting Local Operator backend installation..."
echo "=============================================="
echo "Python bin path: $PYTHON_BIN"
echo "Virtual environment path: $VENV_PATH"
echo "App data directory: $APP_DATA_DIR"
echo "Log file: $LOG_FILE"
echo "=============================================="

# Verify bundled Python exists
if [ ! -f "$PYTHON_BIN" ]; then
  echo "Error: Bundled Python not found at $PYTHON_BIN"
  echo "Please ensure standalone Python is properly installed in the application resources."
  exit 1
fi

# Make sure Python binary is executable
chmod +x "$PYTHON_BIN"
echo "Using bundled Python: $PYTHON_BIN"
"$PYTHON_BIN" --version

# Check if Python has venv module available
echo "Checking for venv module availability..."
"$PYTHON_BIN" -m venv --help > /dev/null 2>&1 || {
  echo "ERROR: Python venv module not available in the Python installation"
  echo "Python details:"
  "$PYTHON_BIN" --version
  "$PYTHON_BIN" -c "import sys; print('Prefix:', sys.prefix); print('Exec Prefix:', sys.exec_prefix)"
  "$PYTHON_BIN" -c "import sys; print('Modules path:'); print('\n'.join(sys.path))"
  exit 1
}
echo "venv module is available"

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_PATH" ]; then
  echo "Creating virtual environment at $VENV_PATH..."
  # Remove any potentially corrupted virtual environment
  if [ -e "$VENV_PATH" ]; then
    echo "Removing existing but potentially corrupted venv directory..."
    rm -rf "$VENV_PATH"
  fi
  
  # Make sure parent directory exists and is writable
  mkdir -p "$(dirname "$VENV_PATH")"
  
  # Create the virtual environment with verbosity
  "$PYTHON_BIN" -m venv "$VENV_PATH" || {
    echo "ERROR: Failed to create virtual environment. Exit code: $?"
    echo "Virtual environment path: $VENV_PATH"
    echo "Python binary used: $PYTHON_BIN"
    ls -la "$(dirname "$VENV_PATH")"
    echo "Python executable permissions:"
    ls -la "$PYTHON_BIN"
    exit 1
  }
  echo "Successfully created virtual environment"
fi

# Verify the virtual environment structure
echo "Verifying virtual environment structure..."
if [ ! -f "$VENV_PATH/bin/python" ] || [ ! -f "$VENV_PATH/bin/pip" ]; then
  echo "ERROR: Virtual environment is missing critical components"
  echo "Contents of virtual environment directory:"
  ls -la "$VENV_PATH"
  if [ -d "$VENV_PATH/bin" ]; then
    echo "Contents of bin directory:"
    ls -la "$VENV_PATH/bin"
  fi
  exit 1
fi
echo "Virtual environment structure verified"

# Activate virtual environment and install local-operator
echo "Installing local-operator in virtual environment..."
source "$VENV_PATH/bin/activate"

echo "Upgrading pip..."
python -m pip install --upgrade pip || {
  echo "ERROR: Failed to upgrade pip. Exit code: $?"
  echo "pip version before failing:"
  pip --version
  exit 1
}
echo "pip upgrade successful:"
pip --version

# Check network connectivity to PyPI
echo "Checking network connectivity to PyPI..."
curl -s https://pypi.org/pypi/local-operator/json -o /dev/null || {
  echo "WARNING: Could not reach PyPI. Network connectivity issues might prevent installation."
  echo "Attempting to ping common domains to diagnose network issues:"
  ping -c 1 google.com || echo "Cannot ping google.com"
  ping -c 1 pypi.org || echo "Cannot ping pypi.org"
}

echo "Installing local-operator package..."
python -m pip install --verbose local-operator || {
  echo "ERROR: Failed to install local-operator package. Exit code: $?"
  echo "Python version:"
  python --version
  echo "pip version:"
  pip --version
  echo "Available pip packages:"
  pip list
  echo "Pip config:"
  pip config list
  echo "Network diagnosis:"
  curl -I https://pypi.org || echo "Cannot reach PyPI server"
  exit 1
}
echo "local-operator installation successful"

# Verify installation
if [ -f "$VENV_PATH/bin/local-operator" ]; then
  echo "Local Operator backend installed successfully!"
  
  # Show more information about the installed binary
  ls -la "$VENV_PATH/bin/local-operator"
  file "$VENV_PATH/bin/local-operator"
  
  # Try to run the version command with full error output
  echo "Testing local-operator binary..."
  "$VENV_PATH/bin/local-operator" --version || {
    echo "ERROR: local-operator binary exists but failed to execute. Exit code: $?"
    echo "Binary details:"
    file "$VENV_PATH/bin/local-operator"
    echo "Binary permissions:"
    ls -la "$VENV_PATH/bin/local-operator"
    echo "Dependencies:"
    if command -v otool >/dev/null; then
      otool -L "$VENV_PATH/bin/local-operator" || echo "Could not get dependencies with otool"
    fi
    exit 1
  }
else
  echo "Error: Failed to install Local Operator backend. Binary not found."
  echo "Contents of bin directory:"
  ls -la "$VENV_PATH/bin/"
  exit 1
fi

echo "$(date): Installation completed successfully."
