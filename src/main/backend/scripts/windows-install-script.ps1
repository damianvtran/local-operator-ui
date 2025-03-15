# Local Operator Backend Installation Script for Windows
# This script installs pyenv-win, Python 3.12, and sets up a virtual environment for the Local Operator backend.

# Configuration
$AppName = "Local Operator"
$PythonVersion = "3.12.0"
$VenvName = "local-operator-venv"
$AppDataDir = "$env:APPDATA\\$AppName"
$VenvPath = "$AppDataDir\\$VenvName"
$LogFile = "$AppDataDir\\backend-install.log"
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
    
    # Update PATH
    $Path = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $PyenvBin = "$PyenvDir\\pyenv-win\\bin;$PyenvDir\\pyenv-win\\shims"
    if ($Path -notlike "*$PyenvBin*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$PyenvBin;$Path", "User")
    }
    
    # Update current session PATH
    $env:PYENV = "$PyenvDir\\pyenv-win"
    $env:PYENV_HOME = "$PyenvDir\\pyenv-win"
    $env:PATH = "$PyenvDir\\pyenv-win\\bin;$PyenvDir\\pyenv-win\\shims;$env:PATH"
    
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
    & python -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create virtual environment"
        exit 1
    }
}

# Activate virtual environment and install local-operator
Write-Output "Installing local-operator in virtual environment..."
& "$VenvPath\\Scripts\\Activate.ps1"
& python -m pip install --upgrade pip
& python -m pip install --upgrade local-operator

# Verify installation
$LocalOperatorInstalled = $false
try {
    $Version = & local-operator --version
    $LocalOperatorInstalled = $true
    Write-Output "Local Operator backend installed successfully!"
    Write-Output $Version
} catch {
    Write-Error "Error: Failed to install Local Operator backend."
    exit 1
}

Write-Output "$(Get-Date): Installation completed successfully."
Stop-Transcript
