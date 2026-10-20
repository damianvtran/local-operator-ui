/**
 * The Team Bridge notification watcher.
 *
 * WHAT IT DOES. Every 30 seconds while the user is signed in, it reads the
 * same account-scoped unread answer the sidebar badge spends and the
 * account-scoped conversation list (the membership and notify facts live
 * there, not in the unread row). `planTeamBridgeNotifications` decides what is
 * new, and this hook asks main to raise one banner per new sequence number.
 *
 * HIDDEN IS NOT PAUSED. The poll runs in the background on purpose: Electron
 * reports a minimised window - and, on macOS, a fully occluded one - as
 * hidden, which is exactly the state a banner is for. React Query pauses a
 * `refetchInterval` in the background by default, so both observers set
 * `refetchIntervalInBackground`. Main's real-focus check remains the only
 * quiet authority; the renderer never gates delivery on visibility.
 *
 * WHY A HOOK IN THE SHELL, NOT THE PAGE. A banner is useful precisely when the
 * Team Bridge page is NOT open. Mounting this inside the page would make it
 * silent the moment the reader went back to chat, which is the state the
 * feature exists for.
 *
 * WHY TWO READS. The unread route is deliberately one cheap aggregate and
 * carries no membership or notification policy. The conversation list already
 * has both (and the sender label a banner may borrow), so the watcher reads
 * the merged page rather than inventing a second backend route or fetching
 * messages. No body is ever read here.
 *
 * FIRST LOAD SEEDS. A fresh observer sees every pre-existing unread row as new
 * if it only compared sequence numbers; the planner instead advances every
 * cursor on the first complete answer and raises nothing. Only a strictly newer
 * seq after that is an event.
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	organizationOptions,
} from "./team-bridge-model";
import {
	TEAM_BRIDGE_NOTIFY_POLL_MS,
	planTeamBridgeNotifications,
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

	const unread = useTeamBridgeUnread(active, TEAM_BRIDGE_ALL_SCOPE, {
		refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchIntervalInBackground: true,
	});
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
	const seeded = useRef(false);
	const previousAccount = useRef<string | undefined>(undefined);

	// A different account starts over: seq cursors from another user's
	// conversations are meaningless and could suppress that user's first banner.
	useEffect(() => {
		const previous = previousAccount.current;
		previousAccount.current = selfAccountId;
		if (previous === selfAccountId) return;
		// The first identity arrival is not a switch: the queries were disabled
		// until it landed, so there is no other account's cache to clear.
		if (previous === undefined) return;
		cursors.current = new Map();
		seeded.current = false;
		void client.invalidateQueries({ queryKey: teamBridgeKeys.unreadPrefix });
		void client.invalidateQueries({
			queryKey: teamBridgeKeys.conversationsPrefix,
		});
	}, [selfAccountId, client]);

	useEffect(() => {
		if (!unread.data || !conversations.data) return;
		const plan = planTeamBridgeNotifications({
			conversations: conversations.data.conversations,
			unread: unread.data,
			organizations: organizationOptions(
				membershipsData?.memberships ?? [],
				unread.data.organizations,
			),
			selfAccountId,
			cursors: cursors.current,
			seeded: seeded.current,
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
		cursors.current = plan.cursors;
		seeded.current = plan.seeded;
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
	}, [unread.data, conversations.data, membershipsData, selfAccountId]);
}
