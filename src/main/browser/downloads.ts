import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DownloadItemLike } from "./electron-types";
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
 * than this host's. When Electron reports an UNKNOWN size (-1: a chunked response
 * with no `Content-Length`) the pre-write cap cannot fire; the file lands and
 * Python's `stat()` cap is the one that catches it, which is REPORTED rather than
 * hidden — the fact carries the bytes that did land.
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

/** One row for the UI surface (§16.4): what landed or was refused, and where. */
export interface DownloadNote {
	name: string;
	dir: string;
	outcome: "saved" | "refused";
	reason: string;
	at: number;
}

/** What the chrome row renders: the download in flight, and the last few
 * decisions newest-first. */
export interface DownloadActivity {
	active: string | null;
	dir: string | null;
	notes: DownloadNote[];
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
	/** The most recent accepted name, for the row. */
	lastName: string;
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
 */
export class DownloadArmer {
	private readonly captures = new Map<number, Capture>();
	private readonly notes: DownloadNote[] = [];

	constructor(private readonly options: DownloadArmerOptions) {}

	/** Arm one tab. `dir` is the harness-composed directory (§10.2); it is created
	 * 0700 if missing, because the harness composes it and a race with a session's
	 * own cleanup must not cost the user the file. The mode is asserted rather than
	 * left to the umask, the same way `session_dir` asserts it on the Python side.
	 */
	arm(tabId: number, dir: string, timeoutMs: number): DownloadArm {
		this.forget(tabId);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		chmodSync(dir, 0o700);
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
			lastName: "",
			quietTimer: null,
			deadlineTimer: null,
			finish: null,
			settled: false,
		};
		this.captures.set(tabId, capture);
		const deadline = setTimeout(() => this.settle(capture, true), timeoutMs);
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
			);
		}
		if (
			capture.files.length + capture.pending >=
			CAPS.downloadMaxFilesPerCall
		) {
			return this.refuse(
				capture,
				clean,
				`refused: this call has already landed ${CAPS.downloadMaxFilesPerCall} files, its per-call limit`,
			);
		}
		const total = item.getTotalBytes();
		if (total > CAPS.downloadMaxBytes) {
			return this.refuse(
				capture,
				clean,
				`refused: \`${clean}\` is ${total} bytes, over the ${CAPS.downloadMaxBytes} byte per-file limit`,
			);
		}
		const savePath = this.uniquePath(capture.dir, clean, raw);
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
				`refused: could not write into the quarantine directory (${describe(error)})`,
			);
		}
		this.track(item, capture, savePath);
		return { cancel: false, reason: "" };
	}

	/** What the chrome row renders (§16.4). */
	activity(): DownloadActivity {
		const live = [...this.captures.values()].find(
			(capture) =>
				capture.files.length > 0 || capture.pending > 0 || capture.started,
		);
		const armed = [...this.captures.values()].at(-1);
		return {
			active: live ? live.lastName || basename(live.dir) : null,
			// The DIRECTORY is reported from the live capture even before anything has
			// started, so the reveal is available for the whole of a call rather than only
			// after the first file lands. The NAME is not: "Downloading <a directory>" would
			// be a row that appears before the page has decided to download anything.
			dir: armed?.dir ?? this.notes.at(-1)?.dir ?? null,
			notes: [...this.notes].reverse(),
		};
	}

	// ---- the item lifecycle --------------------------------------------------

	private track(
		item: DownloadItemLike,
		capture: Capture,
		savePath: string,
	): void {
		capture.started = true;
		capture.pending += 1;
		capture.lastName = basename(savePath);
		if (capture.quietTimer) {
			// A second file starting cancels the pending answer: the call is not over
			// until the page stops starting downloads.
			clearTimeout(capture.quietTimer);
			capture.quietTimer = null;
		}
		this.options.onActivity?.();
		item.once("done", (_event: unknown, state: string) => {
			capture.pending -= 1;
			const name = basename(savePath);
			if (!capture.settled) {
				if (state === "completed") {
					// 0600, asserted rather than inherited from the process umask (§4(c): the
					// quarantine is "private by construction: created 0700, files 0600"). Chromium
					// creates the file with the umask's mode, and the directory's 0700 already
					// keeps it unreachable by another user, so this is the second half of a promise
					// the design states rather than the load-bearing half. It is BEST EFFORT for
					// the same reason the audit append is: a chmod that failed would otherwise cost
					// the user a file that did land.
					restrictMode(savePath, this.options.log);
					capture.files.push(fileFact(item, savePath));
					this.note(capture, name, "saved", "");
				} else {
					// `cancelled` here is the PAGE's cancellation or Chromium's, never ours
					// (an attempt we refuse never reaches the item). An interrupted write must
					// be REPORTED, because Python's directory diff would otherwise see a partial
					// file and no explanation for it. Nothing is deleted here: deletion is
					// Python's, for the reason §5.3 gives — the verdict is built from the
					// filesystem, and a host that deletes what it cannot classify is a second
					// policy.
					const reason = `\`${name}\` did not finish (${state}); nothing was saved`;
					capture.refusals.push(reason);
					this.note(capture, name, "refused", reason);
				}
			}
			this.options.onActivity?.();
			if (!capture.settled && capture.pending === 0) this.armQuiet(capture);
		});
	}

	private armQuiet(capture: Capture): void {
		if (capture.quietTimer) clearTimeout(capture.quietTimer);
		const timer = setTimeout(
			() => this.settle(capture, false),
			this.options.quietMs ?? QUIET_MS,
		);
		timer.unref?.();
		capture.quietTimer = timer;
	}

	/**
	 * Answer the call.
	 *
	 * `forced` is the deadline's arm and `false` is the quiet window's, and the
	 * difference matters: a quiet window never fires with a write in flight (it is
	 * only armed at `pending === 0`), so it always has the finished files Python is
	 * about to inspect. A DEADLINE can arrive mid-write, and it answers anyway —
	 * a call that never returns is worse than one that admits what it could not
	 * finish — with a refusal row naming each file that was still writing.
	 */
	private settle(capture: Capture, forced: boolean): void {
		if (capture.settled) return;
		if (forced && capture.pending > 0) {
			capture.refusals.push(
				`${capture.pending} download(s) were still writing when the ${Math.round(capture.timeoutMs / 1000)}s budget expired; they may land after this answer`,
			);
		}
		capture.settled = true;
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
	): DownloadDecision {
		capture.refusals.push(reason);
		this.note(capture, clean, "refused", reason);
		this.options.log(`[browser] ${reason}`);
		return { cancel: true, reason };
	}

	private note(
		capture: Capture,
		name: string,
		outcome: DownloadNote["outcome"],
		reason: string,
	): void {
		this.notes.push({
			name,
			dir: capture.dir,
			outcome,
			reason,
			at: (this.options.now ?? Date.now)(),
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
	 * A path in `dir` that does not exist yet. The page's name is never obeyed
	 * beyond its sanitised basename, and §11.4's rule is "no silent overwrite": the
	 * app host uniquifies with `name (1).ext` rather than letting a second download
	 * of the same name replace the first.
	 *
	 * The probe is `existsSync` on a bounded loop rather than an atomic create, and
	 * that is honest rather than sloppy: the value is handed to Chromium, which
	 * opens the file itself, so a create-and-release probe would only add a window
	 * where the file exists empty. Two downloads of one name on ONE tab cannot race
	 * (an arm accepts them one at a time), and two tabs do not share a directory.
	 */
	private uniquePath(dir: string, clean: string, raw: string): string {
		const first = join(dir, clean);
		if (!existsSync(first)) return first;
		const dot = clean.lastIndexOf(".");
		const stem = dot > 0 ? clean.slice(0, dot) : clean;
		const ext = dot > 0 ? clean.slice(dot + 1) : "";
		for (let index = 1; index <= 999; index += 1) {
			const candidate = join(
				dir,
				ext ? `${stem} (${index}).${ext}` : `${stem} (${index})`,
			);
			if (!existsSync(candidate)) return candidate;
		}
		// Every suffix taken: fall back to the sanitiser's own generated name, which
		// is a function of the raw name and cannot collide with a numbered one.
		return join(dir, safeName(raw, extensionOf(raw) || "bin"));
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
