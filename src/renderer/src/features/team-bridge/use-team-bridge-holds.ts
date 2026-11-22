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
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import {
	type DiscardBatchResult,
	discardSnapshot,
} from "./team-bridge-discard-batch";
import {
	holdBindingKey,
	holdDetailKey,
	holdsKey,
	invalidateAfterDecision,
	invalidateAfterDiscardAll,
} from "./team-bridge-holds-keys";
import {
	type HoldDiscardAllResult,
	type HoldItem,
	type HoldProof,
	type HoldWord,
	type JoinedDetail,
	bindShownBody,
	holdRefusalLabel,
	resolveHoldDetail,
} from "./team-bridge-holds-model";
import type { DiscardSnapshotEntry } from "./team-bridge-holds-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import { readForBridgeOwner, useTeamBridgeAccount } from "./team-bridge-owner";
import {
	TEAM_BRIDGE_BADGE_POLL_HIDDEN_MS,
	TEAM_BRIDGE_BADGE_POLL_VISIBLE_MS,
	useTeamBridgeStatus,
} from "./use-team-bridge";

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
export type HeldMessageDetail = JoinedDetail<OwnerAuditMessage>;

/*
 * Owner-audit refusals that mean "not in THIS organization" for one lookup:
 * the conversation is absent there (404), the hub refuses this org's read
 * (403), or core says the read named another org (`invalid_tenant`). The walk
 * moves on to the next org instead of stranding the hold (security S-5).
 *
 * NOT a 409 (security r2 S-8): core's 409 read family is authority and state
 * (`account_mismatch`, `owner_changed`, `credential_changed`,
 * `consent_revoked`, `stale_generation`, `state_unreadable`, ...), so it must
 * surface, not be skipped and cached as "not here".
 */
function notInThisOrg(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		(error.status === 403 ||
			error.status === 404 ||
			error.code === "invalid_tenant")
	);
}

/**
 * THE JOIN. The hold list carries no tenant, sender or body, by contract; the
 * owner-audit read the person can already open carries all three. A held
 * conversation lives in ONE of the account's organizations, so each lookup
 * walks `status.tenants` in order and the first organization that has it
 * answers.
 *
 * ONE LOOKUP PER HELD MESSAGE, not per conversation (review M1): a page is at
 * most 50 messages newest-first, so one page per conversation missed a second
 * hold more than 50 messages older and left it undecidable forever. Each
 * lookup pages from `before_seq = seq + 1`, so the held message is the newest
 * row of its own page; a hold with no seq reads the latest page.
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
	// QA Q1: a hold with no conversation id gets no lookup at all.
	const joinable = items.filter((item) => Boolean(item.conversation_id));
	const lookups = useQueries({
		queries: joinable.map((item) => ({
			queryKey: holdDetailKey(accountId, item, tenantIds),
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
								item.conversation_id,
								item.seq !== null && item.seq >= 0 ? item.seq + 1 : undefined,
							),
						);
						const message = page.messages.find(
							(row) => row.id === item.message_id,
						);
						if (message) return { message, tenantId };
						// The conversation is here but the message is not: it is in
						// no other org either.
						return null;
					} catch (error) {
						if (notInThisOrg(error)) continue;
						throw error;
					}
				}
				return null;
			},
		})),
	});
	const lookupById = new Map(
		joinable.map((item, index) => [item.message_id, lookups[index]]),
	);
	const bindings = useQueries({
		queries: joinable.map((item) => {
			const found = lookupById.get(item.message_id)?.data?.message;
			return {
				queryKey: holdBindingKey(
					accountId,
					item.message_id,
					found?.body_hash ?? null,
					found?.body ?? null,
				),
				enabled: Boolean(found),
				gcTime: 0,
				queryFn: () => bindShownBody(found?.body, found?.body_hash),
			};
		}),
	});
	const bindingById = new Map(
		joinable.map((item, index) => [item.message_id, bindings[index]]),
	);
	return (item) => {
		const lookup = lookupById.get(item.message_id);
		const binding = bindingById.get(item.message_id);
		return resolveHoldDetail(item, {
			auditSupported,
			lookup: lookup && {
				/* Pending until it settles, unless it can never run: the status
				   answered with no organizations, so there is nowhere to look. */
				pending:
					lookup.isPending && !(status.isFetched && tenantIds.length === 0),
				/* A failed REFRESH keeps what already loaded (review r2 M2): a
				   429 on one row must not blank every other row's sender and body.
				   Only a lookup that never loaded reads as unavailable. */
				found: lookup.data ?? null,
			},
			binding: binding && {
				pending: binding.isPending,
				value: binding.data,
			},
		});
	};
}

/** Re-read the joins, for a row whose details could not load (UX U6). */
export function useRetryHeldDetails() {
	const client = useQueryClient();
	return useCallback(
		() =>
			client.invalidateQueries({
				queryKey: [...teamBridgeKeys.all, "holds"],
			}),
		[client],
	);
}

/** The id `busy` carries while the bulk terminal discard runs (no row owns it). */
export const DISCARD_ALL_BUSY_ID = "__discard_all__";

/** What a bulk terminal discard resolved to, for the section's result line. */
export type DiscardAllOutcome =
	| { state: "done"; result: HoldDiscardAllResult }
	| { state: "refused"; message: string };

/** One Deliver / Discard at a time; the refusal is fixed copy by code. */
export function useHoldDecide() {
	const client = useQueryClient();
	const { accountId } = useTeamBridgeAccount();
	/* The word too, so the pressed button can say "Delivering..." (UX U4). */
	const [busy, setBusy] = useState<{ id: string; word: HoldWord } | null>(null);
	const [refusals, setRefusals] = useState<Record<string, string>>({});
	// State paints the lock; the ref takes it synchronously, before React can
	// commit another frame (two clicks in one turn must not sign twice).
	const locked = useRef(false);
	const owner = useRef({ accountId, epoch: 0, mounted: true });
	if (owner.current.accountId !== accountId) {
		owner.current = {
			accountId,
			epoch: owner.current.epoch + 1,
			mounted: true,
		};
	}
	useEffect(() => {
		owner.current.mounted = true;
		return () => {
			owner.current.mounted = false;
		};
	}, []);
	const run = useCallback(
		async (item: HoldItem, word: HoldWord, proof: HoldProof) => {
			if (!accountId || locked.current) return;
			locked.current = true;
			setBusy({ id: item.message_id, word });
			setRefusals(({ [item.message_id]: _, ...rest }) => rest);
			try {
				await TeamBridgeHoldsApi.decide(accountId, word, item, proof);
			} catch (error) {
				const code =
					error instanceof DesktopControlError ? (error.code ?? null) : null;
				setRefusals((current) => ({
					...current,
					[item.message_id]: holdRefusalLabel(code, "hold_receipt" in proof),
				}));
			} finally {
				locked.current = false;
				setBusy(null);
				void invalidateAfterDecision(client, accountId, item.message_id);
			}
		},
		[accountId, client],
	);
	const runBatch = useCallback(
		async (
			entries: readonly DiscardSnapshotEntry[],
			onResult: (result: DiscardBatchResult) => void,
		) => {
			if (!accountId || locked.current) {
				for (const entry of entries)
					onResult({ entry, recorded: false, error: holdRefusalLabel(null) });
				return;
			}
			if (entries.length === 0) return;
			locked.current = true;
			const epoch = owner.current.epoch;
			const isCurrentOwner = () =>
				owner.current.mounted &&
				owner.current.accountId === accountId &&
				owner.current.epoch === epoch;
			setBusy({ id: "__batch_discard__", word: "discard" });
			try {
				await discardSnapshot(
					entries,
					(entry) =>
						TeamBridgeHoldsApi.decide(
							accountId,
							"discard",
							entry.item,
							entry.proof,
						),
					isCurrentOwner,
					(error, entry) =>
						holdRefusalLabel(
							error instanceof DesktopControlError ? error.code : null,
							"hold_receipt" in entry.proof,
						),
					(result) => {
						if (!isCurrentOwner()) return;
						onResult(result);
						setRefusals((current) => ({
							...current,
							[result.entry.item.message_id]: result.error ?? "",
						}));
						void invalidateAfterDecision(
							client,
							accountId,
							result.entry.item.message_id,
						);
					},
				);
			} finally {
				locked.current = false;
				setBusy(null);
			}
		},
		[accountId, client],
	);
	/*
	 * #4662: the bulk terminal sweep. One request, no per-row proof, idempotent on
	 * the daemon side. It shares the decide lock with the per-row paths, so a
	 * Deliver cannot be signed while a sweep is in flight and the sweep cannot
	 * start under a confirm step that is already open.
	 *
	 * The refusal is the same fixed-copy mapping every other decide uses: an
	 * unknown code reads generically, never as the daemon's own sentence.
	 */
	const runDiscardAll = useCallback(
		async (onSettled: (outcome: DiscardAllOutcome) => void) => {
			if (!accountId || locked.current) {
				onSettled({ state: "refused", message: holdRefusalLabel(null) });
				return;
			}
			locked.current = true;
			setBusy({ id: DISCARD_ALL_BUSY_ID, word: "discard" });
			try {
				const result = await TeamBridgeHoldsApi.discardAll(accountId);
				onSettled({ state: "done", result });
			} catch (error) {
				const code =
					error instanceof DesktopControlError ? (error.code ?? null) : null;
				onSettled({ state: "refused", message: holdRefusalLabel(code) });
			} finally {
				locked.current = false;
				setBusy(null);
				/* The daemon stops listing what it cleared, so the list re-read is
				   what removes the rows AND lowers the badge; the per-message joins
				   of cleared rows are never offered again. */
				void invalidateAfterDiscardAll(client, accountId);
			}
		},
		[accountId, client],
	);
	return { busy, refusals, run, runBatch, runDiscardAll };
}
