# Local Operator Backend Installation Script for Windows
# This script finds or installs Python 3.12+ inside the app's own folder and sets up a virtual environment for the Local Operator backend.

# Configuration
$AppName = "Local Operator"
$VenvName = "local-operator-venv"
$AppDataDir = "$env:APPDATA\\$AppName"
$VenvPath = "$AppDataDir\\$VenvName"
$LogFile = "$AppDataDir\\backend-install-shell.log"

# Which environment this installs into - the app's decision, handed in rather
# than re-derived. A packaged install and an unpackaged one must not share an
# environment (the venv is built on whatever interpreter the instance resolves),
# and only the app knows which it is: LOCAL_OPERATOR_VENV_PATH carries
# managedVenvPath's answer (src/main/backend/venv-paths.ts). The default above is
# what a standalone run uses - the packaged name, because that is what every
# install on a disk today has.
if ($env:LOCAL_OPERATOR_VENV_PATH) {
    $VenvPath = $env:LOCAL_OPERATOR_VENV_PATH
}

# Keep CPython's bytecode cache out of the application directory.
#
# Same rule as the macOS script, and stated here for the same reason: an
# interpreter writes __pycache__/*.pyc beside the stdlib sources it imports. On
# Windows those sources are the bundled python directory rather than a
# code-signed bundle, so this is hygiene rather than the load-bearing fix it is
# on macOS - but the app and the script must not disagree about where bytecode
# goes. $AppDataDir is used for the same reason the venv is: it is never inside
# the installed application tree.
if (-not $env:PYTHONPYCACHEPREFIX) {
    $env:PYTHONPYCACHEPREFIX = "$AppDataDir\\python-bytecode-cache"
}

# The refusal half of the same pair, kept in step with the app's
# `withPythonBytecodeCache`: CPython reads the flag before its first import, so
# nothing this script runs can write a __pycache__ at all.
$env:PYTHONDONTWRITEBYTECODE = "1"

# Create app data directory if it doesn't exist
if (-not (Test-Path $AppDataDir)) {
    New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
}

# Start logging
Start-Transcript -Path $LogFile -Append
Write-Output "$(Get-Date): Starting Local Operator backend installation..."

# Nothing is fetched here but the package itself and Python's own toolchain.
#
# This script used to download a third-party FFmpeg binary from a GitHub release
# into `$AppDataDir\bin`. Nothing in the app or in `local-operator` ever executed
# it. Tooling a task actually needs is acquired later, on demand, through the
# app's Console with the user's approval; this script's job is the environment
# below and nothing else. The script itself names no download URL at all now:
# the one third-party fetch it used to make, pyenv-win's unpinned source archive,
# is gone (see "Which Python the environment is built on" below), and
# `scripts/install-scripts-network.test.mjs` keeps it that way.

# Function to check if a command exists
function Test-CommandExists {
    param ($command)
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'stop'
    try {
        if (Get-Command $command) { return $true }
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldPreference
    }
}

# --- Which Python the environment is built on ---------------------------------
#
# WHAT THIS REPLACED (first-run onboarding, Q4). The script used to download
# pyenv-win's `master.zip` - an UNPINNED branch head, so every install ran
# whatever that repository's default branch said that day - install Python
# 3.12.0 through it, and persist User-scope `PYENV`/`PYENV_HOME` plus two `PATH`
# prepends on the user's account: changes to the machine outside this app's own
# folder, before the step most likely to fail. It also ignored `PYTHON_BIN`, the
# interpreter the app resolves and hands every platform's script. It cost ~77 s
# of the Windows CI run before the package install started.
#
# THE ORDER NOW, first usable wins, and every arm stays inside this app's folder:
#
#  1. `PYTHON_BIN` - the app's own answer (`findPython` in backend-installer.ts),
#     honoured exactly as the macOS and Linux scripts honour it. On an existing
#     install that is the pyenv-win 3.12.0 it already has, so an upgrade does not
#     move an environment it does not need to.
#  2. The bundled uv's own managed Python, at the version the app pins
#     (`LOCAL_OPERATOR_PYTHON_VERSION`, from `bundled-runtime-layout.json` - the
#     same definition the macOS seed is built from, so the two platforms run the
#     same interpreter). uv verifies the download against checksums compiled into
#     the pinned uv, installs it under `$AppDataDir\python`, and `--no-bin`
#     `--no-registry` keep it off PATH and out of the registry: nothing outside
#     the folder changes.
#  3. A Python 3.12+ already on this process's PATH (`py -3`, then `python`) - the
#     shape of a dev checkout or an artifact built before uv was bundled.
#
# None of them writes to the user's environment variables.
# THE VERSION IS NOT SPELLED HERE (code review round 1, R5). It used to fall
# back to a literal "3.14.7", which is a second copy of
# `src/shared/bundled-runtime-layout.json`'s `python.version` - exactly the
# duplication this file's own note above forbids, and nothing would have caught
# it drifting. The app always sets the variable; a hand-run that does not gets a
# loud sentence naming what to set, inside the branch that actually needs it (a
# machine whose PYTHON_BIN or PATH Python answers never reads it at all).
$PythonVersion = $env:LOCAL_OPERATOR_PYTHON_VERSION
$ManagedPythonDir = "$AppDataDir\python"

# Is this a Python 3.12+ executable we can run? The floor is local-operator's own
# `requires-python`; an older interpreter fails the install much later with
# pip's "from versions: none", which is the least helpful place to learn it.
function Test-PythonUsable {
    param ($Candidate)
    if (-not $Candidate) { return $false }
    try {
        & $Candidate -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# THE `python` STAGE IS ANNOUNCED HERE, ON THIS PLATFORM TOO (code review round 1,
# R1). macOS gets it from `managed-python.ts` when it copies the managed runtime;
# nothing ever announced it on win32, so the panel painted with no step, no clock
# and no estimate through the whole CPython download and the first line a Windows
# user saw was "Step 2 of 4" - while the rail still showed four rows and the
# win32 baseline this PR measured was dead input.
#
# IT BRACKETS THE STAGE, NOT ONLY ITS uv BRANCH: this is where the interpreter is
# found, and fetched only if it is not already here. Announcing inside
# provisioning alone would leave a machine whose PYTHON_BIN or PATH Python
# answers without any phase 1 at all, which is the same hole one branch over. The
# phase's own words are "Getting ready / Finding the copy of Python Local
# Operator runs on", so finding is what it means - and `$PythonVersion` above is
# read inside the branch that needs it, never to decide this marker.
Write-Output "|LO1:python"
$PythonExe = $null
if ($env:PYTHON_BIN -and (Test-Path $env:PYTHON_BIN) -and (Test-PythonUsable $env:PYTHON_BIN)) {
    $PythonExe = $env:PYTHON_BIN
    Write-Output "Using Python provided by the app: $PythonExe"
} elseif ($env:PYTHON_BIN) {
    Write-Output "WARNING: PYTHON_BIN ($env:PYTHON_BIN) is not a runnable Python 3.12+; looking for another."
}

# --- The installer this script prefers: the app's own bundled uv ---------------
#
# Same shape as the macOS and Linux scripts, and for the same reasons: uv resolves
# and fetches in parallel - measured on macOS, cold cache, three runs each, same
# interpreter: uv's package install is 12.8-16.1 s against pip's 33.0-40.7 s,
# plus the 2.3-2.8 s pip self-upgrade this path skips, so 1.5-2.8x across two
# operators rather than the "14.8 s against 128.9 s" quoted here before that
# reading was withdrawn (`docs/BUILD.md` has the full set). The pip path below is
# unchanged and runs whenever uv is absent or cannot do the job, and pip STAYS in
# the venv because the app's backend-update path runs `pip install --upgrade
# local-operator` inside this same environment - which is why the environment must
# keep pip, and NOT a reason to avoid `uv venv`: bare `uv venv` leaves no pip,
# `uv venv --seed` does, and `--seed` is what the creation below passes.
#
# RESOLVED ABOVE THE ENVIRONMENT, because uv now provisions the interpreter and
# builds the environment too (first-run onboarding, Q4/Q13).
#
# Nothing here searches PATH for a uv: an installed uv is a version and a
# configuration nobody in this repository chose. `LOCAL_OPERATOR_UV_BIN` is the
# app's own answer (`src/main/backend/uv-tool.ts`).
$UvBin = $env:LOCAL_OPERATOR_UV_BIN
$UvCacheDir = "$AppDataDir\uv-cache"

function Test-UvUsable {
    if (-not $UvBin) { return $false }
    if (-not (Test-Path $UvBin)) { return $false }
    try {
        & $UvBin --version | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

# Drop every UV_* variable the launching environment carried, then set the four
# settings this install depends on. Measured on uv 0.12.17: a user-level
# `uv.toml` naming an unreachable index is obeyed by `uv pip install` and ignored
# with `UV_NO_CONFIG=1`; an ambient `UV_INDEX_URL` changes where packages come
# from, while `PIP_INDEX_URL` does not affect uv at all. A name list would drift
# the day uv adds a variable - the namespace cannot.
#
# The names are MATERIALISED first (`@(...)` over a property projection):
# removing entries of a collection that is still being enumerated is the shape
# that throws `Collection was modified`.
$uvAmbientNames = @(
    Get-ChildItem env: |
        Where-Object { $_.Name -like 'UV_*' } |
        Select-Object -ExpandProperty Name
)
foreach ($uvAmbientName in $uvAmbientNames) {
    Remove-Item "env:$uvAmbientName" -ErrorAction SilentlyContinue
}

# UV_NO_CONFIG: never read `pyproject.toml`/`uv.toml`, wherever they are.
# UV_PYTHON_DOWNLOADS=never: this install uses the interpreter it was handed and
# never fetches another.
# UV_CACHE_DIR: under the app's own support directory rather than the user's
# shared uv cache.
#
# UV_SYSTEM_CERTS: trust the PLATFORM trust store (the Windows certificate
# stores), not only the root bundle uv ships - off by default, which is the
# default this line changes; `--system-certs` is the same setting spelled as a
# flag in the bundled uv 0.12.17.
#
# WHY: on a network that inspects TLS the root is installed in the platform
# store, and uv does not read that store by default - it fails the handshake
# against the roots compiled into it. uv names the remedy itself when it fails:
# "Consider enabling use of system TLS certificates with the `--system-certs`
# command-line flag". Nothing here passed it.
#
# AND WHY THE PIP FALLBACK IS HANDED NO CA SETTING: pip 24.2 and newer read the
# platform store by default, in addition to the Mozilla bundle they ship
# (`truststore`, "always on since 24.2"), and every pip these installs produce
# is newer than that - uv's own seed and the bundled interpreter's ensurepip
# alike - so a root added to the Windows certificate stores is trusted by BOTH
# clients and no `PIP_CERT`/`SSL_CERT_FILE` is needed. The note this replaces
# claimed the opposite (the fallback "resolves against certifi"), which was
# true only of pip before 24.2; corrected rather than deleted so it is not
# restored (review round 1, R1-2). The one shape it does not cover is a dev
# checkout on a system python old enough to predate truststore.
#
# IT CANNOT MAKE THINGS WORSE: every uv call below is already followed by the pip
# fallback on a non-zero exit, so a platform store that cannot be read costs one
# failed uv attempt and then the path that shipped before uv was bundled.
$env:UV_NO_CONFIG = "1"
$env:UV_PYTHON_DOWNLOADS = "never"
$env:UV_CACHE_DIR = $UvCacheDir
$env:UV_SYSTEM_CERTS = "1"

if (-not $PythonExe -and (Test-UvUsable)) {
    if (-not $PythonVersion) {
        Write-Error "ERROR: no Python version was handed down (LOCAL_OPERATOR_PYTHON_VERSION is unset), so the bundled uv has nothing to install. Launch setup from the app, or set that variable to the version src/shared/bundled-runtime-layout.json pins."
        exit 1
    }
    Write-Output "Installing Python $PythonVersion with uv..."
    # `UV_PYTHON_DOWNLOADS=manual` for THIS call alone: the global `never` above is
    # what keeps every later uv call on the interpreter it was handed, and an
    # explicit `python install` is the one place a download is the point.
    $env:UV_PYTHON_DOWNLOADS = "manual"
    & $UvBin python install $PythonVersion --install-dir $ManagedPythonDir --no-bin --no-registry
    $UvPythonStatus = $LASTEXITCODE
    $env:UV_PYTHON_DOWNLOADS = "never"
    if ($UvPythonStatus -eq 0) {
        $env:UV_PYTHON_INSTALL_DIR = $ManagedPythonDir
        $Found = (& $UvBin python find --managed-python $PythonVersion 2>$null | Select-Object -First 1)
        Remove-Item env:UV_PYTHON_INSTALL_DIR -ErrorAction SilentlyContinue
        if ($Found -and (Test-PythonUsable $Found)) {
            $PythonExe = $Found.Trim()
            Write-Output "Using Python installed by uv: $PythonExe"
        }
    }
    if (-not $PythonExe) {
        Write-Output "WARNING: the bundled uv could not install Python $PythonVersion (exit $UvPythonStatus); looking for one on PATH."
    }
}

if (-not $PythonExe) {
    foreach ($Candidate in @("py", "python")) {
        if (-not (Test-CommandExists $Candidate)) { continue }
        if ($Candidate -eq "py") {
            $Resolved = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
        } else {
            $Resolved = (& python -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
        }
        if ($Resolved -and (Test-PythonUsable $Resolved.Trim())) {
            $PythonExe = $Resolved.Trim()
            Write-Output "Using Python found on PATH: $PythonExe"
            break
        }
    }
}

if (-not $PythonExe) {
    Write-Error "ERROR: No Python 3.12+ is available: the app handed none, the bundled uv could not install one, and none is on PATH. Install Python 3.12 or newer from https://www.python.org/downloads/ and try again."
    exit 1
}

# Create virtual environment if it doesn't exist
if (-not (Test-Path $VenvPath)) {
    Write-Output "|LO1:environment"
    Write-Output "Creating virtual environment at $VenvPath..."

    # Ensure the directory exists
    if (-not (Test-Path $AppDataDir)) {
        New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
        Write-Output "Created directory: $AppDataDir"
    }

    # uv first, `--seed` so the environment keeps pip (the app's backend-update
    # path runs `pip install --upgrade local-operator` inside it); the venv
    # module is the fallback, as on macOS and Linux. Removing a failed attempt is
    # safe: the guard above proved the path absent a moment ago.
    $VenvCreated = $false
    if (Test-UvUsable) {
        & $UvBin venv --seed --python $PythonExe $VenvPath
        if ($LASTEXITCODE -eq 0) {
            $VenvCreated = $true
        } else {
            Write-Output "WARNING: the bundled uv could not create the environment (exit $LASTEXITCODE); retrying with the interpreter's own venv module."
            Remove-Item -Path $VenvPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if (-not $VenvCreated) {
        & $PythonExe -m venv $VenvPath
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create virtual environment"
            exit 1
        }
    }
}

# Verify the virtual environment was created
if (-not (Test-Path "$VenvPath\\Scripts\\Activate.ps1")) {
    Write-Error "Virtual environment activation script not found at $VenvPath\\Scripts\\Activate.ps1"
    exit 1
}

# --- The package install: uv when there is one, pip otherwise ------------------

# Activate virtual environment and install local-operator
# --- Progress markers -------------------------------------------------------
# One whole line per phase, read by the app and shown in the setup window. The
# app matches the ENTIRE line (`|LO1:<phase>`, see src/shared/install-progress.ts)
# and never a substring, so a marker has to stand alone: do not wrap it in
# other text, do not re-indent it into a longer sentence, and do not emit one
# for work this script does not actually do. A missing marker leaves the window
# on its previous step, which is the honest failure; a marker a log line also
# happens to produce is a wrong step presented as a measurement.
#
# WHY THE SCRIPT AND NOT ONLY THE APP: the install below is minutes of work on a
# cold machine, and the app cannot see inside the venv it is about to create -
# this is the only process that knows when the environment exists and when the
# download starts.
Write-Output "|LO1:components"
Write-Output "Installing local-operator in virtual environment..."
# Use PowerShell to run the activation script
& "$VenvPath\\Scripts\\Activate.ps1"

$UvInstalled = $false
if (Test-UvUsable) {
    Write-Output "Installing local-operator with uv..."
    # No `pip install --upgrade pip` on this path: uv does not use pip.
    & $UvBin pip install --python "$VenvPath\Scripts\python.exe" --upgrade local-operator
    if ($LASTEXITCODE -eq 0) {
        $UvInstalled = $true
        Write-Output "local-operator installation with uv successful"
    } else {
        # The exit code is printed for the same reason as on macOS and Linux: the
        # fallback is deliberately forgiving, so this line is the only evidence
        # that a bundled uv is present and failing for every user (QA Q2).
        Write-Output "WARNING: the bundled uv is present but its install failed (exit $LASTEXITCODE); retrying with pip, which is what this script used before uv was bundled."
    }
} else {
    if ($UvBin) {
        Write-Output "Bundled uv at $UvBin could not be run on this machine; installing with pip."
    } else {
        Write-Output "Bundled uv not available (LOCAL_OPERATOR_UV_BIN unset); installing with pip."
    }
}

if (-not $UvInstalled) {
    # No pip self-upgrade (first-run onboarding, Q13): an extra resolve and
    # download that changes nothing, since the environment's pip is already
    # 24.2+ on both creation paths. The venv's own interpreter by path, not
    # `python` off PATH: activation in a child `&` call is not guaranteed to have
    # put the venv first, and a PATH python would install into the wrong place.
    & "$VenvPath\Scripts\python.exe" -m pip install --upgrade local-operator

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install packages in virtual environment"
        exit 1
    }
}

# Verify installation
$LocalOperatorInstalled = $false
try {
    # First try to run local-operator directly (it should be in PATH from the activated venv)
    $Version = & local-operator --version
    $LocalOperatorInstalled = $true
    Write-Output "Local Operator backend installed successfully!"
    Write-Output $Version
} catch {
    Write-Output "Could not run local-operator directly, trying with full path..."
    try {
        # Try with explicit path
        $LocalOperatorExe = "$VenvPath\\Scripts\\local-operator.exe"
        if (Test-Path $LocalOperatorExe) {
            $Version = & $LocalOperatorExe --version
            $LocalOperatorInstalled = $true
            Write-Output "Local Operator backend installed successfully at $LocalOperatorExe!"
            Write-Output $Version
        } else {
            # Try without .exe extension
            $LocalOperatorCmd = "$VenvPath\\Scripts\\local-operator"
            if (Test-Path $LocalOperatorCmd) {
                $Version = & $LocalOperatorCmd --version
                $LocalOperatorInstalled = $true
                Write-Output "Local Operator backend installed successfully at $LocalOperatorCmd!"
                Write-Output $Version
            } else {
                Write-Error "Error: local-operator executable not found in expected locations."
                
                # Create a symlink to make it more accessible
                Write-Output "Attempting to create a symlink for local-operator..."
                $PythonModule = "$VenvPath\\Lib\\site-packages\\local_operator"
                if (Test-Path $PythonModule) {
                    Write-Output "Found local_operator module at $PythonModule"
                    
                    # Create a batch file that runs the module
                    $BatchContent = "@echo off`npython -m local_operator %*"
                    Set-Content -Path "$VenvPath\\Scripts\\local-operator.bat" -Value $BatchContent
                    
                    # Test the batch file
                    if (Test-Path "$VenvPath\\Scripts\\local-operator.bat") {
                        Write-Output "Created local-operator.bat in Scripts directory"
                        $LocalOperatorInstalled = $true
                    } else {
                        Write-Error "Failed to create local-operator.bat"
                        exit 1
                    }
                } else {
                    Write-Error "local_operator module not found in site-packages"
                    exit 1
                }
            }
        }
    } catch {
        Write-Error "Error: Failed to install Local Operator backend."
        Write-Error $_.Exception.Message
        exit 1
    }
}

# If we got here, installation was successful
if ($LocalOperatorInstalled) {
    Write-Output "Local Operator backend installation verified."
} else {
    Write-Error "Error: Failed to verify Local Operator backend installation."
    exit 1
}

Write-Output "$(Get-Date): Installation completed successfully."

# Properly close the transcript and ensure it's released
try {
    Write-Output "Finalizing installation and releasing resources..."
    # Flush any pending output
    [System.Console]::Out.Flush()
    # Stop transcript properly
    Stop-Transcript
    
    # Add a small delay to ensure file handles are released
    Start-Sleep -Seconds 1
    
    # Explicitly release any COM objects
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    
    Write-Output "Installation completed and resources released."
} catch {
    Write-Error "Error during cleanup: $_"
}
