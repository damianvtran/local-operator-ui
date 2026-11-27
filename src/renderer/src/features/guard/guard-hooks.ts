/**
 * Radient Guard's reads and writes on the desktop plane.
 *
 * TWO READS, ONE OWNER EACH.
 * - `useGuardPrompts` is the PENDING-CONSENT read: the `guard_consent` cards in
 *   `GET /v1/desktop/approvals` (`features.approvals`). It shares the Mesh tray's
 *   query KEY so the app polls one list, but its own `select`: `useMeshApprovals`
 *   drops guard rows because a privacy consent is not a mesh fact, and this is the
 *   only reader that keeps them.
 * - `useGuardStatus` is the STATUS/INDICATOR read (`GET /v1/desktop/guard`,
 *   `features.guard`): local facts only, no network, so an interval costs one local
 *   read and no socket at all (the same argument `mesh-approvals.ts` makes for its
 *   poll).
 *
 * WHY NOTHING HERE CAN GRANT. The writes are: decline (the generic deny), the typed
 * accept (built only by `guardShareRequest`, fired only from the dialog's Share
 * button), stop sharing and share again. There is no auto-answer, no list-level
 * approve and no auto-approval-mode hook: a Guard consent is answered by a person
 * pressing a button on a card they opened (RFC §5.2.3, §5.9).
 *
 * NON-TEAM ACCOUNTS CALL NOTHING BUT THE TWO READS. The renderer never speaks to
 * `/v1/guard/*` at all (the host does, and only for an org that raised Guard); a
 * non-Team status read answers `mode: "non_team"` from cached facts, and the
 * non-Team card read is made only while that card is on screen.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesktopRequest } from "../../../../shared/desktop-contract";
import {
	type GuardNonTeamCard,
	type GuardRevokeResult,
	type GuardStatus,
	guardNonTeamCard,
	guardRevokeResultSchema,
	guardStatus,
} from "../../../../shared/guard-status";
import {
	type MeshApprovalRow,
	meshApprovalKeys,
	readApprovalRows,
} from "../mesh/mesh-approvals";
import { guardWaitingViews } from "./guard-prompt-model";

export const guardKeys = {
	status: ["desktop", "guard", "status"] as const,
	nonTeamCard: ["desktop", "guard", "non-team-card"] as const,
};

/** Same cadence as the approvals rail: the read is local and the wait is a person's. */
export const GUARD_POLL_MS = 15_000;

/** `features.guard`: the status, non-Team card, revoke and share-again routes exist. */
export function useGuardRoutes(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "guard");
}

/** `features.approvals`: the pending `guard_consent` card can be read and answered. */
export function useGuardCardPlane(): boolean {
	const capabilities = useDesktopCapabilities();
	return desktopFeatureEnabled(capabilities.data, "approvals");
}

/**
 * Module-level so `select` keeps one identity: an inline arrow is a new function
 * each render, which makes react-query re-run it and hand every consumer (the gear
 * count, the entries, the section) a fresh array to re-render on.
 */
const guardRows = (rows: MeshApprovalRow[]): MeshApprovalRow[] =>
	rows.filter((row) => row.kind === "guard");

export function useGuardPrompts({ poll = true }: { poll?: boolean } = {}) {
	const enabled = useGuardCardPlane();
	return useQuery({
		queryKey: meshApprovalKeys.approvals,
		enabled,
		queryFn: readApprovalRows,
		select: guardRows,
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? GUARD_POLL_MS : false,
		refetchOnWindowFocus: poll,
	});
}

/** How many consent prompts wait: the one number the rail's gear mark states. */
export function useGuardWaitingCount(): number {
	const prompts = useGuardPrompts();
	return guardWaitingViews(prompts.data ?? []).length;
}

export function useGuardStatus({ poll = true }: { poll?: boolean } = {}) {
	const enabled = useGuardRoutes();
	return useQuery<GuardStatus | null>({
		queryKey: guardKeys.status,
		enabled,
		queryFn: async () =>
			guardStatus(await desktopResult<unknown>({ op: "guard.status" })),
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? GUARD_POLL_MS : false,
		refetchOnWindowFocus: poll,
	});
}

/**
 * The non-Team card read. It is the ONE read of this family that reaches the
 * network (the host asks the trial-eligibility proxy), so it is made only while
 * the card is drawn, and a failure is the plain "See Radient Team" card.
 */
export function useGuardNonTeamCard(enabled: boolean) {
	const routes = useGuardRoutes();
	return useQuery<GuardNonTeamCard | null>({
		queryKey: guardKeys.nonTeamCard,
		enabled: enabled && routes,
		queryFn: async () =>
			guardNonTeamCard(
				await desktopResult<unknown>({ op: "guard.nonTeamCard" }),
			),
		retry: false,
		staleTime: 60_000,
	});
}

/**
 * Answer a consent card: the typed accept or the decline. The LIST stays the one
 * authority for what happened (settle invalidates it), so there is no second copy
 * of "accepted" to disagree with the store. No automatic retry: a replayed accept
 * would sign twice.
 */
export function useGuardAnswer() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async (request: DesktopRequest): Promise<void> => {
			await desktopResult<unknown>(request);
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: meshApprovalKeys.approvals });
			void client.invalidateQueries({ queryKey: guardKeys.status });
		},
	});
}

/** Stop sharing. `revoke_pending` is a success: the local stop is already committed. */
export function useGuardRevoke() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async (tenant: string): Promise<GuardRevokeResult | null> => {
			const parsed = guardRevokeResultSchema.safeParse(
				await desktopResult<unknown>({ op: "guard.revoke", tenant }),
			);
			return parsed.success ? parsed.data : null;
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: guardKeys.status });
		},
	});
}

/** Lift a sticky answer. It grants nothing: the org's prompt returns as a card. */
export function useGuardShareAgain() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async (tenant: string): Promise<void> => {
			await desktopResult<unknown>({ op: "guard.shareAgain", tenant });
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: guardKeys.status });
			void client.invalidateQueries({ queryKey: meshApprovalKeys.approvals });
		},
	});
}
