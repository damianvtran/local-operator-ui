/**
 * WHICH MESSAGE ROWS MAY PLAY THE ARRIVAL MOTION (operator ask, 2026-10-26).
 *
 * A row animates because the MESSAGE ARRIVED while this view was open, never
 * because the row MOUNTED. History restore, a conversation switch, a paged-in
 * slice, a refetch and a virtual remount draw rows without motion. The journal
 * is keyed by stream identity and by message identity, not by a row component.
 *
 * The read and the journal write are separate on purpose. React may render a
 * tree twice before committing it; a render-time write would consume the
 * arrival on the first pass and make the second pass forget to animate. The
 * list reads with `{ commit: false }` and observes in a layout effect instead.
 *
 * IDENTITY ALIASES COVER OPTIMISTIC -> CONFIRMED. The server's id can replace a
 * client ref without replacing the row's message: `seq` and `client_ref` (or
 * `clientRef`) are aliases for the same identity, so that transition cannot
 * play the motion twice. A locally-built row without either alias cannot be
 * matched to a different server id; callers should provide its next seq.
 */

export type TeamBridgeArrivalIdentity = {
	id: string;
	seq?: number;
	client_ref?: string;
	clientRef?: string;
};

type ArrivalStream = {
	seen: Set<string>;
	highestSeq: number;
	/** True until the first non-empty read has been observed. */
	loading: boolean;
};

const streams = new Map<string, ArrivalStream>();

export const teamBridgeArrivalStreamKey = (
	tenantId: string | undefined,
	conversationId: string | null | undefined,
	rootId?: string | null,
): string =>
	`${tenantId ?? ""}/${conversationId ?? "draft"}${rootId ? `#${rootId}` : ""}`;

function streamFor(key: string): ArrivalStream {
	let stream = streams.get(key);
	if (!stream) {
		stream = { seen: new Set(), highestSeq: -1, loading: true };
		streams.set(key, stream);
	}
	return stream;
}

function aliases(message: TeamBridgeArrivalIdentity): string[] {
	const result = [`id:${message.id}`];
	if (message.seq !== undefined) result.push(`seq:${message.seq}`);
	const ref = message.client_ref ?? message.clientRef;
	if (ref) result.push(`ref:${ref}`);
	return result;
}

/** Every token a row answers to: its id, and its seq/ref aliases. */
export function teamBridgeArrivalTokens(
	message: TeamBridgeArrivalIdentity,
): string[] {
	return aliases(message);
}

/** Record the rendered page without deciding that any of it is live. */
export function teamBridgeObserveArrivals(
	key: string,
	messages: readonly TeamBridgeArrivalIdentity[],
): void {
	const stream = streamFor(key);
	if (messages.length === 0) {
		// The list is mounted only once its read is ready. An OPEN empty stream
		// is therefore live: its first message must arrive with motion too. The
		// page's pending branch does not mount the list or call this observer.
		stream.loading = false;
		return;
	}
	for (const message of messages) {
		for (const alias of aliases(message)) stream.seen.add(alias);
		if (message.seq !== undefined)
			stream.highestSeq = Math.max(stream.highestSeq, message.seq);
	}
	stream.loading = false;
}

/**
 * Return ids that are new, newer than the stream's observed history, and not
 * aliases of an already-rendered row. Older pages therefore stay still even
 * when a caller has not supplied its pagination hold yet.
 *
 * The default commits the observation for small non-React callers and tests;
 * the rendered list passes `commit: false` and commits in its layout effect.
 */
export function teamBridgeLiveArrivals(
	key: string,
	messages: readonly TeamBridgeArrivalIdentity[],
	{ commit = true }: { commit?: boolean } = {},
): Set<string> {
	const stream = streamFor(key);
	const arrived = new Set<string>();
	if (!stream.loading) {
		for (const message of messages) {
			const known = aliases(message).some((alias) => stream.seen.has(alias));
			const newer =
				message.seq === undefined || message.seq > stream.highestSeq;
			if (!known && newer) arrived.add(message.id);
		}
	}
	if (commit) teamBridgeObserveArrivals(key, messages);
	return arrived;
}

/** The seq a locally-built optimistic row should claim for alias matching. */
export function teamBridgeNextSeq(key: string): number {
	return streamFor(key).highestSeq + 1;
}

/** Mark an empty conversation whose read is ready while its view is open. */
export function teamBridgeOpenEmptyArrivals(key: string): void {
	streamFor(key).loading = false;
}

/**
 * A closed stream cannot receive a LIVE arrival. Its already-seen identities
 * stay remembered, but the first page on reopening is a restore even when the
 * poll/cache learned new ids while this view was away.
 */
export function teamBridgeSuspendArrivals(key: string): void {
	const stream = streams.get(key);
	if (stream) stream.loading = true;
}

/** Test seam: the journal deliberately outlives component mounts. */
export function resetTeamBridgeArrivals(): void {
	streams.clear();
}
