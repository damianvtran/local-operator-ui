import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { RETAIN_BYTES } from "./byte-log";
import type { SurfaceOrigin } from "./protocol";

/**
 * Persistence for retained surfaces: the bytes, and the parameters they were
 * created with.
 *
 * Design: docs/design/ui-console-tab.md 7.3 (where it lives, and what "recalled"
 * means across a relaunch), 7.4 (the durability boundary, and the GC), 2.2/2.4
 * (the mode discipline this follows rather than reinvents).
 *
 * TWO FILES PER SURFACE, and the split is the same one §7.1 makes in memory: the
 * `.log` is the byte log (lossless, replayable), and the `.json` sidecar is what
 * the surface *was* — argv, cwd, grid, timestamps, exit code, whether the log was
 * truncated, and its exit GENERATION (`exit_epoch`, §7.3). Reconstruction is
 * replay, so nothing needs a serialised terminal state, which the headless build
 * could not produce anyway (no `addon-serialize`, §5.4).
 *
 * WHY `exit_epoch` LIVES HERE AND NOT ON THE RECORD (§7.3): the counter's job is
 * to outlive the process. A retained surface is replayed under its own handle and
 * may be RUN AGAIN, and only a generation that survived the relaunch can tell
 * that second exit from the first — which is what the dedupe key in §12.3
 * (`(surface, exit_epoch)`) needs. A counter that lived in the live registry
 * would restart at 0 on every launch and make the second exit look like the
 * first.
 *
 * A READ CREATES NOTHING. Every path helper here is pure arithmetic, and the
 * directory is made by the writer that needs it — the rule the bridge's and the UI
 * host's state modules both state, and the reason a listing on a machine with no
 * history leaves nothing behind.
 *
 * MODES: 0700 directory, 0600 files. The bytes of a terminal are as private as
 * the session key that unlocks the socket: a surface the user ran `sudo` in
 * writes its prompt text here, and the design's answer to "who may read a
 * surface" (§11.4) is the same answer as for the discovery record.
 */

/** Where history lives, relative to the local-operator config root. */
export const HISTORY_DIRNAME = join("run", "ui-console", "history");

export const HISTORY_DIR_MODE = 0o700;
export const HISTORY_FILE_MODE = 0o600;

/** The design's default GC window (§7.4). A parameter with a default rather than
 * a constant read at one call site, because the config surface that will own
 * `console.history_days` does not exist yet and inventing an environment variable
 * for it would be a second switch beside the one Settings will carry. */
export const DEFAULT_HISTORY_DAYS = 30;

/**
 * When a `.log` is rewritten down to `RETAIN_BYTES`.
 *
 * The log file is append-only so an ordinary session never rewrites it; past
 * twice the retained window it is rewritten to the newest `RETAIN_BYTES` and the
 * sidecar's `truncated` is set (and never cleared), so what is on disk matches
 * what the design promises a reader will find.
 */
export const HISTORY_ROTATE_BYTES = RETAIN_BYTES * 2;

/** What a sidecar carries. Field names are the wire's, so a listing and a
 * sidecar describe a surface the same way. */
export interface ConsoleHistoryMeta {
	surface: string;
	session_id: string;
	origin: SurfaceOrigin;
	command: string;
	argv: string[];
	cwd: string;
	cols: number;
	rows: number;
	created_at: number;
	last_seen_at: number;
	exit_code: number | null;
	truncated: boolean;
	/** The exit GENERATION of this surface: incremented once per `process_exited`
	 * (§7.3, §10.6). A sidecar written before this field existed reads as 0, which
	 * is why every reader normalises it rather than trusting the file. */
	exit_epoch: number;
}

export interface ConsoleHistoryOptions {
	/** Seconds since the epoch, matching the record's clock. */
	now?: () => number;
}

export interface LoadedSurface {
	meta: ConsoleHistoryMeta;
	bytes: Uint8Array;
}

export interface CollectReport {
	/** Session directories removed, and the surfaces they held. */
	removedSessions: string[];
	removedSurfaces: number;
}

/**
 * The surface handle as a filename stem.
 *
 * `con:3:abc` would be a legal POSIX filename and an illegal Windows one, and this
 * app builds for all three platforms (§2.11). The mapping is one-way on purpose:
 * the handle lives in the sidecar, so nothing has to invert it, and a stem that
 * cannot be parsed back cannot be mistaken for a handle.
 */
export function fileStem(surface: string): string {
	return surface.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** The history root. Pure path arithmetic: creates NOTHING. */
export function historyRoot(configDir: string): string {
	return join(configDir, HISTORY_DIRNAME);
}

export function sessionDir(root: string, sessionId: string): string {
	return join(root, fileStem(sessionId));
}

export function logPath(
	root: string,
	sessionId: string,
	surface: string,
): string {
	return join(sessionDir(root, sessionId), `${fileStem(surface)}.log`);
}

export function sidecarPath(
	root: string,
	sessionId: string,
	surface: string,
): string {
	return join(sessionDir(root, sessionId), `${fileStem(surface)}.json`);
}

export class ConsoleHistory {
	private readonly now: () => number;

	constructor(
		private readonly root: string,
		options: ConsoleHistoryOptions = {},
	) {
		this.now = options.now ?? (() => Date.now() / 1000);
	}

	/** Write the sidecar. Staged and renamed, so a reader sees a whole document
	 * or the previous one — never half a JSON file that would read as absent. */
	writeMeta(meta: ConsoleHistoryMeta): void {
		const path = sidecarPath(this.root, meta.session_id, meta.surface);
		mkdirSync(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
		const staged = `${path}.${process.pid}.tmp`;
		writeFileSync(staged, `${JSON.stringify(meta, null, 2)}\n`, {
			mode: HISTORY_FILE_MODE,
		});
		renameSync(staged, path);
		// `writeFileSync`'s mode applies only at creation, and the target's mode
		// survives the rename from the first write onward — so the intent is
		// re-asserted rather than assumed (the discovery record's own lesson).
		enforceModes(path);
	}

	/**
	 * Append bytes, rotating when the file passes the rotate bound.
	 *
	 * Rotation is what keeps a long-lived surface's history bounded: appending
	 * forever is the one shape that turns "retained history" into an unbounded
	 * directory. `truncated` is the caller's to carry — this method reports whether
	 * it rotated, and the host sets the flag on the sidecar, because the sidecar is
	 * the only place the flag is durable.
	 */
	append(
		sessionId: string,
		surface: string,
		bytes: Uint8Array,
		meta: ConsoleHistoryMeta,
	): { rotated: boolean } {
		const path = logPath(this.root, sessionId, surface);
		try {
			mkdirSync(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
			appendFileSync(path, bytes, { mode: HISTORY_FILE_MODE });
			enforceModes(path);
			let size = 0;
			try {
				size = statSync(path).size;
			} catch {
				size = 0;
			}
			if (size <= HISTORY_ROTATE_BYTES) return { rotated: false };
			// Rewrite with the newest retained window. Read-then-write rather than a
			// tail seek: the window is 4 MiB, the operation is once per 8 MiB appended,
			// and a partial read that guessed at a UTF-8 boundary would corrupt the
			// stream this file exists to keep exact.
			const all = readFileSync(path);
			const kept = all.subarray(Math.max(all.length - RETAIN_BYTES, 0));
			const staged = `${path}.${process.pid}.tmp`;
			writeFileSync(staged, kept, { mode: HISTORY_FILE_MODE });
			renameSync(staged, path);
			enforceModes(path);
			meta.truncated = true;
			meta.last_seen_at = this.now();
			this.writeMeta(meta);
			return { rotated: true };
		} catch {
			// Persistence is a convenience for the next launch; it must never take a
			// running surface down. The host logs its own line when a surface asked to
			// be retained, and `console_status` reports `retain`, not "retained".
			return { rotated: false };
		}
	}

	/** Load one surface's history, or null. Never creates anything. */
	load(sessionId: string, surface: string): LoadedSurface | null {
		const metaPath = sidecarPath(this.root, sessionId, surface);
		if (!existsSync(metaPath)) return null;
		try {
			const meta = parseMeta(readFileSync(metaPath, "utf8"));
			const logFile = logPath(this.root, sessionId, surface);
			const bytes = existsSync(logFile)
				? readFileSync(logFile)
				: Buffer.alloc(0);
			return { meta, bytes: new Uint8Array(bytes) };
		} catch {
			return null;
		}
	}

	/** One sidecar, or null. Never creates anything, and never throws. */
	private loadSidecar(
		sessionId: string,
		surface: string,
	): ConsoleHistoryMeta | null {
		const path = sidecarPath(this.root, sessionId, surface);
		if (!existsSync(path)) return null;
		try {
			return parseMeta(readFileSync(path, "utf8"));
		} catch {
			return null;
		}
	}

	/**
	 * Every retained surface, optionally for one session.
	 *
	 * A directory listing rather than an index file: an index is a second source
	 * of truth that a crash between the two writes can desynchronise, and the
	 * number of sessions here is small enough that a readdir is not a cost.
	 */
	list(sessionId?: string): LoadedSurface[] {
		const sessions =
			sessionId === undefined ? this.sessionDirs() : [fileStem(sessionId)];
		const loaded: LoadedSurface[] = [];
		for (const stem of sessions) {
			const dir = join(this.root, stem);
			let files: string[];
			try {
				files = readdirSync(dir);
			} catch {
				continue;
			}
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const meta = parseMeta(readFileSync(join(dir, file), "utf8"));
					const logFile = join(dir, `${file.slice(0, -".json".length)}.log`);
					const bytes = existsSync(logFile)
						? readFileSync(logFile)
						: Buffer.alloc(0);
					loaded.push({ meta, bytes: new Uint8Array(bytes) });
				} catch {
					// A corrupt sidecar is skipped rather than fatal: one bad file must
					// not hide every other surface from a listing.
				}
			}
		}
		return loaded;
	}

	/**
	 * The exit generation this sidecar currently records, or 0 when nothing has
	 * exited yet (§7.3).
	 *
	 * Read from the FILE rather than from a field the caller carries: the durable
	 * record is the only place a generation can outlive the process, and a caller
	 * that has just restored a surface is holding exactly the meta this reads.
	 */
	exitEpoch(sessionId: string, surface: string): number {
		const loaded = this.loadSidecar(sessionId, surface);
		return loaded?.exit_epoch ?? 0;
	}

	/**
	 * The generation the surface's NEXT exit will carry (§7.3).
	 *
	 * `live` is what the running host has seen in this process, and it is combined
	 * with the sidecar rather than replacing it: a write that failed, or a surface
	 * replayed from history and run again, must never move the generation
	 * backwards — two exits sharing one generation is exactly the collision the
	 * counter exists to make impossible (§12.3).
	 */
	nextExitEpoch(sessionId: string, surface: string, live: number): number {
		return Math.max(this.exitEpoch(sessionId, surface), live) + 1;
	}

	/** Remove one surface's history, log and sidecar. */
	remove(sessionId: string, surface: string): void {
		for (const path of [
			logPath(this.root, sessionId, surface),
			sidecarPath(this.root, sessionId, surface),
		]) {
			try {
				rmSync(path, { force: true });
			} catch {
				// Best effort: a file that cannot be removed is reported by the GC
				// pass's own count on the next run rather than failing a close.
			}
		}
	}

	/**
	 * Remove a session's whole history, for the session-deleted path (§6.7).
	 *
	 * CALLED BY NOTHING YET, and that is the deferred row rather than dead code:
	 * §6.7's session-deleted row is disclosed as unimplemented (there is no
	 * session-lifecycle signal for main to subscribe to in this PR), so this is the
	 * seam the wiring will call from. It lives here rather than in the caller
	 * because the GC and this method are the only two things that remove a
	 * DIRECTORY, and one implementation of that is the point.
	 */
	removeSession(sessionId: string): void {
		try {
			rmSync(sessionDir(this.root, sessionId), {
				recursive: true,
				force: true,
			});
		} catch {
			// As above: best effort.
		}
	}

	/**
	 * The GC pass (§7.4): drop session directories whose newest file is older than
	 * the window, and report what it removed rather than doing it silently.
	 */
	collect(days = DEFAULT_HISTORY_DAYS): CollectReport {
		const report: CollectReport = { removedSessions: [], removedSurfaces: 0 };
		const cutoff = this.now() - days * 24 * 60 * 60;
		for (const stem of this.sessionDirs()) {
			const dir = join(this.root, stem);
			let newest = 0;
			let files: string[];
			try {
				files = readdirSync(dir);
			} catch {
				continue;
			}
			for (const file of files) {
				try {
					newest = Math.max(newest, statSync(join(dir, file)).mtimeMs / 1000);
				} catch {
					// A file that vanished mid-listing contributes nothing.
				}
			}
			if (newest === 0 || newest >= cutoff) continue;
			report.removedSurfaces += files.filter((file) =>
				file.endsWith(".json"),
			).length;
			try {
				rmSync(dir, { recursive: true, force: true });
				report.removedSessions.push(stem);
			} catch {
				// Left for the next pass.
			}
		}
		return report;
	}

	private sessionDirs(): string[] {
		try {
			return readdirSync(this.root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	}
}

/**
 * Parse a sidecar, defaulting the fields this build added after a file may already
 * have been written.
 *
 * `exit_epoch` is the only one today, and it is read here rather than at each
 * call site because a sidecar from an older build is a NORMAL state (the field
 * arrived after the first retained surfaces existed) — a reader that had to
 * remember the default would be a reader that eventually forgets it, and the
 * observable failure is a surface whose generation silently restarts at 0.
 */
function parseMeta(raw: string): ConsoleHistoryMeta {
	const meta = JSON.parse(raw) as ConsoleHistoryMeta;
	if (typeof meta.exit_epoch !== "number") meta.exit_epoch = 0;
	return meta;
}

/** Re-assert the modes on a path that already exists. Needed because
 * `writeFileSync`'s mode applies only at creation, and a file that arrived 0644
 * keeps it while this code's intent says otherwise. */
function enforceModes(path: string): void {
	try {
		chmodSync(dirname(path), HISTORY_DIR_MODE);
		chmodSync(path, HISTORY_FILE_MODE);
	} catch {
		// Best effort: a mode this process cannot set is not a reason to fail a
		// surface's close, and the write path reports its own errors.
	}
}
