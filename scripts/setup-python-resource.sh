#!/bin/bash
# setup-python-resource.sh
#
# Stages the runtime resources the packaging step copies into the app: the
# standalone Python the backend venv is built on, and the `uv` release the
# install scripts use to install the backend.
#
# This script uses python-build-standalone from Gregory Szorc, which is designed
# for easy bundling with applications. It's also used by PyOxidize and Datasette Desktop.
#
# Both versions live in `src/shared/bundled-runtime-layout.json`, which is the
# single definition the app, the pack hook and the release gate read
# (`scripts/bundled-runtime-layout.mjs` is the scripts-side reader). They are read
# from it here rather than spelled again, because a version spelled twice is a
# version that can disagree: the declared one is what the release gate asserts
# against the seed that ships (`seedVersionCheck` in verify-macos-artifacts.mjs),
# and it DERIVES this script's download URL - so a bump that only reaches the
# JSON changes nothing here, and a bump that only reaches this file ships a tree
# the gate then refuses.
#
# Usage: pnpm setup-python  (this script)
#
set -euo pipefail

# Configuration. Read the version pins out of the layout definition.
#
# LAYOUT_JSON is ABSOLUTE, and that is not style: `node -e "require('...')"`
# resolves a relative specifier as a bare module id, so
# `scripts/../src/shared/bundled-runtime-layout.json` is not found at all
# (`MODULE_NOT_FOUND`), and even a `./`-prefixed spelling would depend on the
# caller's working directory. Measured by running this script.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAYOUT_JSON="${REPO_ROOT}/src/shared/bundled-runtime-layout.json"
read_layout() {
    node -e "process.stdout.write(require('${LAYOUT_JSON}')$1)"
}
PYTHON_VERSION="$(read_layout '.python.version')"
PYTHON_BUILD_DATE="$(read_layout '.python.buildDate')"
UV_VERSION="$(read_layout '.uv.version')"

# The canonical org: `indygreg/python-build-standalone` redirects here (301), and
# a build that depends on a redirect is one rename away from failing. Both the
# release assets and the redirect were checked on 2026-09-21.
BASE_PYTHON_STANDALONE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}"
PYTHON_STANDALONE_URL_X86_64="${BASE_PYTHON_STANDALONE_URL}-x86_64-apple-darwin-install_only.tar.gz"
PYTHON_STANDALONE_URL_AARCH64="${BASE_PYTHON_STANDALONE_URL}-aarch64-apple-darwin-install_only.tar.gz"

# uv is pinned to an exact release, never `latest`: the install scripts' behaviour
# is then a property of this repository rather than of the day a build ran, and
# the release gate can assert the version that shipped. The asset is a `.tar.gz`
# (it carries `uv` and `uvx`; only `uv` is staged, see setup_uv_arch below) with a
# published `.sha256` beside it, which is checked before anything is unpacked.
UV_RELEASE_BASE_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"

RESOURCES_DIR="$(dirname "$0")/../resources"
# The staging directory names come from the layout too. They are not cosmetic:
# `backend-installer.ts` resolves the DEV layout by the same names
# (`uvToolPath`/`seedPath`), so a staging directory this script invented would be
# a tree the app never looks in - and the failure mode is the quiet one, an
# install that keeps falling back to pip.
PYTHON_DIR_X86_64="${RESOURCES_DIR}/$(read_layout '.python.checkoutSeedNames.x64')"
PYTHON_DIR_AARCH64="${RESOURCES_DIR}/$(read_layout '.python.checkoutSeedNames.arm64')"
UV_DIR_X86_64="${RESOURCES_DIR}/$(read_layout '.uv.checkoutNames.x64')"
UV_DIR_AARCH64="${RESOURCES_DIR}/$(read_layout '.uv.checkoutNames.arm64')"

# Every download in this script is bounded and fails on an HTTP error. Why the
# pair rather than the bare `curl -L` this used to be: a build with no bound and
# no `--fail` hangs on a stalled connection and, on a 404 or a moved asset,
# writes the ERROR PAGE into the tree as if it were the artifact - which the
# extraction then reports as a tar error naming a file nobody can explain.
FETCH=(curl --fail --location --silent --show-error --max-time 600)

# Fetch a URL into a file, then print the file. Kept as a function so every
# download this script performs is bounded by the same one implementation.
fetch_to() {
    local url=$1 destination=$2
    echo "Downloading ${url}"
    "${FETCH[@]}" "${url}" -o "${destination}"
}

# The sha256 of a file, in the spelling the published `.sha256` files use.
sha256_of() {
    shasum -a 256 "$1" | awk '{print $1}'
}

echo "Setting up the bundled runtime resources for Local Operator UI..."
echo "Python version: ${PYTHON_VERSION} (${PYTHON_BUILD_DATE})"
echo "uv version: ${UV_VERSION}"
echo "Resources directory: ${RESOURCES_DIR}"
echo "Python x86_64 directory: ${PYTHON_DIR_X86_64}"
echo "Python aarch64 directory: ${PYTHON_DIR_AARCH64}"
echo "uv x86_64 directory: ${UV_DIR_X86_64}"
echo "uv aarch64 directory: ${UV_DIR_AARCH64}"

# Create resources directory if it doesn't exist
mkdir -p "${RESOURCES_DIR}"
echo "Created resources directory: ${RESOURCES_DIR}"

# Remove existing staged directories if they exist
if [ -d "${PYTHON_DIR_X86_64}" ]; then
    echo "Removing existing Python x86_64 directory: ${PYTHON_DIR_X86_64}..."
    rm -rf "${PYTHON_DIR_X86_64}"
fi
if [ -d "${PYTHON_DIR_AARCH64}" ]; then
    echo "Removing existing Python aarch64 directory: ${PYTHON_DIR_AARCH64}..."
    rm -rf "${PYTHON_DIR_AARCH64}"
fi

# Remove existing staged uv directories if they exist (the staged tree is a build
# input, never a source: `resources/uv*` is gitignored).
for dir in "${UV_DIR_X86_64}" "${UV_DIR_AARCH64}"; do
    if [ -d "${dir}" ]; then
        echo "Removing existing uv directory: ${dir}..."
        rm -rf "${dir}"
    fi
    mkdir -p "${dir}"
done

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
    # Download to a temporary file first to handle potential tar issues
    TMP_TAR_FILE=$(mktemp)
    fetch_to "${url}" "${TMP_TAR_FILE}"

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
        # PYTHONDONTWRITEBYTECODE for the check itself: this is the first import
        # of the archive's stdlib, and it happens BEFORE the cleanup below, so
        # writing bytecode here would only be work for the cleanup to undo.
        PYTHONDONTWRITEBYTECODE=1 "${PYTHON_BIN}" --version
    else
        echo "Error: Python standalone installation for ${arch} failed. Binary not found at ${PYTHON_BIN}"
        exit 1
    fi

    # The tree that was just unpacked IS the version the layout declares, or the
    # build stops here.
    #
    # WHY THIS ASSERTION IS NOT DECORATION: the patch level is the one thing no
    # later step can see. `lib/python3.12`, `bin/python3.12` and
    # `_sysconfigdata`'s `VERSION` all carry the major.minor only, so a bump to
    # the declaration that this script did not act on - a checkout that pulled
    # the bump and ran `pnpm build` without re-running `pnpm setup-python`, or a
    # CDN serving the previous patch - produces a complete tree the release gate
    # accepts while shipping four patch releases behind, three of them security.
    # Asking the interpreter it just unpacked takes the reading from the bytes
    # rather than from the URL that was supposed to produce them.
    REPORTED_VERSION=$(PYTHONDONTWRITEBYTECODE=1 "${PYTHON_BIN}" --version 2>&1)
    if [ "${REPORTED_VERSION}" != "Python ${PYTHON_VERSION}" ]; then
        echo "Error: the ${arch} interpreter just unpacked reports '${REPORTED_VERSION}' but src/shared/bundled-runtime-layout.json declares Python ${PYTHON_VERSION}."
        echo "URL fetched: ${url}"
        exit 1
    fi
    echo "Verified: the ${arch} tree is Python ${PYTHON_VERSION}."

    # Ship no bytecode, and remove any that the extraction or the check above
    # produced.
    #
    # Why this is a hard requirement rather than tidiness: the tree this script
    # assembles becomes `Contents/Resources/python_aarch64` inside a code-sealed
    # `.app`, and CPython rewrites a `.pyc` whose recorded source mtime does not
    # match the source it finds. Packaging and installing reset `.py` mtimes, so
    # any `.pyc` that ships is stale by construction and gets rewritten on the
    # user's first launch. Measured on the shipped 0.17.0 image: the bundle
    # carries exactly 3 `.pyc`, all in `encodings/__pycache__`, recording source
    # mtime 1748584453 while the packaged sources carry 1789072763 - and one of
    # those rewrites is a `file modified:` violation, which cannot be healed by
    # deleting the file (it becomes `file missing:` and the seal stays broken).
    # A `file added:` `.pyc` is recoverable at update time; a rewritten sealed
    # one is not, so shipping three of them is what turned a self-inflicted
    # signature break into a reinstall for every 0.17.x user.
    REMOVED_PYCACHE=$(find "${final_python_dir}" -type d -name '__pycache__' -print | sort)
    if [ -n "${REMOVED_PYCACHE}" ]; then
        echo "Removing bytecode caches from ${final_python_dir}:"
        printf '%s\n' "${REMOVED_PYCACHE}"
        find "${final_python_dir}" -type d -name '__pycache__' -prune -exec rm -rf {} +
    else
        echo "No bytecode caches found in ${final_python_dir}."
    fi

    # Remove the seed content nothing can reach, and normalise the execute bits
    # that mean nothing in a bundle. This is the one place the seed is
    # materialised, so it is where the dev tree and the shipped tree are made
    # identical; the release gate asserts both halves against the packaged app.
    # It runs BEFORE signing by construction - this script runs before the build
    # - and removing content after signing would be a `file missing:` violation.
    # See scripts/prune-python-seed.mjs for why the list is what it is, and
    # the seedStdlibMarker and prunedSeedPaths keys of
    # src/shared/bundled-runtime-layout.json for the list itself.
    echo "Pruning unreachable seed content and normalising execute bits in ${final_python_dir}..."
    node "$(dirname "$0")/prune-python-seed.mjs" "${final_python_dir}"

    REMAINING_PYC=$(find "${final_python_dir}" \( -name '*.pyc' -o -name '*.pyo' \) -print | sort)
    if [ -n "${REMAINING_PYC}" ]; then
        echo "Error: bytecode remains in ${final_python_dir} after cleanup; the release gate would reject this app:"
        printf '%s\n' "${REMAINING_PYC}"
        exit 1
    fi
    echo "Verified: no .pyc or .pyo under ${final_python_dir}."
}

# Setup Python for x86_64
setup_python_arch "x86_64" "${PYTHON_STANDALONE_URL_X86_64}" "${PYTHON_DIR_X86_64}"

# Setup Python for aarch64
setup_python_arch "aarch64" "${PYTHON_STANDALONE_URL_AARCH64}" "${PYTHON_DIR_AARCH64}"

# --- uv ---------------------------------------------------------------------
#
# The uv release for one architecture, verified and staged as a single binary.
#
# WHY uv SHIPS AT ALL: installing the backend with pip is the dominant cost of a
# first run. Measured on this machine, cold cache, same interpreter, same
# dependency set: pip 28 s against uv 4 s for the package install, and the venv
# creation is 3 s on both paths. That is the phase a user waits through.
#
# WHY THE ARCHIVE AND NOT A BARE BINARY: the release publishes
# `uv-<triple>.tar.gz` with a `.sha256` beside it. The archive carries `uv` and
# `uvx`; only `uv` is staged, because `uvx` is a tool runner this app never
# invokes and app size is a download every user pays.
#
# WHAT THIS DOES NOT DO: re-sign or normalise the binary. It ships exactly the
# bytes its publisher signed and notarized (`codesign -dv` reports a Developer ID
# Application authority and the hardened-runtime flag; `spctl -a -vv -t install`
# reports `source=Notarized Developer ID`), which is what lets it sit inside this
# repository's code-sealed bundle as a sealed resource without re-signing - and
# re-signing it would replace the publisher's identity with ours for a tool that
# is not ours to speak for.
setup_uv_arch() {
    local arch=$1
    local triple=$2
    local final_dir=$3
    local tarball_url="${UV_RELEASE_BASE_URL}/uv-${triple}.tar.gz"

    echo "Setting up uv for ${arch} (${triple})..."
    TMP_UV_TAR=$(mktemp)
    TMP_UV_SUM=$(mktemp)
    fetch_to "${tarball_url}" "${TMP_UV_TAR}"
    fetch_to "${tarball_url}.sha256" "${TMP_UV_SUM}"

    # The published checksum, checked before anything is unpacked. This is the
    # half that makes "pinned to a release" mean the bytes rather than the URL:
    # a truncated download or a substituted asset is refused here rather than
    # becoming a binary the install scripts cannot execute on every user's
    # machine.
    EXPECTED_SHA=$(awk '{print $1}' "${TMP_UV_SUM}")
    ACTUAL_SHA=$(sha256_of "${TMP_UV_TAR}")
    if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
        echo "Error: uv ${UV_VERSION} for ${arch} does not match its published sha256."
        echo "Expected: ${EXPECTED_SHA}"
        echo "Actual:   ${ACTUAL_SHA}"
        echo "URL fetched: ${tarball_url}"
        rm -f "${TMP_UV_TAR}" "${TMP_UV_SUM}"
        exit 1
    fi
    echo "Verified uv ${arch} sha256: ${ACTUAL_SHA}"

    TMP_UV_EXTRACT=$(mktemp -d)
    tar -xzf "${TMP_UV_TAR}" -C "${TMP_UV_EXTRACT}"
    if [ ! -f "${TMP_UV_EXTRACT}/uv-${triple}/uv" ]; then
        echo "Error: expected uv-${triple}/uv in the archive for ${arch}."
        rm -f "${TMP_UV_TAR}" "${TMP_UV_SUM}"
        rm -rf "${TMP_UV_EXTRACT}"
        exit 1
    fi
    cp "${TMP_UV_EXTRACT}/uv-${triple}/uv" "${final_dir}/uv"
    chmod +x "${final_dir}/uv"
    rm -f "${TMP_UV_TAR}" "${TMP_UV_SUM}"
    rm -rf "${TMP_UV_EXTRACT}"

    # The staged binary runs, and it is the pinned release.
    #
    # A tree for the OTHER architecture may not execute at all on this host (an
    # x86_64 uv on an arm64 machine with no Rosetta), and that is not a failure:
    # the bytes are pinned by the checked sha256 above, and the architecture that
    # ships is asserted per artifact by the release gate (`bundledUvToolCheck`).
    # What is checked here is that a binary this host CAN run reports the version
    # the layout declares - i.e. that the pin and the staged bytes agree.
    REPORTED_UV=$( "${final_dir}/uv" --version 2>/dev/null || true )
    if [ -n "${REPORTED_UV}" ]; then
        case "${REPORTED_UV}" in
            "uv ${UV_VERSION}"*)
                echo "Verified: the ${arch} uv is ${REPORTED_UV}."
                ;;
            *)
                echo "Error: the staged uv for ${arch} reports '${REPORTED_UV}' rather than 'uv ${UV_VERSION}'."
                exit 1
                ;;
        esac
    else
        echo "Staged ${final_dir}/uv for ${arch} cannot run on this host ($(uname -m)); its version is asserted on an artifact built for that architecture."
    fi
}

# The two macOS triples the layout's `uv.binaryNames` map is paired with. A
# Windows or Linux uv is deliberately NOT staged here: this script runs only in
# the macOS job (`publish.yml`), while `package.json`'s win/linux
# `extraResources` carry the same two target directories so a future platform job
# that does stage them ships them without another change to the layout.
setup_uv_arch "x86_64" "x86_64-apple-darwin" "${UV_DIR_X86_64}"
setup_uv_arch "aarch64" "aarch64-apple-darwin" "${UV_DIR_AARCH64}"

echo "Python standalone setup complete for all architectures!"
echo "uv ${UV_VERSION} staged for both architectures."
echo "You can now build the application with 'pnpm dist:mac'"
