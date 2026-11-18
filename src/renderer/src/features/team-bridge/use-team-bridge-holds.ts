/**
 * React bindings for Team Bridge held messages: the hold list (shared by the
 * nav badge, the Approvals slot and the section), the owner-audit join that
 * names each hold's sender, and the signed Deliver / Discard.
 *
 * The rules live in `team-bridge-holds-model.ts`; this file only owns the
 * query keys, the capability gate, the account fence and the join.
 */
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { useDesktopCapabilities } from "@shared/api/local-operator/desktop-hooks";
import { TeamBridgeHoldsApi } from "@shared/api/local-operator/team-bridge-holds-api";
import { TeamBridgeOwnerAuditApi } from "@shared/api/local-operator/team-bridge-owner-audit-api";
import {
	type QueryClient,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import {
	type HoldItem,
	type HoldWord,
	holdRefusalLabel,
	shownBodySha256,
} from "./team-bridge-holds-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import { readForBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS,
	TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS,
	useTeamBridgeStatus,
} from "./use-team-bridge";

const holdsKey = (accountId?: string) =>
	[...teamBridgeKeys.all, "holds", accountId ?? "unresolved-owner"] as const;

/**
 * THE SECTION EXISTS ONLY WHEN CORE ADVERTISES THE ROUTES. `features
 * .team_bridge_hold_release` (local-operator server/features.py) says the
 * routes exist, not that release is on; a daemon without it would answer every
 * call 404, so the section, its badge share and its poll are all off.
 */
export function useHoldsSupported(): boolean {
	const capabilities = useDesktopCapabilities();
	return (capabilities.data?.features?.team_bridge_hold_release ?? 0) >= 1;
}

function pollInterval(): number {
	if (typeof document === "undefined") return TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
	return document.visibilityState === "visible"
		? TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS
		: TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS;
}

/*
 * `panel`: same rule as the approvals read (QA Q2 on #1954): a panel observer
 * never refetches a query whose read failed with no data on mount, so a
 * failing read cannot loop; its Retry is the only read it starts.
 */
export function useHeldMessages(
	enabled: boolean,
	{ panel = false }: { panel?: boolean } = {},
) {
	const client = useQueryClient();
	const supported = useHoldsSupported();
	const { accountId } = useTeamBridgeAccount();
	return useQuery({
		queryKey: holdsKey(accountId),
		queryFn: () =>
			readForBridgeOwner(client, accountId, () =>
				TeamBridgeHoldsApi.list(accountId as string),
			),
		enabled: enabled && supported && Boolean(accountId),
		staleTime: 30_000,
		refetchInterval: pollInterval,
		refetchOnWindowFocus: true,
		...(panel
			? {
					retryOnMount: false,
					refetchOnMount: (query: { state: { status: string } }) =>
						query.state.status !== "error",
				}
			: {}),
		retry: (count, error) =>
			!(error instanceof DesktopControlError && error.status === 404) &&
			count < 1,
	});
}

/** What the owner-audit read says about one held message. */
export type HeldMessageDetail =
	| { state: "loading" }
	| { state: "unavailable" }
	| {
			state: "ready";
			message: OwnerAuditMessage;
			/** `null` when the shown body cannot be bound (see the model). */
			bodySha256: string | null;
	  };

/**
 * THE JOIN. The hold list carries no tenant, sender or body, by contract; the
 * owner-audit read the person can already open carries all three. A held
 * conversation lives in ONE of the account's organizations, so each
 * conversation is looked up across `status.tenants` in order and the first
 * organization that has it answers (a wrong organization answers
 * `conversation_not_found`, which here only means "not this one").
 *
 * Private data: `gcTime: 0`, like every owner-audit read, so nothing outlives
 * the section.
 */
export function useHeldMessageDetails(
	items: readonly HoldItem[],
): (item: HoldItem) => HeldMessageDetail {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	const status = useTeamBridgeStatus();
	const capabilities = useDesktopCapabilities();
	const auditSupported =
		(capabilities.data?.features?.team_bridge_owner_audit ?? 0) >= 1;
	const tenantIds = (status.data?.status?.tenants ?? []).map(
		(tenant) => tenant.tenant_id,
	);
	const conversations = [...new Set(items.map((item) => item.conversation_id))]
		.filter(Boolean)
		.map((conversationId) => ({
			conversationId,
			// The newest held seq bounds the page so every hold of the
			// conversation is on it when at most 50 messages separate them.
			beforeSeq: Math.max(
				0,
				...items
					.filter((item) => item.conversation_id === conversationId)
					.map((item) => item.seq ?? 0),
			),
		}));
	const results = useQueries({
		queries: conversations.map(({ conversationId, beforeSeq }) => ({
			queryKey: [
				...holdsKey(accountId),
				"detail",
				conversationId,
				beforeSeq,
				tenantIds.join(","),
			] as const,
			enabled: auditSupported && Boolean(accountId) && tenantIds.length > 0,
			gcTime: 0,
			staleTime: 30_000,
			retry: false,
			queryFn: async () => {
				for (const tenantId of tenantIds) {
					try {
						const page = await readForBridgeOwner(client, accountId, () =>
							TeamBridgeOwnerAuditApi.messages(
								{ accountId: accountId as string, tenantId },
								conversationId,
								beforeSeq > 0 ? beforeSeq + 1 : undefined,
							),
						);
						return page.messages;
					} catch (error) {
						if (error instanceof DesktopControlError && error.status === 404)
							continue;
						throw error;
					}
				}
				return [] as OwnerAuditMessage[];
			},
		})),
	});
	const byConversation = new Map(
		conversations.map((entry, index) => [entry.conversationId, results[index]]),
	);
	const hashes = useQueries({
		queries: items.map((item) => {
			const found = byConversation
				.get(item.conversation_id)
				?.data?.find((message) => message.id === item.message_id);
			return {
				queryKey: [
					...holdsKey(accountId),
					"hash",
					item.message_id,
					found?.body_hash ?? null,
					found?.body?.length ?? null,
				] as const,
				enabled: Boolean(found),
				gcTime: 0,
				queryFn: () => shownBodySha256(found?.body, found?.body_hash),
			};
		}),
	});
	return (item) => {
		if (!auditSupported) return { state: "unavailable" };
		const query = byConversation.get(item.conversation_id);
		if (!query || query.isPending) return { state: "loading" };
		const message = query.data?.find((row) => row.id === item.message_id);
		if (!message) return { state: "unavailable" };
		const index = items.indexOf(item);
		const hash = index >= 0 ? hashes[index] : undefined;
		if (!hash || hash.isPending) return { state: "loading" };
		return { state: "ready", message, bodySha256: hash.data ?? null };
	};
}

function invalidateHolds(client: QueryClient) {
	return client.invalidateQueries({
		queryKey: [...teamBridgeKeys.all, "holds"],
	});
}

/** One Deliver / Discard at a time; the refusal is fixed copy by code. */
export function useHoldDecide() {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	const [busy, setBusy] = useState<string | null>(null);
	const [refusals, setRefusals] = useState<Record<string, string>>({});
	const run = useCallback(
		async (item: HoldItem, word: HoldWord, bodySha256: string) => {
			if (!accountId || busy) return;
			setBusy(item.message_id);
			setRefusals(({ [item.message_id]: _, ...rest }) => rest);
			try {
				await TeamBridgeHoldsApi.decide(accountId, word, item, bodySha256);
			} catch (error) {
				const code =
					error instanceof DesktopControlError ? (error.code ?? null) : null;
				setRefusals((current) => ({
					...current,
					[item.message_id]: holdRefusalLabel(code),
				}));
			} finally {
				setBusy(null);
				void invalidateHolds(client);
			}
		},
		[accountId, busy, client],
	);
	return { busy, refusals, run };
}
