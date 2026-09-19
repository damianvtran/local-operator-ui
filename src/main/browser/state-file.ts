import { randomBytes, timingSafeEqual } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { HOST_CAPABILITIES, PROTO_VERSION } from "./protocol";

/**
 * The discovery state file, and the key inside it.
 * Design: docs/design/ui-browser-tab.md 10.1 (the file), 2.4 (the discipline it
 * copies from `local_operator/browser_bridge/state.py`).
 *
 * WHY a separate directory from the bridge's `run/browser/bridge.json`: that
 * directory belongs to the daemon — `lop browser status` reads it, and the
 * bridge's install, cleanup and health paths all assume it is theirs. A second
 * process's record beside it invites exactly the confusion a future
 * `lop browser cleanup` sweep would cause, which is the same reason the daemon
 * discovery design chose "a new namespace, not the session one".
 *
 * WHY the file is 0600 under a 0700 directory: `session_key` in a readable file
 * IS the authorization — anything able to read it already owns the agent's
 * browser. The permissions are not hygiene, they are the trust boundary.
 */

/** Where the record lives, relative to the local-operator config root. */
export const RUN_DIRNAME = join("run", "ui-browser");
export const STATE_FILENAME = "host.json";

/** Directory and file modes, named so a test asserts the number this code
 * intends rather than a number copied into the test. */
export const STATE_DIR_MODE = 0o700;
export const STATE_FILE_MODE = 0o600;

/** Heartbeat cadence and the staleness bound, mirroring the bridge's
 * `HEARTBEAT_INTERVAL_S = 15.0` / `HEARTBEAT_TIMEOUT_S = 45.0`
 * (`state.py:24-25`) so the Python side's classification code is unchanged. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/** The state file's body. Field names match `UiHostState` in the design's
 * `local_operator/ui_browser/state.py` sketch, so the Python reader parses this
 * with the same model it would parse its own write of. */
export interface BrowserHostStateFile {
	pid: number;
	port: number;
	session_key: string;
	proto: number;
	host: "ui";
	app_version: string;
	profile_dir: string;
	/** The wire methods this build serves (design §6.3), read by the harness BEFORE
	 * it dispatches: a record with no `capabilities` key is an old app host, and the
	 * tool degrades with a typed `capability_unsupported` naming "update the desktop
	 * app" instead of sending a method that would burn its whole budget. Additive
	 * because `UiHostState` is `extra="ignore"` — an old harness ignores the key.
	 *
	 * A list and not a version, because version arithmetic cannot tell "older" from
	 * "current but wedged", whose remedies are opposite (§6.3). */
	capabilities: string[];
	tabs: number;
	agent_tabs: number;
	heartbeat_at: number;
	started_at: number;
}

/** What the record reports about the live host, read fresh on every write. */
export interface BrowserHostFacts {
	tabs: number;
	agentTabs: number;
	profileDir: string;
}

/**
 * The local-operator config root this app publishes into.
 *
 * `LOCAL_OPERATOR_CONFIG_DIR` wins when set: that is the variable the harness and
 * the app's own backend child process use to redirect the whole config tree, so
 * honouring it here is what makes an isolated run — a QA pass, an evidence
 * script — actually isolated rather than writing into the operator's real
 * `~/.local-operator`.
 */
export function localOperatorConfigDir(): string {
	const configured = process.env.LOCAL_OPERATOR_CONFIG_DIR?.trim();
	if (configured) return configured;
	return join(homedir(), ".local-operator");
}

/** The absolute path of the record. Pure path arithmetic: creates NOTHING.
 *
 * That is a requirement, not an accident — the bridge's `state_path()`
 * documents that routing a reader through a `mkdir` turned an ENOSPC handler
 * into a second `OSError` from inside the first. A caller that wants the
 * directory made asks the writer to make it. */
export function stateFilePath(root: string = localOperatorConfigDir()): string {
	return join(root, RUN_DIRNAME, STATE_FILENAME);
}

/**
 * A fresh 32-byte urlsafe session key.
 *
 * 32 bytes, matching the `min_length=32` the Python model enforces, so a key
 * minted here is one the reader accepts by construction rather than by luck.
 */
export function mintSessionKey(): string {
	return randomBytes(32).toString("base64url");
}

/** Compare a presented key in constant time, per design 11.7: a byte-by-byte
 * compare leaks the key's prefix to anything that can time the responses, and
 * this listener is reachable by every local process. */
export function keysMatch(presented: unknown, expected: string): boolean {
	if (typeof presented !== "string") return false;
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	// Length is not secret here (it is a constant 43 characters either way), and
	// `timingSafeEqual` throws on differing lengths rather than answering false.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export interface BrowserStateWriterOptions {
	appVersion: string;
	now?: () => number;
	onError?: (error: unknown) => void;
}

/**
 * Writes the record, then keeps its heartbeat fresh, with the bridge's write
 * discipline.
 *
 * The discipline, copied with its reasons (design 2.4/7.2):
 * - the directory is created 0700 and the file written 0600;
 * - the write is STAGED: a sibling temp file is written and renamed over the
 *   target. `rename(2)` is the POSIX atomic replace, so a reader sees either the
 *   whole old record or the whole new one — never a half-written JSON document
 *   that would read as "no host here";
 * - a failure to write is reported and swallowed. Discovery is a convenience for
 *   another process; it must never take the app down, the same way the bridge
 *   guards its own diagnostic reads.
 */
export class BrowserStateWriter {
	private readonly now: () => number;
	private readonly onError: (error: unknown) => void;
	private timer: NodeJS.Timeout | null = null;
	private written = false;

	constructor(
		private readonly path: string,
		private readonly facts: () => BrowserHostFacts,
		options: BrowserStateWriterOptions,
	) {
		this.now = options.now ?? Date.now;
		this.onError = options.onError ?? (() => {});
		this.appVersion = options.appVersion;
	}

	private readonly appVersion: string;

	/** Publish the record and start the heartbeat. The heartbeat is the
	 * difference between "the app is running and can open a tab on demand" and a
	 * record that names a process that died without cleaning up. */
	start(port: number, sessionKey: string): void {
		const startedAt = this.now() / 1000;
		this.startedAt = startedAt;
		this.port = port;
		this.sessionKey = sessionKey;
		this.write();
		this.timer = setInterval(() => this.write(), HEARTBEAT_INTERVAL_MS);
		// A heartbeat timer must not hold the process open on its own: the app's
		// lifetime is decided by its window and its backend, not by this file.
		this.timer.unref?.();
	}

	private startedAt = 0;
	private port = 0;
	private sessionKey = "";

	/** Re-publish immediately, without waiting for the next heartbeat. Called
	 * when something the record reports has changed (a tab opened or closed). */
	publishNow(): void {
		if (this.port === 0) return;
		this.write();
	}

	private write(): void {
		try {
			const facts = this.facts();
			const state: BrowserHostStateFile = {
				pid: process.pid,
				port: this.port,
				session_key: this.sessionKey,
				proto: PROTO_VERSION,
				host: "ui",
				app_version: this.appVersion,
				profile_dir: facts.profileDir,
				// Advertised from the ONE list the `/health` route also reads (§6.3), so the
				// record a session reads and the probe Python acquits a stale record with
				// cannot name different capabilities.
				capabilities: [...HOST_CAPABILITIES],
				tabs: facts.tabs,
				agent_tabs: facts.agentTabs,
				heartbeat_at: this.now() / 1000,
				started_at: this.startedAt || this.now() / 1000,
			};
			mkdirSync(dirname(this.path), {
				recursive: true,
				mode: STATE_DIR_MODE,
			});
			const staged = `${this.path}.${process.pid}.tmp`;
			writeFileSync(staged, `${JSON.stringify(state, null, 2)}\n`, {
				mode: STATE_FILE_MODE,
			});
			renameSync(staged, this.path);
			// `writeFileSync`'s mode applies only at CREATION, and the staged file is
			// new each time while the target's mode survives a rename from the first
			// write onward — so a record that arrived 0644 (restored from a backup, or
			// written by a build that got this wrong) would stay world-readable while
			// this code's own intent said 0600. Re-asserting both modes on every write
			// is what makes the intent true of the file on disk (N1: this helper was
			// exported and called from nowhere).
			enforceStateFileModes(this.path);
			this.written = true;
		} catch (error) {
			this.onError(error);
		}
	}

	/** Remove the record, so discovery is honest when the host is gone. Called on
	 * host stop, on quit, and by the Settings toggle that turns the host off. */
	clear(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (!this.written) return;
		try {
			unlinkSync(this.path);
		} catch (error) {
			this.onError(error);
		}
		this.written = false;
	}
}

/**
 * Re-assert the modes on an existing record.
 *
 * Needed because `writeFileSync`'s mode applies only at creation: a record that
 * already exists keeps the mode it had, so a file that arrived 0644 (restored
 * from a backup, or written by a build that got this wrong) would stay readable
 * while this code's own intent said otherwise. Called by `write()` on every
 * write, including the ones that replace an existing record.
 */
export function enforceStateFileModes(path: string): void {
	try {
		chmodSync(dirname(path), STATE_DIR_MODE);
		chmodSync(path, STATE_FILE_MODE);
	} catch {
		// Best effort: a mode this process cannot set is not a reason to fail
		// discovery, and the write path reports its own errors.
	}
}
