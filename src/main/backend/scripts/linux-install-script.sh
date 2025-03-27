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

# Function to check if Python binary is valid for current architecture
is_valid_python_binary() {
  local python_path="$1"
  
  # First check if file exists and is executable
  if [ ! -f "$python_path" ] || [ ! -x "$python_path" ]; then
    return 1
  fi
  
  # Try to run a simple Python command to verify it works on current architecture
  "$python_path" -c "print('Testing Python executable')" >/dev/null 2>&1
  return $?
}

# Check if PYTHON_BIN is already set by the installer
if [ -n "$PYTHON_BIN" ]; then
  echo "Using Python executable provided by installer: $PYTHON_BIN"
  # Verify the provided Python binary works on this architecture
  if ! is_valid_python_binary "$PYTHON_BIN"; then
    echo "Warning: The provided Python binary is not compatible with this system architecture."
    echo "Will attempt to find a system Python installation instead."
    PYTHON_BIN=""
  fi
fi

# If PYTHON_BIN is empty or invalid, try to find a suitable Python installation
if [ -z "$PYTHON_BIN" ] || ! is_valid_python_binary "$PYTHON_BIN"; then
  # Try to find a suitable Python installation
  echo "Looking for a suitable Python installation..."
  
  # Try multiple possible locations to find Python
  POSSIBLE_PYTHON_PATHS=(
    # System paths first (more likely to be compatible with current architecture)
    "/usr/local/bin/python3.12"
    "/usr/bin/python3.12"
    "/usr/local/bin/python3"
    "/usr/bin/python3"
    # From environment variable (set by the installer)
    "$ELECTRON_RESOURCE_PATH/python/bin/python3"
    # Development paths
    "$(dirname "$0")/../../../resources/python/bin/python3"
    "$(pwd)/resources/python/bin/python3"
  )

  # Find the first Python that exists and is version 3.12+ and works on this architecture
  PYTHON_BIN=""
  for path in "${POSSIBLE_PYTHON_PATHS[@]}"; do
    if is_valid_python_binary "$path"; then
      # Check Python version
      PY_VERSION=$("$path" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
      if [ $? -eq 0 ]; then
        MAJOR=$(echo $PY_VERSION | cut -d. -f1)
        MINOR=$(echo $PY_VERSION | cut -d. -f2)
        if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 12 ]; then
          PYTHON_BIN="$path"
          echo "Found suitable Python $PY_VERSION at $path"
          break
        else
          echo "Python at $path is version $PY_VERSION, which is below the required 3.12+"
        fi
      fi
    else
      echo "Python at $path exists but is not compatible with this system architecture"
    fi
  done

  # If we couldn't find a suitable Python, exit with error
  if [ -z "$PYTHON_BIN" ]; then
    echo "Error: No suitable Python installation found (version 3.12 or higher required)."
    echo "Please install Python 3.12 or higher before running this script."
    echo "You can install Python from https://www.python.org/downloads/"
    exit 1
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

# Get Python version for package names
PYTHON_VERSION=$("$PYTHON_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR_VERSION=$("$PYTHON_BIN" -c "import sys; print(sys.version_info.major)")

# Check if Python has venv module and ensurepip available
echo "Checking for venv module and ensurepip availability..."
VENV_AVAILABLE=0
ENSUREPIP_AVAILABLE=0

"$PYTHON_BIN" -c "import venv" > /dev/null 2>&1 || VENV_AVAILABLE=1
"$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1 || ENSUREPIP_AVAILABLE=1

# Check if pip is available
PIP_AVAILABLE=0
"$PYTHON_BIN" -c "import pip" > /dev/null 2>&1 || PIP_AVAILABLE=1

if [ $VENV_AVAILABLE -ne 0 ] || [ $ENSUREPIP_AVAILABLE -ne 0 ]; then
  echo "Python venv module or ensurepip is not available."
  
  # Determine required packages based on distribution
  if [[ "$DISTRO" =~ ^(ubuntu|debian|linuxmint|pop|mint)$ ]]; then
    # For Debian-based distributions
    VENV_PACKAGE="python${PYTHON_VERSION}-venv"
    ENSUREPIP_PACKAGE="python${PYTHON_VERSION}-venv"
    PIP_PACKAGE="python${PYTHON_VERSION}-pip"
    INSTALL_CMD="apt-get install -y"
    SUDO_INSTALL_CMD="sudo apt-get install -y"
  elif [[ "$DISTRO" =~ ^(fedora|rhel|centos|rocky|alma)$ ]]; then
    # For Red Hat-based distributions
    VENV_PACKAGE="python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
    ENSUREPIP_PACKAGE="python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
    PIP_PACKAGE="python${PYTHON_MAJOR_VERSION}-pip"
    INSTALL_CMD="dnf install -y"
    SUDO_INSTALL_CMD="sudo dnf install -y"
  elif [[ "$DISTRO" =~ ^(arch|manjaro|endeavouros)$ ]]; then
    # For Arch-based distributions
    VENV_PACKAGE="python"
    ENSUREPIP_PACKAGE="python"
    PIP_PACKAGE="python-pip"
    INSTALL_CMD="pacman -S --noconfirm"
    SUDO_INSTALL_CMD="sudo pacman -S --noconfirm"
  else
    # Generic fallback
    VENV_PACKAGE="python-venv python-pip"
    ENSUREPIP_PACKAGE="python-venv python-pip"
    PIP_PACKAGE="python-pip"
    INSTALL_CMD=""
    SUDO_INSTALL_CMD=""
  fi
  
  echo "This system requires the $VENV_PACKAGE package for venv support."
  
  # Attempt to install required packages
  INSTALL_ATTEMPTED=0
  
  if [ -n "$INSTALL_CMD" ]; then
    echo "Attempting to install required packages..."
    
    # Try to install without sudo first
    $INSTALL_CMD $VENV_PACKAGE $PIP_PACKAGE > /dev/null 2>&1
    if [ $? -ne 0 ]; then
      echo "Non-sudo installation failed. Trying with sudo..."
      if command_exists sudo; then
        $SUDO_INSTALL_CMD $VENV_PACKAGE $PIP_PACKAGE
        INSTALL_ATTEMPTED=1
      else
        echo "sudo not available. Please install $VENV_PACKAGE and $PIP_PACKAGE manually."
        echo "For $DISTRO: $SUDO_INSTALL_CMD $VENV_PACKAGE $PIP_PACKAGE"
      fi
    else
      INSTALL_ATTEMPTED=1
    fi
  else
    echo "Unable to determine package manager. Please install Python venv support manually."
    if [[ "$DISTRO" =~ ^(ubuntu|debian|linuxmint|pop|mint)$ ]]; then
      echo "For Ubuntu/Debian/Mint: sudo apt install python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-pip"
    elif [[ "$DISTRO" =~ ^(fedora|rhel|centos|rocky|alma)$ ]]; then
      echo "For Fedora/RHEL: sudo dnf install python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
    elif [[ "$DISTRO" =~ ^(arch|manjaro|endeavouros)$ ]]; then
      echo "For Arch Linux: sudo pacman -S python python-pip"
    fi
  fi
  
  # Check if venv and ensurepip are now available after installation attempt
  if [ $INSTALL_ATTEMPTED -eq 1 ]; then
    echo "Checking if venv module and ensurepip are now available..."
    "$PYTHON_BIN" -c "import venv" > /dev/null 2>&1 || VENV_AVAILABLE=1
    "$PYTHON_BIN" -c "import ensurepip" > /dev/null 2>&1 || ENSUREPIP_AVAILABLE=1
    "$PYTHON_BIN" -c "import pip" > /dev/null 2>&1 || PIP_AVAILABLE=1
    
    if [ $VENV_AVAILABLE -eq 0 ] && [ $ENSUREPIP_AVAILABLE -eq 0 ] && [ $PIP_AVAILABLE -eq 0 ]; then
      echo "venv module, ensurepip, and pip are now available!"
    else
      echo "venv module, ensurepip, or pip still not available after installation attempt."
      
      # Provide specific instructions based on distribution
      if [[ "$DISTRO" =~ ^(ubuntu|debian|linuxmint|pop|mint)$ ]]; then
        echo "Please install the required packages manually:"
        echo "sudo apt install python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-pip"
        echo "After installing, please run this script again."
        exit 1
      elif [[ "$DISTRO" =~ ^(fedora|rhel|centos|rocky|alma)$ ]]; then
        echo "Please install the required packages manually:"
        echo "sudo dnf install python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
        echo "After installing, please run this script again."
        exit 1
      elif [[ "$DISTRO" =~ ^(arch|manjaro|endeavouros)$ ]]; then
        echo "Please install the required packages manually:"
        echo "sudo pacman -S python python-pip"
        echo "After installing, please run this script again."
        exit 1
      else
        echo "Please install Python venv support and pip for your distribution and run this script again."
        exit 1
      fi
    fi
  fi
else
  echo "venv module and ensurepip are available"
fi

# Check if pip is available, if not try to install it
if [ $PIP_AVAILABLE -ne 0 ]; then
  echo "pip is not available. Attempting to install it..."
  
  # Try to use ensurepip if available
  if [ $ENSUREPIP_AVAILABLE -eq 0 ]; then
    echo "Using ensurepip to bootstrap pip..."
    "$PYTHON_BIN" -m ensurepip --upgrade --default-pip
    PIP_INSTALL=$?
    
    if [ $PIP_INSTALL -eq 0 ]; then
      echo "Successfully installed pip using ensurepip"
      PIP_AVAILABLE=0
    else
      echo "Failed to install pip using ensurepip"
    fi
  fi
  
  # If ensurepip failed or wasn't available, try get-pip.py
  if [ $PIP_AVAILABLE -ne 0 ]; then
    echo "Downloading get-pip.py to bootstrap pip..."
    if command_exists curl; then
      curl -s https://bootstrap.pypa.io/get-pip.py -o "$APP_DATA_DIR/get-pip.py"
    elif command_exists wget; then
      wget -q -O "$APP_DATA_DIR/get-pip.py" https://bootstrap.pypa.io/get-pip.py
    else
      echo "ERROR: Neither curl nor wget is available to download get-pip.py"
      echo "Please install pip manually for your Python installation"
      exit 1
    fi
    
    "$PYTHON_BIN" "$APP_DATA_DIR/get-pip.py" --user
    PIP_INSTALL=$?
    
    if [ $PIP_INSTALL -eq 0 ]; then
      echo "Successfully installed pip using get-pip.py"
      PIP_AVAILABLE=0
      # Add the user's pip bin directory to PATH temporarily
      export PATH="$HOME/.local/bin:$PATH"
    else
      echo "ERROR: Failed to install pip using get-pip.py"
      echo "Please install pip manually for your Python installation"
      exit 1
    fi
  fi
fi

# Try to install virtualenv as a fallback if venv is still not available
if [ $VENV_AVAILABLE -ne 0 ] || [ $ENSUREPIP_AVAILABLE -ne 0 ]; then
  echo "Checking for virtualenv as an alternative..."
  
  # Try to install virtualenv using pip
  echo "Attempting to install virtualenv using pip..."
  "$PYTHON_BIN" -m pip install --user virtualenv
  VIRTUALENV_INSTALL=$?
  
  if [ $VIRTUALENV_INSTALL -ne 0 ]; then
    echo "ERROR: Could not install virtualenv and venv module is not available."
    echo "Please install the Python venv package for your distribution:"
    
    if [[ "$DISTRO" =~ ^(ubuntu|debian|linuxmint|pop|mint)$ ]]; then
      echo "For Ubuntu/Debian/Mint: sudo apt install python${PYTHON_VERSION}-venv python${PYTHON_VERSION}-pip"
    elif [[ "$DISTRO" =~ ^(fedora|rhel|centos|rocky|alma)$ ]]; then
      echo "For Fedora/RHEL: sudo dnf install python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
    elif [[ "$DISTRO" =~ ^(arch|manjaro|endeavouros)$ ]]; then
      echo "For Arch Linux: sudo pacman -S python"
    else
      echo "For your distribution: Install the Python venv or virtualenv package"
    fi
    
    echo "Alternatively, you can install Python from python.org which includes venv by default."
    exit 1
  else
    echo "Successfully installed virtualenv"
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
      echo "Please install either the Python venv package or virtualenv:"
      
      if [[ "$DISTRO" =~ ^(ubuntu|debian|linuxmint|pop)$ ]]; then
        echo "For Ubuntu/Debian: sudo apt install python${PYTHON_VERSION}-venv"
      elif [[ "$DISTRO" =~ ^(fedora|rhel|centos|rocky|alma)$ ]]; then
        echo "For Fedora/RHEL: sudo dnf install python${PYTHON_MAJOR_VERSION}-devel python${PYTHON_MAJOR_VERSION}-pip"
      elif [[ "$DISTRO" =~ ^(arch|manjaro|endeavouros)$ ]]; then
        echo "For Arch Linux: sudo pacman -S python"
      else
        echo "For your distribution: Install the Python venv or virtualenv package"
      fi
      
      echo "Alternatively, you can install Python from python.org which includes venv by default."
      exit 1
    fi
  fi
  
  # Check if virtual environment creation was successful
  if [ $VENV_CREATE_STATUS -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment. Exit code: $VENV_CREATE_STATUS"
    echo "Virtual environment path: $VENV_PATH"
    echo "Python binary used: $PYTHON_BIN"
    ls -la "$(dirname "$VENV_PATH")"
    echo "Python executable permissions:"
    ls -la "$PYTHON_BIN"
    
    # Try to create a minimal virtual environment manually as a last resort
    echo "Attempting to create a minimal virtual environment manually..."
    mkdir -p "$VENV_PATH/bin"
    echo "#!/bin/bash" > "$VENV_PATH/bin/activate"
    echo "export VIRTUAL_ENV=\"$VENV_PATH\"" >> "$VENV_PATH/bin/activate"
    echo "export PATH=\"$VENV_PATH/bin:\$PATH\"" >> "$VENV_PATH/bin/activate"
    echo "unset PYTHONHOME" >> "$VENV_PATH/bin/activate"
    chmod +x "$VENV_PATH/bin/activate"
    
    # Create symlinks to the system Python
    ln -sf "$PYTHON_BIN" "$VENV_PATH/bin/python"
    ln -sf "$PYTHON_BIN" "$VENV_PATH/bin/python3"
    
    # Try to bootstrap pip
    echo "Bootstrapping pip in the minimal virtual environment..."
    curl -s https://bootstrap.pypa.io/get-pip.py -o "$APP_DATA_DIR/get-pip.py"
    source "$VENV_PATH/bin/activate" && python "$APP_DATA_DIR/get-pip.py" --no-warn-script-location
    
    if [ ! -f "$VENV_PATH/bin/pip" ]; then
      echo "ERROR: Failed to create even a minimal virtual environment."
      exit 1
    else
      echo "Created a minimal virtual environment as a fallback."
    fi
  else
    echo "Successfully created virtual environment"
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
