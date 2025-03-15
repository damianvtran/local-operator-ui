#!/bin/bash
# Local Operator Backend Installation Script for Linux
# This script sets up a virtual environment for the Local Operator backend
# without requiring sudo or admin privileges.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
MIN_PYTHON_VERSION="3.12"
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

# Check if PYTHON_BIN is already set by the installer
if [[ -n "$PYTHON_BIN" ]]; then
  echo "Using Python executable provided by installer: $PYTHON_BIN"
else
  # Try to find a suitable Python installation
  echo "Looking for a suitable Python installation..."
  
  # Try multiple possible locations to find Python
  POSSIBLE_PYTHON_PATHS=(
    # From environment variable (set by the installer)
    "$ELECTRON_RESOURCE_PATH/python/bin/python3"
    # Absolute paths for packaged app
    "/usr/local/bin/python3.12"
    "/usr/bin/python3.12"
    # Development paths
    "$(dirname "$0")/../../../resources/python/bin/python3"
    "$(pwd)/resources/python/bin/python3"
    # Try generic python3 as last resort
    "/usr/local/bin/python3"
    "/usr/bin/python3"
  )

  # Find the first Python that exists and is version 3.12+
  PYTHON_BIN=""
  for path in "${POSSIBLE_PYTHON_PATHS[@]}"; do
    if [[ -f "$path" && -x "$path" ]]; then
      # Check Python version
      PY_VERSION=$("$path" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
      if [[ $? -eq 0 ]]; then
        MAJOR=$(echo $PY_VERSION | cut -d. -f1)
        MINOR=$(echo $PY_VERSION | cut -d. -f2)
        if [[ "$MAJOR" -eq 3 && "$MINOR" -ge 12 ]]; then
          PYTHON_BIN="$path"
          echo "Found suitable Python $PY_VERSION at $path"
          break
        else
          echo "Python at $path is version $PY_VERSION, which is below the required 3.12+"
        fi
      fi
    fi
  done

  # If we couldn't find a suitable Python, exit with error
  if [[ -z "$PYTHON_BIN" ]]; then
    echo "Error: No suitable Python installation found (version 3.12 or higher required)."
    echo "Please install Python 3.12 or higher before running this script."
    echo "You can install Python from https://www.python.org/downloads/"
    exit 1
  fi
fi

# Verify Python exists and is executable
if [ ! -f "$PYTHON_BIN" ]; then
  echo "Error: Python not found at $PYTHON_BIN"
  exit 1
fi

# Make sure Python binary is executable
chmod +x "$PYTHON_BIN"
echo "Using Python: $PYTHON_BIN"
"$PYTHON_BIN" --version

# Check if Python has venv module available
echo "Checking for venv module availability..."
"$PYTHON_BIN" -m venv --help > /dev/null 2>&1 || {
  echo "ERROR: Python venv module not available in the Python installation"
  echo "Python details:"
  "$PYTHON_BIN" --version
  "$PYTHON_BIN" -c "import sys; print('Prefix:', sys.prefix); print('Exec Prefix:', sys.exec_prefix)"
  "$PYTHON_BIN" -c "import sys; print('Modules path:'); print('\n'.join(sys.path))"
  
  # Try to install venv module using pip
  echo "Attempting to install virtualenv using pip..."
  "$PYTHON_BIN" -m pip install --user virtualenv || {
    echo "Failed to install virtualenv. Please ensure your Python installation has pip available."
    exit 1
  }
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
    # If venv fails, try virtualenv as a fallback
    if command_exists virtualenv || "$PYTHON_BIN" -m pip install --user virtualenv; then
      echo "Falling back to virtualenv..."
      "$PYTHON_BIN" -m virtualenv "$VENV_PATH"
    else
      echo "ERROR: Failed to create virtual environment. Exit code: $?"
      echo "Virtual environment path: $VENV_PATH"
      echo "Python binary used: $PYTHON_BIN"
      ls -la "$(dirname "$VENV_PATH")"
      echo "Python executable permissions:"
      ls -la "$PYTHON_BIN"
      exit 1
    fi
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
if command_exists curl; then
  curl -s https://pypi.org/pypi/local-operator/json -o /dev/null || {
    echo "WARNING: Could not reach PyPI. Network connectivity issues might prevent installation."
  }
elif command_exists wget; then
  wget -q --spider https://pypi.org/pypi/local-operator/json || {
    echo "WARNING: Could not reach PyPI. Network connectivity issues might prevent installation."
  }
fi

echo "Installing local-operator package..."
python -m pip install --verbose local-operator || {
  echo "ERROR: Failed to install local-operator package. Exit code: $?"
  echo "Python version:"
  python --version
  echo "pip version:"
  pip --version
  echo "Available pip packages:"
  pip list
  exit 1
}
echo "local-operator installation successful"

# Verify installation
if [ -f "$VENV_PATH/bin/local-operator" ]; then
  echo "Local Operator backend installed successfully!"
  
  # Show more information about the installed binary
  ls -la "$VENV_PATH/bin/local-operator"
  file "$VENV_PATH/bin/local-operator" 2>/dev/null || echo "file command not available"
  
  # Try to run the version command with full error output
  echo "Testing local-operator binary..."
  "$VENV_PATH/bin/local-operator" --version || {
    echo "ERROR: local-operator binary exists but failed to execute. Exit code: $?"
    echo "Binary details:"
    file "$VENV_PATH/bin/local-operator" 2>/dev/null || echo "file command not available"
    echo "Binary permissions:"
    ls -la "$VENV_PATH/bin/local-operator"
    exit 1
  }
else
  echo "Error: Failed to install Local Operator backend. Binary not found."
  echo "Contents of bin directory:"
  ls -la "$VENV_PATH/bin/"
  exit 1
fi

echo "$(date): Installation completed successfully."
