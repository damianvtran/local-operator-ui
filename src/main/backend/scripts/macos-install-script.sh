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

# Nothing is fetched here but the package itself.
#
# This script used to download a third-party FFmpeg binary from a GitHub
# release into `$APP_DATA_DIR/bin`. The macOS asset names it asked for do not
# exist (curl without `--fail` wrote the 404 body to the binary path, `chmod +x`
# made it executable, its own `[ -f ] && [ -x ]` verification passed and the next
# run skipped the download, so the broken file was permanent), nothing in the app
# or in `local-operator` ever executed it, and under `set -e` a failed download
# killed the install before the venv existed - so a machine that can reach PyPI
# but not github.com could not install at all. Tooling a task actually needs is
# acquired later, on demand, through the app's Console with the user's approval;
# this script's job is the environment below and nothing else.
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

# --- The package install: uv when there is one, pip otherwise ------------------
#
# WHY UV. Installing the backend is the phase a user waits through on a first
# run, and pip spends it resolving and fetching serially. Measured on this
# machine, cold cache, the same interpreter and the same dependency set: pip
# 128.9 s against uv 14.8 s for the package install, and 178.3 s against 4.5 s
# with both caches warm (pip's own CPU 13.7 s against uv's 0.5 s). The host runs
# ~25 concurrent agent sessions, so read the ratio as the finding and the seconds
# as this box's.
#
# WHY A FALLBACK RATHER THAN UV ALONE. uv is a NEW resource in the bundle, and
# every artifact built before this change has none. The pip path below is the one
# that shipped until now, unchanged, and it runs whenever uv is absent or cannot
# do the job - a dev checkout whose `pnpm setup-python` was never run, an older
# artifact, a uv the platform refuses to spawn, a uv install that failed. A
# fallback that has never been exercised is a claim rather than a feature, which
# is why the CI install-script jobs run this script with no uv at all.
#
# WHY pip STAYS IN THE VENV, and why this does NOT use `uv venv`: the app's
# backend-update path runs `pip install --upgrade local-operator` inside this same
# environment (`update-service.ts`, and `update-install.ts` documents why pip is
# the right command there). `python -m venv` seeds pip from the interpreter's own
# `ensurepip` wheel, where `uv venv` produces an environment with no pip at all -
# so switching the creation would silently break every later update. The check
# above (`"$VENV_PATH/bin/pip"`) is what holds that on both paths.
#
# The app hands the path of the pinned, bundled uv in `LOCAL_OPERATOR_UV_BIN`
# (`src/main/backend/uv-tool.ts`). Nothing here searches PATH for a uv: an
# installed uv is a version and a configuration nobody in this repository chose,
# and the point of bundling one is that the install is the same for every user.
UV_BIN="${LOCAL_OPERATOR_UV_BIN:-}"

# Drop every UV_* variable the launching environment carried.
#
# WHY THE WHOLE NAMESPACE rather than a list of the dangerous ones: uv reads its
# configuration from `UV_*` and from `uv.toml`, and both are the caller's, not
# this app's. Measured on uv 0.12.17: with a user-level `uv.toml` naming an index
# that is not reachable, `uv pip install --dry-run six` fails with `tcp connect
# error`; `UV_NO_CONFIG=1` makes the same command resolve from PyPI. And an
# ambient `UV_INDEX_URL` changes where packages come from - while `PIP_INDEX_URL`
# does not affect uv at all (measured, both directions). Unsetting a name list
# would drift the day uv adds a variable; unsetting the namespace cannot.
#
# IT RUNS BEFORE THE SETTINGS BELOW ARE SET, and that order is load-bearing: a
# sweep after them takes them away, and an empty `UV_CACHE_DIR` is not "use the
# default cache" - uv exits 2 with `a value is required for '--cache-dir
# <CACHE_DIR>'`. Measured by running this script on the uv path, where the
# failure first surfaced as a silent pip install, because the fallback below
# caught it exactly as designed.
for uv_ambient in $(env | sed -n 's/^\(UV_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$uv_ambient"
done

# The cache lives under the app's own support directory rather than the user's
# shared `~/.cache/uv`, so the install neither reads nor pollutes a cache that
# another tool (or another version of uv) is maintaining. Written here, after the
# sweep, and handed to uv per invocation rather than exported.
#
# IT PERSISTS, and that is worth knowing on a user's disk: a full install leaves
# ~118 MB there (measured; pip's own cache for the same dependency set is ~40 MB
# and it also persists). Nothing else reads it today - the app's backend-update
# path installs with pip - so it is there for the next provisioning or repair,
# and it is what makes a retry converge in ~1.5 s instead of ~20 s.
UV_CACHE_DIR="$APP_DATA_DIR/uv-cache"

# Is the handed-down uv something we can actually run?
uv_is_usable() {
  [ -n "$UV_BIN" ] && [ -x "$UV_BIN" ] && "$UV_BIN" --version >/dev/null 2>&1
}

# UV_NO_CONFIG: never read `pyproject.toml`/`uv.toml`, wherever they are.
# UV_PYTHON_DOWNLOADS=never: this install uses the interpreter it was handed and
# may never fetch another, which is also what keeps it working offline.
# UV_CACHE_DIR: this install's own cache, passed explicitly for the same reason.
uv_run() {
  UV_NO_CONFIG=1 UV_PYTHON_DOWNLOADS=never UV_CACHE_DIR="$UV_CACHE_DIR" \
    "$UV_BIN" "$@"
}

# Activate virtual environment and install local-operator
echo "Installing local-operator in virtual environment..."
source "$VENV_PATH/bin/activate"

# Check network connectivity to PyPI. A DIAGNOSTIC, not a gate: the install below
# decides whether it can proceed.
#
# What this answers, stated precisely because an earlier version of this comment
# claimed more than the flags buy: "did a TLS fetch to PyPI's JSON API complete,
# and did the answer come back as JSON?". `--fail` turns an HTTP ERROR status
# into a non-zero exit - a proxy's 403/407, any 4xx/5xx - and does NOT notice a
# captive portal answering 200 with its own HTML page (measured: a portal-shaped
# 200 returns exit 0 with AND without the flag). `-o /dev/null` cannot tell a
# portal's page from PyPI's JSON either, so the content type is what
# discriminates, and on a captive network a probe that reports "reachable" while
# pip is about to fail is the false negative this warning exists to catch.
#
# What the content type does NOT prove, stated so this paragraph is not read as
# more than it says: a proxy answering 200 with `application/json` and an error
# body (`{"detail":"blocked by proxy policy"}`) is silent here, because the
# answer did come back as JSON. Only parsing the body - a fetch of PyPI's own
# payload shape - would tell those apart, and a diagnostic that costs a parse is
# not what stands in front of an install.
#
# Two bounds, two jobs: `--connect-timeout 5` ends a black-hole network (a
# connect that never completes), `--max-time 30` stops a connected-but-stalled
# peer. Both must be POSITIVE: `--max-time 0` and `--connect-timeout 0` disable
# the bound rather than making it immediate, which is why the test beside this
# script requires `[1-9]`. 30 rather than 10 because the total must not fire on a
# slow-but-working link: a working endpoint that answered in 15s tripped a 10s
# total bound and printed this warning on an install that then succeeded, and a
# warning that cries wolf is one users learn to ignore.
echo "Checking network connectivity to PyPI..."
PYPI_PROBE_CONTENT_TYPE=$(curl -s --fail --connect-timeout 5 --max-time 30 -o /dev/null -w '%{content_type}' https://pypi.org/pypi/local-operator/json) || PYPI_PROBE_CONTENT_TYPE=""
if [[ "$PYPI_PROBE_CONTENT_TYPE" != application/json* ]]; then
  echo "WARNING: Could not reach PyPI. Network connectivity issues might prevent installation."
  echo "Attempting to ping common domains to diagnose network issues:"
  ping -c 1 -W 2000 google.com || echo "Cannot ping google.com"
  ping -c 1 -W 2000 pypi.org || echo "Cannot ping pypi.org"
fi

UV_INSTALLED=false
if uv_is_usable; then
  echo "Installing local-operator with uv ($("$UV_BIN" --version 2>/dev/null || echo 'version unavailable'))..."
  # No `pip install --upgrade pip` on this path: uv does not use pip, so the
  # upgrade would be a whole extra network round trip that changes nothing about
  # the result.
  if uv_run pip install --python "$VENV_PATH/bin/python" --upgrade local-operator; then
    UV_INSTALLED=true
    echo "local-operator installation with uv successful"
  else
    # WHY THE EXIT CODE IS PRINTED (review round 1, QA Q2): this fallback has to
    # be forgiving - an install must not fail because uv did - but "a bundled uv
    # is present and fails" is a defect rather than a degraded path, and this line
    # is the only place it shows up: the exit code is 0 and the UI is unchanged.
    # `uv_is_usable` passing and a uv install SUCCEEDING are two different facts.
    UV_STATUS=$?
    echo "WARNING: the bundled uv is present but its install failed (exit ${UV_STATUS}); retrying with pip, which is what this script used before uv was bundled."
  fi
else
  echo "Bundled uv not available (LOCAL_OPERATOR_UV_BIN=${UV_BIN:-unset}); installing with pip."
fi

if [ "$UV_INSTALLED" != true ]; then
  echo "Upgrading pip..."
  python -m pip install --upgrade pip || {
    echo "ERROR: Failed to upgrade pip. Exit code: $?"
    echo "pip version before failing:"
    pip --version
    exit 1
  }
  echo "pip upgrade successful:"
  pip --version

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
    curl -sI --fail --connect-timeout 5 --max-time 30 https://pypi.org || echo "Cannot reach PyPI server"
    exit 1
  }
fi
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
