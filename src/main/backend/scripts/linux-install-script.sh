#!/bin/bash
# Local Operator Backend Installation Script for Linux
# This script sets up a virtual environment for the Local Operator backend
# without requiring sudo or admin privileges.

# Exit on error, undefined variables, and failed pipe commands
set -e  # Exit immediately if a command exits with a non-zero status
set -u  # Error on unset variables
set -o pipefail  # Fail if any command in a pipe fails

# Configuration
# Variables APP_NAME and MIN_PYTHON_VERSION removed as they were unused
VENV_NAME="local-operator-venv"
APP_DATA_DIR="${HOME}/.config/local-operator"
VENV_PATH="${APP_DATA_DIR}/${VENV_NAME}"
LOG_FILE="${APP_DATA_DIR}/backend-install.log"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")

# Create app data directory if it doesn't exist
if ! mkdir -p "${APP_DATA_DIR}"; then
  echo "ERROR: Unable to create app data directory at ${APP_DATA_DIR}"
  echo "Please check permissions and try again."
  exit 1
fi

# Handle cleanup on script exit
cleanup() {
  # Remove any temporary files created during execution
  if [ -f "${APP_DATA_DIR}/get-pip.py" ]; then
    rm -f "${APP_DATA_DIR}/get-pip.py"
  fi
  echo "$(date): Cleanup completed."
}

# Set trap only for manual interruption (SIGINT, SIGTERM), not normal exits
trap cleanup SIGINT SIGTERM


# Start logging
exec > >(tee -a "${LOG_FILE}") 2>&1
echo "[${TIMESTAMP}]: Starting Local Operator backend installation..."
echo "[${TIMESTAMP}]: System information: $(uname -a)"

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Function to log messages with timestamp
log() {
  local timestamp
  timestamp=$(date +"%Y-%m-%d %H:%M:%S")
  echo "[${timestamp}] $1"
}

# Function to display error messages and exit
error_exit() {
  log "ERROR: $1" >&2
  exit "${2:-1}"
}

# Function to check if Python binary is valid for current architecture
is_valid_python_binary() {
  local python_path="$1"
  
  # First check if file exists and is executable
  if [ ! -f "${python_path}" ] || [ ! -x "${python_path}" ]; then
    return 1
  fi
  
  # Try to run a simple Python command to verify it works on current architecture
  "${python_path}" -c "print('Testing Python executable')" >/dev/null 2>&1
  return $?
}

# Check for network connectivity to key servers
check_connectivity() {
  log "Checking network connectivity..."
  local servers=("pypi.org" "bootstrap.pypa.io")
  local has_connectivity=false
  
  for server in "${servers[@]}"; do
    if command_exists curl; then
      if curl --connect-timeout 5 -s "https://${server}" -o /dev/null; then
        has_connectivity=true
        break
      fi
    elif command_exists wget; then
      if wget --timeout=5 -q --spider "https://${server}"; then
        has_connectivity=true
        break
      fi
    fi
  done
  
  if [ "$has_connectivity" = false ]; then
    log "WARNING: Network connectivity issues detected. This may affect installation."
  else
    log "Network connectivity confirmed."
  fi
}

# Call connectivity check
check_connectivity

# Check if PYTHON_BIN is already set by the installer
if [ -n "${PYTHON_BIN:-}" ]; then
  log "Using Python executable provided by installer: ${PYTHON_BIN}"
  # Verify the provided Python binary works on this architecture
  if ! is_valid_python_binary "${PYTHON_BIN}"; then
    log "Warning: The provided Python binary is not compatible with this system architecture."
    log "Will attempt to find a system Python installation instead."
    PYTHON_BIN=""
  fi
fi

# If PYTHON_BIN is empty or invalid, try to find a suitable Python installation
if [ -z "${PYTHON_BIN:-}" ] || ! is_valid_python_binary "${PYTHON_BIN:-}"; then
  # Try to find a suitable Python installation
  log "Looking for a suitable Python installation..."
  
  # Try multiple possible locations to find Python
  POSSIBLE_PYTHON_PATHS=(
    # System paths first (more likely to be compatible with current architecture)
    "/usr/local/bin/python3.12"
    "/usr/bin/python3.12"
    "/usr/local/bin/python3"
    "/usr/bin/python3"
    # From environment variable (set by the installer)
    "${ELECTRON_RESOURCE_PATH:-}/python/bin/python3"
    # Development paths
    "$(dirname "$0")/../../../resources/python/bin/python3"
    "$(pwd)/resources/python/bin/python3"
  )

  # Find the first Python that exists and is version 3.12+ and works on this architecture
  PYTHON_BIN=""
  for path in "${POSSIBLE_PYTHON_PATHS[@]}"; do
    # Skip empty paths that might come from unset environment variables
    if [ -z "${path}" ]; then
      continue
    fi
    
    if is_valid_python_binary "${path}"; then
      # Check Python version
      if PY_VERSION=$("${path}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null); then
        MAJOR=$(echo "${PY_VERSION}" | cut -d. -f1)
        MINOR=$(echo "${PY_VERSION}" | cut -d. -f2)
        if [ "${MAJOR}" -eq 3 ] && [ "${MINOR}" -ge 12 ]; then
          PYTHON_BIN="${path}"
          log "Found suitable Python ${PY_VERSION} at ${path}"
          break
        else
          log "Python at ${path} is version ${PY_VERSION}, which is below the required 3.12+"
        fi
      fi
    else
      if [ -f "${path}" ]; then
        log "Python at ${path} exists but is not compatible with this system architecture"
      fi
    fi
  done

  # If we couldn't find a suitable Python, exit with error
  if [ -z "${PYTHON_BIN:-}" ]; then
    error_exit "No suitable Python installation found (version 3.12 or higher required).\nPlease install Python 3.12 or higher before running this script.\nYou can install Python from https://www.python.org/downloads/"
  fi
fi

echo "Using Python: $PYTHON_BIN"
"$PYTHON_BIN" --version || {
  echo "Error: Failed to run Python. Please ensure it is executable and accessible."
  echo "System architecture: $(uname -m)"
  echo "Python binary architecture: $(file "$PYTHON_BIN" 2>/dev/null || echo 'Unable to determine')"
  exit 1
}

# Detect the Linux distribution to provide specific instructions
if command_exists lsb_release; then
  DISTRO=$(lsb_release -is)
  DISTRO_VERSION=$(lsb_release -rs)
  echo "Detected Linux distribution: $DISTRO $DISTRO_VERSION"
elif [ -f /etc/os-release ]; then
  DISTRO=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
  DISTRO_VERSION=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"')
  echo "Detected Linux distribution: $DISTRO $DISTRO_VERSION"
else
  DISTRO="unknown"
  echo "Unable to detect Linux distribution"
fi

# Check if Python has venv module and ensurepip available
log "Checking for venv module and ensurepip availability..."
VENV_AVAILABLE=0
ENSUREPIP_AVAILABLE=0

"${PYTHON_BIN}" -c "import venv" > /dev/null 2>&1 || VENV_AVAILABLE=1
"${PYTHON_BIN}" -c "import ensurepip" > /dev/null 2>&1 || ENSUREPIP_AVAILABLE=1

# If venv is still not available, try to use virtualenv as a fallback
if [ $VENV_AVAILABLE -ne 0 ]; then
  echo "venv module is not available. Checking for virtualenv as an alternative..."
  
  # Check if virtualenv is already installed
  if "$PYTHON_BIN" -c "import virtualenv" > /dev/null 2>&1; then
    echo "virtualenv is available, will use it instead of venv"
  else
    echo "ERROR: Neither venv nor virtualenv is available."
    echo "Python 3.12 and venv should be installed as package dependencies."
    echo "Please ensure Python 3.12 and venv are properly installed on your system."
    exit 1
  fi
fi

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
  
  # Try different methods to create a virtual environment
  VENV_CREATE_STATUS=1
  
  # First try with venv if available
  if [ $VENV_AVAILABLE -eq 0 ] && [ $ENSUREPIP_AVAILABLE -eq 0 ]; then
    echo "Creating virtual environment using venv module..."
    "$PYTHON_BIN" -m venv "$VENV_PATH"
    VENV_CREATE_STATUS=$?
  fi
  
  # If venv failed, try virtualenv
  if [ $VENV_CREATE_STATUS -ne 0 ]; then
    echo "venv creation failed with status $VENV_CREATE_STATUS. Falling back to virtualenv..."
    if command_exists virtualenv; then
      virtualenv -p "$PYTHON_BIN" "$VENV_PATH"
      VENV_CREATE_STATUS=$?
    elif "$PYTHON_BIN" -m pip list | grep -q virtualenv; then
      "$PYTHON_BIN" -m virtualenv -p "$PYTHON_BIN" "$VENV_PATH"
      VENV_CREATE_STATUS=$?
    else
      echo "ERROR: Both venv and virtualenv are unavailable or failed."
      echo "Python 3.12 and venv should be installed as package dependencies."
      echo "Please ensure Python 3.12 and venv are properly installed on your system."
      echo "You can install Python 3.12 from https://www.python.org/downloads/"
      exit 1
    fi
  fi
  
  # Check if virtual environment creation was successful
  if [ $VENV_CREATE_STATUS -ne 0 ]; then
    log "ERROR: Failed to create virtual environment. Exit code: $VENV_CREATE_STATUS"
    log "Virtual environment path: $VENV_PATH"
    log "Python binary used: $PYTHON_BIN"
    ls -la "$(dirname "$VENV_PATH")" || true
    log "Python executable permissions:"
    ls -la "$PYTHON_BIN" || true
    
    # Check for common issues
    log "Checking for common virtual environment creation issues..."
    
    # Check disk space
    df -h "$(dirname "$VENV_PATH")" || true
    
    # Check if directory is writable
    if [ ! -w "$(dirname "$VENV_PATH")" ]; then
      log "ERROR: Directory $(dirname "$VENV_PATH") is not writable"
    fi
    
    # Try to create a minimal virtual environment manually as a last resort
    log "Attempting to create a minimal virtual environment manually..."
    mkdir -p "$VENV_PATH/bin" || error_exit "Could not create directory $VENV_PATH/bin"
    echo "#!/bin/bash" > "$VENV_PATH/bin/activate"
    echo "export VIRTUAL_ENV=\"$VENV_PATH\"" >> "$VENV_PATH/bin/activate"
    echo "export PATH=\"$VENV_PATH/bin:\$PATH\"" >> "$VENV_PATH/bin/activate"
    echo "unset PYTHONHOME" >> "$VENV_PATH/bin/activate"
    chmod +x "$VENV_PATH/bin/activate" || error_exit "Could not set execute permissions on activate script"
    
    # Create symlinks to the system Python
    ln -sf "$PYTHON_BIN" "$VENV_PATH/bin/python" || log "WARNING: Failed to create symlink for python"
    ln -sf "$PYTHON_BIN" "$VENV_PATH/bin/python3" || log "WARNING: Failed to create symlink for python3"
    
    # Try to bootstrap pip
    log "Bootstrapping pip in the minimal virtual environment..."
    if command_exists curl; then
      curl -s https://bootstrap.pypa.io/get-pip.py -o "$APP_DATA_DIR/get-pip.py" || log "WARNING: Failed to download get-pip.py"
    elif command_exists wget; then
      wget -q -O "$APP_DATA_DIR/get-pip.py" https://bootstrap.pypa.io/get-pip.py || log "WARNING: Failed to download get-pip.py"
    else
      log "ERROR: Neither curl nor wget available to download get-pip.py"
      error_exit "Installation cannot continue without being able to download pip"
    fi
    
    # shellcheck disable=SC1090
    source "$VENV_PATH/bin/activate" && python "$APP_DATA_DIR/get-pip.py" --no-warn-script-location
    
    if [ ! -f "$VENV_PATH/bin/pip" ]; then
      error_exit "Failed to create even a minimal virtual environment."
    else
      log "Created a minimal virtual environment as a fallback."
    fi
  else
    log "Successfully created virtual environment"
  fi
fi

# Verify the virtual environment structure
echo "Verifying virtual environment structure..."
if [ ! -f "$VENV_PATH/bin/python" ]; then
  echo "Python executable missing in virtual environment, creating symlink..."
  ln -sf "$PYTHON_BIN" "$VENV_PATH/bin/python"
fi

if [ ! -f "$VENV_PATH/bin/pip" ]; then
  echo "pip missing in virtual environment, attempting to bootstrap it..."
  curl -s https://bootstrap.pypa.io/get-pip.py -o "$APP_DATA_DIR/get-pip.py"
  "$VENV_PATH/bin/python" "$APP_DATA_DIR/get-pip.py" --no-warn-script-location
  
  if [ ! -f "$VENV_PATH/bin/pip" ]; then
    echo "ERROR: Failed to bootstrap pip in the virtual environment"
    exit 1
  fi
fi

echo "Virtual environment structure verified"

# Activate virtual environment and install local-operator
echo "Installing local-operator in virtual environment..."
source "$VENV_PATH/bin/activate"

echo "Upgrading pip..."
python -m pip install --upgrade pip || {
  echo "WARNING: Failed to upgrade pip. Will try to continue with existing pip version."
  pip --version
}

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
  log "Local Operator backend installed successfully!"
  
  # Show more information about the installed binary
  ls -la "$VENV_PATH/bin/local-operator" || true
  file "$VENV_PATH/bin/local-operator" 2>/dev/null || log "Note: 'file' command not available"
  
  # Try to run the version command with full error output
  log "Testing local-operator binary..."
  "$VENV_PATH/bin/local-operator" --version || {
    log "ERROR: local-operator binary exists but failed to execute. Exit code: $?"
    log "Binary details:"
    file "$VENV_PATH/bin/local-operator" 2>/dev/null || log "Note: 'file' command not available"
    log "Binary permissions:"
    ls -la "$VENV_PATH/bin/local-operator" || true
    log ""
    log "This could be due to missing dependencies or architecture incompatibility."
    log "Try running the binary manually to see specific errors."
    
    # Don't exit here - just warn the user
    log "WARNING: Installation completed but binary verification failed."
  }
  
  # Create a summary of the installation
  SUMMARY_FILE="${APP_DATA_DIR}/installation-summary-${TIMESTAMP}.txt"
  {
    echo "=== Local Operator Backend Installation Summary ==="
    echo "Timestamp: $(date)"
    echo "Python Version: $("${PYTHON_BIN}" --version 2>&1)"
    echo "Virtual Environment: ${VENV_PATH}"
    echo "Binary Location: ${VENV_PATH}/bin/local-operator"
    echo "To activate the virtual environment, run: source ${VENV_PATH}/bin/activate"
    echo "To test the installation, run: ${VENV_PATH}/bin/local-operator --version"
    echo "Log file: ${LOG_FILE}"
    echo "=================================================="
  } > "${SUMMARY_FILE}"
  
  log "Installation summary saved to: ${SUMMARY_FILE}"
else
  log "Error: Failed to install Local Operator backend. Binary not found."
  log "Contents of bin directory:"
  ls -la "$VENV_PATH/bin/" || true
  log "Check the log file for details: ${LOG_FILE}"
  error_exit "Installation failed. Binary not installed properly."
fi

log "Installation completed successfully at $(date)"

# Clean up temporary files now that installation is complete
cleanup

# Print final instructions
log ""
log "=== INSTALLATION COMPLETE ==="
log "You can now use the Local Operator backend by running: ${VENV_PATH}/bin/local-operator"
log "Installation directory: ${VENV_PATH}"
log "Log file: ${LOG_FILE}"
log "================================"
