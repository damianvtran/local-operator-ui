# Local Operator Backend Installation Script for Windows
# This script installs pyenv-win, Python 3.12, and sets up a virtual environment for the Local Operator backend.

# Configuration
$AppName = "Local Operator"
$PythonVersion = "3.12.0"
$VenvName = "local-operator-venv"
$AppDataDir = "$env:APPDATA\\$AppName"
$VenvPath = "$AppDataDir\\$VenvName"
$LogFile = "$AppDataDir\\backend-install-shell.log"
$PyenvDir = "$env:USERPROFILE\\.pyenv"

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
# below and nothing else. (pyenv-win's source archive below is the one remaining
# third-party fetch, and it is a source archive the Windows install cannot do
# without - see `scripts/install-scripts-network.test.mjs`, which keeps that list
# down to the fetches each platform genuinely needs.)

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

# Install pyenv-win if not installed
if (-not (Test-Path $PyenvDir)) {
    Write-Output "Installing pyenv-win..."
    
    # Create temporary directory
    $TempDir = "$env:TEMP\\pyenv-win"
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    
    # Download and extract pyenv-win
    $PyenvZip = "$TempDir\\pyenv-win.zip"
    # Bounded, and the bound FAILS LOUDLY. An unbounded request here holds a
    # first-run install open behind the progress bar forever on a black-hole
    # network; and without -ErrorAction Stop a fired -TimeoutSec is a
    # NON-TERMINATING error, so the script would walk straight into
    # Expand-Archive with an absent or partial zip and report an archive error
    # instead of "the download timed out". The partial file is removed in the
    # failure branch so a later run cannot expand what this one failed to fetch
    # (the next run clears $TempDir before it downloads at all, which is the
    # `if (Test-Path $TempDir) { Remove-Item ... }` above - named rather than
    # cited by line, because a line number in a script that keeps changing is
    # what a stale citation is made of).
    # 120 seconds is a payload bound rather than the 30-second stall bound the PyPI
    # probes use: this downloads a source archive instead of answering an API
    # call, so it only has to stop an indefinite hang.
    #
    # WHICH BOUND `-TimeoutSec` ACTUALLY IS DEPENDS ON THE POWERSHELL, and that is
    # a trap worth naming because the two paths differ here. The app spawns this
    # script with `powershell.exe` (Windows PowerShell 5.1, see
    # backend-installer.ts), where -TimeoutSec is the REQUEST's timeout - 120
    # seconds to complete the transfer. On PowerShell 7.4+ it was renamed to
    # -OperationTimeoutSeconds and -TimeoutSec survives only as an ALIAS of
    # -ConnectionTimeoutSeconds, i.e. a connect bound, so on a 7.x host (the CI
    # runner is one) a mirror that accepts and then stalls is not ended by this.
    # Do not "fix" that by adding the 7.x spelling: 5.1 does not know
    # -OperationTimeoutSeconds, and an unknown parameter is a binding error which
    # the catch below turns into `exit 1` on every install. The version-agnostic
    # answer is a bound on the transfer itself (a BITS job or a size/rate check),
    # which is a larger change than this one and is recorded rather than made.
    try {
        Invoke-WebRequest -Uri "https://github.com/pyenv-win/pyenv-win/archive/master.zip" -OutFile $PyenvZip -TimeoutSec 120 -ErrorAction Stop
    } catch {
        Remove-Item -Path $PyenvZip -Force -ErrorAction SilentlyContinue
        Write-Error "Failed to download pyenv-win from https://github.com/pyenv-win/pyenv-win/archive/master.zip within 120 seconds: $($_.Exception.Message)"
        exit 1
    }
    # -ErrorAction Stop for the same reason as the download: a truncated archive
    # must fail here rather than half-copy into $PyenvDir.
    Expand-Archive -Path $PyenvZip -DestinationPath $TempDir -ErrorAction Stop
    
    # Create .pyenv directory
    New-Item -ItemType Directory -Path $PyenvDir -Force | Out-Null
    
    # Copy pyenv-win files
    Copy-Item -Path "$TempDir\\pyenv-win-master\\*" -Destination $PyenvDir -Recurse
    
    # Set environment variables
    [System.Environment]::SetEnvironmentVariable("PYENV", "$PyenvDir\\pyenv-win", "User")
    [System.Environment]::SetEnvironmentVariable("PYENV_HOME", "$PyenvDir\\pyenv-win", "User")
    
    # Update PATH - ensure both bin and shims are added separately for better compatibility
    $Path = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $PyenvBinPath = "$PyenvDir\\pyenv-win\\bin"
    $PyenvShimsPath = "$PyenvDir\\pyenv-win\\shims"
    
    # Add bin path if not already in PATH
    if ($Path -notlike "*$PyenvBinPath*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$PyenvBinPath;$Path", "User")
        $Path = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    }
    
    # Add shims path if not already in PATH
    if ($Path -notlike "*$PyenvShimsPath*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$PyenvShimsPath;$Path", "User")
    }
    
    # Set PYENV environment variables
    [System.Environment]::SetEnvironmentVariable("PYENV", "$PyenvDir\\pyenv-win", "User")
    [System.Environment]::SetEnvironmentVariable("PYENV_HOME", "$PyenvDir\\pyenv-win", "User")
    
    # Update current session PATH
    $env:PYENV = "$PyenvDir\\pyenv-win"
    $env:PYENV_HOME = "$PyenvDir\\pyenv-win"
    $env:PATH = "$PyenvDir\\pyenv-win\\bin;$PyenvDir\\pyenv-win\\shims;$env:PATH"
    
    # Refresh environment variables for the current process
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    
    # Clean up
    Remove-Item -Path $TempDir -Recurse -Force
}

# Refresh environment variables for current session
$env:PYENV = "$PyenvDir\\pyenv-win"
$env:PYENV_HOME = "$PyenvDir\\pyenv-win"
$env:PATH = "$PyenvDir\\pyenv-win\\bin;$PyenvDir\\pyenv-win\\shims;$env:PATH"

# Install Python 3.12 if not installed
$PythonInstalled = $false
try {
    $InstalledVersions = & pyenv versions
    if ($InstalledVersions -like "*$PythonVersion*") {
        $PythonInstalled = $true
    }
} catch {
    $PythonInstalled = $false
}

if (-not $PythonInstalled) {
    Write-Output "Installing Python $PythonVersion..."
    & pyenv install $PythonVersion
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install Python $PythonVersion"
        exit 1
    }
}

# Set Python 3.12 as the local version
& pyenv local $PythonVersion
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to set Python $PythonVersion as local version"
    exit 1
}

# Create virtual environment if it doesn't exist
if (-not (Test-Path $VenvPath)) {
    Write-Output "Creating virtual environment at $VenvPath..."
    
    # Ensure the directory exists
    if (-not (Test-Path $AppDataDir)) {
        New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
        Write-Output "Created directory: $AppDataDir"
    }
    
    # Use the full path to python from pyenv
    $PythonExe = "$PyenvDir\\pyenv-win\\versions\\$PythonVersion\\python.exe"
    
    if (Test-Path $PythonExe) {
        Write-Output "Using Python at: $PythonExe"
        & $PythonExe -m venv $VenvPath
    } else {
        Write-Output "Using system Python"
        & python -m venv $VenvPath
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment"
        exit 1
    }
}

# Verify the virtual environment was created
if (-not (Test-Path "$VenvPath\\Scripts\\Activate.ps1")) {
    Write-Error "Virtual environment activation script not found at $VenvPath\\Scripts\\Activate.ps1"
    exit 1
}

# --- The package install: uv when there is one, pip otherwise ------------------
#
# Same shape as the macOS and Linux scripts, and for the same reasons: uv resolves
# and fetches in parallel (measured on macOS, cold cache, same interpreter: 14.8 s
# against pip's 128.9 s for the package install), the pip path below is unchanged
# and runs whenever uv is absent or cannot do the job, and pip STAYS in the venv
# because the app's backend-update path runs `pip install --upgrade
# local-operator` inside this same environment - which is also why the venv is
# still created with `python -m venv` rather than `uv venv`.
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

# Drop every UV_* variable the launching environment carried, then set the three
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
$env:UV_NO_CONFIG = "1"
$env:UV_PYTHON_DOWNLOADS = "never"
$env:UV_CACHE_DIR = $UvCacheDir

# Activate virtual environment and install local-operator
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
    & python -m pip install --upgrade pip
    & python -m pip install --upgrade local-operator

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
