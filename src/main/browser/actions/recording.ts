import {
	accessSync,
	closeSync,
	constants as fsConstants,
	fsyncSync,
	linkSync,
	lstatSync,
	openSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { CdpContents } from "../cdp";
import { BrowserHostError } from "../errors";
import { CDP_DEADLINE_MS } from "../vendor/driver/deadline";
import type { BrowserActionContext } from "./context";
import { requesterOf, stringParam } from "./context";

/**
 * `record_start` / `record_stop`: a video recording of one driven tab, written
 * by the desktop app's main process, addressed by the path the harness chose.
 * Design: `docs/design/browser-recording.md` (D3-D9, D11, D13, D14), which is
 * the decision record this file implements and must not silently outgrow.
 *
 * WHY THE HOST WRITES THE FILE AND NOT THE HARNESS (D3). A clip is megabytes and
 * minutes long; the RPC body cap is 1 MiB (`rpc.ts`) and a base64 stream through
 * it would be a second, lossy channel for bytes Chromium already holds on disk.
 * The `download` verb is the precedent: the harness composes and approves a
 * path, the host writes into it. So the path arrives absolute, and everything
 * policy-shaped (workspace confinement, the scratchpad cap, the scheme refusal)
 * has already been decided in Python before this file sees it.
 *
 * WHY THE PATH IS FIXED AT START (D4). Approval happens once, before any pixel
 * is captured: a denied start writes nothing and starts nothing, and a typo in
 * the destination fails in the first second rather than after a ten-minute
 * clip. Chromium's stream is a delete-on-close temporary file, so bytes only
 * reach this process at stop; a crash therefore leaves no half-file and no
 * orphan, and a hard kill loses the clip by construction.
 *
 * WHAT THIS FILE DOES NOT DO, each deliberately:
 * - it never creates a directory. A missing parent is a refusal, because the
 *   host has no opinion about where the harness's recordings live (D5);
 * - it never overwrites. The publish is `linkSync`, which fails `EEXIST`; an
 *   existing target is refused at start and again at publish when something
 *   else claimed the name while the clip was recording;
 * - it never returns a partial file. The `.part` inode is unlinked on every
 *   failure path, so a reported path always names a complete clip (D5);
 * - it never reports bytes it did not write. `bytes` is the count of bytes
 *   fsync'd to the part before the publish, and Python re-checks the size on
 *   disk (D9).
 *
 * TEARDOWN IS ABORT-AND-DISCARD (D7). Chromium's `PageHandler::Disable` stops
 * the screencast but not the media recorder, and a detach destroys the stream's
 * backing file, so there is nothing to salvage once the debugger boundary is
 * crossed. `abortRecording` is called from `CdpPool.dropCaptures` at all four
 * boundaries (the detach event, `forget`, `detach`, and `close` through
 * `detach`); only the DevTools detach leaves a tombstone, because it is the one
 * case where the tab survives and a later `record_stop` can still be answered.
 *
 * THE ENCODER IS A CHILD PROCESS of the app (`DevTools Media Encoding Service`),
 * one per recording. `MAX_CONCURRENT_RECORDINGS` bounds how many run at once;
 * the number is a product decision until QA measures the CPU of two (D6 says so
 * in as many words), and it matters because `MAX_AGENT_TABS` is 8.
 */

/** The UNSIZED capture shape (D14): the ceiling the encoder scales a clip to fit
 * inside, a frame rate it sustains on a hidden view, and no audio. A
 * `record_start` carrying `width`/`height` replaces the ceiling with a real
 * viewport (see `sizeOf`); omitting them keeps this behaviour exactly. */
export const RECORD_WIDTH = 1280;
export const RECORD_HEIGHT = 720;
export const RECORD_FPS = 10;

/** The agent-tunable size contract (D14/RS1). The 4K ceiling lives in ONE place
 * per side so raising it is a constant change plus docs, not a rewrite. */
export const RECORD_MIN_SIDE = 240;
export const RECORD_MAX_SIDE = 3840;
export const RECORD_MAX_PIXELS = 3840 * 2160;

/** How long a sized start waits for the emulated viewport to be laid out before
 * refusing `record_size`/`not_applied`. The probe measured the page resizing on
 * the next frame. */
export const RECORD_LAYOUT_SETTLE_MS = 2_000;

/** Poll cadence for that wait: the normal case settles on the first check, and a
 * short interval keeps a stuck tab to ~40 round trips, not a spin. */
export const RECORD_LAYOUT_POLL_MS = 50;

/** How long a sized start waits, once the page's own inner size matches, for a
 * frame AT that size to reach the compositor the encoder captures. Bound and
 * poll cadence are separate from the layout wait above on purpose: the two
 * measure different things and either can be the one that fails. */
export const RECORD_FRAME_SETTLE_MS = 2_000;

/** Above this area a clip counts as "large" for the provisional rule below. */
export const RECORD_LARGE_AREA = 1920 * 1080;

/** Provisional until two concurrent 4K encoders are measured: at most ONE
 * recording above 1920x1080 runs at a time. The probe measured 227 % CPU and
 * about 370-390 MB encoder RSS for a single 4K clip (374 MB at 6 s, 389 MB at
 * 30 s; 8K: 778 % / 1.2 GB). Lower the value or drop the rule when that
 * measurement lands; it is not wire contract. */
export const MAX_CONCURRENT_LARGE_RECORDINGS = 1;

/** The longest single path component, in bytes, the filesystems we run on allow. */
const MAX_NAME_BYTES = 255;

/** How long a recording runs before the host stops it (D6). `max_duration_s`
 * must be inside `1..RECORD_MAX_DURATION_S`; the default is the product's
 * answer for "long enough for a demo, short enough to stay a few MB". */
export const RECORD_DEFAULT_DURATION_S = 120;
export const RECORD_MAX_DURATION_S = 600;

/** The most this host will write for one clip (D6). The harness may ask for
 * less — a scratchpad destination is capped at the scratchpad's own 32 MiB
 * write limit — and never for more. */
export const RECORD_MAX_BYTES = 64 * 1024 * 1024;

/** How many recordings may run at once, app-wide (D6). */
export const MAX_CONCURRENT_RECORDINGS = 2;

/** `Page.startScreenRecording` launches the encoder utility process, so its
 * budget is the attach class rather than the read class. `record_stop`'s 20 s
 * covers the flush Chromium performs while finalizing the stream. */
export const RECORD_START_DEADLINE_MS = 20_000;
export const RECORD_STOP_DEADLINE_MS = 20_000;

/** The whole stop, read loop included, stays under the harness's 60 s command
 * budget (D8) with room to answer: 45 s here, 60 s there, and the client's
 * timeout derives from the same table. */
export const RECORD_STOP_BUDGET_MS = 45_000;

/** How long a REPLACE waits for the old recorder to stop (D7's abort-and-discard
 * applied to a tab whose attachment survives). Chromium refuses a second
 * `Page.startScreenRecording` with "Screencast is already active" while the old
 * recorder is live — measured on Electron 45.1.0 — so discarding the old state
 * without stopping the stream would make a hand-over impossible. */
export const RECORD_ABORT_DEADLINE_MS = 2_000;

/** One `IO.read` page. 1 MiB is the size the probe measured as reliable, and it
 * keeps the decoded copy of a page small enough for the main process. */
export const RECORD_READ_BYTES = 1024 * 1024;

/** Chromium 153 added `Page.startScreenRecording` (D9). A build below it cannot
 * be asked, and the protocol schema does not list the command, so the version is
 * the first classifier and Chromium's own message the second. */
const RECORD_FIRST_CHROMIUM_MAJOR = 153;

/** One running recording. */
interface Recording {
	/** `requesterOf(...)`: `session:<id>`, or the request id when the caller
	 * supplied no session identity. */
	owner: string;
	contents: CdpContents;
	cdp: BrowserActionContext["cdp"];
	/** The absolute path the harness approved. Published to, never replaced. */
	path: string;
	/** `<dir>/.<name>.part`: the inode bytes are written to before the publish. */
	partPath: string;
	startedAt: number;
	maxBytes: number;
	maxDurationS: number;
	/** The confirmed size of a sized recording. Both are absent on the unsized
	 * path, which reports no width/height. */
	width?: number;
	height?: number;
	/** The tab viewport this recording owns: absent when it installed no override,
	 * and the token its exits must present before clearing (see
	 * `viewportOverrides`, review M1). */
	viewportToken?: object;
	/** The auto-stop timer. Cleared by every exit path. */
	timer: ReturnType<typeof setTimeout> | undefined;
	/** The one finalize in flight, shared by the timer and a `record_stop` that
	 * arrives while it runs, so the stream is stopped exactly once. */
	finishing: Promise<Record<string, unknown>> | null;
	/** Set by `abortRecording`: a finalize that lands afterwards must not write a
	 * settled result over the abort. */
	aborted: boolean;
}

/**
 * What a later `record_stop` can be answered with after the recording is gone.
 *
 * Two outcomes and no third: a finished result the caller has not collected
 * yet, or the typed failure that ended it. The failure is stored as the error
 * itself rather than as a string so a `record_too_large` auto-stop still reaches
 * the agent as `record_too_large`.
 */
type Settled = { owner: string } & (
	| { result: Record<string, unknown> }
	| { error: BrowserHostError }
);

const recordings = new Map<number, Recording>();
const settled = new Map<number, Settled>();
/**
 * Slots taken by starts that have passed the cap check but not yet registered.
 *
 * The check and the registration are separated by `await`s (attach, then the CDP
 * start), so four starts that arrive together all read `recordings.size === 0`
 * and all proceed — the cap held only for calls that happened to serialise
 * (review M1). A reservation is taken SYNCHRONOUSLY with the path it will write,
 * which also makes a duplicate path impossible before either start registers.
 * Key is a token; value is the absolute path and whether the start is LARGE for
 * the provisional one-large-at-a-time rule (RS5), so four simultaneous sized
 * starts cannot all see the same count.
 */
const reservations = new Map<
	string,
	{ webContentsId: number; path: string; cancelled: boolean; large: boolean }
>();
/**
 * The viewport override each tab currently carries, keyed by view id.
 *
 * A sized start installs one and every exit path clears it, but those exits belong
 * to DIFFERENT recordings: a finalize, abort or replace of a displaced recording
 * can land after a successor has installed its own override on the same tab.
 * Clearing then would leave the live recording at a size nobody asked for, so a
 * clear only acts while its own token is still the tab's (review M1). The claim
 * happens BEFORE the CDP call, so a clear that interleaves with an install sees
 * itself superseded rather than racing the set.
 */
const viewportOverrides = new Map<number, object>();

function notActive(): BrowserHostError {
	return new BrowserHostError(
		"internal",
		"no recording is running on this tab for this requester; start one with record_start",
		{ reason: "record_not_active" },
	);
}

/** The refusal a finalize raises when an abort (DevTools detach, replace) lands
 * while it is reading or publishing. */
function abortedWhileSaving(): BrowserHostError {
	return new BrowserHostError(
		"internal",
		"the recording was discarded while it was being saved; nothing was written",
		{ reason: "record_aborted" },
	);
}

function typedFailure(error: unknown): BrowserHostError {
	if (error instanceof BrowserHostError) return error;
	return new BrowserHostError(
		"internal",
		error instanceof Error ? error.message : String(error),
		{ reason: "record_failed" },
	);
}

/**
 * The Chromium major this process is running, or 0 when it cannot be read.
 *
 * Read from `process.versions.chrome` because that is the one fact available
 * without asking the target anything, and asking is exactly what may be
 * impossible: a missing command answers with an error whose text is unverified
 * on 152 (D9).
 */
function chromiumMajor(): number {
	const version = process.versions.chrome ?? "";
	const major = Number.parseInt(version.split(".")[0] ?? "", 10);
	return Number.isFinite(major) ? major : 0;
}

/** A refusal that must arrive before any CDP call: the path is the approval's
 * subject, so it is checked before the tab is touched. */
function pathRefusal(path: string, detail: string): BrowserHostError {
	return new BrowserHostError("internal", detail, {
		reason: "record_path",
		path,
	});
}

/**
 * Apply D5's host-side invariants to the approved path.
 *
 * These repeat what Python already decided, and that repetition is the point:
 * the host is the trust boundary for the one thing it does with the value — a
 * write. A path that is relative, not an `.mp4`, under a directory this process
 * cannot write, or already present (in any form, symlinks included: `lstat`)
 * is refused here, before the encoder is started.
 */
function preflightPath(params: Record<string, unknown>): string {
	const path = stringParam(params, "path");
	if (!path) {
		throw pathRefusal(
			"",
			"record_start requires the harness-chosen output path: an absolute path ending in .mp4",
		);
	}
	if (!isAbsolute(path)) {
		throw pathRefusal(path, `the recording path must be absolute: ${path}`);
	}
	const name = basename(path);
	if (!name.toLowerCase().endsWith(".mp4") || name.length === ".mp4".length) {
		throw pathRefusal(path, `the recording path must end in .mp4: ${path}`);
	}
	// The part file is `.<name>.part`, which is 6 bytes longer than the name the
	// approval carries. A name that fits as the final path but not as the part
	// would be accepted here and lose the whole clip at stop (ENAMETOOLONG), so
	// the longer of the two is what is checked. 255 bytes is the per-component
	// limit on APFS, ext4 and NTFS alike.
	if (Buffer.byteLength(`.${name}.part`, "utf8") > MAX_NAME_BYTES) {
		throw pathRefusal(
			path,
			`the recording file name is too long: it must be at most ${MAX_NAME_BYTES - 6} bytes, so that its temporary ".part" file also fits`,
		);
	}
	const dir = dirname(path);
	let parentIsDirectory = false;
	try {
		parentIsDirectory = statSync(dir).isDirectory();
	} catch {
		parentIsDirectory = false;
	}
	if (!parentIsDirectory) {
		throw pathRefusal(
			path,
			`the recording path's parent directory does not exist or is not a directory: ${dir}`,
		);
	}
	try {
		accessSync(dir, fsConstants.W_OK);
	} catch {
		throw pathRefusal(
			path,
			`the recording path's parent directory is not writable: ${dir}`,
		);
	}
	let present = true;
	try {
		lstatSync(path);
	} catch {
		present = false;
	}
	if (present) {
		throw pathRefusal(
			path,
			`the recording path already exists and is never overwritten: ${path}`,
		);
	}
	return path;
}

/** D6's duration cap, in seconds. */
function durationOf(params: Record<string, unknown>): number {
	const raw = params.max_duration_s;
	if (raw === undefined) return RECORD_DEFAULT_DURATION_S;
	const seconds = Number(raw);
	if (
		!Number.isInteger(seconds) ||
		seconds < 1 ||
		seconds > RECORD_MAX_DURATION_S
	) {
		throw new BrowserHostError(
			"internal",
			`record_start max_duration_s takes WHOLE SECONDS only: give an integer from 1 to ${RECORD_MAX_DURATION_S}. Nothing was started.`,
			{ reason: "record_failed", param: "max_duration_s" },
		);
	}
	return seconds;
}

/** D6's byte cap. The harness may lower it (a scratchpad destination) and may
 * not raise it past this host's own ceiling. */
function maxBytesOf(params: Record<string, unknown>): number {
	const raw = params.max_bytes;
	if (raw === undefined) return RECORD_MAX_BYTES;
	const bytes = Number(raw);
	if (!Number.isInteger(bytes) || bytes < 1 || bytes > RECORD_MAX_BYTES) {
		throw new BrowserHostError(
			"internal",
			`record_start max_bytes must be a whole number of bytes from 1 to ${RECORD_MAX_BYTES}; nothing was started`,
			{ reason: "record_failed", param: "max_bytes" },
		);
	}
	return bytes;
}

interface RecordSize {
	width: number;
	height: number;
}

/** A refusal that must arrive before any side effect, tagged with the field and
 * the cause so Python can render its own copy (RS2). */
function sizeRefusal(
	why: "incomplete" | "range" | "odd" | "area" | "visible" | "not_applied",
	param: "width" | "height" | "size",
	detail: string,
): BrowserHostError {
	return new BrowserHostError("internal", `${detail} Nothing was started.`, {
		reason: "record_size",
		param,
		why,
	});
}

/**
 * D14's agent-tunable size, or null for the fixed ceiling.
 *
 * Both or neither: a lone `height` is a half-expressed request, not a request
 * for a default width. Even sides are required because the encoder's chroma
 * planes are half resolution; the area cap allows 2160x3840 portrait while
 * refusing 3840x3840. Every refusal names the bound and says nothing started.
 */
function sizeOf(params: Record<string, unknown>): RecordSize | null {
	const hasWidth = params.width !== undefined;
	const hasHeight = params.height !== undefined;
	if (!hasWidth && !hasHeight) return null;
	if (!hasWidth || !hasHeight) {
		const missing = hasWidth ? "height" : "width";
		throw sizeRefusal(
			"incomplete",
			missing,
			`record_start width and height must be given together; ${missing} is missing.`,
		);
	}
	const width = Number(params.width);
	const height = Number(params.height);
	if (!Number.isInteger(width) || !Number.isInteger(height)) {
		const param = Number.isInteger(width) ? "height" : "width";
		throw sizeRefusal(
			"range",
			param,
			`record_start width and height must be whole numbers of pixels: got ${String(params.width)}x${String(params.height)}.`,
		);
	}
	if (width % 2 !== 0 || height % 2 !== 0) {
		const param = width % 2 !== 0 ? "width" : "height";
		throw sizeRefusal(
			"odd",
			param,
			`record_start ${param} must be even, because the encoder's chroma planes are half resolution: got ${width}x${height}.`,
		);
	}
	if (
		width < RECORD_MIN_SIDE ||
		width > RECORD_MAX_SIDE ||
		height < RECORD_MIN_SIDE ||
		height > RECORD_MAX_SIDE
	) {
		const param =
			width < RECORD_MIN_SIDE || width > RECORD_MAX_SIDE ? "width" : "height";
		throw sizeRefusal(
			"range",
			param,
			`record_start ${param} must be from ${RECORD_MIN_SIDE} to ${RECORD_MAX_SIDE} pixels: got ${width}x${height}.`,
		);
	}
	if (width * height > RECORD_MAX_PIXELS) {
		throw sizeRefusal(
			"area",
			"size",
			`record_start ${width}x${height}: the area is larger than ${RECORD_MAX_SIDE}x${RECORD_MAX_PIXELS / RECORD_MAX_SIDE} (${RECORD_MAX_PIXELS} pixels), which is this host's ceiling.`,
		);
	}
	return { width, height };
}

/** True when a size is above 1080p's area, the provisional large-clip rule. */
function isLarge(size: RecordSize): boolean {
	return size.width * size.height > RECORD_LARGE_AREA;
}

/** The same rule for a recording or a start that may be unsized. */
function isLargeRecording(recording: {
	width?: number;
	height?: number;
}): boolean {
	const size = sizeOfRecording(recording);
	return size !== null && isLarge(size);
}

/** The confirmed size of a recording, or null when it used the ceiling. */
function sizeOfRecording(recording: {
	width?: number;
	height?: number;
}): RecordSize | null {
	return recording.width === undefined || recording.height === undefined
		? null
		: { width: recording.width, height: recording.height };
}

/** The page's own inner size, in CSS pixels, from a `Runtime.evaluate` answer,
 * or null when the answer is not a pair of numbers. */
function sizeFromValue(value: unknown): RecordSize | null {
	if (!Array.isArray(value) || value.length !== 2) return null;
	const width = Number(value[0]);
	const height = Number(value[1]);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The page's own inner size, in CSS pixels, or null when the answer is not a
 * pair of numbers.
 *
 * WHY `window.innerWidth` AND NOT `Page.getLayoutMetrics`: that command's
 * `cssLayoutViewport.clientWidth` EXCLUDES the scrollbar, so a page tall enough
 * to scroll reports 1905 for a 1920-wide override and a start that worked was
 * refused `not_applied` after the 2 s wait (measured on Electron 45.1.0, review
 * m1). `innerWidth`/`innerHeight` are what the page sees, scrollbar included,
 * which is the surface the encoder captures.
 */
async function innerViewport(
	cdp: BrowserActionContext["cdp"],
	contents: CdpContents,
): Promise<RecordSize | null> {
	const answer = await cdp.send<{ result?: { value?: unknown } }>(
		contents,
		"Runtime.evaluate",
		{
			expression: "[window.innerWidth, window.innerHeight]",
			returnByValue: true,
		},
		{ deadlineMs: CDP_DEADLINE_MS },
	);
	return sizeFromValue(answer?.result?.value);
}

/** Wait until the emulated viewport is the one that was asked for, or refuse.
 * Polling reads the page's own layout, not a value this process wrote: the
 * override can be accepted while the renderer has not laid out yet.
 *
 * A TRANSIENT `Runtime.evaluate` FAILURE IS A "NOT YET": during a navigation the
 * tab answers `Cannot get default execution context` (or "Cannot find default
 * execution context") until the new document exists, and that is a start racing
 * a load, not a start that cannot resize. Treating it as the answer made the
 * whole start fail with a raw CDP error instead of waiting out the poll window
 * (review n-A).
 *
 * The answer is the REQUESTED size: the poll passes only on an exact match, so
 * reporting the request is reporting the measurement, and the echoed width and
 * height stay the round numbers the caller asked for. */
async function waitForViewport(
	cdp: BrowserActionContext["cdp"],
	contents: CdpContents,
	size: RecordSize,
): Promise<RecordSize> {
	const deadline = Date.now() + RECORD_LAYOUT_SETTLE_MS;
	for (;;) {
		let measured: RecordSize | null = null;
		try {
			measured = await innerViewport(cdp, contents);
		} catch {
			// See the note above: the poll owns this window, so it retries.
			measured = null;
		}
		if (
			measured &&
			measured.width === size.width &&
			measured.height === size.height
		) {
			return size;
		}
		if (Date.now() >= deadline) {
			throw sizeRefusal(
				"not_applied",
				"size",
				`record_start could not apply ${size.width}x${size.height} to the tab's viewport within ${RECORD_LAYOUT_SETTLE_MS / 1000} s.`,
			);
		}
		await new Promise((resolveWait) =>
			setTimeout(resolveWait, RECORD_LAYOUT_POLL_MS),
		);
	}
}

/** Two `requestAnimationFrame` callbacks, resolved with the inner size the tab
 * reports at that point. The first callback runs after the resized frame has
 * been laid out and painted, the second after that frame has been handed to the
 * compositor — which is the surface the encoder captures. */
const FRAME_SETTLE_EXPRESSION =
	"new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve([window.innerWidth, window.innerHeight]))); })";

/**
 * Wait until the tab has DRAWN a frame at the size the layout poll confirmed.
 *
 * WHY THE POLL IS NOT ENOUGH (QA Q1): `window.innerWidth` reports the override
 * as soon as the renderer is told about it, but `Page.startScreenRecording`
 * captures the COMPOSITOR's surface. Starting the instant the numbers matched
 * left the encoder's first frames holding the PREVIOUS 1280x720 raster — the
 * old layout stretched across a 3840x2160 clip, and a 1280x720 patch on black
 * at 2160x3840 and 3840x1080 — while the clip was coded at the requested size
 * and its LAST frame was right (measured 2026-11-02 on Electron 45.1.0, QA Q1).
 *
 * WHY `requestAnimationFrame` AND NOT A TIMER: a timer waits a guessed number
 * of milliseconds for work whose duration depends on the size and the machine
 * (500 ms was enough in the probe, but only because it is far longer than the
 * three-frame path it was really waiting for). rAF callbacks are driven by the
 * compositor's BeginFrames, so two of them mean what this wait means: a frame
 * exists. Measured on the real hidden view: 8-14 ms per pair, and the first
 * frame carried the requested size in 8 of 8 runs at each of 3840x2160,
 * 2160x3840 and 1920x1080, against 3 of 3 stale at 2160x3840 with no wait.
 *
 * A view that never draws one is refused `record_size`/`not_applied` by the
 * caller: a clip whose first frame is the old layout is a wrong clip, not a
 * slow one. */
async function waitForCompositedFrame(
	cdp: BrowserActionContext["cdp"],
	contents: CdpContents,
	size: RecordSize,
): Promise<void> {
	const deadline = Date.now() + RECORD_FRAME_SETTLE_MS;
	for (;;) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		let measured: RecordSize | null = null;
		try {
			const answer = await cdp.send<{ result?: { value?: unknown } }>(
				contents,
				"Runtime.evaluate",
				{
					expression: FRAME_SETTLE_EXPRESSION,
					awaitPromise: true,
					returnByValue: true,
				},
				{ deadlineMs: remaining },
			);
			measured = sizeFromValue(answer?.result?.value);
		} catch {
			// A promise that never settles, and a document that is being replaced,
			// both land here; the loop's deadline is what decides.
			measured = null;
		}
		if (
			measured &&
			measured.width === size.width &&
			measured.height === size.height
		) {
			return;
		}
		await new Promise((resolveWait) =>
			setTimeout(resolveWait, RECORD_LAYOUT_POLL_MS),
		);
	}
	throw sizeRefusal(
		"not_applied",
		"size",
		`record_start applied ${size.width}x${size.height} to the tab's viewport, but the tab did not draw a frame at that size within ${RECORD_FRAME_SETTLE_MS / 1000} s.`,
	);
}

/** Apply one recording's override and claim the tab's viewport for it.
 * Returns the token every later clear for that recording must present. */
async function installViewport(
	cdp: BrowserActionContext["cdp"],
	contents: CdpContents,
	size: RecordSize,
): Promise<object> {
	const token: object = {};
	viewportOverrides.set(contents.id, token);
	try {
		await cdp.send(
			contents,
			"Emulation.setDeviceMetricsOverride",
			{
				width: size.width,
				height: size.height,
				deviceScaleFactor: 1,
				mobile: false,
			},
			{ deadlineMs: CDP_DEADLINE_MS },
		);
	} catch (error) {
		// The claim outlived no override: drop it before the start's own failure
		// path looks for a token it never received.
		if (viewportOverrides.get(contents.id) === token) {
			viewportOverrides.delete(contents.id);
		}
		throw error;
	}
	return token;
}

/** Drop a viewport override, best effort.
 *
 * ONLY THE RECORDING THAT INSTALLED IT MAY CLEAR IT: a finalize, abort or replace
 * belonging to a displaced recording reaches here after its successor has
 * installed its own override, and clearing then would leave the live recording at
 * an unrequested size (review M1). The token is checked synchronously, before any
 * await, so a superseded clear never issues a command at all.
 *
 * Bounded and swallowed on purpose otherwise: this runs on detach, tab close and
 * failure paths whose original error is the answer, and an emulation clear that
 * cannot reach a dying session must never replace it. A session that is gone
 * drops its override by itself. */
async function clearViewport(
	cdp: BrowserActionContext["cdp"],
	contents: CdpContents,
	token: object,
): Promise<void> {
	if (viewportOverrides.get(contents.id) !== token) return;
	viewportOverrides.delete(contents.id);
	// A DESTROYED VIEW ENDS THIS PATH WITHOUT A CDP CALL. `send` answers a
	// destroyed view by calling `forget`, whose `dropCaptures` calls
	// `abortRecording`, which is where this clear came from — so asking recursed
	// until the stack went (depth ~870, RangeError; review m2). The session's
	// override dies with its debugger session.
	if (contents.isDestroyed()) return;
	try {
		await cdp.send(
			contents,
			"Emulation.clearDeviceMetricsOverride",
			{},
			{ deadlineMs: CDP_DEADLINE_MS },
		);
	} catch {
		// Best effort: see above.
	}
}

/** The cap in the words the refusal uses: MiB for a sane cap, KiB for a test-sized
 * one, so "larger than 0 MiB" can never be the only thing a reader sees. */
function capWords(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${Math.floor(bytes / (1024 * 1024))} MiB`
		: `${Math.round(bytes / 1024)} KiB`;
}

/** D9's start-error taxonomy: version first, then Chromium's own text. */
function classifyStartFailure(error: unknown): BrowserHostError {
	const message = error instanceof Error ? error.message : String(error);
	const major = chromiumMajor();
	if (major > 0 && major < RECORD_FIRST_CHROMIUM_MAJOR) {
		return new BrowserHostError(
			"internal",
			`the desktop app's browser engine (Chromium ${major}) has no video recording; it needs Chromium ${RECORD_FIRST_CHROMIUM_MAJOR} or newer. Update the desktop app and retry. Screenshots still work. Nothing was written.`,
			{ reason: "record_unsupported", chromium: major },
		);
	}
	if (/AV1\/libaom|libaom/i.test(message)) {
		return new BrowserHostError(
			"internal",
			"this browser engine build cannot encode AV1, which video recording needs. Nothing was written.",
			{ reason: "record_av1_unavailable", detail: message },
		);
	}
	if (
		/not found|wasn't found|was not found|unknown method|-32601/i.test(message)
	) {
		return new BrowserHostError(
			"internal",
			`this browser engine has no video recording (${message}); it needs Chromium ${RECORD_FIRST_CHROMIUM_MAJOR} or newer. Nothing was written.`,
			{ reason: "record_unsupported", detail: message },
		);
	}
	// Chromium's own refusal is the most useful sentence available, so it is
	// carried verbatim rather than summarised (D9).
	return new BrowserHostError("internal", message, {
		reason: "record_failed",
	});
}

/**
 * The result shape of both methods, from one place so the two cannot drift.
 *
 * An UNSIZED clip reports no width/height: `RECORD_WIDTH`/`RECORD_HEIGHT` are
 * only the ceiling handed to Chromium, the clip is scaled to fit inside it, and
 * a presented 1380x868 view measured 1144x720. A SIZED clip reports the size the
 * layout poll confirmed, because that is a claim this host measured, not the
 * ceiling it asked for.
 */
function captureShape(size?: RecordSize | null): Record<string, unknown> {
	return {
		fps: RECORD_FPS,
		container: "mp4",
		codec: "av1",
		...(size ? { width: size.width, height: size.height } : {}),
	};
}

/**
 * Read the stream into the part file, or refuse.
 *
 * The loop asks for `min(page, remaining + 1)` bytes: paging keeps the decoded
 * copy to 1 MiB (it is written out as each page arrives, never accumulated),
 * and the extra byte is what makes the cap PROVEN rather than inferred from a
 * page that happened to fit exactly (D5/D6). `offset` is deliberately not sent
 * — Chromium's stream position advances with each read, and a delete-on-close
 * stream may not support seeking at all.
 */
async function readStream(
	recording: Recording,
	handle: string,
	budgetAt: number,
	fd: number,
): Promise<number> {
	let bytes = 0;
	for (;;) {
		if (recording.aborted) throw abortedWhileSaving();
		if (Date.now() > budgetAt) {
			throw new BrowserHostError(
				"internal",
				`the recording did not finish within ${RECORD_STOP_BUDGET_MS / 1000} s; nothing was saved`,
				{ reason: "record_failed" },
			);
		}
		const remaining = recording.maxBytes - bytes;
		const page = await recording.cdp.send<{
			data?: string;
			base64Encoded?: boolean;
			eof?: boolean;
		}>(
			recording.contents,
			"IO.read",
			{ handle, size: Math.min(RECORD_READ_BYTES, remaining + 1) },
			{ deadlineMs: CDP_DEADLINE_MS },
		);
		const data = typeof page?.data === "string" ? page.data : "";
		const chunk = data
			? Buffer.from(data, page?.base64Encoded === false ? "utf8" : "base64")
			: Buffer.alloc(0);
		if (chunk.length > 0) {
			writeSync(fd, chunk);
			bytes += chunk.length;
		}
		if (bytes > recording.maxBytes) {
			const atSize = sizeOfRecording(recording);
			throw new BrowserHostError(
				"internal",
				`the recording is larger than ${capWords(recording.maxBytes)}${atSize ? ` at ${atSize.width}x${atSize.height}` : ""}; nothing was saved. Record a shorter span (timeout_s) and retry.`,
				{ reason: "record_too_large", max_bytes: recording.maxBytes },
			);
		}
		if (page?.eof === true || chunk.length === 0) break;
	}
	return bytes;
}

/**
 * Stop the stream, write the approved file, and report what landed.
 *
 * The publish is a hard link from the part inode, so it is atomic and cannot
 * replace a file that appeared while the clip was recording. Every failure path
 * closes the stream and unlinks the part before it throws: a reported path
 * always names a complete clip.
 */
async function runFinalize(
	recording: Recording,
	autoStopped: boolean,
): Promise<Record<string, unknown>> {
	const { contents, cdp, path, partPath } = recording;
	const budgetAt = Date.now() + RECORD_STOP_BUDGET_MS;
	let handle = "";
	let fd: number | null = null;
	let createdPart = false;
	let endedAt = recording.startedAt;
	let viewportCleared = false;
	try {
		const stopped = await cdp.send<{ stream?: string }>(
			contents,
			"Page.stopScreenRecording",
			{},
			{ deadlineMs: RECORD_STOP_DEADLINE_MS },
		);
		endedAt = Date.now();
		// AFTER the stop, never before: the last frames must not be rescaled.
		// Restoring here also covers the duration timer, which finalizes without
		// a caller.
		if (recording.viewportToken) {
			await clearViewport(cdp, contents, recording.viewportToken);
			viewportCleared = true;
		}
		handle = typeof stopped?.stream === "string" ? stopped.stream : "";
		if (recording.aborted) throw abortedWhileSaving();
		if (!handle) {
			throw new BrowserHostError(
				"internal",
				"the browser engine returned no recording stream; nothing was saved",
				{ reason: "record_failed" },
			);
		}
		// 0600, as D5 promises for the default directory's files: a clip of a page is
		// the same class of data as a screenshot, and the process umask would
		// otherwise leave it readable by every account on the machine.
		fd = openSync(partPath, "wx", 0o600);
		// From here the part is OURS to delete. A stale `.part` from an earlier
		// crash makes this open throw `EEXIST`, and the failure path must not
		// delete a file this recording never created (review N1).
		createdPart = true;
		const bytes = await readStream(recording, handle, budgetAt, fd);
		if (bytes === 0) {
			throw new BrowserHostError(
				"internal",
				"the recording produced no bytes; nothing was saved",
				{ reason: "record_failed" },
			);
		}
		// An abort that landed during the last page must not publish: it already
		// wrote a tombstone saying nothing was written.
		if (recording.aborted) throw abortedWhileSaving();
		fsyncSync(fd);
		closeSync(fd);
		fd = null;
		try {
			// `linkSync` fails `EEXIST`, which is the overwrite refusal: the target
			// was absent at start but something claimed the name during the clip.
			linkSync(partPath, path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === "EEXIST") {
				throw pathRefusal(
					path,
					`the recording path appeared while recording and is never overwritten: ${path}`,
				);
			}
			throw error;
		}
		try {
			unlinkSync(partPath);
		} catch {
			// The clip is published; a stray dotfile is not worth failing a saved
			// recording over.
		}
		return {
			path,
			bytes,
			duration_ms: endedAt - recording.startedAt,
			auto_stopped: autoStopped,
			...captureShape(sizeOfRecording(recording)),
		};
	} catch (error) {
		throw typedFailure(error);
	} finally {
		// A stop that threw never reached the clear above; a later capture on this
		// tab must not inherit an override nobody asked for.
		if (recording.viewportToken && !viewportCleared) {
			await clearViewport(cdp, contents, recording.viewportToken);
		}
		if (fd !== null) {
			try {
				closeSync(fd);
			} catch {
				// Already closed, or the descriptor went with the failure.
			}
		}
		if (createdPart) {
			try {
				unlinkSync(partPath);
			} catch {
				// The publish already consumed it, or the unlink is not permitted to
				// undo a completed publish — either way the clip is the answer.
			}
		}
		if (handle) {
			try {
				await cdp.send(
					contents,
					"IO.close",
					{ handle },
					{ deadlineMs: CDP_DEADLINE_MS },
				);
			} catch {
				// Chromium drops the stream with the session; a close that cannot
				// complete must not turn a saved clip into an error.
			}
		}
	}
}

/** Record the outcome once and clear the entry, whichever caller got there
 * first (the duration timer or the agent's own `record_stop`). */
function settle(
	webContentsId: number,
	recording: Recording,
	outcome: { result: Record<string, unknown> } | { error: BrowserHostError },
): void {
	if (recordings.get(webContentsId) === recording) {
		recordings.delete(webContentsId);
	}
	if (recording.timer !== undefined) {
		clearTimeout(recording.timer);
		recording.timer = undefined;
	}
	// An aborted recording has already written its own tombstone (or none); a
	// finalize that lands after the abort must not speak for the tab again.
	if (recording.aborted) return;
	settled.set(webContentsId, { owner: recording.owner, ...outcome });
}

/** What ending a stream needs: the attachment and the target, nothing else. */
type Stoppable = Pick<Recording, "cdp" | "contents" | "width" | "height"> & {
	viewportToken?: object;
};

/**
 * End a recording that another owner is taking over, without salvaging its bytes.
 *
 * D7's "abort the old recording (discard), start fresh" assumes the old capture
 * can be discarded; measured on Electron 45.1.0, Chromium keeps the media
 * recorder alive until it is stopped, and the next `Page.startScreenRecording`
 * on that target is refused with "Screencast is already active". So the abort is
 * a stop: bounded at 2 s, best effort, and the stream is closed unread — the
 * bytes are thrown away, which is what discard means.
 */
export async function endReplaced(recording: Stoppable): Promise<void> {
	try {
		// The stop has to reach a target the pool still has a session for; on the
		// replace path it does, and on the cancellation path the handle was just
		// forgotten, so the attachment is re-opened best-effort (a closed tab throws
		// and is caught below).
		await recording.cdp.attach(recording.contents).catch(() => undefined);
		const stopped = await recording.cdp.send<{ stream?: string }>(
			recording.contents,
			"Page.stopScreenRecording",
			{},
			{ deadlineMs: RECORD_ABORT_DEADLINE_MS },
		);
		const handle = typeof stopped?.stream === "string" ? stopped.stream : "";
		if (handle) {
			await recording.cdp
				.send(
					recording.contents,
					"IO.close",
					{ handle },
					{ deadlineMs: RECORD_ABORT_DEADLINE_MS },
				)
				.catch(() => undefined);
		}
	} catch {
		// A session that is already gone cannot be stopped; the start below is where
		// that becomes visible, with Chromium's own words.
	} finally {
		// After the stop attempt, so the discarded frames were captured at the size
		// the request asked for and the tab does not keep it afterwards.
		if (recording.viewportToken) {
			await clearViewport(
				recording.cdp,
				recording.contents,
				recording.viewportToken,
			);
		}
	}
}

/**
 * Discard a recording and END Chromium's recorder for it.
 *
 * The bookkeeping-only abort is right where the handle is already going away
 * (`forget`, `detach`, a closing tab): the session dies with it. It is WRONG where
 * the tab stays alive and attached, because Chromium keeps the media recorder
 * running and the next `Page.startScreenRecording` on that target is refused with
 * "Screencast is already active" (measured; review F1). `endReplaced` is the stop,
 * bounded at `RECORD_ABORT_DEADLINE_MS` per call.
 */
export async function abortAndEnd(
	webContentsId: number,
	reason: string,
): Promise<void> {
	const recording = recordings.get(webContentsId);
	if (!recording) {
		abortRecording(webContentsId, reason);
		return;
	}
	abortRecording(webContentsId, reason);
	await endReplaced(recording);
}

/** Finalize at most once per recording, and share the result. */
function finish(
	webContentsId: number,
	recording: Recording,
	autoStopped: boolean,
): Promise<Record<string, unknown>> {
	if (!recording.finishing) {
		recording.finishing = runFinalize(recording, autoStopped);
		void recording.finishing.then(
			(result) => settle(webContentsId, recording, { result }),
			(error: unknown) =>
				settle(webContentsId, recording, { error: typedFailure(error) }),
		);
	}
	return recording.finishing;
}

/**
 * Start a recording on one tab.
 *
 * Order is the contract: the same-owner refusal and the path/limit checks run
 * before any CDP call, so a refusal costs the tab nothing; the replace of
 * another owner's recording happens only once this start is known to be
 * permitted; and the entry is registered after Chromium accepted, so a start
 * that failed leaves no state a later stop could misread.
 */
export async function recordStart(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const tab = ctx.registry.requireSurface(String(params.tab ?? ""));
	const contents = tab.view.webContents;
	const id = contents.id;
	const owner = requesterOf(params, requestId);
	const active = recordings.get(id);
	if (active) {
		if (active.owner === owner) {
			// `age_ms` is integer milliseconds and is part of the frozen contract: a
			// harness reads it to age the refusal, so a seconds field would be a
			// second contract (review N3).
			const ageMs = Math.max(0, Math.round(Date.now() - active.startedAt));
			throw new BrowserHostError(
				"busy",
				`a recording is already running on this tab for this session: ${active.path} (${Math.round(ageMs / 1000)}s into its ${active.maxDurationS}s cap). Stop it with record_stop before starting another.`,
				{ reason: "record_active", path: active.path, age_ms: ageMs },
			);
		}
	}
	// The size is validated before anything with a side effect: a refusal must
	// cost the tab no CDP call (RS1/RS2).
	const size = sizeOf(params);
	if (size && tab.presented) {
		throw sizeRefusal(
			"visible",
			"size",
			`record_start cannot grow the tab the user is looking at to ${size.width}x${size.height}: that view is the app's own content area. Activate another tab, or omit width/height for a 1280x720 clip.`,
		);
	}
	const path = preflightPath(params);
	const maxDurationS = durationOf(params);
	const maxBytes = maxBytesOf(params);
	// A START ALREADY IN FLIGHT ON THIS TAB. The entry above is only visible once
	// Chromium accepted, so without this a second start on the same tab passes the
	// same check and both proceed (review F3).
	const inFlight = [...reservations.values()].some(
		(entry) => entry.webContentsId === id,
	);
	if (inFlight) {
		throw new BrowserHostError(
			"busy",
			"a recording is already starting on this tab; wait for that start to finish, then use record_stop before starting another. Nothing was started twice.",
			{ reason: "record_active", path },
		);
	}
	// ONE PATH, ONE RECORDING. Two recordings writing one destination would open
	// the same `.<name>.part` and interleave their bytes; a RESERVED start counts
	// too, because it is about to write that path (review N1). The comparison is
	// on resolved paths, or `/d/../d/x.mp4` slips past `x.mp4` (review F2).
	const canonicalPath = resolve(path);
	const pathTaken =
		[...recordings.values()].some(
			(other) => resolve(other.path) === canonicalPath,
		) ||
		[...reservations.values()].some(
			(entry) => resolve(entry.path) === canonicalPath,
		);
	if (pathTaken) {
		throw pathRefusal(
			path,
			`this path is already being recorded: ${path}. Choose another name; a recording is never overwritten or shared.`,
		);
	}
	// THE SLOT IS COUNTED BEFORE THE FIRST `await`, and the reservation carries
	// this start's path. Four calls that arrive together all see the same size
	// otherwise, and the cap holds only by luck (review M1).
	const effective = recordings.size - (active ? 1 : 0) + reservations.size;
	if (effective >= MAX_CONCURRENT_RECORDINGS) {
		throw new BrowserHostError(
			"busy",
			`${MAX_CONCURRENT_RECORDINGS} recordings are already running, which is this host's cap; stop one with record_stop and retry. Nothing was started.`,
			{ reason: "record_limit", limit: MAX_CONCURRENT_RECORDINGS },
		);
	}
	// The provisional large-clip rule (RS5): the probe measured 227 % CPU and
	// about 370-390 MB RSS for ONE 4K encoder (374 MB at 6 s, 389 MB at 30 s), so
	// two at once are not a shape to discover in a user's session. Counted
	// synchronously with the reservation below, for the same reason as the global
	// cap. The active entry on THIS tab is being replaced, so it does not count
	// against this start.
	if (size && isLarge(size)) {
		const largeRunning = [...recordings.values()].filter(
			(other) => other !== active && isLargeRecording(other),
		).length;
		const largeStarting = [...reservations.values()].filter(
			(entry) => entry.large,
		).length;
		if (largeRunning + largeStarting >= MAX_CONCURRENT_LARGE_RECORDINGS) {
			throw new BrowserHostError(
				"busy",
				`a recording larger than 1920x1080 is already running, and this host allows ${MAX_CONCURRENT_LARGE_RECORDINGS} at a time; stop it with record_stop, ask for 1920x1080 or smaller, or omit width/height. Nothing was started.`,
				{ reason: "record_limit", limit: MAX_CONCURRENT_LARGE_RECORDINGS },
			);
		}
	}
	if (active) {
		// The other owner's session is gone (the wedge `owner_recover` exists to
		// avoid), so its recording is discarded rather than allowed to block this
		// tab forever. The abort is synchronous, so the slot above is already free.
		abortRecording(id, "replaced_by_another_owner");
	}
	const reservation = `${Date.now()}-${Math.random()}`;
	const entry = {
		webContentsId: id,
		path,
		cancelled: false,
		large: size !== null && isLarge(size),
	};
	reservations.set(reservation, entry);
	// The size the layout poll confirmed; `size` itself for the unsized path,
	// where nothing is polled and the ceiling stays in force.
	let measured = size;
	/** The token of THIS start's viewport claim, once one is installed. */
	let viewportToken: object | undefined;
	let started = false;
	try {
		// The abort above drops our state; this ends the recorder itself, which is
		// what lets the next start succeed on the same target.
		if (active) await endReplaced(active);
		await ctx.cdp.attach(contents);
		// A sized start is a real viewport change (measured: the page reflows and
		// fires one resize event), applied BEFORE the recorder starts so the
		// encoder sees the requested surface from its first frame.
		if (size) {
			viewportToken = await installViewport(ctx.cdp, contents, size);
			measured = await waitForViewport(ctx.cdp, contents, size);
			// The poll proved the page's geometry; this proves the compositor has a
			// frame at it, which is what the encoder's first frame must show (Q1).
			await waitForCompositedFrame(ctx.cdp, contents, measured);
		}
		try {
			await ctx.cdp.send(
				contents,
				"Page.startScreenRecording",
				{
					audio: false,
					maxWidth: measured?.width ?? RECORD_WIDTH,
					maxHeight: measured?.height ?? RECORD_HEIGHT,
					frameRate: RECORD_FPS,
				},
				{ deadlineMs: RECORD_START_DEADLINE_MS },
			);
			started = true;
		} catch (error) {
			throw classifyStartFailure(error);
		}
	} catch (error) {
		reservations.delete(reservation);
		// Every failed start restores the viewport; clearViewport is best effort
		// and never masks the error this start is about to report.
		if (size && viewportToken) {
			await clearViewport(ctx.cdp, contents, viewportToken);
		}
		throw error;
	}
	// The tab was released while this start was in flight (`forget`/`detach`, or a
	// DevTools detach): registering now would leave a recording on a handle nobody
	// can stop. Chromium may have started the capture anyway, so it is ended before
	// the refusal returns (review F4).
	if (entry.cancelled) {
		reservations.delete(reservation);
		// endReplaced stops the recorder, then restores the viewport; a start that
		// never reached Chromium has no stream to stop and is restored directly.
		if (started) {
			await endReplaced({
				cdp: ctx.cdp,
				contents,
				width: measured?.width,
				height: measured?.height,
				viewportToken,
			});
		} else if (size && viewportToken) {
			await clearViewport(ctx.cdp, contents, viewportToken);
		}
		throw new BrowserHostError(
			"internal",
			"that browser tab was released while the recording was starting; nothing was saved. Use 'open' with a URL to get a new tab.",
			{ reason: "record_failed" },
		);
	}
	const recording: Recording = {
		owner,
		contents,
		cdp: ctx.cdp,
		path,
		partPath: `${dirname(path)}/.${basename(path)}.part`,
		startedAt: Date.now(),
		maxBytes,
		maxDurationS,
		...(measured ? { width: measured.width, height: measured.height } : {}),
		...(viewportToken ? { viewportToken } : {}),
		timer: undefined,
		finishing: null,
		aborted: false,
	};
	recordings.set(id, recording);
	// The entry now carries the slot; the reservation has done its job.
	reservations.delete(reservation);
	recording.timer = setTimeout(() => {
		// The timer is not a command, so it cannot hold the tab lane; it finalizes
		// through the same `finish` a stop uses, which is what makes the stream
		// stop exactly once. `unref` so a pending clip cannot keep the app alive.
		void finish(id, recording, true).catch(() => undefined);
	}, maxDurationS * 1000);
	recording.timer.unref?.();
	return {
		recording: true,
		path,
		max_duration_s: maxDurationS,
		max_bytes: maxBytes,
		...captureShape(measured),
	};
}

/**
 * Stop the recording this requester owns, or explain why there is none.
 *
 * A tombstone is consumed exactly once, so "the same error after a second stop"
 * is `record_not_active` rather than a repeated story about a clip that is
 * already gone (D7).
 */
export async function recordStop(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const tab = ctx.registry.requireSurface(String(params.tab ?? ""));
	const id = tab.view.webContents.id;
	const owner = requesterOf(params, requestId);
	const recording = recordings.get(id);
	if (recording) {
		// A non-owner gets the same answer as nobody: the tab's owner is not the
		// caller's business (D7).
		if (recording.owner !== owner) throw notActive();
		try {
			return await finish(id, recording, false);
		} finally {
			// The caller holds the answer, so the tombstone this finalize wrote is
			// redundant: a second stop must say "nothing is running", not repeat a
			// failure the caller already read (D7's "same error after a second stop"
			// applies to `record_not_active`). An AUTO-stop keeps its tombstone,
			// because nobody was there to read it.
			settled.delete(id);
		}
	}
	const pending = settled.get(id);
	if (settled.has(id) && pending?.owner === owner) {
		settled.delete(id);
		if ("error" in pending) throw pending.error;
		return pending.result;
	}
	throw notActive();
}

/**
 * What the tombstone says about why the debugger connection ended.
 *
 * It deliberately does NOT name a cause. Electron 45.1.0 emits the `detach` event
 * with the constant reason `"target closed"` whatever happened, a DevTools
 * takeover included (`electron_api_debugger.cc`, per the round-2 review), so the
 * reason cannot tell a closed page from a DevTools window and a sentence that
 * claimed to would sometimes be wrong. The raw reason stays in the message so a
 * reader can see exactly what Electron said.
 */
function detachExplanation(): string {
	return "The debugger connection to the tab ended (the page went away, or DevTools took it)";
}

/**
 * Discard a recording because the debugger lifecycle ended under it (D7).
 *
 * Called from `CdpPool.dropCaptures`, so every boundary that ends the
 * attachment ends the encoder with it. The timer is cleared here and not left
 * to fire against a recording nobody owns.
 *
 * `options.tombstone` is for the detach EVENT: the tab survives a DevTools
 * attach, so a later `record_stop` can be answered with what happened. `forget`
 * and `detach` pass nothing and also DROP an older tombstone — the handle is
 * gone there, and there is nothing left to tell.
 */
export function abortRecording(
	webContentsId: number,
	reason: string,
	options: { tombstone?: boolean; clearSettled?: boolean } = {},
): void {
	// A start in flight for this tab is cancelled with the handle: if its CDP call
	// still lands, it must not register a recording nobody can stop (review F4).
	for (const [token, entry] of reservations) {
		if (entry.webContentsId === webContentsId) {
			entry.cancelled = true;
			reservations.delete(token);
		}
	}
	const recording = recordings.get(webContentsId);
	if (recording) {
		recording.aborted = true;
		if (recording.timer !== undefined) {
			clearTimeout(recording.timer);
			recording.timer = undefined;
		}
		// Dropped BEFORE the clear, so a clear that re-enters this function through
		// `send -> forget -> dropCaptures` finds no recording to abort again (review
		// m2).
		recordings.delete(webContentsId);
		// A detach or close drops the session's emulation with it, but a replace or
		// a document refusal keeps the tab, and a later capture must not inherit a
		// size nobody asked for. Best effort on this synchronous path: the promise
		// swallows every failure, and the token check inside makes a superseded
		// recording's clear a no-op (review M1).
		if (recording.viewportToken) {
			void clearViewport(
				recording.cdp,
				recording.contents,
				recording.viewportToken,
			);
		}
	}
	if (options.tombstone && recording) {
		settled.set(webContentsId, {
			owner: recording.owner,
			error: new BrowserHostError(
				"internal",
				`${detachExplanation()}; the recording was discarded (${reason}). Nothing was written.`,
				{ reason: "record_aborted", detail: reason },
			),
		});
		return;
	}
	// A detach EVENT with no recording running is a hand-over of a tab whose clip
	// already finished and that its owner has not collected yet. Deleting that
	// result would answer the next `record_stop` with "nothing is running" and
	// lose the path it earned (review N2). `forget`/`detach` end the handle and
	// pass `clearSettled`, which is where an uncollected result really is dead.
	if (recording || options.clearSettled) settled.delete(webContentsId);
}
