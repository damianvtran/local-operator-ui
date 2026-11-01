import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	CancelledError,
	type InfiniteData,
	useInfiniteQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

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

/** Member and owner reads share mode negotiation, but never authority/cache.
 * The caller wraps each read with its existing captured-owner/epoch fence.
 * Direction belongs in the query key: a legacy page must NEVER populate DESC.
 */
export function useThreadReplyWindow<P extends ReplyWindowPage>({
	queryKey,
	identity,
	read,
	canEvict,
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
	read: (mode: ReplyWindowMode, cursor?: number) => Promise<P>;
	canEvict?: (page: P) => boolean;
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
			let page: P;
			try {
				page = await read(mode, pageParam);
				if (
					page.root.id !== identity.rootId ||
					page.root.conversation_id !== identity.conversationId ||
					page.root.thread_root_id ||
					page.replies.some(
						(row) =>
							row.conversation_id !== identity.conversationId ||
							row.thread_root_id !== identity.rootId,
					)
				)
					throw new Error("Thread response identity mismatch");
				if (mode === "desc") admitReplyWindow(page);
				if (
					page.replies.length > 50 ||
					page.replies.some((row, index) => {
						const prior = page.replies[index - 1];
						return (
							prior &&
							(prior.seq > row.seq ||
								(prior.seq === row.seq && prior.id >= row.id))
						);
					})
				)
					throw new Error("Thread response page ordering mismatch");
			} catch (error) {
				// Probe only the uncursored request with locally valid fixed options.
				// Never downgrade401/403/404/409, a malformed echo or a later page.
				if (
					mode === "desc" &&
					pageParam === undefined &&
					!signal.aborted &&
					unsupportedReplyWindow(error)
				) {
					setNegotiated({ scope, mode: "legacy" });
					throw new CancelledError({ revert: true });
				}
				throw error;
			}
			if (
				pageParam !== undefined &&
				page.replies.some((row) =>
					mode === "desc" ? row.seq >= pageParam : row.seq < pageParam,
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
				if (expected === undefined || expected <= 0 || returned !== expected)
					throw new Error("Thread response cursor mismatch");
			}
			if (signal.aborted) throw new CancelledError({ revert: true });
			const cached = client.getQueryData<InfiniteData<P>>(key);
			if (cached && pageParam !== undefined) {
				const known = new Map(
					cached.pages.flatMap((prior) =>
						prior.replies.map((row) => [row.id, row.seq] as const),
					),
				);
				if (
					page.replies.some(
						(row) => known.has(row.id) && known.get(row.id) !== row.seq,
					)
				)
					throw new Error("Thread response sequence identity mismatch");
			}
			if (
				pageParam !== undefined &&
				cached &&
				cached.pages.length >= 6 &&
				canEvict &&
				!canEvict(cached.pages[0])
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
		latestPageAvailable:
			mode === "desc" && query.data?.pageParams[0] === undefined,
		resetLatest: () => client.resetQueries({ queryKey: key, exact: true }),
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
