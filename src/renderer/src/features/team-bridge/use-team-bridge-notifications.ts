/**
 * The Team Bridge notification watcher.
 *
 * WHAT IT DOES. Every 30 seconds while the signed-in user is in a visible
 * window, it reads the same account-scoped unread answer the sidebar badge
 * spends and the account-scoped conversation list (the membership and notify
 * facts live there, not in the unread row). `planTeamBridgeNotifications`
 * decides what is new, and this hook asks main to raise one banner per new
 * sequence number.
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
 * QUIET WHEN ACTIVE. A focused window already shows the badge. The renderer
 * skips the IPC in that case and advances the cursor, so leaving the app does
 * not replay a backlog the user just saw. Main checks real focus again before
 * delivering; a renderer's `hasFocus()` is a hint, not the authority.
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { t } from "@shared/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
 * Whether the document is visible, tracked rather than read once.
 *
 * A hidden or minimised renderer stops polling, matching the existing badge
 * hook's background policy. The listener exists because this hook mounts for
 * the app's lifetime: a value read at mount would freeze whatever the window
 * state was at startup and never poll again after a minimise/restore cycle.
 */
function useDocumentVisible(): boolean {
	const [visible, setVisible] = useState(
		() =>
			typeof document === "undefined" || document.visibilityState === "visible",
	);
	useEffect(() => {
		if (typeof document === "undefined") return;
		const onChange = () => setVisible(document.visibilityState === "visible");
		document.addEventListener("visibilitychange", onChange);
		return () => document.removeEventListener("visibilitychange", onChange);
	}, []);
	return visible;
}

/**
 * Subscribe to Team Bridge unread and raise a banner for each new sequence.
 *
 * `enabled` is the `team_bridge_conversations` capability gate from the shell.
 * Everything else is gated inside: a signed-out account has no identity to
 * match against member rows, and a hidden window has no business polling.
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
	const visible = useDocumentVisible();
	const active = enabled && available && signedIn && visible;
	const client = useQueryClient();
	const memberships = useMembershipsQuery({ enabled: active });
	const membershipsData = memberships.data;

	const unread = useTeamBridgeUnread(active, TEAM_BRIDGE_ALL_SCOPE, {
		refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
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
			// `hasFocus` is the renderer's honest local answer. Main re-checks the
			// real window before showing, and a mismatch costs one suppressed
			// banner rather than an interruption.
			quiet: typeof document !== "undefined" && document.hasFocus(),
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
