/**
 * The live Guard section: the status, prompt and non-Team reads wired into the
 * presentational `GuardSettingsView` (kept apart so Storybook and the DOM tests
 * can drive every state without a backend, an account or a router).
 */

import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { useRadientAuth } from "@shared/hooks";
import { type FC, useState } from "react";
import type { GuardRevokeResult } from "../../../../shared/guard-status";
import {
	useGuardNonTeamCard,
	useGuardPrompts,
	useGuardRevoke,
	useGuardRoutes,
	useGuardShareAgain,
	useGuardStatus,
} from "./guard-hooks";
import { GuardPromptEntries } from "./guard-prompt-entries";
import { guardWaitingViews } from "./guard-prompt-model";
import { GuardSettingsView, guardViewerRole } from "./guard-settings-view";

/**
 * The live section. Draws NOTHING for a host that predates `features.guard` and
 * has no consent card waiting (nobody there has anything Guard to see), nothing for
 * a non-Team member (or while that role is still unknown), and the
 * calm "Guard can't read its settings on this computer" line when the host
 * advertises Guard but its read failed or its store is unreadable - never an
 * error toast, and never a claim about what was shared.
 */
export const GuardSettingsSection: FC = () => {
	const routes = useGuardRoutes();
	const prompts = useGuardPrompts({ poll: false });
	const status = useGuardStatus({ poll: false });
	const revoke = useGuardRevoke();
	const shareAgain = useGuardShareAgain();
	const { user } = useRadientAuth();
	const waiting = guardWaitingViews(prompts.data ?? []).length;
	const nonTeam = routes && status.data?.mode === "non_team";
	const memberships = useMembershipsQuery({ enabled: nonTeam === true });
	const tenantId = user?.radientUser?.account.tenant_id;
	// While the membership read is in flight the role is UNKNOWN: the section draws
	// nothing until it settles (design D2), so a member never sees an empty "Radient
	// Guard" heading and an owner never sees one that then jumps when the card loads.
	// A FAILED read still answers the owner variant (see `guardViewerRole`).
	const roleKnown = !(nonTeam === true && memberships.isPending);
	const viewerRole = guardViewerRole(
		memberships.data?.memberships.find((m) => m.tenant_id === tenantId)?.role,
	);
	// The one network-reaching read of the family: made only while the card shows.
	const card = useGuardNonTeamCard(
		nonTeam === true && roleKnown && viewerRole !== "member",
	);
	const [failed, setFailed] = useState<string | null>(null);
	const [revoked, setRevoked] = useState<GuardRevokeResult | null>(null);

	if (!routes && waiting === 0) return null;
	// A non-Team MEMBER has nothing Guard to see or do (the card is the owner's and
	// admin's call to action), and a non-Team account has no consent card to wait on.
	if (
		nonTeam === true &&
		waiting === 0 &&
		(!roleKnown || viewerRole === "member")
	)
		return null;

	const load = !routes
		? "unavailable"
		: status.isPending
			? "loading"
			: status.isError || !status.data
				? "unavailable"
				: "ready";
	const busyTenant = revoke.isPending
		? (revoke.variables ?? null)
		: shareAgain.isPending
			? (shareAgain.variables ?? null)
			: null;
	return (
		<GuardSettingsView
			load={load}
			status={status.data ?? null}
			role={viewerRole}
			nonTeamCard={card.data ?? null}
			nonTeamLoading={card.isPending && card.fetchStatus !== "idle"}
			busyTenant={busyTenant}
			failedTenant={failed}
			revoked={revoked}
			prompts={<GuardPromptEntries />}
			onRevoke={(tenant) => {
				setFailed(null);
				setRevoked(null);
				revoke.mutate(tenant, {
					onSuccess: (result) => setRevoked(result),
					onError: () => setFailed(tenant),
				});
			}}
			onShareAgain={(tenant) => {
				setFailed(null);
				setRevoked(null);
				shareAgain.mutate(tenant, { onError: () => setFailed(tenant) });
			}}
		/>
	);
};
