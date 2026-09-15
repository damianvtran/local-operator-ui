#!/bin/bash
# Local Operator Backend Installation Script for macOS
# This script uses the bundled standalone Python and sets up a virtual environment for the Local Operator backend.

set -e  # Exit immediately if a command exits with a non-zero status

# Configuration
APP_NAME="Local Operator"
VENV_NAME="local-operator-venv"
APP_DATA_DIR="${LOCAL_OPERATOR_SUPPORT_PATH:-$HOME/Library/Application Support/$APP_NAME}"
VENV_PATH="$APP_DATA_DIR/$VENV_NAME"
LOG_FILE="$APP_DATA_DIR/backend-install.log"

# Which environment this installs into. The path is the app's decision, not this
# script's: a packaged install and an unpackaged one must not share an
# environment (the venv is built on whatever interpreter the instance resolves,
# and the installed bundle's stdlib lives inside the code-sealed .app), and only
# the app knows which one it is. The app passes its answer in
# (`LOCAL_OPERATOR_VENV_PATH`, set from `managedVenvPath` in
# src/main/backend/venv-paths.ts).
#
# macOS REFUSES a standalone run rather than falling back, and the asymmetry with
# the Linux and Windows scripts is deliberate. Their default is the packaged name,
# which is harmless there; here it is the exact environment this split exists to
# stop a second instance from writing into - the measured failure is a dev-venv
# interpreter whose stdlib is `/Applications/Local Operator.app/Contents/
# Resources/python_aarch64`, so a silent default would rebuild that venv and
# `pip install` into it, which is what R1 of the review caught. A caller that
# cannot name the environment is a caller that should not be installing into one.
: "${LOCAL_OPERATOR_VENV_PATH:?Pass the resolved managed environment path (see venv-paths.ts); this script will not guess which instance it belongs to}"
VENV_PATH="$LOCAL_OPERATOR_VENV_PATH"

# Keep CPython's bytecode cache out of the application bundle.
#
# The bundled interpreter writes __pycache__/*.pyc beside the stdlib sources it
# imports, and those sources live inside the code-signed .app - which is the
# build's own extraResource. Every such write is a change to a sealed resource:
# measured on an installed 0.17.3, `codesign --verify --deep` reported 308
# `file added:` violations, all of them .pyc, and ShipIt then refuses the
# in-place update with -67028 errSecCSBadBundleFormat. A file codesign reports
# as *added* can be deleted and the seal comes back; a *modified* one cannot,
# which is why nothing may ship a .pyc at all. The app sets this variable when
# it spawns us; defaulting it here keeps a standalone run of this script in
# agreement with the app about where bytecode goes. It is not a complete answer:
# the app does not spawn every python that runs this interpreter, and a python
# started by something else - a shell, a CLI script, an agent - has no prefix at
# all (measured: a venv over this tree wrote 25 .pyc into it that way). The half
# that covers those is the app's seal on the tree itself
# (src/main/python-bytecode-cache.ts), which a standalone run of this script does
# not apply. $HOME is the right place for the cache for the same reason the venv
# lives there: it is never inside the thing that gets signed and swapped.
: "${PYTHONPYCACHEPREFIX:=$APP_DATA_DIR/python-bytecode-cache}"
export PYTHONPYCACHEPREFIX

# And the refusal half of the same pair, so a standalone run of this script
# cannot write bytecode into the bundle even where the redirect above does not
# apply - a relative or unwritable prefix, or a child that drops the variable.
# CPython reads the flag before its first import, so this script's own
# `python -m venv`, its pip runs and the venv they create all compile without
# writing a `__pycache__` anywhere. Measured on CPython: `0` and the empty
# string are the two falsy spellings, so the value is set rather than merged
# with whatever the caller had.
export PYTHONDONTWRITEBYTECODE=1

# The architecture block that used to live here computed and logged the name of
# a directory for an in-bundle search this script no longer performs: every run
# announced which architecture-named directory it was about to use, and then
# installed from `PYTHON_BIN` anyway - the line stated the opposite of how the
# script finds Python, and the names it computed were used nowhere else (review
# N1). Which interpreter to build the environment with is the caller's decision,
# checked immediately below.

# The app prepares a complete external runtime before invoking this script.
# Searching /Applications here would reintroduce legacy-bundle execution during
# migration. Standalone callers must make the same explicit path decision.
: "${PYTHON_BIN:?Pass an external prepared Python executable}"
case "$PYTHON_BIN" in
  *.app/*) echo "Refusing to execute Python inside an application bundle" >&2; exit 1 ;;
esac

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

# --- FFmpeg Installation ---
BIN_DIR="$APP_DATA_DIR/bin"
FFMPEG_BIN="$BIN_DIR/ffmpeg"

echo "Ensuring bin directory exists: $BIN_DIR"
mkdir -p "$BIN_DIR"

# Check if FFmpeg is already installed and executable
if [ -f "$FFMPEG_BIN" ] && [ -x "$FFMPEG_BIN" ]; then
    echo "FFmpeg already installed at $FFMPEG_BIN. Skipping download."
else
    echo "FFmpeg not found or not executable. Attempting to download and install FFmpeg..."

    # The architecture, read here because this URL is the one place left that needs
    # it: the environment is built on `PYTHON_BIN`, handed in above, so nothing
    # else in this script derives anything from `uname -m`. The block that used to
    # compute it at the top of the file was removed with the in-bundle interpreter
    # search it existed for (review N1) - and that removal took this variable with
    # it while this block still read it, so `$ARCH` was empty for every caller,
    # including the app, and any install on a machine without a cached ffmpeg
    # exited 1 here, before the venv was ever created. Measured: `bash
    # src/main/backend/scripts/macos-install-script.sh` with `PYTHON_BIN` set stops
    # on "Unsupported CPU architecture for FFmpeg download:".
    ARCH=$(uname -m)

    FFMPEG_DOWNLOAD_URL=""

    if [[ "$ARCH" == "x86_64" ]]; then
        FFMPEG_DOWNLOAD_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-mac-x64"
    elif [[ "$ARCH" == "arm64" ]] || [[ "$ARCH" == "aarch64" ]]; then
        FFMPEG_DOWNLOAD_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-mac-arm64"
    else
        echo "Error: Unsupported CPU architecture for FFmpeg download: $ARCH"
        exit 1
    fi

    echo "Downloading FFmpeg from: $FFMPEG_DOWNLOAD_URL"
    if curl -L "$FFMPEG_DOWNLOAD_URL" -o "$FFMPEG_BIN"; then
        echo "FFmpeg downloaded successfully to $FFMPEG_BIN"
        chmod +x "$FFMPEG_BIN"
        echo "Set executable permissions for $FFMPEG_BIN"
    else
        echo "Error: Failed to download FFmpeg from $FFMPEG_DOWNLOAD_URL"
        exit 1
    fi

    # Verify FFmpeg is executable after download
    if [ ! -f "$FFMPEG_BIN" ] || [ ! -x "$FFMPEG_BIN" ]; then
        echo "Error: FFmpeg binary not found or not executable after download."
        exit 1
    fi
fi

echo "FFmpeg installation complete. FFmpeg binary is at: $FFMPEG_BIN"
# --- End FFmpeg Installation ---

# Verify bundled Python exists
if [ ! -f "$PYTHON_BIN" ]; then
  echo "Error: Bundled Python not found at $PYTHON_BIN"
  echo "Please ensure standalone Python is properly installed in the application resources."
  exit 1
fi

# Make sure Python binary is executable
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
  # Never repair a path we did not create. Preparation allocates a fresh final
  # pathname; a collision is evidence to preserve, not a reason to delete it.
  if [ -e "$VENV_PATH" ] || [ -L "$VENV_PATH" ]; then
    echo "Refusing to replace an existing environment path: $VENV_PATH" >&2
    exit 1
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
python -m pip install --upgrade --verbose local-operator || {
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
