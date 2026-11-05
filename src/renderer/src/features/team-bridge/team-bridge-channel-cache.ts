import type {
	TeamBridgeEvent,
	TeamBridgeMessage,
	TeamBridgeMessagePage,
} from "../../../../shared/team-bridge-contract";
import { withCarriedTeamBridgeEvents } from "./team-bridge-member-events-model";

/**
 * THE TIMELINE'S OWN CACHE ENTRY: a bounded, paged history window per
 * conversation.
 *
 * WHY THIS EXISTS. The timeline read used to be one server page with no
 * `limit`, so a busy channel answered with its ENTIRE history and
 * `TeamBridgeMessageList` mounted a row - markdown, reactions, attachments and
 * all - for every one of them. A conversation with thousands of messages
 * therefore cost thousands of rows on every open and on every 8 s poll, which
 * replaced the whole array and re-rendered it. The hub has paged this route all
 * along (`next_before_seq`, `has_more`, `limit`, `before_seq`); nothing used it.
 *
 * THE SHAPE IS OURS, NOT THE SERVER'S. React Query stays the store - keys,
 * invalidation and the account/tenant isolation in `team-bridge-keys.ts` come
 * free - but the entry is a monotonically growing window with its own cursor,
 * so a poll can merge the newest page into it instead of replacing it. That is
 * what makes polling cheap: every poll reads ONE page regardless of how much
 * history the reader has paged back through.
 *
 * TWO CADENCES, ONE ENTRY. The newest read (`mergeChannelPage(..., "newest")`)
 * may only ever grow the window upward. An older read (`"older"`) may only grow
 * it downward, and owns `hasOlder` from that point on: the newest read's own
 * `has_more` says "history exists below this page", which stays true after the
 * reader has paged through ALL of it, so letting a poll write it would put the
 * "loading earlier messages" affordance back on a channel with nothing older.
 * That rule is why `hasOlder` is LEARNED once (on the first read) and then
 * refined only by older pages and by trimming.
 *
 * BOUNDING IS OLDEST-FIRST, AND IT IS NOT SILENT. A window that only grows is a
 * leak: the cache would hold every message a long session ever scrolled past.
 * The oldest rows are dropped at both bounds (count and bytes) and `hasOlder`
 * is set, so the reader can still page back to what was dropped - the drop is a
 * retention policy, never a hole the UI pretends does not exist.
 *
 * WHAT THIS MODULE IS NOT. No React, no clock, no DOM: every rule here is a pure
 * function so the merge order, the bounds and the anchor arithmetic can be
 * exercised without a renderer (`scripts/team-bridge-channel-cache.test.mjs`).
 */

/* ------------------------------------------------------------------ policy */

/** One page: the reader's first paint, and every poll afterwards. */
export const TEAM_BRIDGE_PAGE_SIZE = 60;

/**
 * Per-conversation retention. 800 rows is roughly a working day of a busy
 * channel (measured: the QA-coordination channel's largest day is ~340 rows) and
 * about two screenfuls of history above the fold at the 44-96px row heights in
 * `team-bridge-window-model.ts` - deep enough that ordinary back-scrolling never
 * re-fetches, small enough that the entry stays a few MB.
 */
export const TEAM_BRIDGE_MAX_RETAINED_MESSAGES = 800;

/**
 * Per-conversation BYTE ceiling. The count bound alone does not bound memory:
 * eight long agent write-ups with code blocks and pasted logs are one row each.
 * A quarter of the account-wide budget keeps a single pathological channel from
 * evicting the twenty ordinary ones.
 */
export const TEAM_BRIDGE_MAX_CHANNEL_BYTES = 12 * 1024 * 1024;

/**
 * Account-wide budget across conversation entries, and how many conversations
 * may hold one. 48 MB is the renderer's share we are willing to give one
 * feature on a machine also running the rest of the app; 20 conversations is
 * more channels than a person switches between in a session, so the eviction
 * only ever bites a long tail of ones they have left.
 */
export const TEAM_BRIDGE_CACHE_BUDGET_BYTES = 48 * 1024 * 1024;
export const TEAM_BRIDGE_MAX_CONVERSATIONS = 20;

/**
 * Freshness. A cached conversation paints IMMEDIATELY from its window and
 * revalidates in the background (30 s), rather than holding the pane on a
 * spinner per view - the timeline is the page's main surface and the reader is
 * looking at a conversation they already had in cache most of the time. The
 * 8 s poll still runs underneath (see `useTeamBridgeMessages`), so 30 s only
 * decides when a VIEW is allowed to paint stale data, not how often the data
 * moves. 30 min of garbage collection covers an afternoon of switching back and
 * forth without re-reading from the hub, and is short enough that a closed
 * conversation is not held for the life of the window.
 */
export const TEAM_BRIDGE_HISTORY_STALE_MS = 30_000;
export const TEAM_BRIDGE_HISTORY_GC_MS = 30 * 60_000;

/**
 * A per-row overhead estimate for the bytes bound: the row object, its sender,
 * its id/date strings and the wire fields we keep for rendering. Deliberately a
 * CONSTANT rather than a serialization: this feeds an eviction heuristic, and an
 * exact size would cost more to compute (a JSON walk per message per merge) than
 * the heuristic's error is worth.
 */
const ROW_OVERHEAD_BYTES = 320;
/** One attachment/file entry: its id, name and type, plus the array's own slot. */
const ATTACHMENT_OVERHEAD_BYTES = 192;

/* -------------------------------------------------------------------- shape */

/**
 * What one conversation's cache entry holds.
 *
 * `messages` is the retained window, ASCENDING by `seq` and deduped by `id`, so
 * every consumer reads history in the order it happened. Optimistic rows are
 * never in here: they live in `team-bridge-pending-sends.ts` and are merged over
 * the window at render time, so a poll can never drop one.
 */
export type ChannelMessages = {
	messages: TeamBridgeMessage[];
	/** Cursor for the next older page: the oldest retained message's seq. */
	oldestSeq?: number;
	hasOlder: boolean;
	approxBytes: number;
	/** Membership lines that ride the page; carried and deduped like messages. */
	events?: TeamBridgeEvent[];
	eventsTruncated?: boolean;
};

/* ------------------------------------------------------------------ merging */

/**
 * THE MERGE. Two pages of the same conversation, any order, any overlap.
 *
 * Dedupe is by `id` - the hub's identity, and the only field two reads of one
 * message agree on. `seq` is the sort key and is numeric on every hub row (the
 * contract has it required), so ascending `seq` is chronological. Duplicates
 * resolve to the INCOMING copy: a re-read of a message can carry a newer
 * reaction rollup or thread rollup, and the read that just happened is the
 * fresher statement.
 *
 * STABILITY FOR EQUAL SEQ IS LOAD-BEARING. `Array#sort` is stable, and the map
 * is filled existing-first, so two rows sharing a seq keep the retained window's
 * order and the incoming page can never reshuffle rows the reader is looking at.
 * The hub does not issue duplicate seqs today; a proxy or a future cursor change
 * that did would otherwise make the timeline flicker on every poll.
 *
 * THE STALE/GAP EDGE. A page whose boundary sits between two retained rows, or
 * one delivered out of order (an older page answering after a newer poll), adds
 * only what is new: the union keeps every row either side had, so the newest row
 * can never be lost by an older page landing late.
 */
export function mergeChannelMessages(
	existing: readonly TeamBridgeMessage[],
	incoming: readonly TeamBridgeMessage[],
): TeamBridgeMessage[] {
	if (incoming.length === 0) return [...existing];
	const byId = new Map<string, TeamBridgeMessage>();
	for (const message of existing) byId.set(message.id, message);
	for (const message of incoming) byId.set(message.id, message);
	const merged = [...byId.values()];
	merged.sort((a, b) => a.seq - b.seq);
	return merged;
}

/** The oldest retained row's seq, i.e. the next older page's cursor. */
export function oldestRowSeq(
	messages: readonly TeamBridgeMessage[],
): number | undefined {
	let oldest: number | undefined;
	for (const message of messages)
		if (oldest === undefined || message.seq < oldest) oldest = message.seq;
	return oldest;
}

/**
 * An estimate of what one row costs in memory, for the bytes bound.
 *
 * Bodies are UTF-16 in the renderer, so the character count is doubled rather
 * than measured as UTF-8 (a body of CJK text is half the byte count of its
 * in-memory size, and the bound is about memory).
 */
export function approxMessageBytes(message: TeamBridgeMessage): number {
	const body = message.body?.length ?? 0;
	const sender = message.sender.display_label.length;
	const attachments = message.attachments?.length ?? 0;
	const files = message.files?.length ?? 0;
	return (
		ROW_OVERHEAD_BYTES +
		2 * (body + sender) +
		(attachments + files) * ATTACHMENT_OVERHEAD_BYTES
	);
}

export function approxChannelBytes(
	messages: readonly TeamBridgeMessage[],
): number {
	let total = 0;
	for (const message of messages) total += approxMessageBytes(message);
	return total;
}

/**
 * Trim a window from the OLDEST end until both bounds hold.
 *
 * Oldest-first is the only defensible order: the newest rows are what the reader
 * is looking at or about to, and the newest is also what a poll keeps re-reading
 * - dropping from that end would drop the rows that arrive again next tick.
 * Returns whether anything was dropped, because a drop is what re-opens
 * `hasOlder` (see `mergeChannelPage`).
 */
export function boundChannelMessages(
	messages: readonly TeamBridgeMessage[],
	limits: {
		maxMessages?: number;
		maxBytes?: number;
	} = {},
): { messages: TeamBridgeMessage[]; dropped: boolean } {
	const maxMessages = limits.maxMessages ?? TEAM_BRIDGE_MAX_RETAINED_MESSAGES;
	const maxBytes = limits.maxBytes ?? TEAM_BRIDGE_MAX_CHANNEL_BYTES;
	let start = 0;
	let bytes = approxChannelBytes(messages);
	while (
		start < messages.length &&
		(messages.length - start > maxMessages || bytes > maxBytes)
	) {
		bytes -= approxMessageBytes(messages[start]);
		start += 1;
	}
	return start === 0
		? { messages: [...messages], dropped: false }
		: { messages: messages.slice(start), dropped: true };
}

/**
 * Fold ONE server page into the retained window.
 *
 * `direction` is the read's intent, not a guess from the page's contents: the
 * newest read is the poll (grow upward, keep the learned `hasOlder`), the older
 * read is proximity paging (grow downward, own `hasOlder` from the server's own
 * `has_more`). A page that returns nothing on the older read ends the history
 * rather than leaving a cursor that would ask forever.
 */
export function mergeChannelPage(
	previous: ChannelMessages | undefined,
	page: TeamBridgeMessagePage,
	direction: "newest" | "older",
	limits: { maxMessages?: number; maxBytes?: number } = {},
): ChannelMessages {
	/* Membership lines keep their existing carry: the same dedupe-by-id, the
	   same "newer copy wins", and the same bound to the page that owns them. */
	const carrying = withCarriedTeamBridgeEvents(
		previous === undefined
			? undefined
			: {
					messages: previous.messages,
					has_more: previous.hasOlder,
					events: previous.events,
				},
		page,
	);
	const bounded = boundChannelMessages(
		mergeChannelMessages(previous?.messages ?? [], page.messages),
		limits,
	);
	const learned =
		direction === "older"
			? page.messages.length > 0 && (page.has_more ?? false)
			: (previous?.hasOlder ?? page.has_more ?? false);
	const oldestSeq = oldestRowSeq(bounded.messages);
	return {
		messages: bounded.messages,
		...(oldestSeq === undefined ? {} : { oldestSeq }),
		/* A trimmed window always has older history to offer, whatever the last
		   page said: the rows are on the hub, we dropped our copy. */
		hasOlder: learned || bounded.dropped,
		approxBytes: approxChannelBytes(bounded.messages),
		...(carrying.events === undefined ? {} : { events: carrying.events }),
		...(carrying.events_truncated === undefined
			? {}
			: { events_truncated: carrying.events_truncated }),
	};
}

/** The window with rows replaced in place (a thread-unread write), re-bounded. */
export function withChannelMessages(
	entry: ChannelMessages,
	messages: readonly TeamBridgeMessage[],
): ChannelMessages {
	const bounded = boundChannelMessages(messages);
	const oldestSeq = oldestRowSeq(bounded.messages);
	return {
		...entry,
		messages: bounded.messages,
		...(oldestSeq === undefined ? {} : { oldestSeq }),
		hasOlder: entry.hasOlder || bounded.dropped,
		approxBytes: approxChannelBytes(bounded.messages),
	};
}

/* ---------------------------------------------------------------- eviction */

/** One conversation entry, as the eviction policy sees it. */
export type ChannelEntryUsage = { key: string; approxBytes: number };

/**
 * Which conversations leave the cache, in order.
 *
 * LEAST-RECENTLY-VIEWED, never the one on screen. Recency is the order in which
 * conversations were OPENED (`rememberChannelView`), not the order their data
 * last moved: a conversation the reader looked at a minute ago and the poll has
 * not touched is more valuable than one a background watcher refreshed and
 * nobody has opened. An entry the order does not know about is the oldest kind
 * there is - it was written by a reader that is no longer mounted.
 *
 * The active conversation is excluded even if it is both the oldest and the
 * only thing over budget: evicting what is on screen trades a memory bound for
 * a spinner in front of the reader, and the poll would only read it straight
 * back.
 */
export function selectChannelEvictions(
	entries: readonly ChannelEntryUsage[],
	viewed: readonly string[],
	activeKey: string | null,
	limits: {
		maxConversations?: number;
		maxBytes?: number;
	} = {},
): string[] {
	const maxConversations =
		limits.maxConversations ?? TEAM_BRIDGE_MAX_CONVERSATIONS;
	const maxBytes = limits.maxBytes ?? TEAM_BRIDGE_CACHE_BUDGET_BYTES;
	const rank = new Map<string, number>();
	viewed.forEach((key, index) => {
		if (!rank.has(key)) rank.set(key, index);
	});
	const byAge = [...entries].sort((a, b) => {
		const ra = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
		const rb = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
		/* Same age: the bigger entry goes first, which frees the most memory for
		   the fewest evictions. */
		return ra === rb ? b.approxBytes - a.approxBytes : rb - ra;
	});
	let count = entries.length;
	let bytes = entries.reduce((total, entry) => total + entry.approxBytes, 0);
	const evicted: string[] = [];
	for (const entry of byAge) {
		if (count <= maxConversations && bytes <= maxBytes) break;
		if (entry.key === activeKey) continue;
		evicted.push(entry.key);
		count -= 1;
		bytes -= entry.approxBytes;
	}
	return evicted;
}

/**
 * The view order the eviction policy reads, most recent first.
 *
 * A module-level list is enough - it is one renderer session's own navigation
 * history, it never leaves memory, and it is rebuilt as conversations are
 * opened. It holds no message body, no title and nothing that is written to
 * disk: the value is a cache-key string, which is already the identity React
 * Query holds.
 */
const VIEW_ORDER: string[] = [];
const VIEW_ORDER_CAP = 200;

/** Record that a conversation is on screen now. */
export function rememberChannelView(key: string): void {
	const at = VIEW_ORDER.indexOf(key);
	if (at !== -1) VIEW_ORDER.splice(at, 1);
	VIEW_ORDER.unshift(key);
	if (VIEW_ORDER.length > VIEW_ORDER_CAP) VIEW_ORDER.length = VIEW_ORDER_CAP;
}

/** A snapshot, for the eviction pass and for tests. */
export function channelViewOrder(): readonly string[] {
	return VIEW_ORDER;
}
