/**
 * The user's own telemetry choice: opted in, opted out, or never asked.
 *
 * WHY THIS EXISTS (2026-11-24). Telemetry used to be ON unless a launch said
 * otherwise (`telemetry-launch.ts`), which made the shipped app report by
 * default. The product rule is now the reverse: nothing is sent until the user
 * opts in explicitly — in Settings → Privacy, or through the optional onboarding
 * checkbox — and they can opt out or back in at any time. This module owns that
 * choice and nothing else.
 *
 * WHY MAIN OWNS IT, IN A FILE IN `userData`. The choice must be readable before
 * any window exists (main composes every window's `--lo-telemetry` argument from
 * it), must be identical in every window at once (main broadcasts changes), and
 * must survive a renderer's storage being cleared. A `localStorage` key would be
 * per-origin renderer state main cannot read synchronously, and the backend is a
 * separately installed package that is not this app's to configure. So it is a
 * tiny JSON file next to the app's other per-profile state, and a scratch
 * `--user-data-dir` (every rig's profile) starts with no record — which is OFF.
 *
 * THE RULES:
 *  - no record, an unreadable file, or a record that is not exactly the shape
 *    below: NOT OPTED IN. Silence is never consent; existing installs therefore
 *    become off until their user opts in.
 *  - `optedIn: true` is consent; `optedIn: false` is an explicit refusal, kept
 *    (rather than deleting the file) so "decided no" and "never asked" stay
 *    distinguishable for a future onboarding prompt.
 *  - consent is only HALF the decision. `resolveEffectiveTelemetry` combines it
 *    with the launch's verdict, and the launch can only take telemetry away:
 *    `LOCAL_OPERATOR_UI_TELEMETRY=off` or a build without a key beats consent.
 *
 * Pure by construction (the caller does the I/O through the small `ConsentFs`
 * seam), so `scripts/telemetry-consent.test.mjs` bundles it and asserts the
 * rules without Electron.
 */

/** File name inside `app.getPath("userData")`. */
export const TELEMETRY_CONSENT_FILE = "telemetry-consent.json";

/** IPC channels: read, write, and main's broadcast to every window. */
export const TELEMETRY_CONSENT_GET_CHANNEL = "telemetry-consent:get";
export const TELEMETRY_CONSENT_SET_CHANNEL = "telemetry-consent:set";
export const TELEMETRY_CONSENT_CHANGED_CHANNEL = "telemetry-consent:changed";

/** What is persisted. `decidedAt` is an ISO timestamp, for support only. */
export interface TelemetryConsentRecord {
	optedIn: boolean;
	decidedAt: string;
}

/**
 * What a window is told: the user's choice, whether this launch would allow
 * telemetry at all, and the product of the two. Settings renders `optedIn`
 * (the user's answer) and may explain `launchAllows === false`; the analytics
 * client follows `effective` only.
 */
export interface TelemetryConsentState {
	optedIn: boolean;
	launchAllows: boolean;
	effective: boolean;
}

/**
 * Parse a record. `null` for anything that is not exactly a record — missing
 * file contents, bad JSON, a non-boolean `optedIn` (a string "true" is NOT
 * consent: only a value this module wrote counts).
 */
export function parseTelemetryConsent(
	raw: string | null | undefined,
): TelemetryConsentRecord | null {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const { optedIn, decidedAt } = value as Record<string, unknown>;
	if (typeof optedIn !== "boolean") return null;
	return {
		optedIn,
		decidedAt: typeof decidedAt === "string" ? decidedAt : "",
	};
}

/** True only for an explicit, well-formed opt-in. */
export function hasOptedIn(record: TelemetryConsentRecord | null): boolean {
	return record?.optedIn === true;
}

/** The bytes written for a choice made at `now`. */
export function serializeTelemetryConsent(
	optedIn: boolean,
	now: Date = new Date(),
): string {
	const record: TelemetryConsentRecord = {
		optedIn,
		decidedAt: now.toISOString(),
	};
	return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Effective telemetry: the launch must allow it AND the user must have opted
 * in. Either one alone is off.
 */
export function resolveEffectiveTelemetry(input: {
	launchAllows: boolean;
	record: TelemetryConsentRecord | null;
}): TelemetryConsentState {
	const optedIn = hasOptedIn(input.record);
	return {
		optedIn,
		launchAllows: input.launchAllows,
		effective: input.launchAllows && optedIn,
	};
}

/** The I/O this module needs, injected so tests never touch a disk. */
export interface ConsentFs {
	readFile(path: string): string | null;
	writeFile(path: string, contents: string): void;
	/** Atomic replace (POSIX `rename`); see `writeTelemetryConsent`. */
	rename(from: string, to: string): void;
}

/** The sibling a choice is written to before it replaces the real file. */
export const consentTempPath = (path: string): string => `${path}.tmp`;

/**
 * Read the record at `path`. A read error (no file, permissions) is "no
 * record", never a throw: telemetry must fail closed, and the app must start.
 */
export function readTelemetryConsent(
	fs: ConsentFs,
	path: string,
): TelemetryConsentRecord | null {
	try {
		return parseTelemetryConsent(fs.readFile(path));
	} catch {
		return null;
	}
}

/**
 * Persist a choice. Throws on a write failure, deliberately: the Settings
 * toggle must not claim a choice was saved when it was not, and main then
 * keeps its in-memory answer unchanged.
 */
export function writeTelemetryConsent(
	fs: ConsentFs,
	path: string,
	optedIn: boolean,
	now: Date = new Date(),
): TelemetryConsentRecord {
	const contents = serializeTelemetryConsent(optedIn, now);
	/*
	 * ATOMIC (review round 1, R3): written whole to a sibling, then renamed
	 * over the record. A crash mid-write leaves the old record intact rather
	 * than a truncated file, which would parse as "no record" and silently
	 * drop the user's choice. Same directory, so the rename never crosses a
	 * filesystem.
	 */
	const temp = consentTempPath(path);
	fs.writeFile(temp, contents);
	fs.rename(temp, path);
	return { optedIn, decidedAt: now.toISOString() };
}
