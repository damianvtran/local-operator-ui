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
BASE_PYTHON_STANDALONE_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}"

PYTHON_STANDALONE_URL_X86_64="${BASE_PYTHON_STANDALONE_URL}-x86_64-apple-darwin-install_only.tar.gz"
PYTHON_STANDALONE_URL_AARCH64="${BASE_PYTHON_STANDALONE_URL}-aarch64-apple-darwin-install_only.tar.gz"

RESOURCES_DIR="$(dirname "$0")/../resources"
PYTHON_DIR_X86_64="${RESOURCES_DIR}/python"
PYTHON_DIR_AARCH64="${RESOURCES_DIR}/python_aarch64"

echo "Setting up standalone Python for Local Operator UI..."
echo "Python version: ${PYTHON_VERSION}"
echo "Resources directory: ${RESOURCES_DIR}"
echo "Python x86_64 directory: ${PYTHON_DIR_X86_64}"
echo "Python aarch64 directory: ${PYTHON_DIR_AARCH64}"

# Create resources directory if it doesn't exist
mkdir -p "${RESOURCES_DIR}"
echo "Created resources directory: ${RESOURCES_DIR}"

# Remove existing Python directories if they exist
if [ -d "${PYTHON_DIR_X86_64}" ]; then
    echo "Removing existing Python x86_64 directory: ${PYTHON_DIR_X86_64}..."
    rm -rf "${PYTHON_DIR_X86_64}"
fi
if [ -d "${PYTHON_DIR_AARCH64}" ]; then
    echo "Removing existing Python aarch64 directory: ${PYTHON_DIR_AARCH64}..."
    rm -rf "${PYTHON_DIR_AARCH64}"
fi

# Create Python architecture-specific directories
mkdir -p "${PYTHON_DIR_X86_64}"
echo "Created Python x86_64 directory: ${PYTHON_DIR_X86_64}"
mkdir -p "${PYTHON_DIR_AARCH64}"
echo "Created Python aarch64 directory: ${PYTHON_DIR_AARCH64}"

# Function to download and extract Python for a given architecture
setup_python_arch() {
    local arch=$1
    local url=$2
    local final_python_dir=$3 # This is PYTHON_DIR_X86_64 or PYTHON_DIR_AARCH64

    echo "Setting up Python for ${arch}..."
    echo "Downloading Python standalone for ${arch} from ${url}..."
    # Download to a temporary file first to handle potential tar issues
    TMP_TAR_FILE=$(mktemp)
    curl -L "${url}" -o "${TMP_TAR_FILE}"

    # Extract into a temporary location first to avoid conflicts if 'python' dir already exists
    EXTRACT_TEMP_DIR=$(mktemp -d)
    echo "Extracting to temporary directory ${EXTRACT_TEMP_DIR}..."
    tar -xzf "${TMP_TAR_FILE}" -C "${EXTRACT_TEMP_DIR}"
    
    # The archive contains a 'python' directory. Move this to the arch-specific path.
    if [ -d "${EXTRACT_TEMP_DIR}/python" ]; then
        echo "Moving extracted 'python' directory to ${final_python_dir}..."
        # Ensure the final_python_dir is empty before moving
        rm -rf "${final_python_dir:?}"/* # Protect against empty var
        mv "${EXTRACT_TEMP_DIR}/python"/* "${final_python_dir}/"
        echo "Moved contents of extracted 'python' directory to ${final_python_dir}"
    else
        echo "Error: Expected 'python' directory not found in archive for ${arch}."
        rm -f "${TMP_TAR_FILE}"
        rm -rf "${EXTRACT_TEMP_DIR}"
        exit 1
    fi
    
    rm -f "${TMP_TAR_FILE}"
    rm -rf "${EXTRACT_TEMP_DIR}"
    echo "Downloaded and extracted Python standalone for ${arch} to ${final_python_dir}"

    # Verify installation for the current architecture
    PYTHON_BIN="${final_python_dir}/bin/python3"
    if [ -f "${PYTHON_BIN}" ]; then
        echo "Making Python binary for ${arch} executable..."
        chmod +x "${PYTHON_BIN}"
        echo "Python standalone for ${arch} successfully installed!"
        "${PYTHON_BIN}" --version
    else
        echo "Error: Python standalone installation for ${arch} failed. Binary not found at ${PYTHON_BIN}"
        exit 1
    fi
}

# Setup Python for x86_64
setup_python_arch "x86_64" "${PYTHON_STANDALONE_URL_X86_64}" "${PYTHON_DIR_X86_64}"

# Setup Python for aarch64
setup_python_arch "aarch64" "${PYTHON_STANDALONE_URL_AARCH64}" "${PYTHON_DIR_AARCH64}"

echo "Python standalone setup complete for all architectures!"
echo "You can now build the application with 'pnpm dist:mac'"
