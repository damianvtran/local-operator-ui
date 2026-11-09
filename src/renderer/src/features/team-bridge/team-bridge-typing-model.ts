import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import { create } from "zustand";
import type { TeamBridgeTypingTyper } from "../../../../shared/team-bridge-contract";

/**
 * Team Bridge typing indicators: the pure half (timings, scoping, copy form)
 * and the one piece of shared state (the "Show when I'm typing" preference).
 *
 * WHY THIS SHAPE. The design (Team Bridge typing indicators, §3-§6) picked a
 * dedicated 3 s poll over a long-poll: an indicator must appear within ~3 s
 * (Slack's own send throttle), and the 8 s history poll is too slow to carry
 * it. Every number the hub can tune (`poll_after_ms`, `resend_after_ms`,
 * `ttl_ms`) comes from the server; the constants here are only the client's
 * fallbacks and the one client-owned timing, the idle stop.
 *
 * Typing state is a HINT with a TTL, never a fact: every failure path in the
 * emitter and the reader degrades to "nothing shows", with no toast and no
 * retry, because a lost stop is cleaned up by the hub's 8 s expiry.
 */

/**
 * Stop reporting after this long without a keystroke. Between Signal's 3 s
 * and Zulip's 12 s (design §6): long enough that a pause to think does not
 * flicker the reader's line, short enough that someone who walked away
 * clears quickly.
 */
export const TYPING_IDLE_MS = 5_000;
/** The heartbeat cadence until the first PUT answers with the server's own. */
export const TYPING_DEFAULT_RESEND_MS = 3_000;
/** The read cadence until the first GET answers with the server's own. */
export const TYPING_DEFAULT_POLL_MS = 3_000;
/**
 * The back-off for a refused read that names no wait of its own (429 without
 * `retry_after_ms`, a 503 dark hub, a transport failure). It matches the hub's
 * own `enabled:false` answer of `poll_after_ms: 60000`, so every "not now"
 * waits the same minute.
 */
export const TYPING_BACKOFF_MS = 60_000;
/**
 * The longest server-supplied interval the client will honour. A hub bug that
 * answered hours would otherwise silently disable the feature for the session;
 * capped, the worst case is one read every five minutes.
 */
export const TYPING_MAX_INTERVAL_MS = 300_000;

/** The client-side bound on any interval the server hands us. */
export function boundedInterval(value: number | undefined, fallback: number) {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(value, 1_000), TYPING_MAX_INTERVAL_MS);
}

/** Display names beyond this collapse into "Several people are typing" (Zulip's 3). */
export const TYPING_MAX_NAMES = 3;

/**
 * May the typing surface (emitter, reader, indicator line) exist at all?
 *
 * Only an exact `enabled` answer counts, matching the reaction and thread
 * gates: `unknown` (not answered yet, or the read failed), `below-version`
 * and `unpaired` all keep the composers byte-for-byte as they were and send
 * zero typing requests to a backend that predates the routes.
 */
export function teamBridgeTypingAvailable(
	state: DesktopFeatureState | null | undefined,
): boolean {
	return state === "enabled";
}

/** One typer as the reader holds it: the hub's row plus an absolute deadline. */
export type TypingEntry = {
	accountId: string;
	kind: string;
	threadRootId: string | null;
	/** `Date.now()` at which this entry stops showing even without a new poll. */
	expiresAt: number;
};

/** Turn a GET's relative expiries into absolute deadlines from the fetch time. */
export function typingEntries(
	typers: readonly TeamBridgeTypingTyper[],
	fetchedAt: number,
): TypingEntry[] {
	return typers.map((typer) => ({
		accountId: typer.account_id,
		kind: typer.kind,
		threadRootId: typer.thread_root_id,
		expiresAt: fetchedAt + typer.expires_in_ms,
	}));
}

/**
 * The display names for one composer's scope, in the hub's order (newest
 * expiry first), de-duplicated by account.
 *
 * `scope` is `null` for the main composer and the root id for a thread pane:
 * typing in a thread never shows under the channel composer and vice versa.
 * Self is dropped defensively (the hub already drops the caller), v1 shows
 * humans only (agents have no keystroke phase), and an account whose label
 * cannot be resolved is SKIPPED rather than shown as "Unknown person": an
 * unlabeled line would say less than no line.
 */
export function typingNamesForScope(
	entries: readonly TypingEntry[],
	options: {
		scope: string | null;
		now: number;
		selfAccountId?: string | null;
		labelFor: (accountId: string) => string | null | undefined;
	},
): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const entry of entries) {
		if (entry.expiresAt <= options.now) continue;
		if (entry.kind !== "human") continue;
		if (entry.threadRootId !== options.scope) continue;
		if (options.selfAccountId && entry.accountId === options.selfAccountId)
			continue;
		if (seen.has(entry.accountId)) continue;
		seen.add(entry.accountId);
		const label = options.labelFor(entry.accountId)?.trim();
		if (label) names.push(label);
	}
	return names;
}

/** Which of the four copy forms a set of names takes. */
export type TypingLineForm =
	| { form: "none" }
	| { form: "one"; names: [string] }
	| { form: "two"; names: [string, string] }
	| { form: "three"; names: [string, string, string] }
	| { form: "several" };

export function typingLineForm(names: readonly string[]): TypingLineForm {
	switch (names.length) {
		case 0:
			return { form: "none" };
		case 1:
			return { form: "one", names: [names[0]] };
		case 2:
			return { form: "two", names: [names[0], names[1]] };
		case 3:
			return { form: "three", names: [names[0], names[1], names[2]] };
		default:
			return { form: "several" };
	}
}

/**
 * The earliest moment the shown set can change without a poll: the next
 * entry deadline after `now`, or null when nothing is live.
 */
export function nextTypingExpiry(
	entries: readonly TypingEntry[],
	now: number,
): number | null {
	let next: number | null = null;
	for (const entry of entries)
		if (entry.expiresAt > now && (next === null || entry.expiresAt < next))
			next = entry.expiresAt;
	return next;
}

/**
 * "Show when I'm typing", as this renderer last learned it.
 *
 * `null` is unknown (nothing read yet): the emitter sends, and lop's own
 * `share_typing` check answers `{shared:false}` without calling the hub - at
 * which point this flips to `false` and the emitter goes quiet. The settings
 * section writes it on every read and every toggle, so turning the preference
 * back on resumes sending without a reload. Defence in depth, not the gate:
 * the backend check is authoritative (design §5).
 */
type ShareTypingState = {
	shareTyping: boolean | null;
	setShareTyping: (value: boolean | null) => void;
};

export const useTeamBridgeShareTypingStore = create<ShareTypingState>(
	(set) => ({
		shareTyping: null,
		setShareTyping: (value) => set({ shareTyping: value }),
	}),
);
