import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { DownloadItemLike } from "./electron-types";
import { BrowserHostError } from "./errors";
import type { FileFact } from "./protocol";
import {
	executableName,
	extensionOf,
	safeName,
} from "./vendor/driver/file-transfer-policy";
import { CAPS } from "./vendor/driver/file-transfer.tables.gen";

/**
 * The app host's download path: `will-download` -> a save path the HARNESS chose.
 * Design: docs/design/browser-file-transfer.md §5.2, §6.1, §8, §10.3, §11.4, §16.4.
 *
 * WHY THIS EXISTS AT ALL, and it is the one thing that makes this host different
 * from the extension: an extension cannot serve `download` at all. Measured
 * 2026-09-18 (design §12.4 E1x, Chrome 153.0.8010.53): `Page.setDownloadBehavior`
 * answers `-32000 "Cannot not access browser-level commands"`, `Browser
 * .setDownloadBehavior` is not found, no browser target is attachable, and no
 * `downloadWillBegin`/`downloadProgress` event is ever delivered — so no
 * extension build can put a file at a path the harness chose, cannot see the
 * suggested filename, and cannot cancel. Electron's session-level `will-download`
 * gives all three, which is why the capability lives here and why
 * `browser_bridge/protocol.py`'s `EXTENSION_CANNOT_SERVE` names this host as the
 * remedy.
 *
 * WHAT THIS MODULE IS NOT ALLOWED TO DECIDE. The authoritative policy is Python's
 * (`local_operator/browser_files.py`), applied to the landed artifact: it is the
 * only side that can read the bytes, stat the real path and delete the file, and
 * it is one implementation for both hosts. This module does exactly the two
 * things a host can honestly do — refuse an obviously-unwanted NAME before it
 * lands (§5.2) and enforce the caps where the platform lets it cap BEFORE the
 * write (§10.3) — and reports facts about everything else. It never classifies
 * content, never decides a verdict and never invents a destination: the directory
 * is the `dir` parameter, which the harness composes from its own config root.
 *
 * WHY THE CAP CAN BE HONEST EARLIER HERE THAN IN THE EXTENSION. `item
 * .getTotalBytes()` is available before the write, so an over-cap download is
 * cancelled without touching the disk. The extension cannot do this at all (it
 * sees no download event), which is why §10.3's post-hoc cap is the extension
 * story and R2's "exists on disk for milliseconds" is its residual risk rather
 * than this host's.
 *
 * AN UNKNOWN SIZE HAS NO PRE-WRITE CAP, AND SO GETS A RUNTIME ONE (review round
 * 1, B1). Electron reports -1 for a chunked response with no `Content-Length`,
 * and the earlier version of this module accepted those downloads uncapped: the
 * write had no upper bound at all and nothing ever cancelled it, so a hostile
 * page could fill the disk unattended. Python's `stat()` cap cannot be the
 * answer — it deletes a file it can SEE, and Chromium keeps writing into the
 * unlinked inode, so the harness's per-session ceiling (a directory measurement)
 * is blind to it and the loop is repeatable. The ceiling is therefore enforced
 * while the bytes arrive (`item.on("updated")` + `item.cancel()` at the limit),
 * which is the only place a host can bound a length it was never told.
 *
 * A WRITE THIS HOST CANCELS IS NOT A FILE, AND IS NOT LEFT ON DISK. Every cancel
 * path (`updated` over the cap, the deadline, a page's own cancellation, a call
 * that goes away) reports what happened by NAME and discards the partial. That is
 * not the deletion §5.3 reserves to Python: that rule is about the VERDICT on a
 * completed file, which this host still never makes. A partial is the residue of
 * a write that did not become a file, and a `setSavePath` write is created at its
 * final name — so the alternative is a complete-looking name whose bytes are a
 * prefix, which is the file a person double-clicks.
 */

/** How long the tab must stay quiet, after the last tracked download finished,
 * before a call is answered.
 *
 * WHY A QUIET WINDOW rather than waiting out the whole `timeout_s`: a download
 * call waits up to 120 s, and answering only at the ceiling would make every
 * ordinary download take two minutes. WHY NOT "the first file that lands": one
 * click routinely starts several — §10.3's `DOWNLOAD_MAX_FILES_PER_CALL` exists
 * because "one page can start many downloads from one click", and the 2026-09-18
 * receipts case is exactly that. A page that staggers its downloads further apart
 * than this is answered by a second call, which the model can issue; a window
 * long enough for every conceivable page would make the common case slow.
 *
 * The window is measured from the moment the tab has NO download in flight, so a
 * second file that starts while the first is still writing joins this call rather
 * than the next one. */
const QUIET_MS = 1500;

/** How many decisions the UI surface keeps to show the user, newest last.
 *
 * Bounded because this is a notification strip, not a history: the audit trail is
 * `audit.jsonl` (§10.5) and the row's job is "what just happened", which one
 * screenful covers. */
const NOTES_KEPT = 4;

/** How often a still-writing transfer may re-render the strip.
 *
 * `updated` fires per progress chunk — thousands of times on a large file — and
 * every render is an IPC message to the renderer, so progress is reported on a
 * timer rather than per chunk. Short enough that the line moves, long enough that
 * a 40 MB download is not thousands of messages (review round 1, U6). */
const PROGRESS_RENDER_MS = 250;

/** What the `download` method answers (design §6.1, mirrored in `protocol.ts`). */
export interface DownloadCaptureResult {
	files: FileFact[];
	armed: boolean;
	reason: string;
}

/** The answer to one download attempt. `cancel: true` is what this host did for
 * EVERY download before this feature existed (`profile.ts`'s unconditional
 * `preventDefault`), and it stays the answer for a download on a tab that is not
 * armed. */
export interface DownloadDecision {
	cancel: boolean;
	/** Model-facing explanation; "" when the attempt was accepted. */
	reason: string;
}

/** The rule a refusal came from, plus the facts the ROW's own sentence needs.
 *
 * WHY THE NOTE CARRIES A RULE RATHER THAN ONLY A SENTENCE (review round 1, D1 and
 * D3). One sentence has to serve two readers with opposite needs: the MODEL reads
 * `reason`, where the exact byte counts belong ("is 268435457 bytes" is the fact
 * that tells it what happened), and a PERSON reads the strip, where two nine-digit
 * numbers differing by one are unreadable by construction — 256.0000009 MiB and
 * 256 MiB render as the same number in every human unit — and where the
 * consequence at the END of a long sentence is exactly what `truncate` eats first.
 * So `reason` stays the tool result's sentence verbatim, and the row composes its
 * own from this rule and these facts: the name and the rule may elide, and the
 * consequence is the part that never does. */
export interface TransferRefusal {
	rule: "executable" | "limit" | "count" | "write" | "interrupted" | "deadline";
	/** The file's own size, in bytes, where the host knows it (0 otherwise). */
	bytes: number;
	/** The cap that fired, in its own unit: bytes for `limit`, files for `count`,
	 * seconds for `deadline`. */
	limit: number;
}

/** One row for the UI surface (§16.4): what landed, was refused, or was SENT, and
 * where it went.
 *
 * WHY IT CARRIES A DIRECTION (review round 1, D2 and U3). One strip speaks for
 * both file verbs, and this change is the one that made that literal: the upload
 * path had no surface at all, so a file could leave the machine with nothing on
 * screen before or after it. Once the same strip shows both, a sentence about
 * "the limit" with no verb in it is readable as a statement about the upload the
 * user is watching — which is exactly the state frames 04/05 photographed. The
 * direction is what lets the row name which way the bytes went; it is not a label
 * on a list, because there is still no list. */
export interface TransferNote {
	name: string;
	/** How many files this decision covered (an upload call attaches several). */
	count: number;
	/** Where a download went. "" for an upload, which has no destination of ours. */
	dir: string;
	outcome: "saved" | "refused" | "sent";
	reason: string;
	at: number;
	direction: "download" | "upload";
	/** The tab whose decision this was. `activityFor` is asked for ONE tab, so the
	 * strip of the tab the user is looking at cannot narrate a decision taken in
	 * another one (review round 1, D2: `notes` and `captures` are host-wide, and
	 * the row rendered all of it into every browser tab's chrome). */
	tabId: number;
	/** The site an upload went to, for the row's own line. */
	site: string;
	/** Which rule refused it, and the numbers the row's sentence needs. Null on a
	 * note that was not refused. */
	refusal: TransferRefusal | null;
}

/** The transfer in flight, with the progress the row needs to say something other
 * than "still going" (review round 1, U6: one static line on a 40 MB file is
 * indistinguishable from a hung one). `total` is 0 when the response declared no
 * length — which by then is a fact the row can state rather than hide. */
export interface ActiveTransfer {
	name: string;
	received: number;
	total: number;
}

/** What the chrome row renders: the transfer in flight, where downloads go, and
 * the last few decisions OF ONE TAB, newest-first. */
export interface TransferActivity {
	active: ActiveTransfer | null;
	dir: string | null;
	notes: TransferNote[];
}

/** One accepted download still writing. `weCancelled` is what separates a write
 * THIS host cancelled from one the page or Chromium ended: the first is reported
 * where the cancel happened (so the sentence survives the call answering before
 * the `done` event), and the second is reported by the `done` handler. */
interface LiveDownload {
	item: DownloadItemLike;
	savePath: string;
	weCancelled: boolean;
}

interface Capture {
	tabId: number;
	dir: string;
	timeoutMs: number;
	startedAt: number;
	/** Files accepted and completed, in landing order. */
	files: FileFact[];
	/** Refusals, in the order they happened, each a model-facing sentence. */
	refusals: string[];
	/** Downloads accepted and still writing. */
	pending: number;
	/** Whether the page has started anything at all. */
	started: boolean;
	/** Every accepted download that is still writing, with the path it was given,
	 * so a settle or a forget can CANCEL it instead of letting a write nobody is
	 * waiting for land unjudged (review round 1, B1 and M1). */
	live: LiveDownload[];
	/** The paths this capture has already promised Chromium. A RESERVATION, not a
	 * probe: Chromium creates the file after `setSavePath` returns, so two accepted
	 * downloads of one name can both find the disk empty and both be handed the same
	 * path (review round 1, Q1/M4 — the silent overwrite §11.4 forbids). */
	handedOut: Set<string>;
	/** What the row says is in flight, and how far along it is. */
	active: ActiveTransfer | null;
	/** When the row was last refreshed from `updated`, for the render throttle. */
	lastProgressAt: number;
	quietTimer: ReturnType<typeof setTimeout> | null;
	deadlineTimer: ReturnType<typeof setTimeout> | null;
	finish: (() => void) | null;
	settled: boolean;
}

/** What a caller holds between `arm` and `release`. */
export interface DownloadArm {
	/** Resolves when the tab has been quiet for the quiet window, or when the
	 * call's own timeout expires. Never rejects: a page that starts no download is
	 * an ANSWER (§7.4's "no download started" row), not a fault. */
	done(): Promise<DownloadCaptureResult>;
}

export interface DownloadArmerOptions {
	/** The tab a webContents belongs to, or null when it is not one of ours. */
	tabForWebContents: (webContentsId: number) => number | null;
	log: (message: string) => void;
	/** Called whenever the surface's state changes (arm, accept, refusal, finish),
	 * so the chrome can re-render the row without polling. */
	onActivity?: () => void;
	now?: () => number;
	/** Overridable so the desktop suite is not slowed by real waiting; production
	 * always takes the module constant. */
	quietMs?: number;
}

/**
 * The per-tab arming state for `download`, and the `will-download` decision
 * behind it.
 *
 * ONE ARM PER TAB, and that is a rule rather than a limitation: `download` takes
 * the tab's command lane (`host.ts`'s `TAB_SCOPED`), so two calls cannot be armed
 * on one tab at once, and an arm whose call is gone must not keep capturing —
 * which is what `forget` in the action's `finally` guarantees. A download on a
 * tab with no live arm is CANCELLED, because "a page wrote a file nobody asked
 * for" is precisely the outcome the pre-feature `preventDefault` existed to
 * prevent.
 *
 * IT ALSO OWNS THE STRIP'S NOTES FOR BOTH DIRECTIONS (§16.4, review round 1,
 * U3). The notes live here rather than in a second store because the strip is ONE
 * surface: an upload note written anywhere else would be a second projection of
 * "what just happened to a file", which is the disagreement
 * `browser-projection-store.ts`'s rule exists to prevent. The DOWNLOAD half alone
 * is what arms and tracks; `noteUpload` records the other half, which never lands
 * on disk here and so has no item to track.
 */
export class DownloadArmer {
	private readonly captures = new Map<number, Capture>();
	private readonly notes: TransferNote[] = [];

	constructor(private readonly options: DownloadArmerOptions) {}

	/** Arm one tab. `dir` is the harness-composed directory (§10.2); it is created
	 * 0700 if missing, because the harness composes it and a race with a session's
	 * own cleanup must not cost the user the file.
	 *
	 * TWO RULES ABOUT THAT DIRECTORY (review round 1, M3), and both exist because
	 * this is the last place between a wire parameter and a `chmod`. ABSOLUTE: a
	 * relative `dir` resolves against the APP's working directory rather than the
	 * session's, which is the shape `upload` already refuses for its own paths. And
	 * the MODE IS ASSERTED ONLY ON A DIRECTORY THIS CALL CREATED: re-moding an
	 * existing path the harness composed — or a symlink to one — would be a chmod on
	 * something this host does not own.
	 */
	arm(tabId: number, dir: string, timeoutMs: number): DownloadArm {
		if (!isAbsolute(dir)) {
			throw new BrowserHostError(
				"internal",
				"download needs an absolute directory to write into",
				{ param: "dir" },
			);
		}
		this.forget(tabId);
		const created = !existsSync(dir);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (created) chmodSync(dir, 0o700);
		const now = this.options.now ?? Date.now;
		const capture: Capture = {
			tabId,
			dir,
			timeoutMs,
			startedAt: now(),
			files: [],
			refusals: [],
			pending: 0,
			started: false,
			live: [],
			handedOut: new Set<string>(),
			active: null,
			lastProgressAt: 0,
			quietTimer: null,
			deadlineTimer: null,
			finish: null,
			settled: false,
		};
		this.captures.set(tabId, capture);
		const deadline = setTimeout(() => this.settle(capture), timeoutMs);
		deadline.unref?.();
		capture.deadlineTimer = deadline;
		this.options.log(
			`[browser] armed downloads on tab ${tabId} into ${dir} for ${Math.round(timeoutMs / 1000)}s`,
		);
		this.options.onActivity?.();
		return {
			done: () =>
				new Promise<DownloadCaptureResult>((resolve) => {
					const answer = (): void => {
						capture.settled = true;
						resolve(this.resultOf(capture));
					};
					if (capture.settled) answer();
					else capture.finish = answer;
				}),
		};
	}

	/** Drop one tab's arm and stop tracking it. Called from the action's `finally`
	 * and from the single tab-removal path, so a closed tab cannot leave a live
	 * capture behind. */
	forget(tabId: number): void {
		const capture = this.captures.get(tabId);
		if (!capture) return;
		this.captures.delete(tabId);
		this.clearTimers(capture);
		// A WRITE NOBODY IS WAITING FOR MUST NOT LAND (review round 1, B1/M1). Three
		// paths arrive here — a closed tab, a click that refused, and the action's own
		// `finally` — and every one of them can arrive with a download still writing.
		// Left alone that write lands after this call's answer: nothing classifies it,
		// nothing names it, and nothing asserts its mode.
		this.cancelLive(
			capture,
			"was still being written when the download call ended",
		);
		if (!capture.settled) {
			capture.settled = true;
			capture.finish?.();
		}
	}

	/**
	 * Decide one download attempt. THE ONLY ENTRY POINT `profile.ts` calls.
	 *
	 * The order is deliberate and is the design's: the NAME first (cheapest, and
	 * the only check that can refuse a `.url`/`.reg`/`.command`, whose bytes are
	 * plain text), then the CAP before the write, then the save path.
	 */
	decide(item: DownloadItemLike, webContentsId: number): DownloadDecision {
		const tabId = this.options.tabForWebContents(webContentsId);
		const capture = tabId === null ? undefined : this.captures.get(tabId);
		if (!capture || capture.settled) {
			return { cancel: true, reason: "no download call is armed on this tab" };
		}
		const raw = item.getFilename();
		const clean = safeName(raw);
		if (executableName(raw)) {
			return this.refuse(
				capture,
				clean,
				`refused: \`${clean}\` is an executable/script type; nothing was saved`,
				{ rule: "executable", bytes: item.getTotalBytes(), limit: 0 },
			);
		}
		if (
			capture.files.length + capture.pending >=
			CAPS.downloadMaxFilesPerCall
		) {
			return this.refuse(
				capture,
				clean,
				// The row shows this verbatim, so it is written for a person who just
				// clicked something rather than in tool-call jargon (review round 1, D1):
				// "call" and "landed" described the MODEL's call, and a user reading the
				// strip made neither.
				`refused: this download call has already saved its limit of ${CAPS.downloadMaxFilesPerCall} files; nothing was saved`,
				{
					rule: "count",
					bytes: 0,
					limit: CAPS.downloadMaxFilesPerCall,
				},
			);
		}
		const total = item.getTotalBytes();
		if (total > CAPS.downloadMaxBytes) {
			// THE RULE AND THE RELATIONSHIP, not two raw byte counts (review round 1,
			// D1). Stating the size and the cap as nine-digit numbers differing by one
			// read as a self-contradiction, and a single-unit rendering of both would
			// read as one too — 268435457 bytes and 268435456 bytes are the same number
			// in every human unit. So the limit is named as a unit and the file is
			// reported as ITS EXACT SIZE BESIDE THE CONSEQUENCE, which is the half a
			// truncated row must not lose.
			return this.refuse(
				capture,
				clean,
				`refused: \`${clean}\` is over the ${humanBytes(CAPS.downloadMaxBytes)} per-file download limit; nothing was saved (it is ${total} bytes)`,
				{ rule: "limit", bytes: total, limit: CAPS.downloadMaxBytes },
			);
		}
		const savePath = this.uniquePath(capture, clean, raw);
		try {
			item.setSavePath(savePath);
		} catch (error) {
			// A `setSavePath` that throws (a directory that vanished between the arm and
			// the write) must CANCEL rather than let Chromium fall back to the user's own
			// Downloads folder: the whole point of this path is that the destination is
			// one the harness chose.
			return this.refuse(
				capture,
				clean,
				`refused: \`${clean}\` could not be saved — the download folder could not be written to (${describe(error)}); nothing was saved`,
				{ rule: "write", bytes: item.getTotalBytes(), limit: 0 },
			);
		}
		this.track(item, capture, savePath);
		// THE RESERVATION, and it has to happen AFTER `setSavePath` (review round 1,
		// Q1/M4): Chromium creates the file only once the item accepted the path, so a
		// probe of the disk cannot see the first of two same-named downloads that are
		// both in flight. What the capture keeps is what it has PROMISED, and the next
		// `uniquePath` for the same name probes that as well as the filesystem.
		capture.handedOut.add(savePath);
		return { cancel: false, reason: "" };
	}

	/** What the chrome row renders for ONE tab (§16.4).
	 *
	 * WHY PER TAB (review round 1, D2): `captures` and `notes` are host-wide, and
	 * the row rendered both into EVERY browser tab's chrome — so the strip of the
	 * tab the user is watching could narrate a decision taken in another one, and
	 * did exactly that in the published frames (`04` showed a refusal above a form
	 * holding three attached files). The active tab is the row's subject.
	 *
	 * `null` is "no tab is active", which renders nothing: the strip belongs to a
	 * tab, and there is no tab to speak for.
	 */
	activityFor(tabId: number | null): TransferActivity {
		const capture = tabId === null ? undefined : this.captures.get(tabId);
		return {
			active: capture?.active ?? null,
			// The DIRECTORY is reported from a live capture even before anything has
			// started, so the reveal is available for the whole of a call rather than
			// only after the first file lands. The NAME is not: "Downloading <a
			// directory>" would be a row that appears before the page has decided to
			// download anything.
			dir: this.downloadDir(capture),
			notes:
				tabId === null
					? []
					: this.notes.filter((note) => note.tabId === tabId).reverse(),
		};
	}

	/** The directory the reveal opens (§16.4): the live arm's, else the newest one a
	 * decision used.
	 *
	 * HOST-WIDE ON PURPOSE, which is why it is not `activityFor`'s own field: the
	 * button is about the FOLDER the host writes into, not about a tab. Upload notes
	 * carry no directory, so they cannot answer for one. */
	downloadDir(capture?: Capture): string | null {
		const dirs = this.notes.filter((note) => note.dir !== "").map((n) => n.dir);
		return (
			capture?.dir ??
			[...this.captures.values()].at(-1)?.dir ??
			dirs.at(-1) ??
			null
		);
	}

	/** One upload's own line (review round 1, U3).
	 *
	 * WHY AN UPLOAD HAS A NOTE AT ALL, when §16.4 deliberately has no upload
	 * affordance: the surface asymmetry was defensible while nothing was going
	 * wrong, but an upload is the more dangerous verb — and the QA matrix showed
	 * three files leaving the machine with the strip silent, or (worse) still
	 * narrating an unrelated download refusal while they left. One line naming what
	 * went where is not the per-file list §16.4 rules out; it is the same rule the
	 * download half follows, applied to the half that had none.
	 *
	 * The SITE comes from the page the action actually reported (never from a URL a
	 * caller composed), and the names are the sanitised ones the host attached. */
	noteUpload(tabId: number, files: FileFact[], site: string): void {
		if (files.length === 0) return;
		this.notes.push({
			name: files[0]?.name ?? "",
			count: files.length,
			dir: "",
			outcome: "sent",
			reason: "",
			at: (this.options.now ?? Date.now)(),
			direction: "upload",
			tabId,
			site,
			refusal: null,
		});
		while (this.notes.length > NOTES_KEPT) this.notes.shift();
		this.options.onActivity?.();
	}

	// ---- the item lifecycle --------------------------------------------------

	private track(
		item: DownloadItemLike,
		capture: Capture,
		savePath: string,
	): void {
		capture.started = true;
		capture.pending += 1;
		const entry: LiveDownload = { item, savePath, weCancelled: false };
		capture.live.push(entry);
		this.showProgress(capture, entry);
		if (capture.quietTimer) {
			// A second file starting cancels the pending answer: the call is not over
			// until the page stops starting downloads.
			clearTimeout(capture.quietTimer);
			capture.quietTimer = null;
		}
		this.options.onActivity?.();

		// THE RUNTIME CAP (review round 1, B1). A chunked response reports -1 from
		// `getTotalBytes()`, so the pre-write cap above could not fire and NOTHING else
		// bounded the write: the disk filled while the model was told the file had been
		// refused and deleted, and the harness's per-session ceiling measures the
		// directory, which an unlinked file is invisible to. So the running total is
		// checked as the bytes arrive and the write is CANCELLED AT the limit rather
		// than after it — the only ceiling available for a length the server never
		// declared.
		item.on("updated", () => {
			if (entry.weCancelled) return;
			const name = basename(savePath);
			if (capture.settled) {
				// The answer is out and this write is still going: nothing will classify it
				// (M1), so it is cancelled with the sentence the settle's own cancel path
				// would have used.
				this.cancelEntry(capture, entry);
				return;
			}
			if (item.getReceivedBytes() > CAPS.downloadMaxBytes) {
				this.refuseLive(
					capture,
					entry,
					`\`${name}\` went over the ${humanBytes(CAPS.downloadMaxBytes)} per-file download limit while it was being written`,
					{
						rule: "limit",
						bytes: item.getReceivedBytes(),
						limit: CAPS.downloadMaxBytes,
					},
				);
				return;
			}
			this.showProgress(capture, entry);
		});

		item.once("done", (_event: unknown, state: string) => {
			capture.pending -= 1;
			capture.live = capture.live.filter((live) => live !== entry);
			const name = basename(savePath);
			// `weCancelled` FIRST, and it is what makes the deadline case reportable at
			// all: our own cancel happens BEFORE the answer is sent (so the sentence
			// survives it), and the `done` event it produces must not write a second
			// note when it arrives after the call has already answered (review round 1,
			// U1: an aborted download ended with no row, no note, and a partial file on
			// disk under a complete-looking name).
			if (entry.weCancelled) {
				discardPartial(savePath, this.options.log);
			} else if (state === "completed") {
				// 0600, asserted rather than inherited from the process umask (§4(c): the
				// quarantine is "private by construction: created 0700, files 0600"). Chromium
				// creates the file with the umask's mode, and the directory's 0700 already
				// keeps it unreachable by another user, so this is the second half of a promise
				// the design states rather than the load-bearing half. It is BEST EFFORT for
				// the same reason the audit append is: a chmod that failed would otherwise cost
				// the user a file that did land.
				restrictMode(savePath, this.options.log);
				capture.files.push(fileFact(item, savePath));
				this.note(capture, name, "saved", 1, "", null);
			} else {
				// `cancelled` here is the PAGE's cancellation or Chromium's, never ours (a
				// refused attempt never reaches the item, and ours set `weCancelled`). An
				// interrupted write is REPORTED, and its residue is DISCARDED — a write that
				// did not finish is not a file. That is not the deletion §5.3 reserves to
				// Python: that rule is about the VERDICT on a completed file, which this host
				// still never makes, and a `setSavePath` write is created at its final name,
				// so leaving it is a complete-looking name whose bytes are a prefix.
				const reason = capture.settled
					? `refused: \`${name}\` did not finish (${state}) after this call's answer; the partial file was discarded`
					: `refused: \`${name}\` did not finish (${state}); the partial file was discarded`;
				discardPartial(savePath, this.options.log);
				if (!capture.settled) capture.refusals.push(reason);
				this.note(capture, name, "refused", 1, reason, {
					rule: "interrupted",
					bytes: item.getReceivedBytes(),
					limit: 0,
				});
			}
			this.showProgress(capture);
			this.options.onActivity?.();
			if (!capture.settled && capture.pending === 0) this.armQuiet(capture);
		});
	}

	/** What the row says is in flight, refreshed on the render throttle.
	 *
	 * The LAST tracked item is the one the row names, which is the item a page that
	 * starts several files is currently growing; the byte counts come from the item
	 * itself, never from a sum this module keeps (a sum would be a second account of
	 * the same write). The throttle is what keeps a 40 MB download from sending a
	 * message per chunk to the renderer. */
	private showProgress(capture: Capture, entry?: LiveDownload): void {
		const last = entry ?? capture.live.at(-1);
		capture.active = last
			? {
					name: basename(last.savePath),
					received: last.item.getReceivedBytes(),
					total: last.item.getTotalBytes(),
				}
			: null;
		const now = (this.options.now ?? Date.now)();
		if (now - capture.lastProgressAt < PROGRESS_RENDER_MS) return;
		capture.lastProgressAt = now;
		this.options.onActivity?.();
	}

	/** Cancel one still-writing download, with the deadline's own sentence. */
	private cancelEntry(capture: Capture, entry: LiveDownload): void {
		this.refuseLive(
			capture,
			entry,
			`\`${basename(entry.savePath)}\` was still being written when the ${Math.round(capture.timeoutMs / 1000)}s budget expired`,
			{
				rule: "deadline",
				bytes: entry.item.getReceivedBytes(),
				limit: Math.round(capture.timeoutMs / 1000),
			},
		);
	}

	/** Report a download this host is cancelling, and cancel it.
	 *
	 * ONE PATH FOR ALL THREE KINDS OF CANCEL (the runtime cap, the deadline, the
	 * call going away), because they differ only in the clause that explains them
	 * and a second copy would be a second chance to forget the note, the refusal or
	 * the cancel itself.
	 *
	 * `weCancelled` is set HERE rather than by the callers, and it is what makes the
	 * sentence survivable: the `done` event our own `cancel()` produces arrives after
	 * the answer in the deadline case, and the handler must then discard the residue
	 * without writing a second note. */
	private refuseLive(
		capture: Capture,
		entry: LiveDownload,
		clause: string,
		refusal: TransferRefusal,
	): void {
		entry.weCancelled = true;
		const reason = `refused: ${clause}; it was cancelled and the partial file was discarded`;
		capture.refusals.push(reason);
		this.note(capture, basename(entry.savePath), "refused", 1, reason, refusal);
		this.options.log(`[browser] ${reason}`);
		// ONLY A WRITE STILL IN PROGRESS CAN BE STOPPED, and the item's own state is
		// what says so: `cancel()` on one Chromium has already finished with throws,
		// and the `done` handler's own discard is what removes that case's residue.
		if (entry.item.getState() !== "progressing") return;
		try {
			entry.item.cancel();
		} catch (error) {
			this.options.log(
				`[browser] could not cancel ${basename(entry.savePath)}: ${describe(error)}`,
			);
		}
		// DISCARDED AT THE CANCEL, not only when `done` arrives (review round 1, U1).
		// The answer this cancel precedes is the point at which Python takes its one
		// snapshot of the directory, and a partial left there until Chromium's event
		// lands is a partial the harness can see under a complete-looking name — which
		// is the file a person double-clicks. A write that Chromium reports as COMPLETED
		// is left alone: this host removes residue, never a file.
		if (entry.item.getState() !== "completed") {
			discardPartial(entry.savePath, this.options.log);
		}
		this.options.onActivity?.();
	}

	/** Cancel every download this capture still has writing. */
	private cancelLive(capture: Capture, clause: string): void {
		const live = [...capture.live];
		capture.live = [];
		for (const entry of live) {
			if (entry.weCancelled) continue;
			this.refuseLive(
				capture,
				entry,
				`\`${basename(entry.savePath)}\` ${clause}`,
				{
					rule: "interrupted",
					bytes: entry.item.getReceivedBytes(),
					limit: 0,
				},
			);
		}
	}

	private armQuiet(capture: Capture): void {
		if (capture.quietTimer) clearTimeout(capture.quietTimer);
		const timer = setTimeout(
			() => this.settle(capture),
			this.options.quietMs ?? QUIET_MS,
		);
		timer.unref?.();
		capture.quietTimer = timer;
	}

	/**
	 * Answer the call.
	 *
	 * THE TWO ARMS ARE THE DEADLINE AND THE QUIET WINDOW, and the quiet window never
	 * fires with a write in flight (it is only armed at `pending === 0`), so it always
	 * has the finished files Python is about to inspect. A DEADLINE can arrive
	 * mid-write, and it answers anyway — a call that never returns is worse than one
	 * that admits what it could not finish — after cancelling what was still writing,
	 * because that is the one file the harness could not describe honestly.
	 */
	private settle(capture: Capture): void {
		if (capture.settled) return;
		// CANCEL BEFORE ANSWERING, and this order IS the fix (review round 1, B1 and
		// M1). A download still writing when the call answers is the one file the
		// harness cannot describe honestly: Python takes its single snapshot of the
		// directory immediately after this answer, so a write that finishes later is
		// never classified, never named and never given its 0600 — and a write that is
		// still going at snapshot time is hashed and measured as a PREFIX of the file
		// it becomes. Cancelling here makes both cases unreachable, and the sentence
		// is written here rather than in the `done` handler because in the deadline
		// case that event arrives after the answer is already out.
		if (capture.pending > 0) {
			this.cancelLive(
				capture,
				`was still being written when the ${Math.round(capture.timeoutMs / 1000)}s budget expired`,
			);
		}
		capture.settled = true;
		capture.active = null;
		this.clearTimers(capture);
		capture.finish?.();
		this.options.onActivity?.();
	}

	private resultOf(capture: Capture): DownloadCaptureResult {
		const reasons = [...capture.refusals];
		if (capture.files.length === 0 && reasons.length === 0) {
			const waited = Math.max(
				1,
				Math.round(
					((this.options.now ?? Date.now)() - capture.startedAt) / 1000,
				),
			);
			reasons.push(
				`no download started within ${waited}s; if the page needs a click first, pass a selector, or \`click\` it and retry`,
			);
		}
		return {
			// `armed: false` is a POLICY answer, not a fault (§6.1). The app host always
			// arms when the harness asks it to and reports true; the harness's own
			// pre-arm refusals (its per-call checks before dispatching) are the caller of
			// the other arm.
			armed: true,
			files: capture.files,
			reason: reasons.join("; "),
		};
	}

	private refuse(
		capture: Capture,
		clean: string,
		reason: string,
		refusal: TransferRefusal,
	): DownloadDecision {
		capture.refusals.push(reason);
		this.note(capture, clean, "refused", 1, reason, refusal);
		this.options.log(`[browser] ${reason}`);
		return { cancel: true, reason };
	}

	private note(
		capture: Capture,
		name: string,
		outcome: TransferNote["outcome"],
		count: number,
		reason: string,
		refusal: TransferRefusal | null,
	): void {
		this.notes.push({
			name,
			count,
			dir: capture.dir,
			outcome,
			reason,
			at: (this.options.now ?? Date.now)(),
			direction: "download",
			tabId: capture.tabId,
			site: "",
			refusal,
		});
		while (this.notes.length > NOTES_KEPT) this.notes.shift();
	}

	private clearTimers(capture: Capture): void {
		if (capture.quietTimer) clearTimeout(capture.quietTimer);
		if (capture.deadlineTimer) clearTimeout(capture.deadlineTimer);
		capture.quietTimer = null;
		capture.deadlineTimer = null;
	}

	/**
	 * A path in `dir` that neither exists nor has already been PROMISED in this
	 * capture. The page's name is never obeyed beyond its sanitised basename, and
	 * §11.4's rule is "no silent overwrite": the app host uniquifies with
	 * `name (1).ext` rather than letting a second download of the same name replace
	 * the first.
	 *
	 * THE RESERVATION IS THE FIX, and the earlier comment here was simply wrong
	 * (review round 1, Q1/M4). It claimed two downloads of one name on one tab
	 * "cannot race (an arm accepts them one at a time)" — being DECIDED one at a
	 * time is not being CREATED one at a time: Chromium creates the file after
	 * `setSavePath` returns, so two accepted downloads of one name are both in
	 * flight with the disk still empty, both probe the same path, and the second
	 * silently overwrites the first while the result reports two files at one path.
	 * The probe therefore runs against the filesystem AND against the paths this
	 * capture has already handed out.
	 *
	 * It is still not an atomic create, and that is honest rather than sloppy: the
	 * value is handed to Chromium, which opens the file itself, so a
	 * create-and-release probe would only add a window where the file exists empty.
	 * The reservation closes the window the probe could not see.
	 */
	private uniquePath(capture: Capture, clean: string, raw: string): string {
		const taken = (path: string): boolean =>
			existsSync(path) || capture.handedOut.has(path);
		const first = join(capture.dir, clean);
		if (!taken(first)) return first;
		const dot = clean.lastIndexOf(".");
		const stem = dot > 0 ? clean.slice(0, dot) : clean;
		const ext = dot > 0 ? clean.slice(dot + 1) : "";
		for (let index = 1; index <= 999; index += 1) {
			const candidate = join(
				capture.dir,
				ext ? `${stem} (${index}).${ext}` : `${stem} (${index})`,
			);
			if (!taken(candidate)) return candidate;
		}
		// Every suffix taken: fall back to the sanitiser's own generated name, which
		// is a function of the raw name and cannot collide with a numbered one.
		return join(capture.dir, safeName(raw, extensionOf(raw) || "bin"));
	}
}

/** The fact Python is told about one landed file.
 *
 * `sha256` is deliberately EMPTY: it is computed by Python over the bytes on
 * disk, never reported by a host (§6.1 — a host that reports a hash it did not
 * compute is a host whose word is being trusted, which is the property the
 * post-hoc verification exists to remove). `sniffed` is empty for the same
 * reason: this host observes no content, and "" is the honest value rather than a
 * guess. */
function fileFact(item: DownloadItemLike, savePath: string): FileFact {
	return {
		name: basename(savePath),
		path: savePath,
		bytes: item.getReceivedBytes(),
		mime: item.getMimeType() || "",
		sniffed: "",
		sha256: "",
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A byte count a person reads, ROUNDED DOWN so it can never overstate a limit.
 *
 * Only used for the caps (review round 1, D1/U5): the file's own size is reported
 * in bytes, because a rounded one would contradict the rule it is being compared
 * with — 268435457 bytes and 268435456 bytes are the same number in every human
 * unit, which is how the refusal came to read as a self-contradiction. */
function humanBytes(bytes: number): string {
	const MiB = 1024 * 1024;
	if (bytes >= MiB) return `${Math.floor(bytes / MiB)} MiB`;
	if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KiB`;
	return `${bytes} byte${bytes === 1 ? "" : "s"}`;
}

/** Remove the residue of a write this host knows did not become a file.
 *
 * WHY THIS IS NOT THE DELETION §5.3 RESERVES TO PYTHON: that rule is about the
 * VERDICT on a completed file — only Python reads the bytes and only Python
 * decides — and this function never touches one. What it removes is the partial a
 * `setSavePath` write leaves at its FINAL name, which is the file a person
 * double-clicks and trusts (review round 1, U1). Best effort, and logged: a file
 * the OS will not let us remove must not turn an answered call into a failure. */
function discardPartial(path: string, log: (message: string) => void): void {
	try {
		if (existsSync(path)) {
			unlinkSync(path);
			log(`[browser] discarded the partial download at ${basename(path)}`);
		}
	} catch (error) {
		log(
			`[browser] could not discard the partial download at ${basename(path)}: ${describe(error)}`,
		);
	}
}

/** Force one landed file to 0600, best effort.
 *
 * WHY IT IS NOT AN ERROR WHEN IT FAILS: the file is already inside a directory this
 * host created 0700, so the mode is a second lock on a door that is already shut. A
 * chmod that failed for a reason outside our control (a filesystem without POSIX
 * modes, a file the OS moved) must not turn a successful download into a failed
 * call — the same rule §10.5 gives the audit writer. */
function restrictMode(path: string, log: (message: string) => void): void {
	try {
		chmodSync(path, 0o600);
	} catch (error) {
		log(
			`[browser] could not restrict ${basename(path)} to 0600: ${describe(error)}`,
		);
	}
}
