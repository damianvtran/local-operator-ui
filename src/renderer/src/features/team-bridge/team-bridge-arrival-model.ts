/**
 * WHICH MESSAGE ROWS MAY PLAY THE ARRIVAL MOTION (operator ask, 2026-10-26).
 *
 * A row animates because the MESSAGE ARRIVED while this view was open, never
 * because the row MOUNTED. History restore, a conversation switch, a paged-in
 * slice, a refetch and a virtual remount draw rows without motion. The journal
 * is keyed by stream identity and by message identity, not by a row component.
 *
 * THE READ AND THE WRITE ARE SEPARATE ON PURPOSE. React may render a tree twice
 * before committing it; a render-time write would consume the arrival on the
 * first pass and make the second pass forget to animate. Callers read with
 * `{ commit: false }` and observe in a layout effect instead.
 *
 * IDENTITY IS THE MESSAGE ID, AND NOTHING ELSE (review round 1, A1/M5). An
 * earlier revision also treated `seq` and a client ref as aliases for the same
 * message, to protect an optimistic row that is replaced by its server row.
 * The shared send journal now owns those rows and the list excludes them from
 * this arrival observer, both before and after confirmation. Their synthetic
 * seq must NEVER advance the remote-arrival watermark. `seq` is numbered PER
 * CONVERSATION, so as an identity token it collided across streams - a live `seq:2` in one conversation
 * lit up seq 2 of the next one. The sequence number is still read, but only as a
 * WATERMARK within one stream: a message whose seq is not above everything this
 * stream has already shown is history being restored (an older page, or a
 * forward page the thread pane asked for), never a live arrival.
 */

export type TeamBridgeArrivalIdentity = { id: string; seq?: number };

type ArrivalStream = {
	seen: Set<string>;
	/** Highest seq this stream has ever shown; history below it never animates. */
	highestSeq: number;
	/** True while the next non-empty read is a restore rather than live traffic. */
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

/** Record the rendered page without deciding that any of it is live. */
export function teamBridgeObserveArrivals(
	key: string,
	messages: readonly TeamBridgeArrivalIdentity[],
): void {
	const stream = streamFor(key);
	if (messages.length === 0) {
		// The list mounts only once its read is ready, so an open empty stream is
		// live: its first message must arrive with motion.
		stream.loading = false;
		return;
	}
	for (const message of messages) {
		stream.seen.add(message.id);
		if (message.seq !== undefined)
			stream.highestSeq = Math.max(stream.highestSeq, message.seq);
	}
	stream.loading = false;
}

/**
 * The ids that are new AND above the stream's own watermark. The default
 * commits the observation for small non-React callers and tests; the rendered
 * list passes `commit: false` and observes in its layout effect.
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
			const newer =
				message.seq === undefined || message.seq > stream.highestSeq;
			if (!stream.seen.has(message.id) && newer) arrived.add(message.id);
		}
	}
	if (commit) teamBridgeObserveArrivals(key, messages);
	return arrived;
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
