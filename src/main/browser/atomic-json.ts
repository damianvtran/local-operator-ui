import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Staged JSON writes, and tolerant reads.
 *
 * The discipline is the bridge's `state.py:99-117` copied with its reason
 * (design 2.4, 7.2, 9.3): write a sibling temp file, then `rename(2)` over the
 * target. `rename` is the POSIX atomic replace, so a reader — including a reader
 * arriving while the app is being SIGKILLed — sees either the whole old document
 * or the whole new one, never a truncated one. A half-written approvals store
 * would read as "nothing is approved" (fail closed, which is survivable) while a
 * half-written policy file that still parsed would be a silent lie.
 *
 * The mode is 0600 under a 0700 directory for the same reason as the state file:
 * these files are policy about what an agent may reach as the user.
 */

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

/** Write `value` as JSON, atomically, creating parents 0700. Returns whether the
 * write happened; a failure is reported to the caller rather than thrown,
 * because losing a policy write must not take a running command down with it. */
export function writeJsonAtomic(path: string, value: unknown): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIR_MODE });
		const staged = `${path}.${process.pid}.tmp`;
		writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`, {
			mode: PRIVATE_FILE_MODE,
		});
		renameSync(staged, path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Read JSON, or null.
 *
 * Deliberately swallow-everything: the design's rule for these files is that a
 * corrupt or missing one "must never block startup" (7.2). A caller that needs
 * to distinguish "missing" from "corrupt" does not exist here — both mean "start
 * from the empty policy", which is the fail-closed direction for approvals and
 * the convenient direction for a tab list.
 */
export function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}
