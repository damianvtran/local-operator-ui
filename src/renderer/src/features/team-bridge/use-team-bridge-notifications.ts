/**
 * The Team Bridge notification watcher.
 *
 * WHAT IT DOES. Every 30 seconds while the user is signed in, it reads the
 * account-scoped unread answer for ORGANIZATION DISCOVERY (total + per-org
 * counts), then one tenant-scoped unread read per organization that reports
 * unread. The tenant read is the only place conversation rows exist - the
 * account answer deliberately carries no `conversations` array - and each row
 * is tagged with the organization it was read in. The account-scoped
 * conversation list supplies membership, notify policy and the sender label.
 * `planTeamBridgeNotifications` decides what is new, and this hook asks main to
 * raise one banner per new sequence number.
 *
 * HIDDEN IS NOT PAUSED. The poll runs in the background on purpose: Electron
 * reports a minimised window - and, on macOS, a fully occluded one - as
 * hidden, which is exactly the state a banner is for. React Query pauses a
 * `refetchInterval` in the background by default, so every observer sets
 * `refetchIntervalInBackground`. Main's real-focus check remains the only
 * quiet authority; the renderer never gates delivery on visibility.
 *
 * WHY A HOOK IN THE SHELL, NOT THE PAGE. A banner is useful precisely when the
 * Team Bridge page is NOT open. Mounting this inside the page would make it
 * silent the moment the reader went back to chat, which is the state the
 * feature exists for.
 *
 * FIRST LOAD SEEDS PER ORGANIZATION. A fresh observer sees every pre-existing
 * unread row as new if it only compared sequence numbers; an organization's
 * first answered read advances its cursors and raises nothing. An organization
 * the account answer reports at zero is marked seeded without a read, because
 * there are no rows to advance and its first future message must be an event.
 * An organization that first appears later is seeded on its own first answer,
 * the same first-observation rule.
 *
 * QUIET WHEN ACTIVE. Main owns that decision: only it can read the real window
 * focus, and a renderer cannot tell focused from occluded on macOS. The watcher
 * therefore always asks on a new seq; main refuses to raise while the user is
 * looking at the app. The cursor advances either way, so leaving the app does
 * not replay a seq the badge already showed.
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { t } from "@shared/i18n";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	asTeamBridgeTenantId,
	organizationOptions,
} from "./team-bridge-model";
import {
	TEAM_BRIDGE_NOTIFY_POLL_MS,
	type TeamBridgeNotifyUnreadRow,
	planTeamBridgeNotifications,
	teamBridgeNotifyOrganizations,
} from "./team-bridge-notify-model";
import {
	teamBridgeKeys,
	useTeamBridgeIdentity,
	useTeamBridgeUnread,
} from "./use-team-bridge";

/**
 * Subscribe to Team Bridge unread and raise a banner for each new sequence.
 *
 * `enabled` is the `team_bridge_conversations` capability gate from the shell.
 * Everything else is gated inside: a signed-out account has no identity to
 * match against member rows. Visibility is deliberately NOT a gate: a hidden
 * window is the case banners exist for, and main decides quiet from the real
 * window focus.
 */
export function useTeamBridgeNotifications(enabled: boolean): void {
	/*
	 * The preload bridge is the feature's other half: browser development and
	 * Storybook mount the same shell without one, and a watcher there would poll
	 * two routes only to discard every candidate at the IPC line.
	 */
	const available = Boolean(window.api?.desktop?.teamBridge);
	const identity = useTeamBridgeIdentity(enabled && available);
	const selfAccountId = identity.data ?? undefined;
	const signedIn = Boolean(selfAccountId);
	const active = enabled && available && signedIn;
	const client = useQueryClient();
	const memberships = useMembershipsQuery({ enabled: active });
	const membershipsData = memberships.data;

	const accountUnread = useTeamBridgeUnread(active, TEAM_BRIDGE_ALL_SCOPE, {
		refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchIntervalInBackground: true,
	});
	/*
	 * The account answer is the org DISCOVERY read and the badge total, never a
	 * row source: it has `organizations` and no `conversations`. The rows come
	 * from the per-tenant reads below.
	 */
	const notificationOrganizations = useMemo(
		() => teamBridgeNotifyOrganizations(accountUnread.data),
		[accountUnread.data],
	);
	const tenantUnread = useQueries({
		queries: notificationOrganizations.map((organization) => {
			const tenantId = asTeamBridgeTenantId(organization.tenant_id);
			return {
				queryKey: teamBridgeKeys.unread(tenantId),
				queryFn: () => TeamBridgeApi.unread({ tenantId }),
				enabled: active,
				staleTime: TEAM_BRIDGE_NOTIFY_POLL_MS,
				refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
				refetchIntervalInBackground: true,
				refetchOnWindowFocus: true,
				retry: 1,
			};
		}),
	});
	/*
	 * A PRIMITIVE CHANGE DETECTOR. `useQueries` returns a fresh array each
	 * render, so depending on it directly would re-run the planner on every
	 * render. `dataUpdatedAt` names the actual answer (and `status` covers an
	 * error after a previous success); the effect below reads the query objects
	 * through a ref and uses this string only to notice that a batch changed.
	 */
	const tenantVersion = tenantUnread
		.map((query) => `${query.status}:${query.dataUpdatedAt}`)
		.join("|");
	const tenantUnreadRef = useRef(tenantUnread);
	tenantUnreadRef.current = tenantUnread;
	const notificationOrganizationsRef = useRef(notificationOrganizations);
	notificationOrganizationsRef.current = notificationOrganizations;

	/*
	 * The same cache entry the page and the rail read, with a 30 s observer.
	 * The page's own observer has no interval; React Query keeps one timer per
	 * observer, so this one polls the shared entry for as long as the shell is
	 * mounted. That is deliberate: the watcher cannot prove membership, notify
	 * policy or a conversation's title from an unread row alone.
	 */
	const conversations = useQuery({
		queryKey: teamBridgeKeys.conversations(TEAM_BRIDGE_ALL_SCOPE),
		queryFn: () => TeamBridgeApi.listConversations("account"),
		enabled: active,
		staleTime: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchIntervalInBackground: true,
		refetchOnWindowFocus: true,
		retry: 1,
	});

	const cursors = useRef<Map<string, number>>(new Map());
	/** Organizations whose first unread answer (or zero total) has been seen. */
	const seededOrganizations = useRef<Set<string>>(new Set());
	const previousAccount = useRef<string | undefined>(undefined);
	/** The last plan key, so one render's worth of answers is applied once. */
	const lastPlanKey = useRef<string | null>(null);

	const planKey = [
		tenantVersion,
		accountUnread.dataUpdatedAt,
		conversations.dataUpdatedAt,
		(membershipsData?.memberships ?? [])
			.map((membership) => `${membership.tenant_id}:${membership.tenant_name}`)
			.join(","),
		selfAccountId ?? "",
	].join("#");

	// A different account starts over: seq cursors and org seeds from another
	// user's conversations are meaningless and could suppress a first banner.
	useEffect(() => {
		const previous = previousAccount.current;
		previousAccount.current = selfAccountId;
		if (previous === selfAccountId) return;
		// The first identity arrival is not a switch: the queries were disabled
		// until it landed, so there is no other account's cache to clear.
		if (previous === undefined) return;
		cursors.current = new Map();
		seededOrganizations.current = new Set();
		lastPlanKey.current = null;
		void client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		void client.invalidateQueries({
			queryKey: teamBridgeKeys.conversationsPrefix,
		});
	}, [selfAccountId, client]);

	useEffect(() => {
		// The key is the effect's change detector; the query objects below are
		// read from refs so a fresh array cannot trigger a re-plan by identity.
		if (lastPlanKey.current === planKey) return;
		lastPlanKey.current = planKey;
		if (!accountUnread.data) return;

		/*
		 * ZERO-TOTAL SEEDING RUNS BEFORE THE CONVERSATION-LIST GUARD, and that
		 * ordering is the fix for the race: a zero-total org is seeded from the
		 * account answer ALONE. If this sat below `!conversations.data`, a first
		 * message that arrived before the list resolved would make the org enter
		 * the read set unseeded; the tenant row would then be consumed as that
		 * org's first observation and the message would be silent.
		 */
		for (const organization of accountUnread.data.organizations ?? []) {
			if (
				organization.unread === 0 &&
				!seededOrganizations.current.has(organization.tenant_id)
			) {
				seededOrganizations.current.add(organization.tenant_id);
			}
		}

		if (!conversations.data) return;

		const reads = tenantUnreadRef.current;
		const organizationsForRead = notificationOrganizationsRef.current;
		// Name orgs from the account aggregate first: it already carries each
		// tenant's `tenant_name` and is the list the per-tenant reads came
		// from, so a tenant the memberships read lacks still gets its name on
		// the banner. Memberships only fill a blank name, or stand in when an
		// older aggregate sends no organizations.
		const organizations = organizationOptions(
			membershipsData?.memberships ?? [],
			accountUnread.data.organizations,
			accountUnread.data.organizations ?? null,
		);
		let plannedCursors = cursors.current;

		for (let index = 0; index < organizationsForRead.length; index += 1) {
			const organization = organizationsForRead[index];
			const data = reads[index]?.data;
			if (!data) continue;
			const rows: TeamBridgeNotifyUnreadRow[] = (data.conversations ?? []).map(
				(row) => ({
					conversation_id: row.conversation_id,
					tenant_id: organization.tenant_id,
					unread_count: row.unread_count,
					last_read_seq: row.last_read_seq,
					latest_seq: row.latest_seq,
				}),
			);
			const plan = planTeamBridgeNotifications({
				conversations: conversations.data.conversations,
				rows,
				organizations,
				selfAccountId,
				cursors: plannedCursors,
				seeded: seededOrganizations.current.has(organization.tenant_id),
				/*
				 * MAIN IS THE ONLY QUIET AUTHORITY. A renderer cannot tell a focused
				 * window from an occluded one on macOS, and Electron reports both as
				 * hidden; `document.hasFocus()` is a hint at best. So the watcher
				 * always asks, and main's real window check refuses the banner while
				 * the user is actually looking at the app. The cursor advances either
				 * way, so leaving the app does not replay a seq the badge already
				 * showed.
				 */
				quiet: false,
			});
			plannedCursors = plan.cursors;
			if (plan.seeded) {
				seededOrganizations.current.add(organization.tenant_id);
			}
			for (const candidate of plan.candidates) {
				const bridge = window.api?.desktop?.teamBridge;
				if (!bridge) continue;
				const conversationName =
					candidate.conversationName ?? t("ui.teamBridge.list.untitled");
				const title = candidate.organizationName
					? t("ui.teamBridge.notify.title", {
							conversation: conversationName,
							organization: candidate.organizationName,
						})
					: conversationName;
				const body = candidate.senderLabel
					? t("ui.teamBridge.notify.body", { sender: candidate.senderLabel })
					: t("ui.teamBridge.notify.body_fallback");
				// Fire and forget: a refused banner is not something the user can act
				// on, and the cursor has already advanced, so a retry would duplicate
				// rather than repair. The next message is the retry.
				void bridge
					.notify({
						conversationId: candidate.conversationId,
						tenantId: candidate.tenantId,
						seq: candidate.seq,
						title,
						body,
					})
					.catch(() => undefined);
			}
		}

		cursors.current = plannedCursors;
	}, [
		planKey,
		accountUnread.data,
		conversations.data,
		membershipsData,
		selfAccountId,
	]);
}
