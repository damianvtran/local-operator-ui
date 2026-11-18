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
import {
	type ComposerPhase,
	eventsBackoffMs,
	invalidationsFor,
	phaseAfterFailure,
	phaseAfterSubmission,
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
 * The composer's send loop: one attempt at a time, with its own key.
 *
 * The key is minted BEFORE the request so Cancel can name the in-flight attempt
 * and a lost answer can be asked about (`submission.status`). Every retry
 * mints a new key: the hub answers a reused key with the first attempt's stored
 * outcome, so reusing one after a refusal or an outage would replay it. A
 * `checking` answer (the verdict outlived the request) is followed by status
 * reads every 2 s until it settles.
 */
export function useCommunityComposer(input: {
	communityId: string;
	conversationId: string;
	threadRootId?: string;
	guidelinesVersion?: string;
	/** The published message's id, when the hub returned one. */
	onPublished: (messageId: string | null) => void;
}) {
	const accountId = useCommunityOwner();
	const client = useQueryClient();
	const [phase, setPhase] = useState<ComposerPhase>({ kind: "idle" });
	const attempt = useRef<string | null>(null);
	const { communityId, conversationId, threadRootId, guidelinesVersion } =
		input;
	const onPublished = input.onPublished;

	// A conversation switch abandons any attempt's UI (the hub keeps the
	// verdict; the reader sees the post land through the next history read).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on target change only
	useEffect(() => {
		attempt.current = null;
		setPhase({ kind: "idle" });
	}, [communityId, conversationId, threadRootId]);

	const settle = useCallback(
		(key: string, outcome: Parameters<typeof phaseAfterSubmission>[0]) => {
			if (attempt.current !== key) return;
			const next = phaseAfterSubmission(outcome);
			setPhase(next.phase);
			if (next.clearDraft) {
				attempt.current = null;
				onPublished(outcome.message_id ?? null);
				void client.invalidateQueries({
					queryKey: communityKeys.history(
						accountId,
						communityId,
						conversationId,
					),
				});
			}
		},
		[client, accountId, communityId, conversationId, onPublished],
	);

	const followUp = useCallback(
		async (key: string) => {
			for (;;) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				if (attempt.current !== key) return;
				try {
					const outcome = await communityApi.submissionStatus(
						communityId,
						key,
						{
							expectedAccountId: accountId,
						},
					);
					if (attempt.current !== key) return;
					if (outcome.state !== "checking") {
						settle(key, outcome);
						return;
					}
				} catch (error) {
					if (attempt.current !== key) return;
					setPhase(phaseAfterFailure(communityFailure(error), Date.now()));
					return;
				}
			}
		},
		[accountId, communityId, settle],
	);

	const send = useCallback(
		async (text: string, images: CommunityImageInput[] = []) => {
			const key = newCommunityIdempotencyKey();
			attempt.current = key;
			setPhase({ kind: "checking", key, cancelling: false });
			try {
				const outcome = await communityApi.submit(communityId, conversationId, {
					text,
					images,
					...(threadRootId ? { threadRootId } : {}),
					...(guidelinesVersion ? { guidelinesVersion } : {}),
					idempotencyKey: key,
					expectedAccountId: accountId,
				});
				if (attempt.current !== key) return;
				if (outcome.state === "checking") {
					settle(key, outcome);
					void followUp(key);
					return;
				}
				settle(key, outcome);
			} catch (error) {
				if (attempt.current !== key) return;
				setPhase(phaseAfterFailure(communityFailure(error), Date.now()));
			}
		},
		[
			accountId,
			communityId,
			conversationId,
			threadRootId,
			guidelinesVersion,
			settle,
			followUp,
		],
	);

	/**
	 * Best-effort cancel (RFC §5.5): if the hub already published, the reader
	 * sees it posted. The UI says "Cancelling" until the hub answers.
	 */
	const cancel = useCallback(async () => {
		const key = attempt.current;
		if (!key) return;
		setPhase({ kind: "checking", key, cancelling: true });
		try {
			const outcome = await communityApi.cancelSubmission(communityId, key, {
				expectedAccountId: accountId,
			});
			settle(key, outcome);
		} catch (error) {
			if (attempt.current !== key) return;
			setPhase(phaseAfterFailure(communityFailure(error), Date.now()));
		}
	}, [accountId, communityId, settle]);

	const dismiss = useCallback(() => {
		attempt.current = null;
		setPhase({ kind: "idle" });
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

	return { react, remove, edit };
}
