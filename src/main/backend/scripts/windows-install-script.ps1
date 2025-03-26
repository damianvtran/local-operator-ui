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

# Create app data directory if it doesn't exist
if (-not (Test-Path $AppDataDir)) {
    New-Item -ItemType Directory -Path $AppDataDir -Force | Out-Null
}

# Start logging
Start-Transcript -Path $LogFile -Append
Write-Output "$(Get-Date): Starting Local Operator backend installation..."

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
    Invoke-WebRequest -Uri "https://github.com/pyenv-win/pyenv-win/archive/master.zip" -OutFile $PyenvZip
    Expand-Archive -Path $PyenvZip -DestinationPath $TempDir
    
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

# Activate virtual environment and install local-operator
Write-Output "Installing local-operator in virtual environment..."
# Use PowerShell to run the activation script
& "$VenvPath\\Scripts\\Activate.ps1"
& python -m pip install --upgrade pip
& python -m pip install --upgrade local-operator

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install packages in virtual environment"
    exit 1
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
