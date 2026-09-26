#!/usr/bin/env pwsh
# setup-python-resource.ps1
#
# Stages the bundled runtime resources the Windows packaging step copies into the
# app - the `uv` release the install script uses to install the backend.
#
# WHY ONLY uv HERE, AND WHY THIS FILE EXISTS AT ALL. The Unix sibling
# (`scripts/setup-python-resource.sh`) stages two things: the interpreter seed
# the mac artifacts ship as inert data, and the uv release. Windows ships no
# interpreter (the install script installs Python with pyenv-win, see
# `src/main/backend/scripts/windows-install-script.ps1`), so only the uv half
# applies - and it is staged HERE rather than by the Unix script because the
# Windows release is a `.zip` whose layout differs from the tar releases
# (`uv.exe` at the archive root; see `archiveMember` in the layout). One stager
# per platform family, each reading the one definition:
# `src/shared/bundled-runtime-layout.json`. A version or a triple spelled in this
# file would be a second place to update and a place for the release download to
# drift from the pin.
#
# WHAT THE TREES ARE FOR. `package.json`'s `build.win.extraResources` copies
# `resources/uv` and `resources/uv_aarch64` into the packed app as
# `resources/uv/<arch>/uv.exe`, which is exactly where the app resolves it for
# the installer: `uvToolPath` (`src/main/backend/uv-tool.ts`) reads the same
# layout file, and `backend-installer.ts` hands the path down as
# `LOCAL_OPERATOR_UV_BIN`. `afterPack` then prunes the other architecture's tree
# out of each packed app (`scripts/prune-bundled-resources.mjs`).
#
# WHAT THIS DOES NOT DO: re-sign the binary. It ships the bytes its publisher
# signed, verified against the release's published `.sha256` before anything is
# unpacked - the same treatment the Unix stager gives the same release.
#
# Usage: pnpm setup-python:win   (or: pwsh -File scripts/setup-python-resource.ps1)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LayoutJson = Join-Path $RepoRoot 'src/shared/bundled-runtime-layout.json'
$ResourcesDir = Join-Path $RepoRoot 'resources'
$Layout = Get-Content $LayoutJson -Raw | ConvertFrom-Json

# The platform this stager serves. Windows is this file's whole subject, so it is
# a constant rather than a `uname`-style detection: the layout's platform keys
# (`binaryNames`/`releaseTriples`/`archiveExtension`/`archiveMember`) are what the
# names below are read through, and `win32` is the Node spelling the app itself
# uses for `process.platform`.
$LayoutPlatform = 'win32'

$UvVersion = $Layout.uv.version
$BinaryName = $Layout.uv.binaryNames.$LayoutPlatform
$ArchiveExtension = $Layout.uv.archiveExtension.$LayoutPlatform
$ArchiveMember = $Layout.uv.archiveMember.$LayoutPlatform
$ReleaseBaseUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion"
$CheckoutNames = @{ x64 = $Layout.uv.checkoutNames.x64; arm64 = $Layout.uv.checkoutNames.arm64 }
$Triples = @{ x64 = $Layout.uv.releaseTriples.$LayoutPlatform.x64; arm64 = $Layout.uv.releaseTriples.$LayoutPlatform.arm64 }

foreach ($entry in @(
		@('uv.version', $UvVersion),
		@("uv.binaryNames.$LayoutPlatform", $BinaryName),
		@("uv.archiveExtension.$LayoutPlatform", $ArchiveExtension),
		@("uv.archiveMember.$LayoutPlatform", $ArchiveMember),
		@("uv.releaseTriples.$LayoutPlatform.x64", $Triples.x64),
		@("uv.releaseTriples.$LayoutPlatform.arm64", $Triples.arm64),
		@('uv.checkoutNames.x64', $CheckoutNames.x64),
		@('uv.checkoutNames.arm64', $CheckoutNames.arm64)
	)) {
	if (-not $entry[1]) {
		throw "src/shared/bundled-runtime-layout.json has no $($entry[0]); this stager reads every name it uses from that definition."
	}
}

# curl.exe where it exists, `curl` otherwise. The explicit `.exe` matters on
# Windows PowerShell 5.1, where `curl` is an alias for Invoke-WebRequest and a
# plain `curl` call would silently change the client - and with it the flags
# below, which are curl's own.
$Curl = if (Get-Command curl.exe -ErrorAction SilentlyContinue) { 'curl.exe' } else { 'curl' }

function Fetch-To {
	param([string] $Url, [string] $Destination)
	Write-Output "Downloading $Url"
	# Bound and failure flags mirror the Unix stager's `fetch_to`: --fail turns a
	# 404 into a non-zero exit rather than writing an error page into the tree,
	# and --max-time ends a connected-but-stalled transfer.
	& $Curl --fail --location --silent --show-error --max-time 600 $Url -o $Destination
	if ($LASTEXITCODE -ne 0) {
		throw "Failed to download $Url (curl exit $LASTEXITCODE)"
	}
}

function Get-Sha256 {
	param([string] $Path)
	return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Stage one architecture's release the way the Unix stager stages its own:
# download the archive and its published digest, verify BEFORE unpacking, extract,
# copy only the uv binary into the checkout directory the app resolves.
function Set-UpUvArch {
	param([string] $Arch, [string] $Triple)
	$asset = "uv-$Triple.$ArchiveExtension"
	$assetUrl = "$ReleaseBaseUrl/$asset"
	# `{triple}` is a no-op for the flat Windows archive today; expanding it keeps
	# this function's contract identical to the Unix stager's, so a layout change
	# that nests the Windows member moves both in one place.
	$member = $ArchiveMember.Replace('{triple}', $Triple)

	$scratch = Join-Path ([IO.Path]::GetTempPath()) ("local-operator-uv-" + [Guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $scratch | Out-Null
	try {
		$archivePath = Join-Path $scratch $asset
		$sumPath = Join-Path $scratch "$asset.sha256"
		Fetch-To -Url $assetUrl -Destination $archivePath
		Fetch-To -Url "$assetUrl.sha256" -Destination $sumPath

		$expected = ((Get-Content $sumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
		$actual = Get-Sha256 -Path $archivePath
		if ($expected -ne $actual) {
			throw "uv $UvVersion for $Arch does not match its published sha256.`nExpected: $expected`nActual:   $actual`nURL fetched: $assetUrl"
		}
		Write-Output "Verified uv $Arch sha256: $actual"

		$extractDir = Join-Path $scratch 'extract'
		Expand-Archive -Path $archivePath -DestinationPath $extractDir
		$memberPath = Join-Path $extractDir $member
		if (-not (Test-Path $memberPath -PathType Leaf)) {
			throw "Expected $member in $asset for $Arch; the layout's archiveMember says that is where the release puts it."
		}

		$finalDir = Join-Path $ResourcesDir $CheckoutNames[$Arch]
		New-Item -ItemType Directory -Path $finalDir -Force | Out-Null
		Copy-Item $memberPath (Join-Path $finalDir $BinaryName) -Force
		Write-Output "Staged $(Join-Path $finalDir $BinaryName)"

		# Version assertion where the binary can run: the same tolerance the Unix
		# stager has, because an arm64 uv.exe cannot execute on an x64 host and the
		# sha256 above is what its identity rests on there.
		$reported = $null
		try {
			$reported = & (Join-Path $finalDir $BinaryName) --version 2>$null
		}
		catch {
			$reported = $null
		}
		if ($LASTEXITCODE -eq 0 -and $reported) {
			if ("$reported" -notlike "uv $UvVersion*") {
				throw "The staged $Arch uv reports '$reported' rather than 'uv $UvVersion'."
			}
			Write-Output "Verified: the $Arch uv is $reported."
		}
		else {
			Write-Output "Staged $(Join-Path $finalDir $BinaryName) for $Arch cannot run on this host ($Env:PROCESSOR_ARCHITECTURE); its version is asserted on an artifact built for that architecture."
		}
	}
	finally {
		Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
	}
}

Write-Output "Setting up the bundled runtime resources for Local Operator UI..."
Write-Output "Platform: $LayoutPlatform"
Write-Output "uv version: $UvVersion ($ArchiveExtension)"

# Both of this platform's triples are staged, even where a packaging pass builds
# only one of them: `extraResources` is not architecture-aware and `afterPack`
# prunes the off-architecture tree out of every packed app, so staging both keeps
# the two shapes identical to the Unix stager's.
Set-UpUvArch -Arch 'x64' -Triple $Triples.x64
Set-UpUvArch -Arch 'arm64' -Triple $Triples.arm64

Write-Output "Runtime resource staging complete for $LayoutPlatform!"
Write-Output "uv $UvVersion staged for both architectures."
Write-Output "You can now build the application with 'pnpm dist:win'"
