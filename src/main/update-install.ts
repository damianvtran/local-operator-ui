import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

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

/**
 * Free-space headroom over the two copies an install materializes at its peak.
 *
 * `requiredDiskBytes` computes the footprint from the artifact plus the app
 * being replaced; this margin covers the extraction working set and the swap's
 * own bookkeeping. See that function for why the artifact alone is the wrong
 * number.
 */
export const INSTALL_DISK_SLACK_BYTES = 256 * 1024 * 1024;

/** Where a user gets a fresh copy when the app can no longer update itself. */
export const DOWNLOAD_PAGE_URL = "https://local-operator.com/download";

/**
 * Bound on the relaunch watchdog, in seconds.
 *
 * This is the user-visible promise, so the number is measured rather than
 * picked: the ShipIt attempts recorded on this machine for the 1 GiB app ran
 * 255 s (2026-09-11 22:36:49 request -> 22:41:04 `-67028` verdict, the install
 * that stranded the operator) and 168 s (2026-09-09 19:34:20 -> 19:37:08, a
 * swap that completed and relaunched) from request to settled. 600 s is ~2.4x
 * the slowest of them, which is the margin a cold cache or a slower volume
 * needs, and it is the OUTER bound only: the script exits as soon as either
 * the ShipIt job goes or the swap has landed on disk, so a successful install
 * never waits for it and a failed one that did swap does not either.
 *
 * It used to be 900 s, and 900 s was the *only* exit on a failed install -
 * which is why the app came back fifteen minutes later - so the number and the
 * decision the script makes are one change, not two (review R11).
 */
export const WATCHDOG_TIMEOUT_SECONDS = 600;

/**
 * How long the watchdog's on-disk version read may take before it is killed.
 *
 * The read is `plutil` on the target bundle's own Info.plist for every poll, and
 * the path is `/Applications` in every real layout - so a real read is
 * milliseconds and this bound only ever fires on a path whose mount has stopped
 * answering, where the alternative is a read that outlives the script's own
 * deadline and leaves the user with no app at all (review R17).
 */
export const PLIST_READ_TIMEOUT_SECONDS = 5;

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

/** Result of running `codesign --verify --deep` on a bundle. */
export type SealProbe = {
	exitCode: number;
	stdout: string;
	stderr: string;
	/**
	 * Whether the probe ran to a verdict at all.
	 *
	 * `false` means the process timed out, failed to exec, or died without
	 * saying anything - "the probe could not run", which is a different claim
	 * from "codesign rejected this bundle", and the two must not be collapsed:
	 * a timed-out probe used to become a permanent "this app can't be updated in
	 * place" with a reinstall remedy (review R5). Defaults to `true` so a caller
	 * holding only a status code keeps the old meaning.
	 */
	ran?: boolean;
};

/**
 * What a seal probe proved.
 *
 * Three states rather than a boolean because "could not run" has to be
 * handled differently from "ran and said no": the first is retried and then
 * allowed to proceed, the second refuses the install (see
 * `probeInstalledBundleSeal` in the update service).
 */
export type SealVerdict =
	| { kind: "sealed" }
	| { kind: "unavailable"; detail: string }
	| { kind: "unsealed"; detail: string };

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
 * A non-zero `codesign --verify` that printed a reason is a hard failure:
 * ShipIt validates the installed bundle the same way and refuses the install on
 * anything here. A probe that never produced a verdict is a third outcome and
 * is reported as such - see `SealVerdict`.
 */
export function evaluateBundleSeal(probe: SealProbe): SealVerdict {
	const output = `${probe.stdout}\n${probe.stderr}`.trim();
	if (probe.ran === false) {
		return {
			kind: "unavailable",
			detail: `codesign --verify did not complete: ${output || "no output"}`,
		};
	}
	if (probe.exitCode === 0) return { kind: "sealed" };
	const marker = BAD_BUNDLE_MARKERS.find((candidate) =>
		output.includes(candidate),
	);
	return {
		kind: "unsealed",
		detail: marker
			? `${marker}: ${output || "no output"}`
			: `codesign --verify exited ${probe.exitCode}: ${output || "no output"}`,
	};
}

/**
 * The refusal shown when the installed bundle cannot be replaced in place.
 *
 * The remedy names the first step the user has to take themselves - quitting
 * the app - because a user who drags a fresh copy over a running app ends up
 * looking at the old instance with no idea whether it worked (review U9).
 */
export function installedBundleSealBlock(
	appBundlePath: string,
	detail: string,
	version?: string | null,
): InstallBlock {
	return {
		code: "installed-bundle-not-sealed",
		message: version
			? `This install of Local Operator can't be updated in place, so the update to version ${version} was stopped before the app quit.`
			: "This install of Local Operator can't be updated in place, so the update was stopped before the app quit.",
		remedy: {
			text: "Quit Local Operator, then download a fresh copy and replace the app in Applications.",
			url: DOWNLOAD_PAGE_URL,
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

/**
 * Free space the install needs on the volume that holds the app.
 *
 * The peak is not the download: Squirrel unpacks the new app into a staging
 * directory on the app's own volume and then swaps it in, so the artifact, the
 * staged copy of the new app and the app being replaced are all on that volume
 * at once. Hence artifact + two app copies + slack.
 *
 * The guard this replaces multiplied the ARTIFACT by three and labelled the
 * result the install's footprint - about 0.98 GiB for 0.18.0's 336 MiB zip,
 * below the roughly 1.3 GiB the swap actually needs, while the comment above it
 * claimed the 1 GiB app copy it never measured (review R4). The app's own size
 * is measured now, and the detail line shows the arithmetic that was used.
 */
export function requiredDiskBytes(input: {
	artifactSize: number;
	installedBundleSize: number;
}): number {
	return (
		input.artifactSize +
		input.installedBundleSize * 2 +
		INSTALL_DISK_SLACK_BYTES
	);
}

function formatGiB(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * Bytes an installed bundle occupies, or null when it cannot be measured.
 *
 * Symlinks are counted as the links they are rather than followed: an app
 * bundle is full of them (`Versions/Current`, framework aliases) and following
 * them would both double-count and risk a cycle. The figure is therefore a
 * floor, which is the right direction for a free-space guard.
 */
export function measureDirectoryBytes(root: string): number | null {
	try {
		const stats = lstatSync(root);
		if (!stats.isDirectory()) return stats.size;
		let total = 0;
		for (const entry of readdirSync(root)) {
			const child = join(root, entry);
			let childStats: ReturnType<typeof lstatSync>;
			try {
				childStats = lstatSync(child);
			} catch {
				// A file that vanished mid-walk (a running app rotating a log) is not
				// a measurement failure; it is simply not part of the footprint.
				continue;
			}
			if (childStats.isDirectory()) {
				const nested = measureDirectoryBytes(child);
				if (nested != null) total += nested;
			} else {
				total += childStats.size;
			}
		}
		return total;
	} catch {
		return null;
	}
}

/** The version clause every refusal carries, so the user can quote it. */
function versionClause(version: string | null | undefined): string {
	return version ? ` to version ${version}` : "";
}

/**
 * Check a staged artifact against the metadata the updater already parsed.
 *
 * The disk requirement is the install's own footprint, not the download's (see
 * `requiredDiskBytes`), and the sample is honestly sized either way: when the
 * installed app cannot be measured the artifact plus slack is what the guard
 * can defend, and the detail line says so rather than implying the bigger
 * number. `version` names the release the user is being refused, which is what
 * makes a refusal quotable in a support report (review U10).
 */
export function verifyStagedArtifact(input: {
	filePath: string;
	actualSize: number;
	actualSha512: string;
	metadata: UpdateFileMetadata | null;
	freeBytes: number;
	updatePath?: string | null;
	/** Size of the app this update would replace, when it could be measured. */
	installedBundleSize?: number | null;
	/** The release being verified, for the refusal copy. */
	version?: string | null;
}): ArtifactVerdict {
	const name = basename(input.filePath);
	const version = input.version ?? null;

	if (input.metadata == null) {
		return {
			ok: false,
			block: {
				code: "artifact-metadata-missing",
				message: `The downloaded update${versionClause(version)} isn't listed in the release metadata, so it wasn't installed.`,
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
				message: `The downloaded update${versionClause(version)} doesn't match the published release, so it wasn't installed.`,
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
				message: `The downloaded update${versionClause(version)} doesn't match the published release, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} sha512 ${input.actualSha512} does not match the release's ${expectedSha}.`,
			},
		};
	}

	const artifactSize = expectedSize ?? input.actualSize;
	const installedBundleSize = input.installedBundleSize ?? 0;
	const needed = requiredDiskBytes({ artifactSize, installedBundleSize });
	if (input.freeBytes < needed) {
		const footprint = installedBundleSize
			? `${formatGiB(artifactSize)} artifact + two ${formatGiB(
					installedBundleSize,
				)} app copies + ${formatGiB(INSTALL_DISK_SLACK_BYTES)} slack`
			: `${formatGiB(artifactSize)} artifact + ${formatGiB(INSTALL_DISK_SLACK_BYTES)} slack (the installed app could not be measured)`;
		return {
			ok: false,
			block: {
				code: "insufficient-disk-space",
				message: `There isn't enough free disk space to install the update${versionClause(version)}, so it wasn't installed.`,
				remedy: {
					text: `Free up about ${formatGiB(needed - input.freeBytes)}, then check for updates again.`,
				},
				detail: `Install needs ${formatGiB(needed)} (${footprint}); ${formatGiB(input.freeBytes)} free.`,
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

/**
 * The last failed install, kept on disk rather than in memory.
 *
 * Why a second file: the marker is consumed at start-up - it is read, reported
 * and cleared - and the notice is delivered once per process, so dismissing the
 * panel used to be the end of the record. A user who clicked the panel's only
 * control (Dismiss) had lost which version failed, when, and how many times;
 * reviews U1 and D3 asked for the record to outlive the notification. This file
 * is that record, and Settings -> App updates reads it back.
 */
export const LAST_INSTALL_ATTEMPT_FILE = "last-update-install.json";

export type LastInstallAttempt = {
	targetVersion: string;
	runningVersion: string;
	/** When the install that failed was started, as the marker recorded it. */
	startedAt: string | null;
	/** When the failure was detected (the next start). */
	detectedAt: string;
	detail: string;
	/** How many times this same target has failed here, so "again" is a fact. */
	attempts: number;
};

export function lastInstallAttemptPath(dir: string): string {
	return join(dir, LAST_INSTALL_ATTEMPT_FILE);
}

/** Read the recorded last failure, or null when there is none to report. */
export function readLastInstallAttempt(dir: string): LastInstallAttempt | null {
	const path = lastInstallAttemptPath(dir);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<LastInstallAttempt>;
		if (
			typeof parsed?.targetVersion !== "string" ||
			parsed.targetVersion.length === 0
		) {
			return null;
		}
		return {
			targetVersion: parsed.targetVersion,
			runningVersion:
				typeof parsed.runningVersion === "string"
					? parsed.runningVersion
					: "unknown",
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
			detectedAt:
				typeof parsed.detectedAt === "string" ? parsed.detectedAt : "",
			detail: typeof parsed.detail === "string" ? parsed.detail : "",
			attempts:
				typeof parsed.attempts === "number" && parsed.attempts > 0
					? parsed.attempts
					: 1,
		};
	} catch {
		return null;
	}
}

/**
 * Record a failed install, counting repeats of the same target.
 *
 * The count is what turns "try again" into evidence for the user: the install
 * that keeps failing is the one that has to be replaced by hand, and the panel
 * can only say so once somebody has counted (review U1). Written temp-then-
 * rename for the same reason the marker is.
 */
export function recordInstallFailure(
	dir: string,
	input: {
		payload: InstallFailurePayload;
		/** The marker's own start time, when it recorded one. */
		startedAt: string | null;
		detectedAt: string;
	},
): LastInstallAttempt {
	const previous = readLastInstallAttempt(dir);
	const record: LastInstallAttempt = {
		targetVersion: input.payload.targetVersion,
		runningVersion: previous?.runningVersion ?? "unknown",
		startedAt: input.startedAt,
		detectedAt: input.detectedAt,
		detail: input.payload.detail,
		attempts:
			previous && previous.targetVersion === input.payload.targetVersion
				? previous.attempts + 1
				: 1,
	};
	mkdirSync(dir, { recursive: true });
	const target = lastInstallAttemptPath(dir);
	const temp = `${target}.tmp`;
	writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	renameSync(temp, target);
	return record;
}

export type PendingInstallOutcome =
	| { kind: "none" }
	| { kind: "succeeded"; marker: PendingInstallMarker }
	/** A marker from an install that a later one superseded: not a failure. */
	| { kind: "stale"; marker: PendingInstallMarker }
	| { kind: "failed"; marker: PendingInstallMarker };

/** `x.y.z` at the start of a version string, with an optional leading `v`. */
const VERSION_TRIPLE_REGEX = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Compare dotted numeric versions: -1, 0, 1, or null when either is not
 * parseable as `x.y.z`.
 *
 * Null is the honest answer for a version this cannot order - "unknown" from
 * the backend, a dev build stamp - and every caller has to decide what to do
 * with it rather than being handed a made-up ordering.
 */
export function compareVersions(a: string, b: string): number | null {
	const parse = (value: string): [number, number, number] | null => {
		const match = VERSION_TRIPLE_REGEX.exec(value.trim());
		if (!match) return null;
		return [Number(match[1]), Number(match[2]), Number(match[3])];
	};
	const left = parse(a);
	const right = parse(b);
	if (!left || !right) return null;
	for (let index = 0; index < 3; index++) {
		if (left[index] !== right[index])
			return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

/**
 * Interpret the marker on the next start.
 *
 * The running version is the only evidence available: Squirrel leaves no exit
 * status behind and `launchAfterInstallation` never ran, so "still on the old
 * version" is the whole signal that the install failed.
 *
 * That reading has one exception, and it produced a false alarm: a marker whose
 * target is OLDER than the running version describes an install that was
 * superseded (the user is on something newer), not an install that failed. It
 * used to make the app say "the update to version 0.9.0 didn't finish, so
 * version 0.17.0 is still running" (review Q2). The marker is cleared either
 * way; only the message the user sees differs.
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
	const order = compareVersions(marker.targetVersion, input.runningVersion);
	if (order !== null && order < 0) return { kind: "stale", marker };
	return { kind: "failed", marker };
}

export type InstallFailurePayload = {
	targetVersion: string;
	message: string;
	remedy: UpdateRemedy;
	detail: string;
	/** How many times this target has failed on this machine. */
	attempts: number;
};

/**
 * What the user is told after an install that did not complete.
 *
 * Two things here are deliberate. The remedy carries the download page URL so
 * the panel has a control that reaches it - the copy used to name "the update
 * prompt" while the panel's only button was Dismiss, and the user whose install
 * kept failing had no way out of the cycle (reviews U1, D3). And the timestamp
 * is rendered in the user's own locale rather than as a raw ISO-8601 UTC stamp:
 * it is read by a person, and the machine-readable form stays in the log.
 *
 * The details line also names Squirrel's own log for this install when the
 * caller can point at it. The app was dead while the install failed, so the log
 * is the only record of WHY - the refusal panel can quote an OSStatus code
 * because the app was alive to read one, and this one cannot (review U14). The
 * detail is the line the panel's copy button hands to a support thread, so it
 * has to carry the reason rather than only the artifact that was staged.
 */
export function installFailurePayload(
	marker: PendingInstallMarker,
	runningVersion: string,
	options: { attempts?: number; shipItLogPath?: string | null } = {},
): InstallFailurePayload {
	const started = marker.startedAt ? new Date(marker.startedAt) : null;
	const startedText =
		started && !Number.isNaN(started.getTime())
			? started.toLocaleString()
			: "at an unknown time";
	const logText = options.shipItLogPath
		? ` Squirrel's own log is at ${options.shipItLogPath}.`
		: "";
	return {
		message: `The update to version ${marker.targetVersion} didn't finish, so version ${runningVersion} is still running.`,
		remedy: {
			text: "Quit Local Operator and replace it in Applications with a fresh copy, or update again from the app.",
			url: DOWNLOAD_PAGE_URL,
		},
		detail: `Install started ${startedText} from ${marker.artifactPath || "an unknown artifact"}.${logText}`,
		targetVersion: marker.targetVersion,
		attempts: options.attempts ?? 1,
	};
}

// ---------------------------------------------------------------------------
// Relaunch watchdog
// ---------------------------------------------------------------------------

/**
 * The launchd job Squirrel's ShipIt runs an install under.
 *
 * Squirrel builds this label as `<bundle id>.ShipIt` (`shipItJobLabel` in
 * SQRLShipItLauncher) and the job is submitted as part of the app's quit and
 * unloaded when the install is over. Its presence in the user's launchd domain
 * is therefore the machine's own answer to "is an install still in flight" -
 * and the answer for a *hung* install, which is the case that left the operator
 * with no app. The watchdog used to ask `pgrep -f ShipIt` instead, which matched
 * any process whose command line merely contains that word (a reviewer's
 * sampling loop held it open past the deadline; review R7).
 */
export function shipItJobLabel(bundleId: string): string {
	return `${bundleId}.ShipIt`;
}

/**
 * Squirrel's own cache directory for an app: its logs and its staged update.
 *
 * `reapFailedInstall` uses this to find the staging tree a failed install
 * leaves behind; the logs inside it are deliberately kept.
 */
export function shipItCacheDir(cacheRoot: string, bundleId: string): string {
	return join(cacheRoot, shipItJobLabel(bundleId));
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
 * Why the signals are what they are (each was wrong at some point, and in a way
 * that produced the operator's outcome - see the docstring in the script):
 *
 * - "has the app exited" is asked of the APP'S OWN PID with `kill -0`. The pid
 *   is captured here, by the app, before the quit. A name probe cannot answer
 *   this question: macOS `pgrep -f` does not report its own ancestors, and this
 *   script is spawned BY the app, so `pgrep -f <app path>` returned "not
 *   running" while the app was very much running (review R1, reproduced).
 * - "is the install over" is asked of the ShipIt launchd job by label AND of
 *   the version in the bundle's own Info.plist at the target path. The job
 *   alone is not an answer: a failed install never unloads it (this PR's own
 *   evidence: runs=3114, still loaded until it was removed by hand), so the job
 *   was the reason a failed install waited out the whole bound with no app on
 *   screen (review R11). The bundle's version is the swap's own state, and it
 *   is what makes an early exit safe rather than a guess - and it is read as "at
 *   or beyond the target", the same shape as the renderer's own clear rule, so a
 *   bundle already past the target is not waited out to the bound (review Q6).
 *
 * `targetVersion` is the version the update was for - the updater's advertised
 * version, which is the same fact the pending-install marker records. `null`
 * means the caller could name no version OTHER than the one already installed,
 * and the script then has only the job and the bound to go on: a target that is
 * already in place would read as "the swap landed" on the first poll.
 *
 * The paths travel in the environment rather than in the script text, as
 * before: `sh -c` puts the script in its own command line, and a script
 * carrying `/Applications/Local Operator.app/...` would show up in any process
 * listing of it.
 */
/**
 * The version the watchdog's on-disk swap check may be handed, or null.
 *
 * The app used to fall back to its own running version when the updater named
 * none. That target is already in place, so `swap_landed` was true on the
 * script's first poll, `decided()` returned at once and the app came back ~5 s
 * into a live install - the one outcome the on-disk check exists to prevent
 * (review R15). The pre-flight refuses an install the updater has no version
 * for, so this is belt-and-braces rather than a live path; `null` means the
 * script waits on ShipIt's job and the bound instead of on a version that can
 * say nothing.
 */
export function watchdogSwapTarget(input: {
	/** The version the update was for, when the updater named one. */
	target: string | null;
	/** The version already installed, which proves nothing about a swap. */
	running: string | null;
}): string | null {
	if (!input.target) return null;
	if (!input.running) return input.target;
	// The on-disk check reads "at or beyond the target", so a target the running
	// version is already at - or past - is a target that answers yes before the
	// install has begun.
	const order = compareVersions(input.target, input.running);
	if (order !== null && order <= 0) return null;
	if (input.target === input.running) return null;
	return input.target;
}

export function buildWatchdogPlan(input: {
	appBundlePath: string;
	executableName: string;
	/** The app's own pid, captured before the quit. */
	appPid: number;
	/** The launchd job label ShipIt's install runs under. */
	shipItJob: string | null;
	/** The version the install is for, for the on-disk swap check. */
	targetVersion?: string | null;
	timeoutSeconds?: number;
	intervalSeconds?: number;
	settleSeconds?: number;
	/** How long to wait for ShipIt's job to be submitted after the app exits. */
	appearSeconds?: number;
	/** How long the on-disk version read may take before it is killed. */
	plistReadTimeoutSeconds?: number;
}): WatchdogPlan {
	const timeoutSeconds = input.timeoutSeconds ?? WATCHDOG_TIMEOUT_SECONDS;
	const intervalSeconds = input.intervalSeconds ?? 3;
	const settleSeconds = input.settleSeconds ?? 5;
	const appearSeconds = input.appearSeconds ?? 30;
	const plistTimeoutSeconds =
		input.plistReadTimeoutSeconds ?? PLIST_READ_TIMEOUT_SECONDS;

	const script = `#!/bin/sh
# ${WATCHDOG_TOKEN}
#
# Why this exists: a failed Squirrel.Mac install quits the app and never brings
# it back - ShipIt logs an installation error, leaves no exit status and does not
# run the relaunch - so the user is left with no app and no message (operator
# report, 2026-09-11, errSecCSBadBundleFormat -67028).
#
# How it decides, and why each signal is the one it is:
#   - "the app has exited" is asked of the app's own pid (kill -0), captured by
#     the app before it quit. A name probe cannot answer it on macOS: pgrep -f
#     does not report its own ancestors, and this script is the app's child.
#   - "the install is over" is asked of BOTH the ShipIt launchd job, by label,
#     AND the state of the swap on disk. The job is submitted as part of the quit
#     and unloaded when an install settles, so it is the signal that separates a
#     hung install from an unrelated process that merely has the word in its
#     command line - but it is not sufficient on its own: the 0.17.0 failure
#     left its job loaded and respawning for hours (runs=3114), so waiting only
#     on the job meant waiting for the bound with the user staring at nothing
#     (review R11). The version in the target bundle's own Info.plist is what
#     says the swap landed, whether or not the job ever goes away.
#
# It starts the app in exactly one situation - the app is not running - and it
# reaches that point on three paths:
#   (a) ShipIt's job is gone: the install is decided. The conservative case.
#   (b) the bundle at the target path reports the version this update was for, or
#       one beyond it: the new app is in place and ShipIt has nothing left to do.
#       This is what makes an early exit safe rather than a guess, and it is the
#       path a failed-but-swapped install takes.
#   (c) the bound arrived with no decision. Trying is still better than leaving
#       the user with nothing, and the bound is what makes the previous
#       version's silent exit 0 impossible. It is ~2.4x the slowest ShipIt
#       attempt measured on this machine (255s from request to verdict for a
#       1 GiB app), and it is the ONE path that can start the app while a swap
#       is still in flight - an accepted risk, not an oversight.
#
# With no job label to ask about, the job cannot be consulted at all, so the swap
# state is the whole signal: the script waits for (b) rather than spending an
# appear window on a job it cannot see and then relaunching on no evidence.
set -u
APP_PID="\${LO_UPDATE_WATCHDOG_APP_PID:-}"
BUNDLE="\${LO_UPDATE_WATCHDOG_APP_BUNDLE:-}"
NAME="\${LO_UPDATE_WATCHDOG_APP_NAME:-}"
SHIPIT_JOB="\${LO_UPDATE_WATCHDOG_SHIPIT_JOB:-}"
TARGET_VERSION="\${LO_UPDATE_WATCHDOG_TARGET_VERSION:-}"
if [ -z "$APP_PID" ] || [ -z "$BUNDLE" ]; then
	exit 1
fi
now() { date +%s; }
app_running() { kill -0 "$APP_PID" 2>/dev/null; }
# launchctl list <label> exits 113 when the job is not loaded, 0 when it is.
shipit_loaded() { [ -n "$SHIPIT_JOB" ] && launchctl list "$SHIPIT_JOB" >/dev/null 2>&1; }
# (b), the swap's own state: is the app at the target path AT OR BEYOND the
# version this update was for? plutil rather than \`defaults read\`, which reads
# through a preference domain and can answer from a stale cache; a half-written
# plist and a missing one both read as "not landed yet", which is the safe
# direction.
#
# At or beyond rather than an exact match, because this is the same question the
# renderer's clear rule asks ("is the server no longer behind the version the
# panel named?"): a release that moves on between the offer and the check must
# not leave the app waiting out the whole bound for a bundle already past the
# target (review Q6).
version_at_least() {
	# An absent version is not a version. This is the ONE input the two halves
	# answer differently on, deliberately: the renderer pads a missing side with
	# zero (\`left[index] ?? 0\`), so it reads an empty target as "at least 0",
	# while a rule that can start a relaunch must not call a version nobody
	# reported "landed". Both callers prove the operand non-empty first - the
	# script's \`swap_landed\` declines an empty target outright and the read
	# answers nothing rather than a version - so no path reaches this with one.
	[ -n "$1" ] && [ -n "$2" ] || return 1
	# Exact match first, as the renderer's rule does: a pre-release pair that
	# matches exactly IS the version that was waited for, and the digit checks
	# below cannot order a suffix at all. The caller strips a leading \`v\` before
	# calling, which is the other half of what the renderer's rule does itself.
	[ "$1" = "$2" ] && return 0
	# Anything else carrying a suffix is not orderable here, and the renderer's
	# rule refuses the same inputs for the same reason ("keeps the instruction on
	# screen rather than clearing over a real gap"). Answered before the digit
	# walk, because a suffix the unrelated leading numeric components never reach
	# would otherwise be ignored - \`1.0.0\` against \`0.18.0-rc1\` compared as
	# landed here and as not-beyond there. Not-landed is the safe direction in
	# this script: the job and the bound still decide, and the app still comes
	# back.
	case "$1$2" in *-*) return 1 ;; esac
	_va="$1"
	_vb="$2"
	while :; do
		case "$_va" in
			*.*) _ha="\${_va%%.*}"; _va="\${_va#*.}" ;;
			*) _ha="$_va"; _va="" ;;
		esac
		case "$_vb" in
			*.*) _hb="\${_vb%%.*}"; _vb="\${_vb#*.}" ;;
			*) _hb="$_vb"; _vb="" ;;
		esac
		# A component with no digits in it is a pre-release suffix, which this
		# cannot order: it reads as "not landed", so the job and the bound stay
		# the deciders. Same shape as the renderer's rule.
		case "$_ha" in *[!0-9]*) return 1 ;; esac
		case "$_hb" in *[!0-9]*) return 1 ;; esac
		# A side that has run out contributes zero, which is what the renderer's
		# \`left[index] ?? 0\` does, so unequally wide dotted versions order the
		# same way in both halves of "at or beyond". Without this, \`0.18.0.1\`
		# against \`0.18.0\` read as not-landed here and as landed there (review
		# round 4, M3): the safe direction is not a reason to leave two
		# implementations of one rule disagreeing.
		[ -n "$_ha" ] || _ha=0
		[ -n "$_hb" ] || _hb=0
		if [ "$_ha" -gt "$_hb" ]; then return 0; fi
		if [ "$_ha" -lt "$_hb" ]; then return 1; fi
		if [ -z "$_va" ] && [ -z "$_vb" ]; then return 0; fi
	done
}
# Read the bundle's version under a hard time bound. This sits inside the poll
# loop, and an unbounded read of a path on a mount that has stopped answering
# would outlive the script's own deadline and leave the user with no app - the
# very outcome this script exists to undo. macOS ships no \`timeout(1)\`, so the
# bound is a background read the script can stop waiting on (review R17).
bundle_version() {
	_plist="$BUNDLE/Contents/Info.plist"
	# A plist that is not readable yet - the ordinary state while a swap is in
	# flight - answers without starting a read at all, so the bound below is only
	# ever spent on a read that started and did not answer.
	[ -r "$_plist" ] || return 1
	_stamp="$$-$(now)"
	_out="\${TMPDIR:-/tmp}/lo-update-watchdog-version-$_stamp.out"
	# The pid the bound kills IS the reader: \`exec\` replaces the subshell rather
	# than wrapping plutil, so nothing is reparented when the kill lands. The
	# previous shape killed a subshell whose whole job was to drop a completion
	# marker, and the read that subshell had forked was left blocked under pid 1 -
	# one more per poll, for as long as the mount stayed dead (review round 4,
	# Q7). Completion is read off the answer itself instead: plutil writes the
	# version into this file and nothing else does, so bytes in it mean the read
	# answered, and a read that fails writes none and is stopped by the same
	# deadline.
	( exec /usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$_plist" ) >"$_out" 2>/dev/null &
	_read_pid=$!
	_waited=0
	while [ ! -s "$_out" ]; do
		if [ "$_waited" -ge ${plistTimeoutSeconds} ]; then
			kill -9 "$_read_pid" 2>/dev/null
			rm -f "$_out"
			return 1
		fi
		sleep 1
		_waited=$((_waited + 1))
	done
	_version="$(cat "$_out" 2>/dev/null)"
	rm -f "$_out"
	[ -n "$_version" ] || return 1
	printf '%s\n' "$_version"
}
swap_landed() {
	[ -n "$TARGET_VERSION" ] || return 1
	installed=$(bundle_version) || return 1
	installed=\${installed#v}
	[ -n "$installed" ] || return 1
	target=\${TARGET_VERSION#v}
	[ "$installed" = "$target" ] && return 0
	version_at_least "$installed" "$target"
}
job_known=0
[ -n "$SHIPIT_JOB" ] && job_known=1
decided() {
	if [ "$job_known" -eq 1 ] && ! shipit_loaded; then return 0; fi
	swap_landed && return 0
	return 1
}
deadline=$(( $(now) + ${timeoutSeconds} ))
# 1. The install only starts once the old app has exited.
while app_running; do
	if [ "$(now)" -ge "$deadline" ]; then break; fi
	sleep ${intervalSeconds}
done
# 2. ShipIt's job is submitted as part of the quit, so it may not be loaded the
#    instant the app is gone: give it a bounded window to appear before treating
#    "no job" as "the install is over". Skipped when there is no label to ask
#    about: an appear window for an unaskable job is 30s of pretending, and it
#    used to end by relaunching with no evidence about the install at all.
if [ "$job_known" -eq 1 ]; then
	appear_deadline=$(( $(now) + ${appearSeconds} ))
	while ! shipit_loaded; do
		if [ "$(now)" -ge "$appear_deadline" ] || [ "$(now)" -ge "$deadline" ]; then break; fi
		sleep ${intervalSeconds}
	done
fi
# 3. Wait for the install to be decided - by the job going, or by the swap
#    landing - and never past the bound.
while :; do
	if decided; then break; fi
	if [ "$(now)" -ge "$deadline" ]; then break; fi
	sleep ${intervalSeconds}
done
# Let Squirrel's own relaunch (which happens as the job finishes) land first.
sleep ${settleSeconds}
# 4. Nothing to do if Squirrel relaunched the app or the user started it. This is
#    what makes the script a no-op when the install succeeded, by construction
#    rather than by claim.
if app_running; then exit 0; fi
if [ -n "$NAME" ] && [ -x "$BUNDLE/Contents/MacOS/$NAME" ]; then
	open -a "$BUNDLE" >/dev/null 2>&1 || "$BUNDLE/Contents/MacOS/$NAME" >/dev/null 2>&1 &
fi
exit 0
`;

	return {
		script,
		env: {
			LO_UPDATE_WATCHDOG_APP_PID: String(input.appPid),
			LO_UPDATE_WATCHDOG_APP_BUNDLE: input.appBundlePath,
			LO_UPDATE_WATCHDOG_APP_NAME: input.executableName,
			LO_UPDATE_WATCHDOG_SHIPIT_JOB: input.shipItJob ?? "",
			LO_UPDATE_WATCHDOG_TARGET_VERSION: input.targetVersion ?? "",
		},
		timeoutSeconds,
	};
}

export type FailedInstallReap = {
	jobLabel: string | null;
	jobRemoved: boolean;
	removedStaging: string[];
	errors: string[];
};

/**
 * Clean up what a failed Squirrel install leaves running on the user's machine.
 *
 * Why the product has to do this: on the operator's machine the 0.17.0 failure
 * left the ShipIt launchd job loaded in their user domain, respawning every
 * ~2.5 s (`runs=3114`, `LastExitStatus=256`) and appending `Could not read
 * update request` to `ShipIt_stderr.log` until it was 3.4 MB - with the staged
 * update tree still beside it. Squirrel retires that job when an install
 * finishes; when an install fails it simply stays, and a job in a respawn loop
 * is not something to leave on someone's machine because an updater fell over.
 * It was removed by hand during round 1 of the review; the app does it now.
 *
 * Deliberately narrow, and deliberately not silent: this app's own ShipIt job
 * by label, and the `update.*` staging directories under that same app's ShipIt
 * cache directory. The ShipIt logs are NOT touched - they are the only record of
 * why the install failed, and the failure detail points at them.
 *
 * Every step takes its collaborator as an argument so the contract tests can
 * drive it against a temporary tree instead of the developer's launchd domain.
 */
export function reapFailedInstall(input: {
	bundleId: string | null;
	cacheRoot: string | null;
	removeJob: (label: string) => { notFound: boolean; output: string };
	exists: (path: string) => boolean;
	listDir: (dir: string) => string[];
	removeDir: (path: string) => void;
	log: (message: string) => void;
}): FailedInstallReap {
	const result: FailedInstallReap = {
		jobLabel: null,
		jobRemoved: false,
		removedStaging: [],
		errors: [],
	};
	if (!input.bundleId) {
		// Without the bundle id there is no label to remove and no cache directory
		// to look in. Guessing one (or removing by process name) is exactly the
		// over-reach this whole change is undoing.
		input.log(
			"Skipped cleaning up the failed install: the app's bundle id could not be read.",
		);
		return result;
	}

	const label = shipItJobLabel(input.bundleId);
	result.jobLabel = label;
	try {
		const removal = input.removeJob(label);
		result.jobRemoved = !removal.notFound;
		input.log(
			removal.notFound
				? `Leftover install job ${label} was not loaded.`
				: `Removed the leftover install job ${label}.`,
		);
	} catch (error) {
		// A launchd domain that refuses to answer is not a reason to fail the
		// start-up path; it is a reason to say so in the log.
		result.errors.push(`launchctl remove ${label}: ${String(error)}`);
		input.log(
			`Could not remove the leftover install job ${label}: ${String(error)}`,
		);
	}

	const cacheDir = input.cacheRoot
		? shipItCacheDir(input.cacheRoot, input.bundleId)
		: null;
	if (!cacheDir) return result;
	try {
		if (!input.exists(cacheDir)) return result;
		for (const entry of input.listDir(cacheDir)) {
			if (!entry.startsWith("update.")) continue;
			const staging = join(cacheDir, entry);
			try {
				input.removeDir(staging);
				result.removedStaging.push(staging);
				input.log(`Removed the staged update left behind at ${staging}.`);
			} catch (error) {
				result.errors.push(`${staging}: ${String(error)}`);
				input.log(`Could not remove ${staging}: ${String(error)}`);
			}
		}
	} catch (error) {
		result.errors.push(`${cacheDir}: ${String(error)}`);
		input.log(`Could not inspect ${cacheDir}: ${String(error)}`);
	}
	return result;
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
	| "pip"
	| "editable"
	| "global-unknown";

/**
 * What a global `local-operator` install actually is.
 *
 * Mirrors `local_operator/update.py`'s `install_kind()` on the Python side - same
 * six outcomes for the same reasons - because the app and the server have to
 * agree about who owns the environment before either names a command for it.
 */
export type GlobalInstallKind = Exclude<
	BackendRemedyKind,
	"managed" | "external"
>;

export type BackendPlan = {
	canManageUpdate: boolean;
	updateCommand: string;
	remedy: string;
	detail: string;
	/**
	 * Whether this install follows a source tree on this machine rather than the
	 * published release - a uv tool built by `lop-update`, or the checkout
	 * itself.
	 *
	 * Why the prompt needs to know: for these installs the version the server
	 * reports afterwards is the CHECKOUT's, which is not the version the app
	 * offered, so a closing line promising "the new server version" promises
	 * something this install may never reach (review U12). The detail line and
	 * the closing sentence both say so instead.
	 */
	sourceBuild: boolean;
};

/**
 * The evidence a global install's kind is decided from.
 *
 * Why the path alone is not enough: both `uv tool` and `pipx` install a console
 * SCRIPT into `~/.local/bin`, so the string `which local-operator` prints
 * contains neither `/uv/tools/` nor `/pipx/venvs/`. On the operator's machine it
 * is `/Users/<user>/.local/bin/local-operator`, a symlink into the uv tool
 * environment - and matching markers against that string classified their own uv
 * tool install as unknown and told them to run pip, which is the command from
 * the incident report (review R2).
 *
 * The `uv`/`pipx` outputs are consulted last and only when the cheaper signals
 * have declined, matching the Python implementation's order.
 */
export type InstallIdentity = {
	/** The path `which local-operator` returned, shim and all. */
	path: string | null;
	/** `realpathSync` of that path, when it resolves somewhere else. */
	realPath?: string | null;
	/** First line of the file at `path`: a console script's own shebang. */
	shebang?: string | null;
	/** A `uv-receipt.toml` beside the resolved install, when one exists. */
	uvReceipt?: string | null;
	/** A `pyvenv.cfg` in the prefix the script lives in, when one exists. */
	venvPrefix?: string | null;
	/**
	 * Lower-cased `INSTALLER` from the `local-operator` dist-info beside the
	 * resolved install, when there is one.
	 *
	 * Why a file read and not another layout test: pip, uv and pipx each write
	 * it, so it states outright which tool owns the install. The Python side
	 * consults it last and only for the exact value `pip` - a `mise`, `pyenv` or
	 * `asdf` toolchain installs into a BASE prefix that writes no
	 * `pyvenv.cfg` (#396), and `pip install --upgrade` is the right command
	 * there. Without it the app called that install `global-unknown` and named
	 * no command at all, which is where this began to diverge from the server
	 * (review R13).
	 */
	installer?: string | null;
	/**
	 * Whether the dist-info's `direct_url.json` marks this install editable.
	 *
	 * PEP 610/660: `dir_info.editable` is what pip and uv write for `-e`, and it
	 * is the only POSITIVE evidence that an install is a checkout rather than an
	 * installed distribution. The Python side answers `editable` - a refusal -
	 * before any layout probe, and `pyvenv.cfg` alone cannot tell the two apart:
	 * a developer's repo `.venv` has one, so the app classified it `pip` and
	 * told them to install a wheel over their own checkout (review Q5).
	 */
	editable?: boolean;
	/** `uv tool list` output, when the uv CLI could be run. */
	uvToolList?: string | null;
	/** `pipx list` output, when the pipx CLI could be run. */
	pipxList?: string | null;
};

/** `uv tool list` names each tool as `local-operator v0.54.20` on its own line. */
const UV_TOOL_LIST_ENTRY_REGEX = /(^|\n)local-operator v\d/i;

/** `pipx list` names its environment as `package local-operator 0.54.20, ...`. */
const PIPX_LIST_ENTRY_REGEX = /(^|\n)\s*package local-operator\b/i;

/**
 * `uv tool list` names each tool as `local-operator v0.54.20` on its own line;
 * anchored there so a version string that merely mentions the name cannot match.
 */
function uvToolListNamesLocalOperator(
	output: string | null | undefined,
): boolean {
	return UV_TOOL_LIST_ENTRY_REGEX.test(output ?? "");
}

/** `pipx list` names its environment as `package local-operator 0.54.20, ...`. */
function pipxListNamesLocalOperator(
	output: string | null | undefined,
): boolean {
	return PIPX_LIST_ENTRY_REGEX.test(output ?? "");
}

/** `<prefix>/lib/pythonX.Y` — the POSIX interpreter directory of a prefix. */
const PYTHON_LIB_DIR = /^python\d/;

/** A dist-info for this package, under either name normalisation. */
const LOCAL_OPERATOR_DIST_INFO = /^local[-_]operator[-_]/;

/**
 * The two files in a `local-operator` dist-info that state who owns an install.
 *
 * Read from disk rather than inferred from a layout, because two of the install
 * kinds the server recognises cannot be told apart any other way:
 *
 * - `INSTALLER` is what says `pip` for a BASE-prefix install. A
 *   `mise`/`pyenv`/`asdf` toolchain reports `sys.prefix == sys.base_prefix` and
 *   writes no `pyvenv.cfg`, so the layout probes all decline and the app used to
 *   answer `global-unknown` - naming no command for a user whose environment
 *   `pip install -U` upgrades fine (#396, review R13). Consulted only for the
 *   exact value `pip`, as `_is_ordinary_pip` does: uv and pipx write their own
 *   value, and answering `pip` for them is the guess this module exists to
 *   refuse.
 * - `direct_url.json`'s `dir_info.editable` (PEP 610/660) is the only positive
 *   evidence that a prefix is the repo checkout rather than an installed copy.
 *   A checkout usually has a `pyvenv.cfg` too, so the layout says `pip` - and
 *   `pip install --upgrade local-operator` would put a wheel over the code the
 *   user is working in (review Q5).
 *
 * Every `site-packages` under the prefix is read, and `editable` wins over
 * `installer`: a prefix rebuilt against a second interpreter leaves the previous
 * one's dist-info behind, and the order `install_kind()` uses is the checkout
 * first. A prefix with no readable distribution is not evidence of anything, so
 * the caller's answer stays "unknown" rather than becoming a guess.
 */
export function resolveDistributionMarkers(prefix: string): {
	installer: string | null;
	editable: boolean;
} {
	const sitePackages: string[] = [];
	// POSIX: `<prefix>/lib/pythonX.Y/site-packages`. Windows: `Lib/site-packages`.
	try {
		for (const entry of readdirSync(join(prefix, "lib"))) {
			if (!PYTHON_LIB_DIR.test(entry)) continue;
			const candidate = join(prefix, "lib", entry, "site-packages");
			if (existsSync(candidate)) sitePackages.push(candidate);
		}
	} catch {
		// No `lib`: not a POSIX Python prefix. The Windows layout below still runs.
	}
	const windowsSitePackages = join(prefix, "Lib", "site-packages");
	if (existsSync(windowsSitePackages)) sitePackages.push(windowsSitePackages);

	let installer: string | null = null;
	let editable = false;
	for (const dir of sitePackages) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			// `local-operator` normalises to `local_operator` in a dist-info name;
			// accept either separator rather than depending on the normalisation.
			if (!LOCAL_OPERATOR_DIST_INFO.test(entry)) continue;
			if (!entry.endsWith(".dist-info")) continue;
			const distInfo = join(dir, entry);
			try {
				const installerText = readFileSync(join(distInfo, "INSTALLER"), "utf8");
				installer = installerText.trim().toLowerCase() || installer;
			} catch {
				// Absent is no evidence, never a negative.
			}
			try {
				const payload = JSON.parse(
					readFileSync(join(distInfo, "direct_url.json"), "utf8"),
				) as { editable?: unknown; dir_info?: { editable?: unknown } };
				if (payload.editable === true || payload.dir_info?.editable === true) {
					editable = true;
				}
			} catch {
				// No direct_url.json, or not JSON: not an editable install.
			}
		}
	}

	return { installer, editable };
}

/** Trailing slashes in a PATH entry, which `join` would faithfully double. */
const TRAILING_SLASHES = /\/+$/;

/**
 * Where a user-installed command can live, in the order to try them.
 *
 * Why the app cannot just ask the shell's `which`: the app is normally started
 * by Finder or `open`, and macOS gives such a process the launchd default PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`) with no `~/.local/bin` in it - which is
 * where uv and pipx link their console scripts, and where `lop-update` lives on
 * this machine. Resolving the install from `which` alone therefore answered
 * "nothing is installed" for the very install this classification exists to
 * describe: no path, so no kind, so a remedy carrying no command at all (the
 * empty-command panel nobody had rendered). The inherited PATH is still
 * searched first, so a shell launch, a custom prefix or a `UV_TOOL_BIN_DIR`
 * override keeps its own precedence; these locations are what answers the
 * question when it is not there.
 */
function commandSearchDirs(env: NodeJS.ProcessEnv, home: string): string[] {
	const dirs: string[] = [];
	const add = (dir: string | undefined) => {
		if (!dir) return;
		const trimmed = dir.replace(TRAILING_SLASHES, "");
		if (trimmed.length === 0 || dirs.includes(trimmed)) return;
		dirs.push(trimmed);
	};
	for (const dir of (env.PATH ?? "").split(delimiter)) add(dir);
	// The installers' own bin directories first - uv's default tool bin dir IS
	// `~/.local/bin`, `XDG_BIN_HOME` is the XDG spelling of the same thing, and
	// pipx links into it too - then the two Homebrew prefixes and the OS's own.
	add(env.UV_TOOL_BIN_DIR);
	add(env.XDG_BIN_HOME);
	// uv's own bin-dir precedence runs `UV_TOOL_BIN_DIR` -> `XDG_BIN_HOME` ->
	// `$XDG_DATA_HOME/../bin` -> `~/.local/bin` (measured on uv 0.10.8:
	// `XDG_DATA_HOME=/tmp/xdgd uv tool dir --bin` -> `/tmp/xdgd/../bin`), so an
	// install configured with a data home alone put its shim in a directory
	// nothing searched: the classification then answered "could not tell how this
	// was installed" for an install whose command was right there (review round
	// 4, M2). `join` normalises the `..` away because the directory searched is
	// the same one either way.
	if (env.XDG_DATA_HOME) add(join(env.XDG_DATA_HOME, "..", "bin"));
	add(join(home, ".local", "bin"));
	add("/opt/homebrew/bin");
	add("/usr/local/bin");
	add("/usr/bin");
	add("/bin");
	return dirs;
}

/**
 * The uv tool environments' own script directories.
 *
 * A tool's console script is normally linked into the tool bin dir above, but a
 * link that was removed, or a `UV_TOOL_DIR` that is not uv's default, still
 * leaves the script inside the environment itself - beside the
 * `uv-receipt.toml` that names the install as a uv tool - and that is the one
 * place `readInstallIdentity` can still see the layout markers from.
 *
 * Three platform rules live here, and they are not all measured: the tool root
 * (`UV_TOOL_DIR`, then `$XDG_DATA_HOME/uv/tools`, then
 * `~/.local/share/uv/tools`) and the POSIX `bin` script dir are measured
 * against uv's own answers on this host (review round 4, M2). The Windows
 * `Scripts` half is DERIVED rather than measured - there is no Windows host to
 * ask - from the split `updateBackend` already writes for a bundled venv,
 * which is the layout uv's own tool environments use (review round 4, M1).
 *
 * Known and deliberate: uv's own default root on Windows is under the user's
 * app data (`%LOCALAPPDATA%\uv\tools`, uv's storage reference), which this
 * does not model - there is no Windows host to measure it on, and a guessed
 * path is worse than a stated gap. Nothing depends on it being right: the
 * shims live in `%USERPROFILE%\.local\bin`, which `commandSearchDirs` searches
 * and `where` finds, and a Windows tool install is then classified by the
 * `uv tool list` probe the resolved `uv.exe` answers (review round 4, M1).
 */
function uvToolBinDirs(
	env: NodeJS.ProcessEnv,
	home: string,
	listDir: (dir: string) => string[],
	platform: NodeJS.Platform,
): string[] {
	const root =
		env.UV_TOOL_DIR ??
		(env.XDG_DATA_HOME
			? join(env.XDG_DATA_HOME, "uv", "tools")
			: join(home, ".local", "share", "uv", "tools"));
	const scriptDir = platform === "win32" ? "Scripts" : "bin";
	const dirs: string[] = [];
	try {
		for (const entry of listDir(root)) {
			dirs.push(join(root, entry, scriptDir));
		}
	} catch {
		// No uv tool environments on this machine: nothing to add.
	}
	return dirs;
}

/**
 * What Windows appends to a bare command name, in the platform's own order.
 *
 * `PATHEXT` is the machine's list; the documented default is used when the
 * environment carries none, so the search still resolves an executable in a
 * context that never inherited a shell's environment - the case this whole
 * module exists for. The case is kept as written because it is only ever
 * concatenated onto a name the caller gave, and Windows compares file names
 * case-insensitively.
 */
const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function windowsCommandExtensions(env: NodeJS.ProcessEnv): string[] {
	const raw = (env.PATHEXT ?? "").trim();
	const parts = (raw.length > 0 ? raw : WINDOWS_DEFAULT_PATHEXT).split(";");
	const extensions: string[] = [];
	for (const part of parts) {
		const extension = part.trim();
		if (extension.length === 0 || extensions.includes(extension)) continue;
		extensions.push(extension);
	}
	return extensions;
}

/**
 * The file names to try inside one directory, in the order the platform does.
 *
 * POSIX resolves a bare command name to the file of that same name, and that is
 * all this has to do there. Windows resolves it through `PATHEXT`: `uv` is
 * `uv.exe`, pipx writes its shims as `.exe` trampolines rather than symlinks,
 * and uv does the same - so an exact-name `existsSync` finds nothing on a
 * machine that has both installed. That answer then read as "nothing here",
 * which is how a uv-tool or pipx install came out unidentifiable with no
 * command at all on Windows (review round 4, M1). The bare name is tried first
 * because an extensionless executable is legitimate on Windows too.
 */
function commandCandidates(
	dir: string,
	name: string,
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string[] {
	const candidates = [join(dir, name)];
	if (platform !== "win32") return candidates;
	for (const extension of windowsCommandExtensions(env)) {
		candidates.push(join(dir, name + extension));
	}
	return candidates;
}

/**
 * The path `name` resolves to, or null when it is nowhere to be found.
 *
 * Not `which`, for the reason `commandSearchDirs` gives: the app is normally
 * started without a shell, so the search has to cover the installers' own
 * locations, not just the PATH it inherited. On Windows a bare name is resolved
 * through `PATHEXT` (`commandCandidates`), which is the part of `where`'s
 * semantics that matters to the callers here.
 *
 * The injected options exist so the contract tests can drive a synthetic tree -
 * including the Windows one - instead of the developer's machine.
 */
export function resolveCommandPath(
	name: string,
	options: {
		env?: NodeJS.ProcessEnv;
		home?: string;
		/** The platform whose resolution rules to apply; defaults to this one. */
		platform?: NodeJS.Platform;
		listDir?: (dir: string) => string[];
		exists?: (path: string) => boolean;
	} = {},
): string | null {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? existsSync;
	const listDir =
		options.listDir ??
		((dir: string): string[] => {
			try {
				return readdirSync(dir);
			} catch {
				return [];
			}
		});

	const dirs = [
		...commandSearchDirs(env, home),
		...uvToolBinDirs(env, home, listDir, platform),
	];
	for (const dir of dirs) {
		for (const candidate of commandCandidates(dir, name, env, platform)) {
			try {
				if (exists(candidate)) return candidate;
			} catch {
				// An unreadable entry is not an answer: try the next location.
			}
		}
	}
	return null;
}

/**
 * Everything `classifyGlobalInstall` needs to tell a uv tool install from a
 * pipx one from an ordinary pip venv from the checkout a developer runs.
 *
 * Two markers are read out of the dist-info itself, because the layout cannot
 * answer them: `INSTALLER`, which is what names pip for a base-prefix install
 * (`mise`/`pyenv`/`asdf` write no `pyvenv.cfg`, review R13), and
 * `direct_url.json`'s `dir_info.editable`, which is the only positive evidence
 * that a prefix IS the repo checkout rather than an installed copy (review Q5).
 * Both mirror `install_kind()` in `local_operator/update.py`. The markers are
 * where they are: a uv tool environment lives at `<...>/uv/tools/<name>`, and
 * its console script in `~/.local/bin` is a symlink into it, so the resolved
 * path carries the marker the printed path does not (review R2).
 */
export function readInstallIdentity(shimPath: string | null): InstallIdentity {
	if (!shimPath) return { path: null };

	let realPath: string | null = null;
	try {
		realPath = realpathSync(shimPath);
	} catch {
		realPath = null;
	}

	let shebang: string | null = null;
	try {
		const firstLine = readFileSync(shimPath, "utf8").split("\n", 1)[0] ?? "";
		shebang = firstLine.startsWith("#!") ? firstLine : null;
	} catch {
		shebang = null;
	}

	// The script lives in `<prefix>/bin/<name>`, and a Python install records
	// its own kind next to that prefix: uv writes `uv-receipt.toml` beside the
	// environment, and pip leaves `pyvenv.cfg` in it.
	const executable = realPath ?? shimPath;
	const prefix = dirname(dirname(executable));
	const existing = (candidate: string) =>
		existsSync(candidate) ? candidate : null;
	const markers = resolveDistributionMarkers(prefix);

	return {
		path: shimPath,
		realPath,
		shebang,
		uvReceipt: existing(join(prefix, "uv-receipt.toml")),
		venvPrefix: existsSync(join(prefix, "pyvenv.cfg")) ? prefix : null,
		installer: markers.installer,
		editable: markers.editable,
	};
}

/**
 * Classify a global `local-operator` install from what the install IS.
 *
 * Order matters and follows the Python side: a checkout is answered first (it
 * is not an install to upgrade), a uv tool install is recognised by its receipt
 * before any layout guess, pipx next, an ordinary pip venv last - and "unknown"
 * is a real answer, never a fallback to pip.
 */
export function classifyGlobalInstall(
	identity: InstallIdentity,
): GlobalInstallKind {
	if (!identity.path) return "global-unknown";
	// An editable install is the repo checkout, or a checkout beside it. Answered
	// before the layout probes because every layout probe would match it too - it
	// has a `pyvenv.cfg` when it is a venv, and often a uv receipt when uv made
	// it - and `pip install --upgrade` would install a wheel over the checkout
	// the user is working in (review Q5).
	if (identity.editable) return "editable";
	// The resolved path and the script's own shebang both name the interpreter
	// that owns the install, which is where the layout markers actually live.
	const haystack = [
		identity.path,
		identity.realPath ?? "",
		identity.shebang ?? "",
	]
		.join("\n")
		.toLowerCase();
	if (haystack.includes("/uv/tools/")) return "uv-tool";
	if (identity.uvReceipt) return "uv-tool";
	if (uvToolListNamesLocalOperator(identity.uvToolList)) return "uv-tool";
	if (
		haystack.includes("/pipx/venvs/") ||
		(haystack.includes("/pipx/") && haystack.includes("venvs"))
	)
		return "pipx";
	if (pipxListNamesLocalOperator(identity.pipxList)) return "pipx";
	// A `local-operator` script inside a virtualenv prefix: the README's
	// `pip install` path, and the one case where pip is the right command.
	if (identity.venvPrefix) return "pip";
	// The base-prefix case, consulted last and only for the exact value `pip`,
	// as `_is_ordinary_pip` does: uv and pipx write their own INSTALLER value and
	// have already been answered above, so reading "pip" as a guess for them is
	// the thing this classifier exists to refuse (review R13).
	if (identity.installer === "pip") return "pip";
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
 *
 * The unidentified case names NO command. Shipping `pip install --upgrade
 * local-operator` as the answer for an install we could not identify is how the
 * app told the operator to pip into a uv tool environment (reviews R2, U4, D4);
 * "we could not tell" is a claim we can support, and pip is not.
 */
export function resolveGlobalInstallPlan(input: {
	identity: InstallIdentity;
	lopUpdatePath: string | null;
}): BackendPlan {
	const kind = classifyGlobalInstall(input.identity);
	// A uv tool built by `lop-update` and the checkout itself both report the
	// CHECKOUT's version after they are updated, so neither can be promised the
	// version the app offered (review U12).
	const sourceBuild =
		kind === "editable" || (kind === "uv-tool" && Boolean(input.lopUpdatePath));
	const detail = input.identity.path
		? `local-operator resolves to ${input.identity.path}${
				input.identity.realPath &&
				input.identity.realPath !== input.identity.path
					? ` (${input.identity.realPath})`
					: ""
			}, classified as ${kind}${
				sourceBuild
					? ", built from source on this machine, so it follows the checkout rather than the published release"
					: ""
			}`
		: "local-operator was not found on PATH";

	if (kind === "editable") {
		// The Python side refuses this case by name (`editable_refusal()`), and the
		// refusal is the point: `pip install -U` into the checkout either no-ops or
		// breaks the editable link, and the tools that own the environment are not
		// named for it either. No command, then - the sentence says what to do
		// instead.
		return {
			canManageUpdate: false,
			updateCommand: "",
			remedy:
				"The server is running from a source checkout on this machine rather than an installed copy, so update it with lop-update after your change is merged.",
			detail,
			sourceBuild: true,
		};
	}
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
			detail,
			sourceBuild,
		};
	}
	if (kind === "pipx") {
		return {
			canManageUpdate: false,
			updateCommand: "pipx upgrade local-operator",
			remedy: "The server is a pipx install, so update it from your terminal:",
			detail,
			sourceBuild: false,
		};
	}
	if (kind === "pip") {
		return {
			canManageUpdate: false,
			updateCommand: "pip install --upgrade local-operator",
			remedy: "The server is a pip install, so update it from your terminal:",
			detail,
			sourceBuild: false,
		};
	}
	return {
		canManageUpdate: false,
		updateCommand: "",
		remedy:
			"The app could not tell how this server was installed, so update it with the tool you installed it with - uv, pipx or pip:",
		detail,
		sourceBuild: false,
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
 *
 * The `before` reading deserves its own rule. It is null whenever `pip show`
 * failed before the upgrade, and the old code read that as "changed" - an
 * unreadable starting point cannot prove an upgrade landed, so the target
 * version is what the after-reading is held to instead (review R6).
 */
export function didUpgradeLand(input: {
	before: string | null;
	after: string | null;
	/** The version this upgrade was asked for, when the caller knows it. */
	target?: string | null;
}): boolean {
	const { before, after, target } = input;
	if (after == null) return false;
	if (before == null) {
		return target != null && after.trim() === target.trim();
	}
	return before.trim() !== after.trim();
}
