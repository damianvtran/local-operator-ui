/**
 * The Team Bridge notification cursor, persisted in main.
 *
 * WHAT IS STORED: one integer per conversation - the newest sequence number a
 * banner was raised for, keyed by the captured account and conversation IDs.
 * Nothing else. No conversation name, no organization,
 * no sender label and no message body, because a banner is a transient display
 * and this file outlives it. The ids are already in the hub's own store; this
 * file adds only the fact "the user was told about seq N".
 *
 * WHY MAIN AND WHY DISK. The renderer's cursor lives in a ref and dies with the
 * document, so a reload would replay the newest unread as a banner. Main's
 * lifetime is the app's lifetime, and a file is what keeps a restart from
 * re-interrupting someone for messages they were already told about. The
 * renderer still seeds its own cursor on first load; the two layers cover
 * different gaps and the persisted one is authoritative.
 *
 * CORRUPTION FAILS OPEN TOWARD SILENCE? No - toward a possible duplicate.
 * An unreadable file is treated as empty, which at worst repeats one banner
 * after a crash or a hand edit. The alternative (refusing to start or refusing
 * to notify) would silently disable the feature, which is worse than a
 * duplicate nobody can prove happened.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The file's shape, versioned so a later field can be added without guessing. */
type TeamBridgeNotifyFile = {
	version: 2;
	cursors: Record<string, number>;
};

/** How many conversations one file may remember before the oldest is dropped. */
export const TEAM_BRIDGE_NOTIFY_CURSOR_BOUND = 2048;

// Legacy cursors have no owner. Never assign them to whoever signs in next.
const VERSION = 2;

function cursorKey(accountId: string, conversationId: string): string {
	return JSON.stringify([accountId, conversationId]);
}

function isCursor(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Read-safe cursor store.
 *
 * The in-memory map is the source of truth for the running process; every
 * `record` writes the whole bounded map atomically (write-temp then rename), so
 * a reader never sees a half-written file and a crash between two writes
 * leaves the previous complete answer.
 */
export class TeamBridgeNotifyStore {
	private readonly cursors = new Map<string, number>();

	constructor(
		private readonly file: string,
		private readonly onError: (message: string, error: unknown) => void = () =>
			undefined,
	) {
		this.load();
	}

	/** The newest seq a banner was raised for, or `undefined`. */
	notifiedSeq(accountId: string, conversationId: string): number | undefined {
		return this.cursors.get(cursorKey(accountId, conversationId));
	}

	/**
	 * Remember that this conversation was notified at `seq`.
	 *
	 * Only advances: a late poll whose seq is older than the recorded one must
	 * not move the cursor backwards and re-open the door to a duplicate banner.
	 * Touching an existing key moves it to the newest position so the bound
	 * evicts by usefulness rather than alphabetically.
	 */
	record(accountId: string, conversationId: string, seq: number): void {
		if (!isCursor(seq)) return;
		const key = cursorKey(accountId, conversationId);
		const previous = this.cursors.get(key);
		if (previous !== undefined && seq <= previous) return;
		this.cursors.delete(key);
		this.cursors.set(key, seq);
		this.trim();
		this.persist();
	}

	/**
	 * Enforce the bound on BOTH paths: `record` while a run is live and `load` on
	 * a file written by an older or hand-edited build. A bound enforced only on
	 * the write path is a promise about files this process wrote itself, which is
	 * not the file it has just read.
	 */
	private trim(): void {
		while (this.cursors.size > TEAM_BRIDGE_NOTIFY_CURSOR_BOUND) {
			const oldest = this.cursors.keys().next();
			if (oldest.done) break;
			this.cursors.delete(oldest.value);
		}
	}

	private load(): void {
		let raw: string;
		try {
			raw = readFileSync(this.file, "utf8");
		} catch {
			// Absent is the ordinary first run, not an error worth reporting.
			return;
		}
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (
				parsed === null ||
				typeof parsed !== "object" ||
				(parsed as { version?: unknown }).version !== VERSION
			) {
				return;
			}
			const cursors = (parsed as { cursors?: unknown }).cursors;
			if (cursors === null || typeof cursors !== "object") return;
			for (const [conversationId, seq] of Object.entries(
				cursors as Record<string, unknown>,
			)) {
				if (isCursor(seq)) this.cursors.set(conversationId, seq);
			}
			this.trim();
		} catch (error) {
			this.onError("team-bridge notification cursor file is unreadable", error);
		}
	}

	private persist(): void {
		const payload: TeamBridgeNotifyFile = {
			version: VERSION,
			cursors: Object.fromEntries(this.cursors),
		};
		try {
			mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
			const temporary = `${this.file}.${process.pid}.tmp`;
			writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600 });
			renameSync(temporary, this.file);
		} catch (error) {
			// A banner that was shown must not be made to throw because a disk is
			// full; the in-memory cursor still suppresses duplicates this run.
			this.onError(
				"team-bridge notification cursor could not be written",
				error,
			);
		}
	}
}
