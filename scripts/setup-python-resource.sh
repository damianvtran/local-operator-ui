#!/bin/bash
# setup-python-resource.sh
#
# Stages the runtime resources the packaging step copies into the app: the
# standalone Python the backend venv is built on, and the `uv` release the
# install scripts use to install the backend.
#
# WHICH HALF RUNS WHERE, because the two halves serve different platforms now. On
# macOS both are staged - the interpreters the mac artifacts ship as inert data
# plus the two `*-apple-darwin` uv releases. On Linux only the uv half is staged
# (the two `*-unknown-linux-gnu` releases): this repository ships no Linux
# interpreter, the Linux install script requires a system Python 3.12+, and a
# darwin tree in a Linux artifact is `exec format error` weight. Windows stages
# its uv with the PowerShell sibling (`scripts/setup-python-resource.ps1`), which
# this script points at when it is run on a platform it does not stage for.
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

# Which platform's resources this run stages. Detected from the host rather than
# taken as a flag: the stagers are run by the build job of the platform they
# serve (publish.yml), the trees they write are copied into THAT platform's
# artifacts, and a cross-staged tree would ship binaries the artifact cannot
# execute (the review R1-3 class). There is one stager per platform family and
# the platform names are the layout's own (`binaryNames`/`releaseTriples` keys).
case "$(uname -s)" in
    Darwin) LAYOUT_PLATFORM="darwin" ;;
    Linux) LAYOUT_PLATFORM="linux" ;;
    *)
        echo "Error: this script stages macOS and Linux runtime resources; it was run on $(uname -s)."
        echo "Windows stages its uv with scripts/setup-python-resource.ps1."
        exit 1
        ;;
esac

PYTHON_VERSION="$(read_layout '.python.version')"
PYTHON_BUILD_DATE="$(read_layout '.python.buildDate')"
UV_VERSION="$(read_layout '.uv.version')"
UV_ARCHIVE_EXTENSION="$(read_layout ".uv.archiveExtension.${LAYOUT_PLATFORM}")"
UV_ARCHIVE_MEMBER="$(read_layout ".uv.archiveMember.${LAYOUT_PLATFORM}")"
UV_BINARY_NAME="$(read_layout ".uv.binaryNames.${LAYOUT_PLATFORM}")"

# The canonical org: `indygreg/python-build-standalone` redirects here (301), and
# a build that depends on a redirect is one rename away from failing. Both the
# release assets and the redirect were checked on 2026-09-21. These two URLs are
# the darwin seeds - the only interpreter this repository stages (the Linux half
# of this script stages uv alone; `pnpm setup-python` skips them there).
BASE_PYTHON_STANDALONE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}"
PYTHON_STANDALONE_URL_X86_64="${BASE_PYTHON_STANDALONE_URL}-x86_64-apple-darwin-install_only.tar.gz"
PYTHON_STANDALONE_URL_AARCH64="${BASE_PYTHON_STANDALONE_URL}-aarch64-apple-darwin-install_only.tar.gz"

# uv is pinned to an exact release, never `latest`: the install scripts' behaviour
# is then a property of this repository rather than of the day a build ran, and
# the release gate can assert the version that shipped. The asset is a `.tar.gz`
# for the Unix triples and a `.zip` for the Windows ones (`archiveExtension`
# above); only `uv` is staged out of it (see setup_uv_arch below), and every
# asset's published `.sha256` beside it is checked before anything is unpacked.
UV_RELEASE_BASE_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}"

# This script extracts the tar releases only; the zip shape is the PowerShell
# sibling's (scripts/setup-python-resource.ps1). Named rather than left to fail
# inside `tar -xzf` as a gzip error, because the reader of that error has to
# already know the two stagers split the shapes to act on it.
if [ "${UV_ARCHIVE_EXTENSION}" != "tar.gz" ]; then
    echo "Error: src/shared/bundled-runtime-layout.json names the '${UV_ARCHIVE_EXTENSION}' archive for ${LAYOUT_PLATFORM}, which this script does not extract; the zip release is staged by scripts/setup-python-resource.ps1."
    exit 1
fi

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
UV_TRIPLE_X86_64="$(read_layout ".uv.releaseTriples.${LAYOUT_PLATFORM}.x64")"
UV_TRIPLE_AARCH64="$(read_layout ".uv.releaseTriples.${LAYOUT_PLATFORM}.arm64")"

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
#
# Both spellings deliberately: `shasum -a 256` is macOS's and `sha256sum` is the
# one a Linux runner or container has. A single spelling would fail the staging
# step on the platform this script now serves, and both print `<hex>  <name>`.
sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

echo "Setting up the bundled runtime resources for Local Operator UI..."
echo "Platform: ${LAYOUT_PLATFORM}"
echo "Python version: ${PYTHON_VERSION} (${PYTHON_BUILD_DATE})"
echo "uv version: ${UV_VERSION} (${UV_ARCHIVE_EXTENSION})"
echo "Resources directory: ${RESOURCES_DIR}"
echo "Python x86_64 directory: ${PYTHON_DIR_X86_64}"
echo "Python aarch64 directory: ${PYTHON_DIR_AARCH64}"
echo "uv x86_64 directory: ${UV_DIR_X86_64}"
echo "uv aarch64 directory: ${UV_DIR_AARCH64}"

# Create resources directory if it doesn't exist
mkdir -p "${RESOURCES_DIR}"
echo "Created resources directory: ${RESOURCES_DIR}"

# Remove existing staged directories if they exist.
#
# The interpreter half is macOS's alone, so on Linux neither the removal nor the
# creation below touches `resources/python*`: creating empty trees there would
# put empty directories into a Linux artifact (the copy lists name those sources)
# and make `findPython` on a Linux dev checkout find a directory that is not an
# interpreter.
if [ "${LAYOUT_PLATFORM}" = "darwin" ]; then
    if [ -d "${PYTHON_DIR_X86_64}" ]; then
        echo "Removing existing Python x86_64 directory: ${PYTHON_DIR_X86_64}..."
        rm -rf "${PYTHON_DIR_X86_64}"
    fi
    if [ -d "${PYTHON_DIR_AARCH64}" ]; then
        echo "Removing existing Python aarch64 directory: ${PYTHON_DIR_AARCH64}..."
        rm -rf "${PYTHON_DIR_AARCH64}"
    fi
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

# Create Python architecture-specific directories (macOS only; see the note on
# the removal above).
if [ "${LAYOUT_PLATFORM}" = "darwin" ]; then
    mkdir -p "${PYTHON_DIR_X86_64}"
    echo "Created Python x86_64 directory: ${PYTHON_DIR_X86_64}"
    mkdir -p "${PYTHON_DIR_AARCH64}"
    echo "Created Python aarch64 directory: ${PYTHON_DIR_AARCH64}"
fi

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

# Setup Python for x86_64 and aarch64. macOS only - see the note on the
# directory removal above: the Linux install script requires a system Python
# 3.12+ on the user's machine (`linux-install-script.sh`), and this repository
# ships no Linux interpreter seed for it to fall back to.
if [ "${LAYOUT_PLATFORM}" = "darwin" ]; then
    setup_python_arch "x86_64" "${PYTHON_STANDALONE_URL_X86_64}" "${PYTHON_DIR_X86_64}"
    setup_python_arch "aarch64" "${PYTHON_STANDALONE_URL_AARCH64}" "${PYTHON_DIR_AARCH64}"
else
    echo "Skipping the interpreter seed: not macOS (${LAYOUT_PLATFORM}). The Linux install uses the system Python 3.12+."
fi

# --- uv ---------------------------------------------------------------------
#
# The uv release for one architecture, verified and staged as a single binary.
#
# WHY uv SHIPS AT ALL: installing the backend with pip is the dominant cost of a
# first run. Measured on this machine, cold cache, same interpreter, same
# dependency set: pip 28 s against uv 4 s for the package install, and the venv
# creation is 3 s on both paths. That is the phase a user waits through.
#
# WHY THE ARCHIVE AND NOT A BARE BINARY: the release publishes one archive per
# triple with a `.sha256` beside it - `uv-<triple>.tar.gz` for the Unix triples,
# `uv-<triple>.zip` (flat, `uv.exe` at the root) for the Windows ones. The
# extension and the member path are read from the layout rather than spelled
# here, because the two shapes differ and a stager that assumed one extracts
# nothing on the other platform. Only `uv` is staged out of whichever archive -
# `uvx` is a tool runner this app never invokes and app size is a download every
# user pays.
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
    local asset="uv-${triple}.${UV_ARCHIVE_EXTENSION}"
    local asset_url="${UV_RELEASE_BASE_URL}/${asset}"
    # `uv-{triple}/uv` for the tar releases; the Windows zip's flat `uv.exe` is
    # the PowerShell stager's shape, and this script refuses a non-tar extension
    # before it gets here.
    local member="${UV_ARCHIVE_MEMBER//\{triple\}/${triple}}"

    echo "Setting up uv for ${arch} (${triple})..."
    TMP_UV_TAR=$(mktemp)
    TMP_UV_SUM=$(mktemp)
    fetch_to "${asset_url}" "${TMP_UV_TAR}"
    fetch_to "${asset_url}.sha256" "${TMP_UV_SUM}"

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
        echo "URL fetched: ${asset_url}"
        rm -f "${TMP_UV_TAR}" "${TMP_UV_SUM}"
        exit 1
    fi
    echo "Verified uv ${arch} sha256: ${ACTUAL_SHA}"

    TMP_UV_EXTRACT=$(mktemp -d)
    tar -xzf "${TMP_UV_TAR}" -C "${TMP_UV_EXTRACT}"
    if [ ! -f "${TMP_UV_EXTRACT}/${member}" ]; then
        echo "Error: expected ${member} in ${asset} for ${arch}; the layout's archiveMember says that is where the release puts it."
        rm -f "${TMP_UV_TAR}" "${TMP_UV_SUM}"
        rm -rf "${TMP_UV_EXTRACT}"
        exit 1
    fi
    cp "${TMP_UV_EXTRACT}/${member}" "${final_dir}/${UV_BINARY_NAME}"
    chmod +x "${final_dir}/${UV_BINARY_NAME}"
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
    REPORTED_UV=$( "${final_dir}/${UV_BINARY_NAME}" --version 2>/dev/null || true )
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
        echo "Staged ${final_dir}/${UV_BINARY_NAME} for ${arch} cannot run on this host ($(uname -m)); its version is asserted on an artifact built for that architecture."
    fi
}

# Both of THIS platform's triples are staged, even where the target list builds
# only one of them (linux is x64-only today): `extraResources` is not
# architecture-aware, `afterPack` prunes the off-architecture tree out of every
# packed app (`scripts/prune-bundled-resources.mjs`), and staging both keeps the
# build jobs a copy of each other rather than a platform-specific list to
# maintain. The triples come from the layout definition - a triple spelled here
# is a triple that can disagree with the release it names.
setup_uv_arch "x86_64" "${UV_TRIPLE_X86_64}" "${UV_DIR_X86_64}"
setup_uv_arch "aarch64" "${UV_TRIPLE_AARCH64}" "${UV_DIR_AARCH64}"

echo "Runtime resource staging complete for ${LAYOUT_PLATFORM}!"
echo "uv ${UV_VERSION} staged for both architectures."
case "${LAYOUT_PLATFORM}" in
    darwin) echo "You can now build the application with 'pnpm dist:mac'" ;;
    linux) echo "You can now build the application with 'pnpm dist:linux'" ;;
esac
