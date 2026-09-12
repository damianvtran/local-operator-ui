import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

/**
 * Pure helpers behind the application update path.
 *
 * Why this module exists: on 2026-09-11 the 0.17.0 auto-update downloaded,
 * verified its sha512, called `quitAndInstall`, and then the app never came
 * back. Squirrel.Mac's ShipIt logged `NSOSStatusErrorDomain Code=-67028`
 * (`errSecCSBadBundleFormat`) from `SecStaticCodeCreateWithPath` on the
 * *installed* bundle - it was mid-replacement by a Finder copy at that moment -
 * quit, and nothing relaunched the app or told the user anything. The checks in
 * here are the ones whose absence produced that outcome:
 *
 * - a seal check on the installed bundle before we agree to quit (so ShipIt is
 *   never handed a bundle it will reject),
 * - a size/sha512/disk check on the staged artifact (so a truncated or
 *   mis-published download is refused with a message instead of failing
 *   silently during the install),
 * - a pending-update marker plus a bounded relaunch watchdog, because a failed
 *   Squirrel install strands the user with no app and no explanation.
 *
 * Everything here is deliberately free of Electron imports so the contract
 * tests can bundle the shipped TypeScript in memory (`pnpm test:desktop`),
 * and side effects are confined to functions that take the directory to act in.
 */

/** Marker file name, written under the app's userData directory. */
export const PENDING_INSTALL_MARKER_FILE = "pending-update-install.json";

/** How many times the artifact size the installer needs free (it stages a copy). */
export const INSTALL_DISK_MULTIPLIER = 3;

/** Default bound on the relaunch watchdog, in seconds. */
export const WATCHDOG_TIMEOUT_SECONDS = 900;

/** Sentinel inside the watchdog script; see `watchdogIsOurs`. */
export const WATCHDOG_TOKEN = "local-operator-update-watchdog";

export type InstallBlockCode =
	| "installed-bundle-not-sealed"
	| "download-verification-failed"
	| "insufficient-disk-space"
	| "artifact-metadata-missing";

/** What the user can actually do about a refusal, in their own UI terms. */
export type UpdateRemedy = {
	/** One sentence telling them what to do, without the mechanism. */
	text: string;
	/** A page to open, when the remedy is a reinstall. */
	url?: string;
	/** A command to run, when the remedy is on the user's terminal. */
	command?: string;
};

export type InstallBlock = {
	code: InstallBlockCode;
	/** One sentence, sentence case, shown to the user. */
	message: string;
	/** The actionable half: what to do about it. */
	remedy: UpdateRemedy;
	/** Raw command output or numbers, for the log and the detail line. */
	detail: string;
};

// ---------------------------------------------------------------------------
// Installed bundle seal check
// ---------------------------------------------------------------------------

/** Result of running `codesign --verify --deep --strict` on a bundle. */
export type SealProbe = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/**
 * Markers ShipIt reports for a path it cannot treat as a code object.
 *
 * -67068 `errSecCSStaticCodeNotFound` is a *missing* bundle, a different
 * problem from a bundle that exists but seals badly, and the probe proves the
 * distinction: a nonexistent path gives -67068, while a plain directory or a
 * bundle with no `Contents/MacOS/<exe>` gives -67028.
 */
const BAD_BUNDLE_MARKERS = [
	"errSecCSBadBundleFormat",
	"-67028",
	"not a valid code object",
	"code object is not signed at all",
	"a sealed resource is missing or invalid",
	"errSecCSUnsigned",
	"-67062",
];

/** The `.app` bundle that contains an executable, or null when there is none. */
export function appBundleFromExecutable(execPath: string): string | null {
	const marker = `${join("Contents", "MacOS")}/`;
	const index = execPath.lastIndexOf(marker);
	if (index <= 0) return null;
	return execPath.slice(0, index - 1);
}

/**
 * Decide whether the installed bundle is a sealed code object.
 *
 * A non-zero `codesign --verify` is a hard failure: ShipIt validates the
 * installed bundle the same way and refuses the install on anything here.
 */
export function evaluateBundleSeal(
	probe: SealProbe,
): { ok: true } | { ok: false; detail: string } {
	const output = `${probe.stdout}\n${probe.stderr}`.trim();
	if (probe.exitCode === 0) return { ok: true };
	const marker = BAD_BUNDLE_MARKERS.find((candidate) =>
		output.includes(candidate),
	);
	return {
		ok: false,
		detail: marker
			? `${marker}: ${output || "no output"}`
			: `codesign --verify exited ${probe.exitCode}: ${output || "no output"}`,
	};
}

export function installedBundleSealBlock(
	appBundlePath: string,
	detail: string,
): InstallBlock {
	return {
		code: "installed-bundle-not-sealed",
		message:
			"This install of Local Operator can't be updated in place, so the update was stopped before the app quit.",
		remedy: {
			text: "Download a fresh copy and replace the app in Applications.",
			url: "https://local-operator.com/download",
		},
		detail: `${appBundlePath}: ${detail}`,
	};
}

// ---------------------------------------------------------------------------
// Staged artifact verification
// ---------------------------------------------------------------------------

/** The `files[]` entry shape electron-updater parses out of the release yml. */
export type UpdateFileMetadata = {
	url: string;
	sha512?: string | null;
	size?: number | null;
};

function metadataBasenames(
	filePath: string,
	updatePath?: string | null,
): string[] {
	const names = [basename(filePath)];
	if (updatePath) names.push(basename(updatePath));
	return names;
}

/**
 * Find the release-metadata entry for a downloaded file.
 *
 * Matching on the file name rather than on the updater's private download
 * helper keeps this working for both a fresh download (where the caller has the
 * returned path) and a download staged during an earlier run.
 */
export function matchArtifactMetadata(
	filePath: string,
	files: UpdateFileMetadata[],
	updatePath?: string | null,
): UpdateFileMetadata | null {
	const names = metadataBasenames(filePath, updatePath);
	for (const name of names) {
		for (const file of files) {
			let url = file.url;
			try {
				url = decodeURIComponent(url);
			} catch {
				// A malformed percent sequence is not a reason to skip the file.
			}
			if (basename(url) === name) return file;
		}
	}
	return null;
}

export type ArtifactVerdict =
	| { ok: true; sha512: string; size: number }
	| { ok: false; block: InstallBlock };

export function requiredDiskBytes(artifactSize: number): number {
	return artifactSize * INSTALL_DISK_MULTIPLIER;
}

function formatGiB(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * Check a staged artifact against the metadata the updater already parsed.
 *
 * The disk requirement is the install's own footprint, not the download's:
 * Squirrel copies the whole 1 GB app into a temp directory before swapping it
 * in, so a check that only covers the artifact size would pass and then fail
 * deep inside the install with nothing to show the user.
 */
export function verifyStagedArtifact(input: {
	filePath: string;
	actualSize: number;
	actualSha512: string;
	metadata: UpdateFileMetadata | null;
	freeBytes: number;
	updatePath?: string | null;
}): ArtifactVerdict {
	const name = basename(input.filePath);

	if (input.metadata == null) {
		return {
			ok: false,
			block: {
				code: "artifact-metadata-missing",
				message:
					"The downloaded update isn't listed in the release metadata, so it wasn't installed.",
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} has no matching entry in the update metadata.`,
			},
		};
	}

	const expectedSize = input.metadata.size ?? null;
	if (expectedSize != null && input.actualSize !== expectedSize) {
		return {
			ok: false,
			block: {
				code: "download-verification-failed",
				message:
					"The downloaded update doesn't match the published release, so it wasn't installed.",
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} is ${input.actualSize} bytes; the release lists ${expectedSize}.`,
			},
		};
	}

	const expectedSha = input.metadata.sha512 ?? null;
	if (expectedSha != null && input.actualSha512 !== expectedSha) {
		return {
			ok: false,
			block: {
				code: "download-verification-failed",
				message:
					"The downloaded update doesn't match the published release, so it wasn't installed.",
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} sha512 ${input.actualSha512} does not match the release's ${expectedSha}.`,
			},
		};
	}

	const needed = requiredDiskBytes(expectedSize ?? input.actualSize);
	if (input.freeBytes < needed) {
		return {
			ok: false,
			block: {
				code: "insufficient-disk-space",
				message:
					"There isn't enough free disk space to install this update, so it wasn't installed.",
				remedy: {
					text: `Free up about ${formatGiB(needed - input.freeBytes)}, then check for updates again.`,
				},
				detail: `Install needs ${formatGiB(needed)} (${INSTALL_DISK_MULTIPLIER}x the ${formatGiB(
					expectedSize ?? input.actualSize,
				)} artifact); ${formatGiB(input.freeBytes)} free.`,
			},
		};
	}

	return { ok: true, sha512: input.actualSha512, size: input.actualSize };
}

/**
 * Resolve the staged artifact's path, newest first.
 *
 * The updater's own download helper is the authoritative path when this run
 * downloaded the file; after a restart the file is whatever the updater left in
 * its pending cache, which is why the directory listing is the fallback.
 */
export function resolveStagedArtifactPath(input: {
	downloadHelperFile: string | null;
	pendingDir: string;
	candidateNames: string[];
	listDir: (dir: string) => string[];
}): string | null {
	if (input.downloadHelperFile && existsSync(input.downloadHelperFile)) {
		return input.downloadHelperFile;
	}
	if (input.candidateNames.length === 0 || !existsSync(input.pendingDir)) {
		return null;
	}
	const entries = input.listDir(input.pendingDir);
	for (const name of input.candidateNames) {
		const match = entries.find((entry) => entry === name);
		if (match) return join(input.pendingDir, match);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Pending-install marker
// ---------------------------------------------------------------------------

export type PendingInstallMarker = {
	targetVersion: string;
	artifactPath: string;
	/** ISO timestamp of the install attempt. */
	startedAt: string;
	/** Pid of the relaunch watchdog, for the log and for a bounded reap. */
	watchdogPid: number | null;
};

export function pendingInstallMarkerPath(dir: string): string {
	return join(dir, PENDING_INSTALL_MARKER_FILE);
}

/**
 * Write the marker before the app quits.
 *
 * Written to a sibling temp file and renamed so a crash mid-write cannot leave
 * a half-parsed marker that reads as "no failed install".
 */
export function writePendingInstallMarker(
	dir: string,
	marker: PendingInstallMarker,
): PendingInstallMarker {
	mkdirSync(dir, { recursive: true });
	const target = pendingInstallMarkerPath(dir);
	const temp = `${target}.tmp`;
	writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
	renameSync(temp, target);
	return marker;
}

export function parsePendingInstallMarker(
	raw: string,
): PendingInstallMarker | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PendingInstallMarker>;
		if (
			typeof parsed?.targetVersion !== "string" ||
			parsed.targetVersion.length === 0
		) {
			return null;
		}
		return {
			targetVersion: parsed.targetVersion,
			artifactPath:
				typeof parsed.artifactPath === "string" ? parsed.artifactPath : "",
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
			watchdogPid:
				typeof parsed.watchdogPid === "number" ? parsed.watchdogPid : null,
		};
	} catch {
		return null;
	}
}

export function readPendingInstallMarker(
	dir: string,
): PendingInstallMarker | null {
	const path = pendingInstallMarkerPath(dir);
	if (!existsSync(path)) return null;
	try {
		return parsePendingInstallMarker(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

export function clearPendingInstallMarker(dir: string): boolean {
	const path = pendingInstallMarkerPath(dir);
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}

export type PendingInstallOutcome =
	| { kind: "none" }
	| { kind: "succeeded"; marker: PendingInstallMarker }
	| { kind: "failed"; marker: PendingInstallMarker };

/**
 * Interpret the marker on the next start.
 *
 * The running version is the only evidence available: Squirrel leaves no exit
 * status behind and `launchAfterInstallation` never ran, so "still on the old
 * version" is the whole signal that the install failed.
 */
export function evaluatePendingInstall(input: {
	marker: PendingInstallMarker | null;
	runningVersion: string;
}): PendingInstallOutcome {
	const { marker } = input;
	if (marker == null) return { kind: "none" };
	if (marker.targetVersion === input.runningVersion) {
		return { kind: "succeeded", marker };
	}
	return { kind: "failed", marker };
}

export type InstallFailurePayload = {
	targetVersion: string;
	message: string;
	remedy: UpdateRemedy;
	detail: string;
};

export function installFailurePayload(
	marker: PendingInstallMarker,
	runningVersion: string,
): InstallFailurePayload {
	return {
		message: `The update to version ${marker.targetVersion} didn't finish, so version ${runningVersion} is still running.`,
		remedy: {
			text: "Try installing the update again from the update prompt.",
		},
		detail: `Install started ${marker.startedAt || "unknown"} from ${marker.artifactPath || "an unknown artifact"}.`,
		targetVersion: marker.targetVersion,
	};
}

// ---------------------------------------------------------------------------
// Relaunch watchdog
// ---------------------------------------------------------------------------

/** Escape a plain string for use as a `pgrep -f` extended-regex pattern. */
export function escapePgrepPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type WatchdogPlan = {
	/** The shell script handed to `sh -c`. */
	script: string;
	/** Environment carrying the paths, so the script's argv holds none of them. */
	env: Record<string, string>;
	timeoutSeconds: number;
};

/**
 * Build the detached relaunch watchdog.
 *
 * The paths travel in the environment rather than in the script text: `sh -c`
 * puts the script in its own command line, `pgrep -f` matches command lines,
 * and a script carrying `/Applications/Local Operator.app/...` would therefore
 * find *itself* through the very check that waits for the app to exit.
 */
export function buildWatchdogPlan(input: {
	appExecutablePath: string;
	appBundlePath: string;
	executableName: string;
	timeoutSeconds?: number;
	intervalSeconds?: number;
	settleSeconds?: number;
}): WatchdogPlan {
	const timeoutSeconds = input.timeoutSeconds ?? WATCHDOG_TIMEOUT_SECONDS;
	const intervalSeconds = input.intervalSeconds ?? 3;
	const settleSeconds = input.settleSeconds ?? 5;
	const appPattern = escapePgrepPattern(input.appExecutablePath);

	const script = `#!/bin/sh
# ${WATCHDOG_TOKEN}
# Why this exists: a failed Squirrel.Mac install quits the app and never brings it
# back - ShipIt logs an installation error, leaves no exit status and does not run
# the relaunch - so the user is left with no app and no message (operator report,
# 2026-09-11, errSecCSBadBundleFormat -67028). This watchdog waits for the install
# to settle and then starts the app again if nothing else did. It is a no-op when
# the install succeeded, and it is bounded: it exits at the deadline whatever
# happens, so a stuck install cannot leave an orphan process behind.
set -u
APP="$LO_UPDATE_WATCHDOG_APP_EXEC"
BUNDLE="$LO_UPDATE_WATCHDOG_APP_BUNDLE"
NAME="$LO_UPDATE_WATCHDOG_APP_NAME"
if [ -z "$APP" ] || [ -z "$BUNDLE" ]; then
	exit 1
fi
is_running() { pgrep -f "$1" >/dev/null 2>&1; }
deadline=$(( $(date +%s) + ${timeoutSeconds} ))
# 1. The install only starts once the old app has exited.
while is_running "$APP"; do
	if [ "$(date +%s)" -ge "$deadline" ]; then exit 0; fi
	sleep ${intervalSeconds}
done
# 2. ShipIt then does the install; wait for it to finish. It may not be running
#    yet in the moment after the app exits, so we wait for it to appear as well.
while is_running 'ShipIt'; do
	if [ "$(date +%s)" -ge "$deadline" ]; then exit 0; fi
	sleep ${intervalSeconds}
done
sleep ${settleSeconds}
# 3. Nothing to do if Squirrel relaunched the app or the user started it.
if is_running "$APP"; then exit 0; fi
if [ -n "$NAME" ] && [ -x "$BUNDLE/Contents/MacOS/$NAME" ]; then
	open -a "$BUNDLE" >/dev/null 2>&1 || "$BUNDLE/Contents/MacOS/$NAME" >/dev/null 2>&1 &
fi
exit 0
`;

	return {
		script,
		env: {
			LO_UPDATE_WATCHDOG_APP_EXEC: appPattern,
			LO_UPDATE_WATCHDOG_APP_BUNDLE: input.appBundlePath,
			LO_UPDATE_WATCHDOG_APP_NAME: input.executableName,
		},
		timeoutSeconds,
	};
}

/**
 * Decide whether a recorded watchdog pid is still ours.
 *
 * Killing by pid alone would be unsafe after a pid reuse, so the decision also
 * requires the process's command line to still contain the script's sentinel.
 */
export function watchdogIsOurs(input: {
	alive: boolean;
	commandLine: string | null;
	installSucceeded: boolean;
}): boolean {
	if (!input.alive || !input.installSucceeded) return false;
	return (input.commandLine ?? "").includes(WATCHDOG_TOKEN);
}

// ---------------------------------------------------------------------------
// Backend update planning
// ---------------------------------------------------------------------------

export type BackendRemedyKind =
	| "managed"
	| "external"
	| "uv-tool"
	| "pipx"
	| "global-unknown";

export type BackendPlan = {
	canManageUpdate: boolean;
	updateCommand: string;
	remedy: string;
	detail: string;
};

/**
 * Classify a global `local-operator` install from the path `which` resolved.
 *
 * This is the fact the old code never looked at: a uv tool install and a plain
 * pip install both answer `which local-operator`, but only one of them is a
 * Python environment we can pip into, and pip is the wrong tool for the other.
 */
export function classifyGlobalInstall(
	localOperatorPath: string | null,
): Exclude<BackendRemedyKind, "managed" | "external"> {
	if (!localOperatorPath) return "global-unknown";
	if (localOperatorPath.includes("/uv/tools/")) return "uv-tool";
	if (localOperatorPath.includes("/pipx/venvs/")) return "pipx";
	return "global-unknown";
}

/**
 * Resolve what a global (GLOBAL_INSTALL) backend can be told to do.
 *
 * `canManageUpdate` is false in every case: the installer that owns the
 * environment is the only thing that may touch it, and running
 * `pip install --upgrade` inside a uv- or pipx-managed environment either fails
 * or corrupts it. A `lop-update` command on PATH takes precedence for a uv tool
 * install because that install was built from source - upgrading it from the
 * registry would replace the user's own build.
 */
export function resolveGlobalInstallPlan(input: {
	localOperatorPath: string | null;
	lopUpdatePath: string | null;
}): BackendPlan {
	const kind = classifyGlobalInstall(input.localOperatorPath);
	if (kind === "uv-tool") {
		const useLopUpdate = Boolean(input.lopUpdatePath);
		return {
			canManageUpdate: false,
			updateCommand: useLopUpdate
				? "lop-update"
				: "uv tool upgrade local-operator",
			remedy: useLopUpdate
				? "The server is a uv tool install built from source on this machine, so update it from your terminal:"
				: "The server is a uv tool install, so update it from your terminal:",
			detail: `local-operator resolves to ${input.localOperatorPath}`,
		};
	}
	if (kind === "pipx") {
		return {
			canManageUpdate: false,
			updateCommand: "pipx upgrade local-operator",
			remedy: "The server is a pipx install, so update it from your terminal:",
			detail: `local-operator resolves to ${input.localOperatorPath}`,
		};
	}
	// Nothing identified the installer (no `local-operator` on the app's PATH, or
	// a path that fits neither layout). pip stays the last-resort line because a
	// plain pip install is what it would be right for; the detail records that
	// the installer could not be identified, so a report can be diagnosed.
	return {
		canManageUpdate: false,
		updateCommand: "pip install --upgrade local-operator",
		remedy:
			"The server is installed outside the app, so update it from your terminal:",
		detail: input.localOperatorPath
			? `local-operator resolves to ${input.localOperatorPath}`
			: "local-operator was not found on PATH",
	};
}

/**
 * The pip invocation used for the app's own bundled environment.
 *
 * `--no-input` keeps a prompt from hanging an install with no console attached,
 * and `--disable-pip-version-check` keeps pip's self-update notice out of the
 * output we read the installed version back from.
 */
export function buildPipUpgradeCommand(pythonPath: string): {
	command: string;
	args: string[];
	/** The same thing, for the log line and any message shown to the user. */
	display: string;
} {
	const args = [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"--no-input",
		"--disable-pip-version-check",
		"local-operator",
	];
	return {
		command: pythonPath,
		args,
		display: `"${pythonPath}" ${args.join(" ")}`,
	};
}

const PIP_SHOW_VERSION_REGEX = /^Version:\s*(.+)$/m;

export function parsePipShowVersion(stdout: string): string | null {
	const match = stdout.match(PIP_SHOW_VERSION_REGEX);
	if (!match) return null;
	const version = match[1].trim();
	return version.length > 0 ? version : null;
}

/**
 * Whether an upgrade actually landed.
 *
 * "pip exited 0" is not evidence: pip reports success when the requirement is
 * already satisfied, and it can exit 0 having installed a wheel for a different
 * interpreter than the one the app started. The version read back afterwards is
 * the only thing that answers the question the user asked.
 */
export function didVersionChange(
	before: string | null,
	after: string | null,
): boolean {
	if (after == null) return false;
	if (before == null) return true;
	return before.trim() !== after.trim();
}
