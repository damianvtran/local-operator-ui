#!/bin/bash
# setup-python-standalone.sh
#
# Downloads and sets up standalone Python for bundling with the Local Operator UI
# application for use with Electron-based builds.
#
# This script uses python-build-standalone from Gregory Szorc, which is designed
# for easy bundling with applications. It's also used by PyOxidize and Datasette Desktop.
#
# Usage: ./setup-python-standalone.sh
#
set -euo pipefail

# Configuration
PYTHON_VERSION="3.12.2"
PYTHON_BUILD_DATE="20240224"
PYTHON_STANDALONE_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-apple-darwin-install_only.tar.gz"
RESOURCES_DIR="$(dirname "$0")/../resources"
PYTHON_DIR="${RESOURCES_DIR}/python"

echo "Setting up standalone Python for Local Operator UI..."
echo "Python version: ${PYTHON_VERSION}"
echo "Resources directory: ${RESOURCES_DIR}"

# Create resources directory if it doesn't exist
mkdir -p "${RESOURCES_DIR}"
echo "Created resources directory: ${RESOURCES_DIR}"

# Remove existing Python directory if it exists
if [ -d "${PYTHON_DIR}" ]; then
    echo "Removing existing Python directory..."
    rm -rf "${PYTHON_DIR}"
fi

# Create Python directory
mkdir -p "${PYTHON_DIR}"
echo "Created Python directory: ${PYTHON_DIR}"

# Download and extract Python standalone
echo "Downloading Python standalone from ${PYTHON_STANDALONE_URL}..."
curl -L "${PYTHON_STANDALONE_URL}" | tar -xz -C "${RESOURCES_DIR}"
echo "Downloaded and extracted Python standalone to ${RESOURCES_DIR}"

# Verify installation
PYTHON_BIN="${PYTHON_DIR}/bin/python3"
if [ -f "${PYTHON_BIN}" ]; then
    echo "Making Python binary executable..."
    chmod +x "${PYTHON_BIN}"
    echo "Python standalone successfully installed!"
    "${PYTHON_BIN}" --version
else
    echo "Error: Python standalone installation failed"
    exit 1
fi

echo "Python standalone setup complete!"
echo "You can now build the application with 'yarn dist:mac'"
