import { onDraftRevocation } from "@shared/store/team-bridge-draft-account";
import { create } from "zustand";
import {
	type TeamBridgeMessage,
	teamBridgeMessageSchema,
} from "../../../../shared/team-bridge-contract";

/**
 * OPTIMISTIC SENDS: the author's own message is on screen the moment Send is
 * pressed, and is replaced in place by its server row when that row exists.
 *
 * WHY (operator report, 2026-10-30): "It takes a really long time for my message
 * to appear when sending the first message to someone or their agent." There was
 * no optimistic row at all. A send drew nothing until the POST returned AND the
 * thread refetched; a FIRST message was fully serial behind that - create the
 * conversation, post, refetch the list, refetch the thread - while the pane sat on
 * the person's intro or "No messages yet".
 *
 * WHY A MODULE STORE AND NOT REACT-QUERY'S `onMutate`. Two of the three send paths
 * never touch the thread cache: a first message posts straight to the API into a
 * conversation that has no cache entry yet, and the page view REMOUNTS when its
 * draft key changes (a compose draft becomes a conversation; the merged view's
 * tenant resolves). A row that must survive both lives outside the component and
 * outside any one query key. The thread cache is never written: the server page
 * stays the server's, and the view MERGES these rows over it at render time, so a
 * poll or a focus refetch cannot drop a row it never held.
 *
 * IDENTITY. `localId` is minted once per message and is the row's React key and
 * arrival identity for its whole life - including after its server row replaces
 * it - so the replacement is the SAME list item (no remount, no arrival motion).
 * `clientRef` is the idempotency key and is MUTABLE: the page's one automatic retry
 * on a 409 `client_ref_conflict` re-keys the message (PR #1512), and the row follows
 * the new key rather than leaving an orphan beside a duplicate.
 *
 * MATCHING A SERVER ROW. The hub does NOT return `client_ref` on message rows
 * (agent-server `models/bridge_conversation.go`: `json:"-"`), so the match is made
 * through the send RESPONSE, which is the stored message: its `id` becomes
 * `serverId`. A thread poll can land between the hub committing the row and the
 * POST answering; then the row is matched by what it must be - our own account,
 * the same body, a seq above everything the thread held when the message was
 * sent - so the two copies are never on screen together, even for one frame.
 */

/** `sent`: the hub took it; the entry stays as the server row's key alias. */
export type PendingSendStatus = "pending" | "failed" | "sent";

export type PendingSend = {
	/** Stable row identity: React key and arrival-journal id, never sent. */
	localId: string;
	/** The idempotency key the CURRENT attempt carries (re-keyed on a 409 retry). */
	clientRef: string;
	body: string;
	/** Local press time; the row's clock until the server row replaces it. */
	createdAt: string;
	/** Send order, for rows the server has not numbered yet. */
	order: number;
	/** The Radient account that sent it: a sign-out never shows it to the next one. */
	owner: string;
	/** `draftTargetKey` of the view it was typed in (person, chief, compose, conversation). */
	lane: string;
	/** Known at once for an existing conversation; set when a first send creates one. */
	conversationId?: string;
	tenantId?: string;
	/** Highest server seq the thread held at the press; a fallback match must be above it. */
	baselineSeq: number;
	/** The stored message's id, from the send response. */
	serverId?: string;
	/**
	 * The send response itself (the hub answers with the stored message). Drawn in
	 * place of the local row until the thread's own page carries it, so the row is
	 * the server's from the moment the POST answers, not from the next refetch.
	 */
	serverRow?: TeamBridgeMessage;
	status: PendingSendStatus;
	/** The one automatic 409 retry this message may spend (PR #1512's rule). */
	autoRetried?: boolean;
};

type PendingSendsState = {
	entries: readonly PendingSend[];
	add: (entry: PendingSend) => void;
	patch: (localId: string, change: Partial<PendingSend>) => void;
	remove: (localId: string) => void;
};

/*
 * Settled rows are KEPT as aliases (server id -> local id) so a later refetch still
 * renders the server row under the local key; without the alias the next poll would
 * remount it as a new item. Bounded so a long session does not grow without limit:
 * an alias older than this many sends is for a row long scrolled past, whose remount
 * nobody can see.
 */
const SETTLED_KEPT = 200;

let nextOrder = 0;
export const nextPendingOrder = () => {
	nextOrder += 1;
	return nextOrder;
};

export const usePendingSends = create<PendingSendsState>()((set) => ({
	entries: [],
	add: (entry) =>
		set((state) => {
			const entries = [...state.entries, entry];
			const settled = entries.filter((row) => row.status === "sent");
			if (settled.length <= SETTLED_KEPT) return { entries };
			const drop = new Set(
				settled
					.slice(0, settled.length - SETTLED_KEPT)
					.map((row) => row.localId),
			);
			return { entries: entries.filter((row) => !drop.has(row.localId)) };
		}),
	patch: (localId, change) =>
		set((state) => ({
			entries: state.entries.map((row) =>
				row.localId === localId ? { ...row, ...change } : row,
			),
		})),
	remove: (localId) =>
		set((state) => ({
			entries: state.entries.filter((row) => row.localId !== localId),
		})),
}));

/**
 * The rows a view shows: this account's sends for this conversation, or - before a
 * conversation exists - for the draft target the reader is looking at. A first send
 * to a person is typed in lane `person:<id>` and later carries the DM's id, so it
 * matches both the person view and the conversation view it becomes.
 */
export function pendingForView(
	entries: readonly PendingSend[],
	view: { owner: string | undefined; lane: string; conversationId?: string },
): PendingSend[] {
	if (!view.owner) return [];
	return entries.filter(
		(row) =>
			row.owner === view.owner &&
			(view.conversationId !== undefined && row.conversationId !== undefined
				? row.conversationId === view.conversationId
				: row.lane === view.lane),
	);
}

export type MergedTimeline = {
	messages: TeamBridgeMessage[];
	/** Stable list key: the local id for a sent row and for its server replacement. */
	keyOf: (message: TeamBridgeMessage) => string;
	/** The send behind a row this client drew (not yet on the server's page). */
	localOf: (message: TeamBridgeMessage) => PendingSend | undefined;
	/** How many rows are drawn from the local store rather than the server page. */
	localCount: number;
};

/**
 * Lay the local rows over the server page.
 *
 * - A server row a send claims - by `serverId`, else (no answer yet, or a failure
 *   whose request landed after all) by our own account + same body + a seq above the
 *   press-time baseline - is drawn as the server's, under the send's local key.
 * - An unclaimed send is drawn after the server page, in send order: its response
 *   row when the POST answered, else a synthetic row built from what was typed. A
 *   settled send whose row the page no longer reaches (paged out) is not drawn.
 * - Drawn rows get display seqs above the page so `threadItems`' seq sort keeps
 *   them last and in press order; the list reads `localOf` and never treats those
 *   seqs as an arrival watermark.
 */
export function mergeOptimisticMessages(
	server: readonly TeamBridgeMessage[],
	sends: readonly PendingSend[],
	self: TeamBridgeMessage["sender"] | null,
	conversationId: string | undefined,
): MergedTimeline {
	const byServerId = new Map<string, PendingSend>();
	const claimed = new Set<string>();
	const ordered = [...sends].sort((a, b) => a.order - b.order);
	const onPage = new Set(server.map((row) => row.id));
	for (const send of ordered)
		if (send.serverId && onPage.has(send.serverId)) {
			byServerId.set(send.serverId, send);
			claimed.add(send.localId);
		}
	const bySeq = [...server].sort((a, b) => a.seq - b.seq);
	for (const send of ordered) {
		if (claimed.has(send.localId) || send.serverId || !self) continue;
		const match = bySeq.find(
			(row) =>
				!byServerId.has(row.id) &&
				row.sender.account_id === self.account_id &&
				row.sender.kind === self.kind &&
				row.body === send.body &&
				row.seq > send.baselineSeq,
		);
		if (match) {
			byServerId.set(match.id, send);
			claimed.add(send.localId);
		}
	}
	let top = server.reduce((max, row) => Math.max(max, row.seq), -1);
	/*
	 * A CONFIRMED ROW THE PAGE HAS NOT CAUGHT UP WITH STILL COUNTS (design round 1,
	 * D2). Its seq comes from the hub, so a pending row numbered from the PAGE alone
	 * could sort above it and the two swapped once the page landed. The watermark is
	 * therefore every server row this client knows of - the page and the responses.
	 */
	const known = new Set(server.map((row) => row.id));
	for (const send of ordered)
		if (send.serverRow && !known.has(send.serverRow.id))
			top = Math.max(top, send.serverRow.seq);
	const pageTop = server.reduce((max, row) => Math.max(max, row.seq), -1);
	const local = new Map<string, PendingSend>();
	const drawn: TeamBridgeMessage[] = [];
	for (const send of ordered) {
		if (claimed.has(send.localId) || !self) continue;
		// A settled row the page has moved past is history, not something to append.
		if (send.serverRow && send.serverRow.seq <= pageTop) continue;
		/*
		 * A CONFIRMED row keeps the hub's own seq - it is a real position, and the
		 * arrival watermark may read it. A row the hub has not numbered yet gets a
		 * display seq above the page, which callers must not treat as real
		 * (`localOf(...).status` is what tells them apart).
		 */
		if (!send.serverRow) top += 1;
		local.set(send.localId, send);
		drawn.push({
			...(send.serverRow ?? {
				conversation_id: conversationId ?? send.conversationId ?? "",
				sender: self,
				body: send.body,
				origin: "human" as const,
				created_at: send.createdAt,
			}),
			id: send.localId,
			seq: send.serverRow?.seq ?? top,
		} as TeamBridgeMessage);
	}
	return {
		messages: drawn.length === 0 ? [...server] : [...server, ...drawn],
		keyOf: (message) => byServerId.get(message.id)?.localId ?? message.id,
		localOf: (message) => local.get(message.id),
		localCount: drawn.length,
	};
}

/*
 * ONE SEND AT A TIME PER CONVERSATION LANE. Posts are serialized so the hub numbers
 * them in press order (two quick messages keep their order however the network
 * answers), and so a second message typed while a first DM or group is still being
 * CREATED posts into that conversation instead of creating another: the lane
 * remembers the conversation its first job resolved, and the conversation's own
 * lane key is aliased onto it so a send from the conversation's view queues behind
 * the draft's. Module-level because the job outlives the view that queued it (the
 * view remounts when a compose draft becomes a conversation).
 */
/** The lane a conversation's own sends queue on. */
export const conversationLaneKey = (conversationId: string) =>
	`conversation:${conversationId}`;

export type SendLane = {
	tail: Promise<unknown>;
	resolved?: { conversationId: string; tenantId: string | undefined };
};
const lanes = new Map<string, SendLane>();

export function enqueueOnLane<T>(
	laneKey: string,
	job: (lane: SendLane) => Promise<T>,
): Promise<T> {
	const lane = lanes.get(laneKey) ?? { tail: Promise.resolve() };
	lanes.set(laneKey, lane);
	const run = lane.tail.catch(() => undefined).then(() => job(lane));
	lane.tail = run;
	/*
	 * A DRAINED LANE FORGETS ITS CONVERSATION (review round 1, B2). The remembered
	 * create is what lets a second message typed during a first send land in the
	 * conversation that send made; keeping it after the queue is empty is how a
	 * LATER draft with the same lane identity posted into an earlier conversation.
	 * Lane identity includes the full draft (see the view's `laneIdentity`), so this
	 * cannot cross drafts - but "cannot" was exactly what the shared `compose` lane
	 * assumed before it sent a message to the wrong group.
	 */
	void run
		.catch(() => undefined)
		.then(() => {
			if (lanes.get(laneKey) === lane && lane.tail === run)
				lanes.delete(laneKey);
		});
	return run;
}

/** A draft lane created its conversation: later sends from either view share it. */
export function resolveLane(
	laneKey: string,
	conversationLaneKey: string,
	resolved: { conversationId: string; tenantId: string | undefined },
): void {
	const lane = lanes.get(laneKey) ?? { tail: Promise.resolve() };
	lane.resolved = resolved;
	lanes.set(laneKey, lane);
	if (!lanes.has(conversationLaneKey)) lanes.set(conversationLaneKey, lane);
}

/*
 * NOTHING UNSENT OUTLIVES THE ACCOUNT (review round 1, M3).
 *
 * Drafts, the composer's rows and the send-attempt records all register with the
 * same revocation fence; the pending rows and the lane map are the operator's
 * unsent words in the same sense, and a failed row came back with a live Retry for
 * the next account to sign in. Registered here, beside the state it clears, so no
 * caller can forget it.
 */
onDraftRevocation(() => {
	lanes.clear();
	usePendingSends.setState({ entries: [] });
});

/** The send response, if it is the stored message (older hubs answer less). */
export function serverRowOf(result: unknown): TeamBridgeMessage | undefined {
	const parsed = teamBridgeMessageSchema.safeParse(result);
	return parsed.success ? parsed.data : undefined;
}

/** Test seam: a fresh process for each case. */
export function resetPendingSendsForTest(): void {
	lanes.clear();
	nextOrder = 0;
	usePendingSends.setState({ entries: [] });
}
