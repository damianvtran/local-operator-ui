import type {
	TeamBridgeEvent,
	TeamBridgeEventKind,
	TeamBridgeEventParty,
	TeamBridgeMessage,
	TeamBridgeMessagePage,
} from "../../../../shared/team-bridge-contract";
import {
	teamBridgeEventKind,
	teamBridgeImplicitReason,
} from "../../../../shared/team-bridge-contract";

/**
 * MEMBERSHIP EVENTS IN THE TIMELINE: the pure half (no React, no i18n).
 *
 * EVENTS ARE NOT MESSAGES. A membership change ("Ben invited Sana") is drawn
 * as one quiet line among the messages (docs/branding.md § 7: a completed
 * action is one quiet line), but it is a different wire object with a
 * different counter. Unread counts, notifications, the arrival motion,
 * read cursors, jump-to-unread, the thread pane, search and stick-to-bottom
 * all read `page.messages`; nothing here ever puts an event into that array,
 * and the rendered event row carries no `data-message-id`, so the DOM
 * observers that mark reading never see one either.
 *
 * AFTER_SEQ INTERLEAVE. An event with `after_seq = k` renders after message k
 * and before k + 1 (`after_seq = 0`: before any message). It anchors ONLY to a
 * server row, i.e. one with a numeric `seq`: an optimistic row (no seq, sorted
 * last) is replaced on reconcile, and an event anchored to it would jump. An
 * event newer than every server row therefore sits after the last server row
 * and before any optimistic row, which is what "largest server seq <=
 * after_seq" yields on its own.
 *
 * CURSOR-BOUNDED PAGE OWNERSHIP. A page owns the events with L <= after_seq < U,
 * where L is the oldest message seq on the page when `has_more` (else 0) and U
 * is the page's upper cursor (unbounded on the newest page). The server applies
 * that window; the client re-applies its lower bound whenever it CARRIES events
 * forward, so a carried event never lands above the first message of a page
 * that does not own it.
 *
 * DEDUPE BY ID. Forward polls re-include the boundary (`L = max(A - 1, 0)`), and
 * an event may arrive on two reads; `id` is the only identity. `event_seq` is a
 * per-conversation counter of its own and is NEVER compared with a message seq.
 */

/** The lowest `after_seq` this page owns (contract: L). */
export function teamBridgeEventsLowerBound(
	page: Pick<TeamBridgeMessagePage, "messages" | "has_more">,
): number {
	if (!page.has_more) return 0;
	let lowest: number | undefined;
	for (const message of page.messages) {
		if (typeof message.seq !== "number") continue;
		if (lowest === undefined || message.seq < lowest) lowest = message.seq;
	}
	return lowest ?? 0;
}

/**
 * The next read's page, with events seen on the previous read of the SAME query
 * carried forward and every event deduped by id (the newer copy wins).
 *
 * WHY CARRY AT ALL. A hub caps events per page (`events_truncated`, newest
 * kept), and a forward-poll window can omit an event the previous read
 * returned; without the carry, a line the reader already saw would disappear
 * on the next eight-second poll. The carry is bounded by the NEW page's lower
 * bound, so it never resurrects an event whose messages left the page.
 *
 * Pure and called from ONE line in the query's `queryFn`, so the notify-click
 * lane's `teamBridgeMessagesQueryOptions` factory can call it unchanged.
 * Returns `next` itself when there is nothing to carry or dedupe, so a page with
 * no events stays byte-identical to what the hub sent (and `events` stays absent).
 */
export function withCarriedTeamBridgeEvents(
	previous: TeamBridgeMessagePage | undefined,
	next: TeamBridgeMessagePage,
): TeamBridgeMessagePage {
	const carried = previous?.events ?? [];
	const fresh = next.events ?? [];
	if (carried.length === 0 && fresh.length === 0) return next;
	const lower = teamBridgeEventsLowerBound(next);
	const byId = new Map<string, TeamBridgeEvent>();
	for (const event of carried)
		if (event.after_seq >= lower) byId.set(event.id, event);
	for (const event of fresh) byId.set(event.id, event);
	const events = [...byId.values()].sort((a, b) => b.event_seq - a.event_seq);
	if (events.length === 0) {
		const { events: _dropped, ...rest } = next;
		return rest as TeamBridgeMessagePage;
	}
	return { ...next, events };
}

/** One rendered line: one event, or several rolled up. */
export type TeamBridgeEventLine = {
	/** React key, in its own namespace so it can never collide with a row key. */
	key: string;
	/** A known kind, or null: the line then reads "Membership changed". */
	kind: TeamBridgeEventKind | null;
	/** joined + implicit + owner_invite: "X added their agent Y". */
	ownerAddedAgent: boolean;
	actor: TeamBridgeEventParty;
	/** Every target across the rolled-up events, deduped, in event order. */
	targets: TeamBridgeEventParty[];
	/** The actor is the only target ("Sana joined", "Sana declined the invitation"). */
	selfOnly: boolean;
	/** Latest `at` in the group (the hover time). */
	at: string;
};

const partyKey = (party: TeamBridgeEventParty) =>
	`${party.kind}:${party.account_id}:${party.endpoint_id ?? ""}`;

/**
 * Events at ONE anchor, chronological, rolled up into lines.
 *
 * ROLL-UP: events sharing `request_id` AND `kind` (and the same actor and the
 * same implicit reading, so "added their agent" never merges with "joined")
 * are one API call's writes and read as one line. The optional time-window
 * grouping of different requests is deliberately not done: it would merge
 * lines the server recorded as separate decisions.
 */
export function teamBridgeEventLines(
	events: readonly TeamBridgeEvent[],
): TeamBridgeEventLine[] {
	const ordered = [...events].sort((a, b) => a.event_seq - b.event_seq);
	const lines: TeamBridgeEventLine[] = [];
	const byGroup = new Map<string, TeamBridgeEventLine>();
	for (const event of ordered) {
		/*
		 * AN EVENT WITH NO TARGETS READS AS THE INERT LINE (agent review round 1,
		 * R1-M2). Every naming template puts `{targets}` where a name belongs, so an
		 * empty array rendered "Damian removed " - a sentence with a hole in it. The
		 * contract says `targets` has at least one entry; an event that carries none
		 * has no readable subject, which is exactly the case the unknown-kind line
		 * exists for. Roll-up is unaffected: a rolled-up group is only built for a
		 * readable kind, so `targets: []` always renders its own line.
		 */
		const named = event.targets.length > 0;
		const kind = named ? teamBridgeEventKind(event.kind) : null;
		const ownerAddedAgent =
			kind === "joined" &&
			event.implicit === true &&
			teamBridgeImplicitReason(event.implicit_reason) === "owner_invite";
		const group =
			event.request_id && kind !== null
				? `${event.request_id}\u0000${kind}\u0000${ownerAddedAgent}\u0000${partyKey(event.actor)}`
				: null;
		const existing = group ? byGroup.get(group) : undefined;
		if (existing) {
			const seen = new Set(existing.targets.map(partyKey));
			for (const target of event.targets)
				if (!seen.has(partyKey(target))) existing.targets.push(target);
			if (event.at > existing.at) existing.at = event.at;
			existing.selfOnly = false;
			continue;
		}
		const targets: TeamBridgeEventParty[] = [];
		const seen = new Set<string>();
		for (const target of event.targets) {
			if (seen.has(partyKey(target))) continue;
			seen.add(partyKey(target));
			targets.push(target);
		}
		const line: TeamBridgeEventLine = {
			key: `event:${event.id}`,
			kind,
			ownerAddedAgent,
			actor: event.actor,
			targets,
			selfOnly:
				targets.length === 0 ||
				(targets.length === 1 &&
					partyKey(targets[0]) === partyKey(event.actor)),
			at: event.at,
		};
		lines.push(line);
		if (group) byGroup.set(group, line);
	}
	return lines;
}

/** The anchor for the slot BEFORE the first message (`after_seq` below every row). */
export const TEAM_BRIDGE_EVENTS_LEADING = "leading";

/**
 * Events bucketed by the message id they render after (or `LEADING`).
 *
 * Anchor = the server row with the largest `seq <= after_seq`. Rows without a
 * numeric seq (optimistic) are never anchors. With no server row at all, every
 * event is leading: a new conversation's creation events show above the empty
 * timeline's first send.
 */
export function teamBridgeEventAnchors(
	messages: readonly Pick<TeamBridgeMessage, "id" | "seq">[],
	events: readonly TeamBridgeEvent[] | undefined,
): Map<string, TeamBridgeEvent[]> {
	const anchors = new Map<string, TeamBridgeEvent[]>();
	if (!events || events.length === 0) return anchors;
	const server = messages
		.filter((message) => typeof message.seq === "number")
		.sort((a, b) => a.seq - b.seq);
	const seen = new Set<string>();
	for (const event of events) {
		if (seen.has(event.id)) continue;
		seen.add(event.id);
		let anchor = TEAM_BRIDGE_EVENTS_LEADING;
		// Binary search: the last server row with seq <= after_seq.
		let low = 0;
		let high = server.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (server[mid].seq <= event.after_seq) {
				anchor = server[mid].id;
				low = mid + 1;
			} else high = mid - 1;
		}
		const bucket = anchors.get(anchor);
		if (bucket) bucket.push(event);
		else anchors.set(anchor, [event]);
	}
	return anchors;
}

/** Up to this many names render in full; more read "A, B and N others". */
export const TEAM_BRIDGE_EVENT_NAMES_SHOWN = 2;
