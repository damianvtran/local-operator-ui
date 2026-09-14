/**
 * The desktop app's viewer record: which window on THIS machine can display
 * session X, and how to dial it.
 *
 * WHY MAIN OWNS THIS, AND NOT THE RENDERER. `lop resume-click` reads
 * `run/viewers/<pid>.json` to decide where a notification click should land.
 * The record names a `control_port` and a `control_key`, so whoever writes it
 * is asserting that a listener is answering there. A renderer can be reloaded,
 * hidden or throttled, and a renderer reload would leave the record advertising
 * a port that died with the previous document — a click would spend its whole
 * dial timeout on a socket nothing is listening on and then fall back to
 * spawning a terminal, which is the exact duplicate-window defect the viewer
 * registry was built to remove. Main's lifetime is the app's lifetime and its
 * listener survives every renderer reload, so main publishes. The renderer's
 * only involvement is to tell main which conversation is on screen, which it
 * already does on the watch heartbeat.
 *
 * TWO QUESTIONS, TWO ARTIFACTS, and this module is only one of them. This file
 * answers "which window can display session X" (routing, read by the click).
 * It is NOT the presence signal the backend reads to decide whether a
 * background completion is worth a banner — that is the delivery lease on the
 * feed (`desktop-feed.ts`), because a desktop paired to a backend on another
 * host cannot write to that host's disk. Conflating the two is the mistake the
 * viewer module's own header warns about.
 *
 * The wire shape and the file contract are the BACKEND's
 * (`local_operator/session/runtime/viewers.py`): the same directory, the same
 * staged write, the same 0600 file under a 0700 directory, the same 15 s beat
 * against a 45 s timeout. The permissions ARE the authorization story — a
 * record carries a control key that can make this app switch conversations, so
 * anything able to read it is already the owning account. The shape is copied
 * rather than invented so an operator debugging one record has learned the
 * other, and so `ViewerRecord.from_json` on the far side reads it unchanged.
 */

import { randomBytes } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The backend's `VIEWER_RUN_DIRNAME`, relative to the config directory. */
const VIEWER_RUN_DIRNAME = "run/viewers";

/** The backend's `VIEWER_PROTOCOL`. A bump here is a protocol the reader refuses. */
export const VIEWER_PROTOCOL = 1;

/** The backend's `FOCUS_WINDOW_CAPABILITY`. */
export const FOCUS_WINDOW_CAPABILITY = "focus-window-v1";

/** Advertised so a reader can tell this publisher can answer a banner click. */
export const DESKTOP_NOTIFY_CAPABILITY = "desktop-notify-v1";

/** How often the record is re-stamped, matching the backend's beat. */
export const VIEWER_HEARTBEAT_INTERVAL_MS = 15_000;

type ViewerRecordShape = {
	pid: number;
	/** Only `"desktop"` is published here; the field is the backend's, unchanged. */
	surface: string;
	control_port: number;
	control_key: string;
	/** The session on screen RIGHT NOW, or `""` when no window is showing one. */
	current_session: string;
	can_switch: boolean;
	/** When this app last held OS focus, or 0.0 if it never has. */
	focused_at: number;
	protocol: number;
	started_at: number;
	heartbeat_at: number;
	capabilities: string[];
};

/**
 * The config directory, resolved the way the backend resolves it.
 *
 * Read from the environment on every call rather than captured at import: the
 * backend the app talks to resolves `LOCAL_OPERATOR_CONFIG_DIR` per call, and a
 * constant here would freeze whatever the first importer saw. A paired external
 * backend on another host still routes through a record on THIS host, because
 * the click runs on the user's machine — which is why this never consults the
 * backend for the path.
 */
export function viewerRunDir(env: NodeJS.ProcessEnv = process.env): string {
	const root =
		env.LOCAL_OPERATOR_CONFIG_DIR || join(homedir(), ".local-operator");
	return join(root, VIEWER_RUN_DIRNAME);
}

/**
 * Write one record, staged so a concurrent reader sees either the old file or
 * the new one and never a half-written one.
 *
 * `mkstemp` + write + chmod + rename, copied from the backend's
 * `publish_viewer`. The chmod is on the TEMPORARY file and happens before the
 * rename, so the record is never briefly world-readable at its final path.
 */
export function publishViewerRecord(
	record: ViewerRecordShape,
	dir: string = viewerRunDir(),
): string {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	// `mkdirSync`'s mode is masked by the umask, so an existing directory keeps
	// whatever it had. Applied explicitly for the same reason the backend does:
	// the directory permissions are half the authorization story.
	chmodSync(dir, 0o700);
	const target = join(dir, `${record.pid}.json`);
	const temporary = join(
		dir,
		`.${record.pid}.${randomBytes(6).toString("hex")}.tmp`,
	);
	writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
	renameSync(temporary, target);
	return target;
}

/** Remove a record. Best effort by contract: an exit path must never throw. */
export function unpublishViewerRecord(
	pid: number,
	dir: string = viewerRunDir(),
): void {
	try {
		unlinkSync(join(dir, `${pid}.json`));
	} catch {
		// A missing file is the ordinary case on a second call, and a record
		// that cannot be removed must not take the app's exit down with it.
	}
}

/**
 * Owns one record for the life of this process.
 *
 * The state it publishes is pushed IN by whoever knows it: the endpoint stamps
 * the control port once it has bound, the window layer stamps the session on
 * every navigation and the focus edge on every focus gain. Nothing here polls
 * the app, because the two facts it carries change on events and a poll would
 * either be late or be a disk write at UI cadence.
 */
export class ViewerRecordPublisher {
	private readonly record: ViewerRecordShape;
	private timer: NodeJS.Timeout | null = null;
	private stopped = false;
	/**
	 * Whether anything has been written yet.
	 *
	 * `setControlPort` lands BEFORE `start` in the app's own ordering (the port
	 * only exists once the listener has bound, and the listener is what the
	 * record advertises), so a publisher that wrote on every setter would put a
	 * port-0 record in the directory for a moment — and a reader that dialled it
	 * would spend its whole dial timeout on nothing. Mutations accumulate; the
	 * first write is `start`'s.
	 */
	private started = false;

	constructor(
		private readonly dir: string = viewerRunDir(),
		pid: number = process.pid,
	) {
		this.record = {
			pid,
			surface: "desktop",
			// 0 until the listener binds. A record advertising port 0 is not
			// dialable, which is the honest answer during the gap and the reason
			// the endpoint stamps the real port before anything else.
			control_port: 0,
			// The whole authorization story: 32 random bytes, 0600 on disk.
			control_key: randomBytes(32).toString("hex"),
			current_session: "",
			// True even with no window: `resume_session` RECREATES the window and
			// then navigates (B3), so routing a click here is still the cheapest
			// landing site on a machine where the app is alive in the dock. What
			// the record must not claim while no window exists is a CONVERSATION
			// (`current_session` stays `""`), because that field is what lets a
			// click skip the switch.
			can_switch: true,
			focused_at: 0,
			protocol: VIEWER_PROTOCOL,
			started_at: Date.now() / 1000,
			heartbeat_at: Date.now() / 1000,
			capabilities: [FOCUS_WINDOW_CAPABILITY, DESKTOP_NOTIFY_CAPABILITY],
		};
	}

	get controlKey(): string {
		return this.record.control_key;
	}

	/** Record the port the control listener actually bound, and publish. */
	setControlPort(port: number): void {
		this.record.control_port = port;
		this.publish();
	}

	/**
	 * Record which conversation is on screen now.
	 *
	 * An early return on an unchanged value keeps the 15 s beat from being a
	 * disk write at navigation cadence: a re-render that re-asserts the same
	 * session costs nothing.
	 */
	noteSession(sessionId: string): void {
		if (this.record.current_session === sessionId) return;
		this.record.current_session = sessionId;
		this.publish();
	}

	/** Stamp the focus GAIN edge only. A blur carries no routing information. */
	noteFocused(): void {
		this.record.focused_at = Date.now() / 1000;
		this.publish();
	}

	/** Begin the beat, and write the record for the first time. Idempotent,
	 * because a window can be recreated. */
	start(): void {
		if (this.timer || this.stopped) return;
		this.started = true;
		this.publish();
		this.timer = setInterval(
			() => this.publish(),
			VIEWER_HEARTBEAT_INTERVAL_MS,
		);
		// `unref` so a heartbeat cannot be the reason a quitting app stays alive.
		this.timer.unref?.();
	}

	/** Stop beating and remove the record. Safe to call twice. */
	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		unpublishViewerRecord(this.record.pid, this.dir);
	}

	private publish(): void {
		if (this.stopped || !this.started) return;
		this.record.heartbeat_at = Date.now() / 1000;
		try {
			publishViewerRecord(this.record, this.dir);
		} catch {
			// A full or read-only disk must not take the app down over a
			// discovery record. The next beat retries, exactly as the backend's
			// own publisher does.
		}
	}
}
