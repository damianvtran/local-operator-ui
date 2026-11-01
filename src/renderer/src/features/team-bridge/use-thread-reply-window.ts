import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	CancelledError,
	type InfiniteData,
	useInfiniteQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";

export type ReplyWindowMode = "desc" | "legacy";
export type ReplyWindowPage = {
	root: { id: string; conversation_id: string; thread_root_id?: string | null };
	replies: readonly {
		id: string;
		seq: number;
		conversation_id?: string;
		thread_root_id?: string | null;
	}[];
	has_more?: boolean;
	next_before_seq?: number | null;
	next_after_seq?: number | null;
	order?: "asc" | "desc";
};
class UnsupportedReplyWindow extends Error {}

/** A missing echo is an old hub, NOT a newest page. Discard it before caching.
 * An explicit wrong echo is malformed, not a reason to mask a refusal/failure.
 */
export function admitReplyWindow<P extends ReplyWindowPage>(page: P): P {
	if (page.order === undefined) throw new UnsupportedReplyWindow();
	if (page.order !== "desc") throw new Error("Thread response order mismatch");
	return page;
}
export function unsupportedReplyWindow(error: unknown): boolean {
	return (
		error instanceof UnsupportedReplyWindow ||
		(error instanceof DesktopControlError &&
			error.status === 422 &&
			error.code === "invalid_request")
	);
}

/** The hub sorts EACH page chronologically, even in backward mode. Reverse
 * page order only; reversing items would invert a page and corrupt chronology.
 */
export function replyWindowRows<Row extends { id: string; seq: number }>(
	pages: readonly { replies: readonly Row[] }[],
	mode: ReplyWindowMode,
): Row[] {
	const ordered = mode === "desc" ? [...pages].reverse() : pages;
	const rows = new Map<string, Row>();
	for (const page of ordered)
		for (const row of page.replies) rows.set(row.id, row);
	return [...rows.values()];
}

type ReplyWindowAttempt = {
	signal: AbortSignal;
	older: boolean;
	first: boolean;
	live: boolean;
	hadRows: boolean;
};
type ReplyWindowState = {
	key: string;
	upperBound?: number;
	latest?: { id: string; seq: number };
	pendingNewer: boolean;
	attempt?: ReplyWindowAttempt;
};

/** Peek and painted pages cross the SAME admission boundary. In particular a
 * logical undefined pageParam may have an actual fixed before cursor; validate
 * the request that went over the wire, not TanStack's logical page label.
 */
function validateReplyPage<P extends ReplyWindowPage>(
	page: P,
	identity: { conversationId: string; rootId: string },
	mode: ReplyWindowMode,
	cursor: number | undefined,
	limit: 1 | 50,
): P {
	if (
		page.root.id !== identity.rootId ||
		page.root.conversation_id !== identity.conversationId ||
		page.root.thread_root_id ||
		page.replies.some(
			(row) =>
				row.id === identity.rootId ||
				row.conversation_id !== identity.conversationId ||
				row.thread_root_id !== identity.rootId,
		)
	)
		throw new Error("Thread response identity mismatch");
	if (mode === "desc") admitReplyWindow(page);
	// Tuple ordering cannot detect one ID reused at two different sequences.
	// Bound the response before constructing the identity set.
	if (
		page.replies.length > limit ||
		new Set(page.replies.map((row) => row.id)).size !== page.replies.length ||
		page.replies.some((row, index) => {
			const prior = page.replies[index - 1];
			return (
				!Number.isSafeInteger(row.seq) ||
				row.seq <= 0 ||
				(prior &&
					(prior.seq > row.seq ||
						(prior.seq === row.seq && prior.id >= row.id)))
			);
		})
	)
		throw new Error("Thread response page ordering mismatch");
	if (
		cursor !== undefined &&
		page.replies.some((row) =>
			mode === "desc" ? row.seq >= cursor : row.seq < cursor,
		)
	)
		throw new Error("Thread response cursor boundary mismatch");
	if (page.has_more) {
		const expected =
			mode === "desc"
				? page.replies[0]?.seq
				: (page.replies.at(-1)?.seq ?? -1) + 1;
		const returned =
			mode === "desc" ? page.next_before_seq : page.next_after_seq;
		if (
			expected === undefined ||
			!Number.isSafeInteger(expected) ||
			expected <= 0 ||
			returned !== expected
		)
			throw new Error("Thread response cursor mismatch");
	}
	return page;
}

/** Member and owner reads share mode negotiation, but never authority/cache.
 * The caller wraps each read with its existing captured-owner/epoch fence.
 * Direction belongs in the query key: a legacy page must NEVER populate DESC.
 */
export function useThreadReplyWindow<P extends ReplyWindowPage>({
	queryKey,
	identity,
	read,
	canEvict,
	isAtLiveEdge,
	poll = false,
	enabled = true,
	retry = false,
	retryDelay,
	refetchOnWindowFocus,
	refetchOnReconnect,
	retryOnMount,
}: {
	queryKey: readonly string[];
	identity: { conversationId: string; rootId: string };
	read: (mode: ReplyWindowMode, cursor?: number, limit?: 1 | 50) => Promise<P>;
	canEvict?: (page: P) => boolean;
	/** The real scroll controller: hold() can unpin without moving the viewport. */
	isAtLiveEdge?: () => boolean;
	poll?: boolean;
	// Owner audit retains its authority gate and bounded recovery policy;
	// member reads keep the existing defaults instead of inheriting that policy.
	enabled?: boolean;
	retry?: false | ((failureCount: number, error: unknown) => boolean);
	retryDelay?: number;
	refetchOnWindowFocus?: boolean;
	refetchOnReconnect?: boolean;
	retryOnMount?: boolean;
}) {
	const client = useQueryClient();
	const scope = JSON.stringify(queryKey);
	const [negotiated, setNegotiated] = useState({
		scope,
		mode: "desc" as ReplyWindowMode,
	});
	const mode = negotiated.scope === scope ? negotiated.mode : "desc";
	const key = [...queryKey, mode] as const;
	const keyScope = JSON.stringify(key);
	// O(1) control metadata only. No second message store, old-body merge,
	// snapshot-retention structuralSharing hook, or extra query subscription.
	const windowRef = useRef<ReplyWindowState>({
		key: keyScope,
		pendingNewer: false,
	});
	if (windowRef.current.key !== keyScope)
		windowRef.current = { key: keyScope, pendingNewer: false };
	const query = useInfiniteQuery({
		queryKey: key,
		initialPageParam: undefined as number | undefined,
		maxPages: 6,
		gcTime: 0,
		enabled,
		retry,
		retryDelay,
		refetchOnWindowFocus,
		refetchOnReconnect,
		retryOnMount,
		queryFn: async ({ pageParam, signal }) => {
			const state = windowRef.current;
			const ensureCurrent = () => {
				if (
					signal.aborted ||
					windowRef.current !== state ||
					state.key !== keyScope
				)
					throw new CancelledError({ revert: true });
			};
			ensureCurrent();
			const cached = client.getQueryData<InfiniteData<P>>(key);
			const cachedMax =
				cached?.pages.reduce(
					(max, page) => Math.max(max, page.replies.at(-1)?.seq ?? 0),
					0,
				) ?? 0;
			// The window TOP, never pageParams[0]: after maxPages eviction that entry
			// is the oldest retained page's BEFORE cursor, so using it would fetch
			// rows BELOW the newest admitted row and slide the boundary again.
			const fixedBoundary = () => {
				const bound = state.upperBound ?? cachedMax + 1;
				if (!Number.isSafeInteger(bound) || bound <= 0)
					throw new Error("Thread upper boundary is not representable");
				return bound;
			};
			// One signal identifies an entire infinite-query fetch attempt. Capture
			// fetchMore at its start: direction/pageParam also occur during ordinary
			// polling and invalidation, neither of which inserts/evicts a page.
			if (state.attempt?.signal !== signal) {
				const older =
					client.getQueryState(key)?.fetchMeta?.fetchMore?.direction ===
						"forward" && pageParam !== undefined;
				if (
					mode === "desc" &&
					!older &&
					cachedMax > 0 &&
					(!(isAtLiveEdge?.() ?? true) ||
						typeof cached?.pageParams[0] === "number" ||
						state.upperBound !== undefined)
				)
					state.upperBound = fixedBoundary();
				state.attempt = {
					signal,
					older,
					first: true,
					live: mode === "desc" && state.upperBound === undefined,
					hadRows: cachedMax > 0,
				};
			}
			const attempt = state.attempt;
			const first = attempt.first;
			attempt.first = false;
			const actualCursor =
				first && !attempt.older && mode === "desc"
					? (state.upperBound ?? pageParam)
					: pageParam;
			const validateStableIDs = (page: P) => {
				const current = client.getQueryData<InfiniteData<P>>(key);
				const known = new Map(
					current?.pages.flatMap((prior) =>
						prior.replies.map((row) => [row.id, row.seq] as const),
					) ?? [],
				);
				if (
					page.replies.some(
						(row) => known.has(row.id) && known.get(row.id) !== row.seq,
					)
				)
					throw new Error("Thread response sequence identity mismatch");
			};
			let page: P;
			try {
				if (
					first &&
					!attempt.older &&
					mode === "desc" &&
					actualCursor !== undefined
				) {
					// Same authority/read path, LIMIT1, no mark-read mutation. Keep
					// only id/seq; the peek's body/root/attachments never enter cache.
					const peek = validateReplyPage(
						await read(mode, undefined, 1),
						identity,
						mode,
						undefined,
						1,
					);
					ensureCurrent();
					validateStableIDs(peek);
					const latest = peek.replies.at(-1);
					state.latest = latest
						? { id: latest.id, seq: latest.seq }
						: undefined;
					state.pendingNewer = Boolean(latest && latest.seq > cachedMax);
				}
				// Rebuild every loaded page from fresh projections at a FIXED upper
				// bound. Never resurrect an omitted body/root/admission field from
				// oldData. Six loaded pages cost at most6*50+1 replies per refresh;
				// this is bounded fresh coverage, NOT a transaction/snapshot claim.
				page = validateReplyPage(
					await read(mode, actualCursor, 50),
					identity,
					mode,
					actualCursor,
					50,
				);
				ensureCurrent();
				validateStableIDs(page);
			} catch (error) {
				// Only an initial unsupported query can negotiate a legacy key.
				// Peek/page auth/epoch/root/permanent errors always win; never turn
				// them into a retained-success transcript or a silent retry.
				if (
					mode === "desc" &&
					first &&
					!cached?.pages.length &&
					actualCursor === undefined &&
					!signal.aborted &&
					unsupportedReplyWindow(error)
				) {
					setNegotiated({ scope, mode: "legacy" });
					throw new CancelledError({ revert: true });
				}
				throw error;
			}
			if (first && attempt.live) {
				const latest = page.replies.at(-1);
				state.latest = latest ? { id: latest.id, seq: latest.seq } : undefined;
			}
			if (
				!attempt.older &&
				attempt.live &&
				attempt.hadRows &&
				!(isAtLiveEdge?.() ?? true)
			) {
				// The reader held/moved away while an uncursored refresh was in
				// flight. Revert that attempt, then immediately restart bounded;
				// waiting for the next poll would silently poison an owner (no poll).
				state.upperBound = fixedBoundary();
				state.pendingNewer = Boolean(
					state.latest && state.latest.seq > cachedMax,
				);
				queueMicrotask(() => {
					if (windowRef.current !== state || signal.aborted) return;
					const active = client
						.getQueryCache()
						.find({ queryKey: key, exact: true });
					if (active && active.getObserversCount() > 0)
						void client.refetchQueries(
							{ queryKey: key, exact: true },
							{ cancelRefetch: true },
						);
				});
				throw new CancelledError({ revert: true });
			}
			const current = client.getQueryData<InfiniteData<P>>(key);
			if (
				attempt.older &&
				current &&
				current.pages.length >= 6 &&
				canEvict &&
				!canEvict(current.pages[0])
			)
				throw new CancelledError({ revert: true });
			return page;
		},
		getNextPageParam: (page, _pages, previous) => {
			if (!page.has_more) return undefined;
			const next = mode === "desc" ? page.next_before_seq : page.next_after_seq;
			if (next == null || !Number.isSafeInteger(next) || next < 0)
				return undefined;
			if (mode === "desc" && next === 0) return undefined;
			return previous === undefined ||
				(mode === "desc" ? next < previous : next > previous)
				? next
				: undefined;
		},
		refetchInterval: poll ? 8000 : false,
	});
	const status =
		query.error instanceof DesktopControlError ? query.error.status : undefined;
	// Keep already admitted rows only for a transport/5xx older-page failure.
	// Auth/epoch/root refusals must retain the existing error presentation, not
	// silently keep painting a private transcript after permission was refused.
	const keepWindowOnError = Boolean(
		query.data &&
			query.isFetchNextPageError &&
			(status === null ||
				(typeof status === "number" &&
					Number.isInteger(status) &&
					status >= 500 &&
					status <= 599)),
	);
	return {
		...query,
		mode,
		keepWindowOnError,
		replies: replyWindowRows<P["replies"][number]>(
			query.data?.pages ?? [],
			mode,
		),
		pendingNewer: windowRef.current.pendingNewer,
		latestPageAvailable:
			mode === "desc" &&
			windowRef.current.upperBound === undefined &&
			!windowRef.current.pendingNewer &&
			query.data?.pageParams[0] === undefined,
		resetLatest: () => {
			if (windowRef.current.key !== keyScope) return Promise.resolve();
			windowRef.current = { key: keyScope, pendingNewer: false };
			return client.resetQueries({ queryKey: key, exact: true });
		},
	};
}

/** Shared visibility admission for bounded member/audit thread windows. */
export function replyPageOutsideViewport(
	page: ReplyWindowPage,
	host: HTMLElement | null,
): boolean {
	if (!host) return false;
	const box = host.getBoundingClientRect();
	const dropping = new Set(page.replies.map((row) => row.id));
	return ![...host.querySelectorAll<HTMLElement>("[data-message-id]")].some(
		(row) => {
			const rect = row.getBoundingClientRect();
			return (
				dropping.has(row.dataset.messageId ?? "") &&
				rect.bottom > box.top &&
				rect.top < box.bottom
			);
		},
	);
}
