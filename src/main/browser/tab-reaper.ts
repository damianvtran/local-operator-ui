import type { TabRecord } from "./registry";

/**
 * The agent-tab reaper: closes agent tabs nobody will drive again, and makes
 * room at the agent-tab cap by evicting the stalest of them instead of refusing.
 *
 * WHY THIS EXISTS (operator report, 2026-11-17): the desktop browser host sat at
 * its `MAX_AGENT_TABS` cap and refused a new session's `open`. All eight tabs
 * were login/signup tabs idle for hours, owned by sessions that had ended or
 * crashed without `owner_finish` — the ONLY path that used to close an agent
 * tab besides the agent's own `close` and the user's chrome. A tab therefore
 * outlived its owner for the life of the app, and the cap turned that leak into
 * an outage for every later session.
 *
 * WHAT MAY BE REAPED: an AGENT-owned tab only, and only when nothing marks a
 * person or a live command as still using it (`protectionOf`). Two triggers:
 *
 * 1. SESSION ENDED. The host is a stateless loopback RPC (`rpc.ts`) — there is
 *    no connection to drop and no session-ended message. The one honest signal
 *    the app has is the daemon's roster (`sessions.list`, read by
 *    `backend-service.ts`'s `servingSessionFleet`): a row whose `live_state` is
 *    `""` is a session whose runtime record is gone ("a vanished pid is cold",
 *    `local_operator/server/utils/desktop_feed.py::_row_for`). Rules, all
 *    conservative because a wrong close loses an agent's work:
 *    - only a row PRESENT and cold counts. A session ABSENT from the roster is
 *      unknown, not ended: the roster lists user sessions only (subagents are
 *      filtered out) and is capped at 500 rows. Those tabs fall to the idle rule.
 *    - an unreadable or degraded roster (`null`) changes nothing.
 *    - cold must be seen on `ENDED_SESSION_CONFIRMATIONS` consecutive reads, so a
 *      runtime mid-restart (it re-execs onto a new build at idle) is not "ended".
 * 2. IDLE. No agent action on the tab for `AGENT_TAB_IDLE_REAP_MS`. This is the
 *    backstop for every owner the roster cannot see (subagents, a session on an
 *    old daemon, a roster that never answers).
 *
 * AT THE CAP: `evictionVictim` picks the least-recently-used reapable tab idle
 * for at least `EVICTION_IDLE_FLOOR_MS`, so a session working in parallel never
 * loses the tab it is using to a newcomer. Nothing evictable → the registry
 * refuses, naming the sessions that hold the tabs.
 *
 * WHAT THE REAPED AGENT SEES: `registry.reap` leaves a nonce-matched tombstone,
 * so its next use of the old handle is `tab_closed` with a reason that says WHY
 * (`reaped_idle` / `reaped_session_ended` / `evicted`), not the generic "gone".
 *
 * Pure and Electron-free: the registry and every guard are injected, so the
 * rules are asserted in process (`scripts/browser-tab-reaper.test.mjs`).
 */

/**
 * How long an agent tab may go without an agent action before a sweep closes it.
 *
 * 45 minutes. Evidence (measured 2026-11-17 over this machine's lop transcripts
 * from the previous 60 days: 216 sessions, 10,736 gaps between consecutive
 * `browser` calls of one session, excluding gaps after a `close` or before an
 * `open`, since no tab is held across those): median 5.5 s, p95 125 s, p99
 * ~49 min; 140 gaps exceeded 30 min, 113 exceeded 45 min, 99 exceeded 60 min,
 * max ~29 days. The distribution is bimodal — in-task gaps are seconds to a
 * couple of minutes, and almost every gap past half an hour is a session that
 * went dormant and resumed much later — so no setting sits "above the max";
 * 45 min (inside the requested 30–60 range) reaps ~1% of continuations, and
 * each of those costs the agent one typed `tab_closed` and one re-`open`. Erring
 * long instead costs another session's `open`, which is the reported outage.
 */
export const AGENT_TAB_IDLE_REAP_MS = 45 * 60_000;

/**
 * The minimum idle time before a tab may be EVICTED to make room at the cap.
 *
 * 10 minutes: an agent mid-task drives its tab every few seconds to minutes
 * (each action is bounded at 30 s by the host), so ten quiet minutes means the
 * owner is not in the middle of using it (same transcripts as above: p95 gap
 * 125 s; 253 of 10,736 gaps, 2.4%, exceeded 10 min). Below the floor nothing is evicted and
 * the newcomer is refused — stealing a busy session's tab to satisfy a newer one
 * would just move the failure.
 */
export const EVICTION_IDLE_FLOOR_MS = 10 * 60_000;

/** How often the sweep runs. A minute bounds "closed within" at idle + 1 min and
 * session-end + ~2 min, and one roster read a minute is the same cost the
 * version-drift gate already pays for the same route. */
export const REAP_SWEEP_INTERVAL_MS = 60_000;

/** Consecutive cold roster reads before a session counts as ended. Two reads a
 * sweep apart (~1 min) rides over a runtime's idle re-exec. */
export const ENDED_SESSION_CONFIRMATIONS = 2;

export type ReapReason = "idle" | "session_ended" | "evicted";

/** The roster row shape the reaper needs (`FleetRosterRow` narrowed). */
export interface RosterRow {
	sessionId: string;
	liveState: string | null;
}

/** Facts about a tab only the host wiring knows. Each one, when true, makes the
 * tab non-reapable. */
export interface ReapGuards {
	/** The tab the user has selected in the browser pane (active), or one with a
	 * held popup / attention row waiting on the user. */
	userEngaged(record: TabRecord): boolean;
	/** A password manager's passkey prompt holds the tab for the user
	 * (`extensions/passkey-custody.ts` `isHeld`). */
	inCustody(record: TabRecord): boolean;
	/** A command is in flight on the tab (`registry.isBusy`). */
	busy(record: TabRecord): boolean;
	/** A screen recording is running or starting on the tab. */
	recording(record: TabRecord): boolean;
	/** The owning session has a site-access request waiting on the user. */
	sessionAwaitingUser(sessionId: string): boolean;
}

/**
 * Why `record` must NOT be reaped, or null when it may be.
 *
 * A user tab is never a candidate; neither is a USER's tab the user handed to an
 * agent (`handedFrom === "user"`) — closing it would close the person's own
 * page. Reaping only ever applies to tabs agents created.
 */
export function protectionOf(
	record: TabRecord,
	guards: ReapGuards,
): string | null {
	if (record.owner !== "agent") return "user_tab";
	if (record.handedFrom === "user") return "handed_from_user";
	if (record.cleanupPending) return "cleanup_pending";
	if (guards.userEngaged(record)) return "user_engaged";
	if (guards.inCustody(record)) return "custody";
	if (guards.busy(record)) return "busy";
	if (guards.recording(record)) return "recording";
	if (record.sessionId && guards.sessionAwaitingUser(record.sessionId))
		return "awaiting_user";
	return null;
}

/** The registry surface the reaper drives. */
export interface ReaperRegistry {
	list(): TabRecord[];
	agentTabCount(): number;
}

export interface TabReaperOptions {
	registry: ReaperRegistry;
	guards: ReapGuards;
	/** Close the tab, leaving a tombstone that names `reason`. */
	reap: (record: TabRecord, reason: ReapReason) => void;
	/** The daemon roster, or null when it cannot be read. Optional: without it
	 * only the idle rule runs. */
	readRoster?: () => Promise<readonly RosterRow[] | null>;
	now?: () => number;
	log?: (line: string) => void;
}

export class TabReaper {
	/** Consecutive cold reads per session id. Reset by any non-cold reading. */
	private readonly coldStreak = new Map<string, number>();
	private sweeping = false;
	private readonly now: () => number;

	constructor(private readonly options: TabReaperOptions) {
		this.now = options.now ?? Date.now;
	}

	/**
	 * Fold one roster read into the cold streaks. Null (unreadable/degraded) is
	 * not evidence and changes nothing; a session absent from the roster is
	 * unknown and loses its streak, so absence can never accumulate into "ended".
	 */
	observeRoster(rows: readonly RosterRow[] | null): void {
		if (rows === null) return;
		const byId = new Map(rows.map((row) => [row.sessionId, row]));
		const owners = new Set(
			this.options.registry
				.list()
				.map((record) => record.sessionId)
				.filter((id): id is string => Boolean(id)),
		);
		for (const id of [...this.coldStreak.keys()])
			if (!owners.has(id)) this.coldStreak.delete(id);
		for (const id of owners) {
			const row = byId.get(id);
			// `""` is the daemon's "no live runtime record"; `null` is a daemon that
			// predates `live_state`, which says nothing about this session.
			if (row && row.liveState === "")
				this.coldStreak.set(id, (this.coldStreak.get(id) ?? 0) + 1);
			else this.coldStreak.delete(id);
		}
	}

	sessionEnded(sessionId: string | null): boolean {
		return (
			sessionId !== null &&
			(this.coldStreak.get(sessionId) ?? 0) >= ENDED_SESSION_CONFIRMATIONS
		);
	}

	/** The tabs a sweep at `now` would close, with why. Pure over current state. */
	candidates(): Array<{ record: TabRecord; reason: ReapReason }> {
		const now = this.now();
		const out: Array<{ record: TabRecord; reason: ReapReason }> = [];
		for (const record of this.options.registry.list()) {
			if (protectionOf(record, this.options.guards) !== null) continue;
			if (this.sessionEnded(record.sessionId))
				out.push({ record, reason: "session_ended" });
			else if (now - record.lastUsedAt >= AGENT_TAB_IDLE_REAP_MS)
				out.push({ record, reason: "idle" });
		}
		return out;
	}

	/**
	 * One sweep: read the roster (if wired), then close every candidate. Single
	 * flight — a slow roster read must not stack sweeps. Guards are re-checked
	 * after the await because the roster read yields to commands that may have
	 * started on a tab meanwhile.
	 */
	async sweep(): Promise<number> {
		if (this.sweeping) return 0;
		this.sweeping = true;
		try {
			if (this.options.readRoster) {
				let rows: readonly RosterRow[] | null = null;
				try {
					rows = await this.options.readRoster();
				} catch {
					rows = null;
				}
				this.observeRoster(rows);
			}
			const due = this.candidates();
			for (const { record, reason } of due) this.close(record, reason);
			return due.length;
		} finally {
			this.sweeping = false;
		}
	}

	/**
	 * The least-recently-used reapable agent tab idle at least
	 * `EVICTION_IDLE_FLOOR_MS`, or null. A tab whose session is confirmed ended
	 * is preferred over any live session's tab, whatever its age.
	 */
	evictionVictim(): TabRecord | null {
		const now = this.now();
		const eligible = this.options.registry.list().filter((record) => {
			if (protectionOf(record, this.options.guards) !== null) return false;
			return (
				this.sessionEnded(record.sessionId) ||
				now - record.lastUsedAt >= EVICTION_IDLE_FLOOR_MS
			);
		});
		eligible.sort((a, b) => {
			const ended =
				Number(this.sessionEnded(b.sessionId)) -
				Number(this.sessionEnded(a.sessionId));
			return ended !== 0 ? ended : a.lastUsedAt - b.lastUsedAt;
		});
		return eligible[0] ?? null;
	}

	/** The registry's capacity hook: evict one tab if any is evictable. */
	evictForCapacity(): boolean {
		const victim = this.evictionVictim();
		if (!victim) return false;
		this.close(victim, "evicted");
		return true;
	}

	private close(record: TabRecord, reason: ReapReason): void {
		const idleMin = Math.round((this.now() - record.lastUsedAt) / 60_000);
		this.options.log?.(
			`[browser] reaped agent tab ${record.tabId} of session ${record.sessionId ?? "(none)"} (${reason}, idle ${idleMin} min)`,
		);
		this.options.reap(record, reason);
	}
}
