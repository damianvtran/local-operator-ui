/**
 * The community surface's reads, writes and event loop (RFC v2.4 §5.3-§5.5).
 *
 * OWNER-BOUND. Every key carries the observed Radient account and every call
 * carries it as `expected_account_id`, so a sign-out or account switch can
 * neither show A's community cache to B nor let a write commissioned under A
 * land as B: the daemon refuses a mismatch with 409 `account_mismatch`.
 *
 * EVENTS ARE INVALIDATIONS. The long poll (`community.events`) carries kinds and
 * ids only; this hook turns each batch into query invalidations through
 * `invalidationsFor` and never renders anything from the event itself.
 *
 * DRAFTS ARE MEMORY ONLY (RFC §5.3: drafts never move between orgs, and a
 * community draft must not land in the persisted Team Bridge draft store, which
 * is keyed by tenant and written to localStorage). The composer's text lives in
 * React state for the life of the community home; leaving the community drops
 * it.
 */
import {
	type CommunityChannel,
	type CommunityImageInput,
	type CommunityMessagePage,
	communityApi,
	communityFailure,
	newCommunityIdempotencyKey,
} from "@shared/api/local-operator/community-api";
import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import {
	type InfiniteData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AttemptContext, CommunityAttempts } from "./community-attempts";
import {
	type ComposerPhase,
	eventsBackoffMs,
	invalidationsFor,
	toggleReaction,
} from "./community-model";

const OWNER_UNRESOLVED = "unresolved-owner";

export const communityKeys = {
	all: ["community"] as const,
	list: (accountId?: string) =>
		["community", accountId ?? OWNER_UNRESOLVED, "list"] as const,
	bootstrap: (accountId: string | undefined, communityId: string) =>
		[
			"community",
			accountId ?? OWNER_UNRESOLVED,
			communityId,
			"bootstrap",
		] as const,
	channels: (accountId: string | undefined, communityId: string) =>
		[
			"community",
			accountId ?? OWNER_UNRESOLVED,
			communityId,
			"channels",
		] as const,
	history: (
		accountId: string | undefined,
		communityId: string,
		conversationId: string,
	) =>
		[
			"community",
			accountId ?? OWNER_UNRESOLVED,
			communityId,
			"history",
			conversationId,
		] as const,
};

/** The observed account, for keys and the owner receipt. */
export function useCommunityOwner(): string | undefined {
	return useObservedRadientAuthority().accountId ?? undefined;
}

/** Joined and featured communities. Off (the flag) is no read at all. */
export function useCommunityList(enabled: boolean) {
	const accountId = useCommunityOwner();
	return useQuery({
		queryKey: communityKeys.list(accountId),
		queryFn: () => communityApi.list({ expectedAccountId: accountId }),
		enabled: enabled && Boolean(accountId),
		staleTime: 60_000,
		// A dark feature on a daemon without the routes answers 404
		// `community_disabled`; retrying that only delays the "off" answer.
		retry: false,
	});
}

export function useCommunityBootstrap(communityId: string | null) {
	const accountId = useCommunityOwner();
	return useQuery({
		queryKey: communityKeys.bootstrap(accountId, communityId ?? ""),
		queryFn: () =>
			communityApi.bootstrap(communityId as string, {
				expectedAccountId: accountId,
			}),
		enabled: Boolean(communityId && accountId),
		staleTime: 60_000,
		retry: false,
	});
}

/**
 * Every channel the directory lists for the reader, all pages.
 *
 * The contract pages at 25; the launch community has 23 channels (frame D5), so
 * this is normally one read. The loop stops on a null cursor and also on a
 * cursor it has already sent, so a hub that repeats a cursor cannot spin it.
 */
export function useCommunityChannels(communityId: string | null) {
	const accountId = useCommunityOwner();
	return useQuery({
		queryKey: communityKeys.channels(accountId, communityId ?? ""),
		queryFn: async (): Promise<CommunityChannel[]> => {
			const out: CommunityChannel[] = [];
			const seen = new Set<string>();
			let cursor: string | undefined;
			for (;;) {
				const page = await communityApi.channels(communityId as string, {
					...(cursor ? { cursor } : {}),
					expectedAccountId: accountId,
				});
				out.push(...page.items);
				const next = page.next_cursor;
				if (!next || seen.has(next)) break;
				seen.add(next);
				cursor = next;
			}
			return out;
		},
		enabled: Boolean(communityId && accountId),
		staleTime: 30_000,
	});
}

/**
 * One conversation's history as newest-first pages; `fetchNextPage` reads the
 * next OLDER page (the contract's history is newest first with viewer-bound
 * cursors).
 */
export function useCommunityHistory(
	communityId: string | null,
	conversationId: string | null,
) {
	const accountId = useCommunityOwner();
	return useInfiniteQuery({
		queryKey: communityKeys.history(
			accountId,
			communityId ?? "",
			conversationId ?? "",
		),
		queryFn: ({ pageParam }) =>
			communityApi.history(communityId as string, conversationId as string, {
				...(pageParam ? { cursor: pageParam } : {}),
				expectedAccountId: accountId,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.next_cursor ?? undefined,
		enabled: Boolean(communityId && conversationId && accountId),
		staleTime: 15_000,
	});
}

/**
 * The events long poll for the community in view.
 *
 * One poll in flight at a time; a healthy answer re-arms at once with its
 * `next` cursor, a failed one waits `eventsBackoffMs`. `offline` is true while
 * nothing answers (no network, daemon down) - the channel pane's D20 offline
 * state - and clears on the next answer. The loop stops on unmount and when the
 * community or account changes, so a late answer never invalidates the next
 * owner's cache.
 */
export function useCommunityEvents(communityId: string | null) {
	const accountId = useCommunityOwner();
	const client = useQueryClient();
	const [offline, setOffline] = useState(
		typeof navigator !== "undefined" && navigator.onLine === false,
	);
	useEffect(() => {
		if (!communityId || !accountId) return;
		let live = true;
		let after: string | undefined;
		let failures = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = async () => {
			if (!live) return;
			try {
				const batch = await communityApi.events(communityId, {
					...(after ? { after } : {}),
					expectedAccountId: accountId,
				});
				if (!live) return;
				failures = 0;
				setOffline(false);
				after = batch.next;
				const work = invalidationsFor(batch);
				if (work.community) {
					void client.invalidateQueries({
						queryKey: communityKeys.list(accountId),
					});
					void client.invalidateQueries({
						queryKey: communityKeys.bootstrap(accountId, communityId),
					});
				}
				if (work.channels || work.conversations.length > 0)
					void client.invalidateQueries({
						queryKey: communityKeys.channels(accountId, communityId),
					});
				for (const conversationId of work.conversations)
					void client.invalidateQueries({
						queryKey: communityKeys.history(
							accountId,
							communityId,
							conversationId,
						),
					});
				timer = setTimeout(poll, 0);
			} catch (error) {
				if (!live) return;
				failures += 1;
				const failure = communityFailure(error);
				if (failure.kind === "unreachable") setOffline(true);
				// Not ours to fix by polling: stop rather than hammer.
				if (
					failure.kind === "disabled" ||
					failure.kind === "not_found" ||
					failure.kind === "signin_required" ||
					failure.kind === "account_mismatch"
				)
					return;
				timer = setTimeout(
					poll,
					failure.kind === "rate_limited"
						? failure.retryAfterS * 1000
						: eventsBackoffMs(failures),
				);
			}
		};
		void poll();
		const onOnline = () => setOffline(false);
		const onOffline = () => setOffline(true);
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		return () => {
			live = false;
			if (timer) clearTimeout(timer);
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
		};
	}, [communityId, accountId, client]);
	return { offline };
}

/** Join the community, accepting exactly the guidelines version shown. */
export function useJoinCommunity() {
	const accountId = useCommunityOwner();
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { communityId: string; guidelinesVersion: string }) =>
			communityApi.join(input.communityId, input.guidelinesVersion, {
				expectedAccountId: accountId,
			}),
		onSuccess: (_answer, input) => {
			void client.invalidateQueries({
				queryKey: communityKeys.list(accountId),
			});
			void client.invalidateQueries({
				queryKey: communityKeys.bootstrap(accountId, input.communityId),
			});
			void client.invalidateQueries({
				queryKey: communityKeys.channels(accountId, input.communityId),
			});
		},
	});
}

/**
 * The composer's send loop, bound to one conversation (or thread).
 *
 * The attempt rules - one key per attempt for as long as it may still
 * publish, a status read before anything is re-sent - live in
 * `CommunityAttempts` (`community-attempts.ts`, review round 1 M1), which is
 * driven by node tests without React. This hook owns only what React must:
 * the phase state, the per-render context (this conversation's ids, the owner
 * receipt, the draft callbacks) and re-entering on a conversation switch, so a
 * conversation with an attempt still in flight shows that attempt again.
 */
export function useCommunityComposer(input: {
	communityId: string;
	conversationId: string;
	threadRootId?: string;
	guidelinesVersion?: string;
	/** The published message's id, when the hub returned one. */
	onPublished: (messageId: string | null) => void;
	/** The hub answered 409 `guidelines_changed` (the home goes read-only). */
	onGuidelinesChanged?: () => void;
}) {
	const accountId = useCommunityOwner();
	const client = useQueryClient();
	const [phase, setPhase] = useState<ComposerPhase>({ kind: "idle" });
	const attempts = useRef<CommunityAttempts | null>(null);
	if (!attempts.current) attempts.current = new CommunityAttempts();
	const { communityId, conversationId, threadRootId, guidelinesVersion } =
		input;
	const target = `${communityId}\u0000${conversationId}\u0000${threadRootId ?? ""}`;

	// Rebuilt every render so a late answer reaches the CURRENT callbacks; the
	// controller's own key check keeps it from painting another target.
	const ctx: AttemptContext = {
		target,
		submit: (key, draft) =>
			communityApi.submit(communityId, conversationId, {
				text: draft.text,
				images: [...draft.images],
				...(threadRootId ? { threadRootId } : {}),
				...(guidelinesVersion ? { guidelinesVersion } : {}),
				idempotencyKey: key,
				expectedAccountId: accountId,
			}),
		status: (key) =>
			communityApi.submissionStatus(communityId, key, {
				expectedAccountId: accountId,
			}),
		cancel: (key) =>
			communityApi.cancelSubmission(communityId, key, {
				expectedAccountId: accountId,
			}),
		setPhase,
		onPublished: input.onPublished,
		onHistoryChanged: () =>
			void client.invalidateQueries({
				queryKey: communityKeys.history(accountId, communityId, conversationId),
			}),
		...(input.onGuidelinesChanged
			? { onGuidelinesChanged: input.onGuidelinesChanged }
			: {}),
	};
	const latest = useRef(ctx);
	latest.current = ctx;

	// A conversation switch shows that conversation's own attempt: idle, or -
	// when one may still be in flight there - its status, read again by key.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-enter on target change only
	useEffect(() => {
		if (!conversationId) return;
		void attempts.current?.enter(latest.current);
	}, [target]);

	const send = useCallback(
		async (text: string, images: CommunityImageInput[] = []) => {
			await attempts.current?.send(latest.current, { text, images });
		},
		[],
	);
	const cancel = useCallback(async () => {
		await attempts.current?.cancel(latest.current);
	}, []);
	const dismiss = useCallback(() => {
		attempts.current?.dismiss(latest.current);
	}, []);

	return { phase, send, cancel, dismiss };
}

type HistoryData = InfiniteData<CommunityMessagePage, string | undefined>;

/** Reactions, edits and deletes on one conversation's loaded history. */
export function useCommunityMessageActions(
	communityId: string,
	conversationId: string,
) {
	const accountId = useCommunityOwner();
	const client = useQueryClient();
	const key = communityKeys.history(accountId, communityId, conversationId);

	const react = useMutation({
		mutationFn: async (input: { messageId: string; emoji: string }) => {
			const data = client.getQueryData<HistoryData>(key);
			const message = data?.pages
				.flatMap((page) => page.items)
				.find((item) => item.id === input.messageId);
			const toggled = message
				? toggleReaction(message, input.emoji)
				: { reactions: [], remove: false };
			// Optimistic: the chip moves now; the next history read is the truth.
			client.setQueryData<HistoryData>(key, (current) =>
				current
					? {
							...current,
							pages: current.pages.map((page) => ({
								...page,
								items: page.items.map((item) =>
									item.id === input.messageId
										? { ...item, reactions: toggled.reactions }
										: item,
								),
							})),
						}
					: current,
			);
			return communityApi.react(communityId, input.messageId, {
				emoji: input.emoji,
				remove: toggled.remove,
				expectedAccountId: accountId,
			});
		},
		onSettled: () => void client.invalidateQueries({ queryKey: key }),
	});

	const remove = useMutation({
		mutationFn: (messageId: string) =>
			communityApi.remove(communityId, messageId, {
				expectedAccountId: accountId,
			}),
		onSettled: () => void client.invalidateQueries({ queryKey: key }),
	});

	/**
	 * An edit is re-moderated like a post and answers a `SubmissionOutcome`; the
	 * caller maps it with the same phase rules, so a refused edit shows the same
	 * sender-only notice and keeps the edited text.
	 */
	const edit = useMutation({
		mutationFn: (input: {
			messageId: string;
			text: string;
			guidelinesVersion?: string;
		}) =>
			communityApi.edit(communityId, input.messageId, {
				text: input.text,
				...(input.guidelinesVersion
					? { guidelinesVersion: input.guidelinesVersion }
					: {}),
				idempotencyKey: newCommunityIdempotencyKey(),
				expectedAccountId: accountId,
			}),
		onSettled: () => void client.invalidateQueries({ queryKey: key }),
	});

	/*
	 * An edit answered `checking` (the verdict outlived the request) is followed
	 * by the same status reads as a post, by the edit's own key, so the row's
	 * "Checking…" ends on its real outcome instead of sitting there with Save
	 * disabled (review round 1, m4). Stops when the history unmounts.
	 */
	const live = useRef(true);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);
	const followEdit = useCallback(
		async (idempotencyKey: string) => {
			for (;;) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				if (!live.current) throw new Error("community history closed");
				const outcome = await communityApi.submissionStatus(
					communityId,
					idempotencyKey,
					{ expectedAccountId: accountId },
				);
				if (outcome.state !== "checking") {
					void client.invalidateQueries({
						queryKey: communityKeys.history(
							accountId,
							communityId,
							conversationId,
						),
					});
					return outcome;
				}
			}
		},
		[client, accountId, communityId, conversationId],
	);

	return { react, remove, edit, followEdit };
}
