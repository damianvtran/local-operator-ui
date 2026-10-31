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
 * therefore always asks on a new seq, telling main only whether the page is
 * showing THIS conversation (`viewing`); main refuses to raise while a focused
 * window is on it. The cursor advances either way, so leaving the app does not
 * replay a seq the badge already showed.
 *
 * WHAT THE BANNER SAYS (tb-os-notifications). A banner that only said "someone
 * sent a message" made the person open the app to learn who and what. So for
 * each candidate the watcher reads the conversation's newest page and composes
 * sender / place / preview (`team-bridge-banner-format.ts`). That read:
 *  - goes THROUGH THE TIMELINE'S OWN QUERY ENTRY (`teamBridgeMessagesQueryOptions`),
 *    and the banner is raised only after that entry holds the message. It used
 *    to go straight through `TeamBridgeApi` with `limit: 1` and drop the body,
 *    which left the page's cached history at whatever it was when the reader
 *    last looked: a click painted that stale page and the announced message
 *    appeared seconds later (operator report, 2026-10-30). The body therefore
 *    lives in the renderer's in-memory query cache exactly as it does when the
 *    page itself reads it (garbage-collected after the cache's idle window,
 *    never persisted). A reply is merged into its thread's cached pages the
 *    same way when the thread pane has been opened;
 *  - is the signed-in HUMAN's own history read, which the hub answers with
 *    bodies for a human member (an agent member's history withholds them until
 *    admitted; this surface never reads as an agent);
 *  - is never logged, and a failure degrades to the metadata banner rather
 *    than to silence, so a slow history read cannot cost the notification.
 *
 * THE APP'S NOTIFICATION SWITCH. `display.notifications` is the registry's
 * "Desktop notifications" row (the backend's banners obey it); off means no
 * Team Bridge banners either. Unknown (no answer, or a backend without the
 * settings registry) keeps its default, which is on.
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { readFlagValue } from "@features/chat/canonical/display-settings";
import { backendSettingsQueryOptions } from "@features/chat/canonical/use-display-flag";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import {
	observedRadientAuthority,
	radientAuthorityPending,
	radientAuthoritySnapshot,
	subscribeRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
import {
	type InfiniteData,
	type QueryClient,
	isCancelledError,
	useMutationState,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
	directoryIdentity,
	resolveIdentityAvatar,
} from "../../../../shared/identity-avatar";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
	TeamBridgeThreadPage,
} from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_NOTIFY_MAX_TITLE,
	type TeamBridgeNotificationSender,
	parseTeamBridgeNotificationSender,
	safeTeamBridgeBannerText,
} from "../../../../shared/team-bridge-notify";
import {
	type TeamBridgeBannerCopy,
	type TeamBridgeBannerPlace,
	teamBridgeBannerText,
	teamBridgePreviewText,
} from "./team-bridge-banner-format";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	asTeamBridgeTenantId,
	organizationOptions,
	participantLabel,
} from "./team-bridge-model";
import {
	TEAM_BRIDGE_NOTIFY_POLL_MS,
	type TeamBridgeNotifyCandidate,
	type TeamBridgeNotifyUnreadRow,
	planTeamBridgeNotifications,
	shouldNotifyTeamBridge,
	teamBridgeNotifyOrganizations,
} from "./team-bridge-notify-model";
import {
	teamBridgeNotifyPolicyPending,
	waitForTeamBridgeNotifyPolicy,
} from "./team-bridge-notify-policy";
import {
	bridgeOwnerCurrent,
	captureBridgeStatusAuthority,
	readForBridgeOwner,
	useTeamBridgeAccount,
} from "./team-bridge-owner";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";
import { assertThreadPage } from "./team-bridge-thread-read";
import { patchTeamBridgeListsFromUnread } from "./team-bridge-unread-sync";
import { teamBridgeViewingConversation } from "./team-bridge-viewing";
import {
	type TeamBridgeDirectoryReads,
	teamBridgeKeys,
	teamBridgeMessagesQueryOptions,
	useTeamBridgeDirectories,
	useTeamBridgeStatus,
	useTeamBridgeUnread,
} from "./use-team-bridge";

/** The registry key of the app's "Desktop notifications" switch. */
const DESKTOP_NOTIFICATIONS_SETTING = "display.notifications";

/** The catalogue copy `teamBridgeBannerText` composes from, read per banner so
 * a language change applies to the next one. */
function bannerCopy(): TeamBridgeBannerCopy {
	return {
		untitled: t("ui.teamBridge.list.untitled"),
		directMessage: t("ui.teamBridge.kind.dm"),
		group: t("ui.teamBridge.kind.group"),
		channel: (name) => t("ui.teamBridge.notify.channel", { channel: name }),
		subtitle: (place, organization) =>
			t("ui.teamBridge.notify.subtitle", { place, organization }),
		count: (count) => t("ui.teamBridge.notify.count", { count }),
		countPreview: (count, preview) =>
			t("ui.teamBridge.notify.count_preview", { count, preview }),
		fallback: t("ui.teamBridge.notify.body_fallback"),
	};
}

function bannerPlace(
	candidate: TeamBridgeNotifyCandidate,
): TeamBridgeBannerPlace {
	if (candidate.kind === "dm") return { kind: "dm" };
	return { kind: candidate.kind, name: candidate.name };
}

/**
 * One directory member as the sender descriptor main keys its image cache on.
 *
 * SHARED by the banner path and the roster warm (review m3): if the two built
 * the descriptor differently - one honouring `source: "none"`, the other not -
 * the warm would fill a key the banner never reads, and the banner would miss
 * and wait. `undefined` when the member cannot be described (e.g. an agent
 * banner for a member with no named agent).
 */
function notificationSender(
	member: TeamBridgeDirectoryMember,
	kind: TeamBridgeNotificationSender["kind"],
): TeamBridgeNotificationSender | undefined {
	// Directory identity, not a message's possibly stale composed label. The
	// picture comes from the one identity resolver, which honours source=none
	// and NEVER gives an agent its owner's photo: a `person_agent` banner is
	// drawn as the agent glyph (core), not the owner's face (2026-10-30).
	const resolved = resolveIdentityAvatar(
		directoryIdentity(member, kind === "person_agent" ? "agent" : "human"),
	).src;
	// Only an account photo has a banner relay today; an endpoint picture (the
	// seam in `identity-avatar.ts`) needs its own closed route before it can
	// ride here.
	const photo = resolved?.type === "account" ? resolved : null;
	return parseTeamBridgeNotificationSender({
		v: 1,
		kind,
		account_id: member.account_id,
		display_name: safeTeamBridgeBannerText(
			member.display_label,
			TEAM_BRIDGE_NOTIFY_MAX_TITLE,
		),
		agent_name: safeTeamBridgeBannerText(
			member.agent?.name ?? "",
			TEAM_BRIDGE_NOTIFY_MAX_TITLE,
		),
		...(photo
			? { avatar: { account_id: photo.accountId, hash: photo.hash } }
			: {}),
	});
}

/**
 * The organization's people, for naming a sender the way the rail does.
 *
 * Join ONLY the already-fetched owner+tenant cache entry. Notification delivery
 * must never fetch a directory per message or wait on a directory request.
 * A missing/refused directory keeps the wire label and the app icon.
 */
function directoryPeople(
	client: QueryClient,
	tenantId: string,
	accountId: string,
): readonly TeamBridgeDirectoryMember[] {
	return (
		client.getQueryData<Awaited<ReturnType<typeof TeamBridgeApi.directory>>>(
			teamBridgeKeys.directory(tenantId, accountId),
		)?.members ?? []
	);
}

/**
 * Fold a banner's reply into its thread's cached pages, when the thread pane
 * has been opened before (an entry exists). Without this the pane would paint
 * its old pages on the click and show the announced reply only on its next
 * poll - the timeline bug, one level down.
 *
 * Only the LAST page may grow, and only when it says no later page exists:
 * pages are forward cursors over an oldest-first thread, so appending to a
 * page that has a successor would put the reply out of order. The row is the
 * server's own (its `client_ref` included), never a reconstruction.
 */
function mergeReplyIntoThreadCache(
	client: QueryClient,
	candidate: TeamBridgeNotifyCandidate,
	threadId: string,
	reply: TeamBridgeMessage,
): void {
	// The thread pane's key is the UNOWNED replies key; match it exactly.
	const key = teamBridgeKeys.replies(
		candidate.tenantId,
		candidate.conversationId,
		threadId,
	);
	client.setQueryData<InfiniteData<TeamBridgeThreadPage>>(key, (current) => {
		const last = current?.pages.at(-1);
		if (!current || !last || last.has_more) return current;
		if (
			current.pages.some((page) =>
				page.replies.some((row) => row.id === reply.id),
			)
		)
			return current;
		return {
			...current,
			pages: [
				...current.pages.slice(0, -1),
				{
					...last,
					replies: [...last.replies, reply].sort((a, b) => a.seq - b.seq),
				},
			],
		};
	});
}

/**
 * The banner's own read of a conversation's newest page.
 *
 * WHY `fetchQuery`, AND WHAT "JOIN" MEANS HERE (agent review round 1, n1). It
 * carries the reader itself, so an entry whose observer is long gone still
 * refreshes, and a read already in flight for the same key is JOINED rather
 * than cancelled - `Query.fetch` only cancels an in-flight fetch when the
 * CALLER passes `cancelRefetch`, and `fetchQuery` never does.
 *
 * PASSING `cancelRefetch: false` EXPLICITLY IS NOT AVAILABLE, which is why this
 * note is here instead of a flag: the property is not part of `FetchQueryOptions`
 * in this version (tsc rejects it), and it would change nothing anyway - an
 * absent `cancelRefetch` is already falsy in `Query.fetch`, so this call already
 * joins. The round-1 suggestion assumed the flag was what made the join happen;
 * it is the default, and the flag is unreachable from this API.
 *
 * THE EXPOSURE THAT IS REAL is the other direction: anyone else can cancel this
 * read. `invalidateQueries`/`refetchQueries` for this key passes `cancelRefetch:
 * true` and aborts the running fetch, which surfaces here as a rejected
 * `CancelledError`, a banner degraded to metadata, and a click with no message
 * to land on. That is why the call site retries once (see the catch below).
 */
function timelineReadOptions(
	client: QueryClient,
	conversationId: string,
	tenantId: string,
	accountId: string,
) {
	return {
		...teamBridgeMessagesQueryOptions(
			client,
			conversationId,
			tenantId,
			accountId,
		),
		// The entry may hold a page fetched before this message existed; a
		// fresher-looking stale page is the bug itself.
		staleTime: 0,
	};
}

/**
 * Compose and send one banner. Never throws, never logs.
 *
 * The newest message is read at notify time (see the module doc for why this
 * is the safe place for a body). A newest message the reader wrote THEMSELF
 * means they already answered (on another device, or just now): there is
 * nothing to tell them, so no banner.
 */
async function deliverTeamBridgeBanner(
	client: QueryClient,
	candidate: TeamBridgeNotifyCandidate,
	selfAccountId: string,
	stillCurrent: () => boolean,
	signal: AbortSignal,
): Promise<void> {
	if (!stillCurrent()) return;
	let senderLabel = candidate.senderLabel;
	let sender: TeamBridgeNotificationSender | undefined;
	let preview: string | null = null;
	/* Set only once the message is in the cache a click will render from. */
	let messageId: string | undefined;
	/*
	 * A thread preview is read only in a build that ships the guarded thread
	 * contract. The observed account supplies the required receipt, and the
	 * authority comparison above prevents a delayed preview crossing to the next
	 * signed-in account. Older/held builds use the ordinary message read instead.
	 */
	const authority = observedRadientAuthority(client);
	if (authority.accountId !== selfAccountId) return;
	const owner = { accountId: selfAccountId, epoch: authority.epoch };
	const threadId = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD
		? candidate.threadId
		: undefined;
	try {
		// Timeline history excludes replies. Address the candidate's thread and
		// inclusive sequence cursor directly: one row bounds the read even for an
		// old, long thread; never page through its private history for a banner.
		let newest: TeamBridgeMessage | undefined;
		if (threadId) {
			newest = assertThreadPage(
				await TeamBridgeApi.listReplies(candidate.conversationId, threadId, {
					tenantId: candidate.tenantId,
					accountId: selfAccountId,
					afterSeq: candidate.seq,
					limit: 1,
				}),
				{
					tenantId: candidate.tenantId,
					conversationId: candidate.conversationId,
					rootId: threadId,
				},
			).replies.find((reply) => reply.seq === candidate.seq);
			if (newest && stillCurrent())
				mergeReplyIntoThreadCache(client, candidate, threadId, newest);
		} else {
			/*
			 * WRITE BEFORE NOTIFY. The one read lands in the timeline's own cache
			 * entry (same key, same reader as the page), so by the time the banner
			 * can be clicked the page already holds the message it announces.
			 */
			const read = () =>
				client.fetchQuery(
					timelineReadOptions(
						client,
						candidate.conversationId,
						candidate.tenantId,
						selfAccountId,
					),
				);
			const page = await read().catch((error: unknown) => {
				// Cancelled from outside: ask again, once (see the helper).
				if (!isCancelledError(error)) throw error;
				return read();
			});
			newest = page.messages.reduce<TeamBridgeMessage | undefined>(
				(max, message) =>
					max === undefined || message.seq > max.seq ? message : max,
				undefined,
			);
		}
		if (newest && newest.seq >= candidate.seq) {
			/*
			 * Timeline messages only. A reply's click opens its thread pane, which
			 * has no row target to land on; a `message` parameter the page has to
			 * ignore is the kind `teamBridgeOpenPath` refuses to emit.
			 */
			if (!threadId) messageId = newest.id;
			if (
				newest.sender.kind === "human" &&
				newest.sender.account_id === selfAccountId
			) {
				return;
			}
			if (!stillCurrent()) return;
			const people = directoryPeople(client, candidate.tenantId, selfAccountId);
			senderLabel = participantLabel(newest.sender, people, {
				named: (agent, person) =>
					t("ui.teamBridge.chief.label", { agent, person }),
				unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
			});
			const person = people.find(
				(member) => member.account_id === newest.sender.account_id,
			);
			if (
				person &&
				(newest.sender.kind === "human" || newest.sender.kind === "agent")
			) {
				sender = notificationSender(
					person,
					newest.sender.kind === "human" ? "person" : "person_agent",
				);
			}
			preview = teamBridgePreviewText(newest.body);
		}
	} catch {
		// Degrade to the metadata banner: a person is still told someone wrote.
	}
	const bridge = window.api?.desktop?.teamBridge;
	if (!bridge) return;
	const text = teamBridgeBannerText(
		{
			senderLabel,
			conversationName: candidate.conversationName,
			place: bannerPlace(candidate),
			organizationName: candidate.organizationName,
			preview,
			unreadCount: candidate.unreadCount,
		},
		bannerCopy(),
	);
	// Fire and forget: a refused banner is not something the user can act on,
	// and the cursor has already advanced, so a retry would duplicate rather
	// than repair. The next message is the retry.
	// Reads above may span a settings change, sign-out or capability disable.
	// Read the LIVE policy at the last synchronous boundary before IPC, not the
	// snapshot that started the request. Cursors advance independently.
	// Planning already consumed the seq. An optimistic mute may still fail:
	// defer this one delivery until rollback/success has reconciled the cache,
	// rather than permanently dropping it or replaying the planner's backlog.
	// Recheck synchronously after each wake in case another write began before
	// this continuation ran. The final policy/notify boundary has no await gap.
	while (
		teamBridgeNotifyPolicyPending(
			client,
			owner,
			candidate.conversationId,
			candidate.tenantId,
		)
	) {
		await waitForTeamBridgeNotifyPolicy(
			client,
			owner,
			candidate.conversationId,
			candidate.tenantId,
			signal,
		);
		if (signal.aborted || !stillCurrent()) return;
	}
	if (signal.aborted || !stillCurrent()) return;
	const conversation = client
		.getQueryData<Awaited<ReturnType<typeof TeamBridgeApi.listConversations>>>(
			teamBridgeKeys.conversations(TEAM_BRIDGE_ALL_SCOPE, selfAccountId),
		)
		?.conversations.find(
			(row) =>
				row.id === candidate.conversationId &&
				row.tenant_id === candidate.tenantId,
		);
	if (!conversation || !shouldNotifyTeamBridge(conversation, selfAccountId))
		return;
	await bridge
		.notify({
			owner: { accountId: selfAccountId, epoch: owner.epoch },
			conversationId: candidate.conversationId,
			// A reply banner names its thread root so the click opens the thread
			// pane; omitted for a top-level message, and omitted entirely while the
			// hold is on (see `threadId` above).
			...(threadId ? { threadId } : {}),
			// The click's scroll/highlight target; present only when the cache
			// the page renders from already holds it (see WRITE BEFORE NOTIFY).
			...(messageId ? { messageId } : {}),
			tenantId: candidate.tenantId,
			...(sender ? { sender } : {}),
			seq: candidate.seq,
			title: text.title,
			subtitle: text.subtitle,
			body: text.body,
			viewing: teamBridgeViewingConversation() === candidate.conversationId,
		})
		.catch(() => undefined);
}

/**
 * Keep caches the page will paint from current while the page is closed.
 *
 * Runs for EVERY tenant unread answer, whether or not anything banners (muted,
 * notifications off, the reader already looking): a banner is only one way
 * back into a conversation, and a rail click into a conversation visited
 * earlier painted its cached page from then, with the new message landing on
 * the next poll (operator report, 2026-10-30).
 *
 *  - Conversation-list rows take the unread row's count and cursors, so the
 *    rail and the nav badge read one set of numbers (`team-bridge-unread-sync.ts`).
 *  - A timeline entry that ALREADY EXISTS for a conversation whose `latest_seq`
 *    moved since the last answer is refetched, exactly that key. A conversation
 *    never opened gets no entry: this adds no read for history nobody looked at.
 *    The first answer only records the seq; `latest_seq` also advances for
 *    replies, which the timeline excludes, so comparing against the cached
 *    page's newest seq would refetch a reply-active thread on every poll.
 *    Joining (not cancelling) a banner's in-flight read of the same key keeps
 *    that banner from degrading to metadata.
 */
function syncUnmountedConversations(
	client: QueryClient,
	accountId: string,
	tenantId: string,
	rows: ReadonlyArray<{ conversation_id: string; latest_seq: number }> &
		Parameters<typeof patchTeamBridgeListsFromUnread>[3],
	observed: Map<string, number>,
): void {
	patchTeamBridgeListsFromUnread(client, accountId, tenantId, rows);
	for (const row of rows) {
		const key = `${tenantId}\u0000${row.conversation_id}`;
		const previous = observed.get(key);
		observed.set(key, row.latest_seq);
		if (previous === undefined || row.latest_seq <= previous) continue;
		const options = teamBridgeMessagesQueryOptions(
			client,
			row.conversation_id,
			tenantId,
			accountId,
		);
		if (client.getQueryState(options.queryKey)?.data === undefined) continue;
		// `fetchQuery`, not `refetchQueries`: it carries the reader itself, so an
		// entry whose observer is long gone still refreshes, and an in-flight read
		// of the same key (a banner's) is joined rather than cancelled.
		void client.fetchQuery({ ...options, staleTime: 0 }).catch(() => undefined);
	}
}

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
	const accountAuthority = useTeamBridgeAccount();
	const status = useTeamBridgeStatus(enabled && available);
	const selfAccountId = accountAuthority.accountId;
	const signedIn = Boolean(selfAccountId);
	const active =
		enabled &&
		available &&
		signedIn &&
		status.data?.account_id === selfAccountId &&
		status.data?.state === "ready" &&
		status.data.local.enabled &&
		!status.data.read_only;
	const client = useQueryClient();
	// Pending IDs wake planning when a write settles even if its invalidations
	// returned byte-identical data. A count alone misses swaps between writes.
	const pendingPolicyIds = useMutationState({
		filters: {
			mutationKey: teamBridgeKeys.notifyMutation(
				selfAccountId,
				accountAuthority.epoch,
			),
			exact: true,
			status: "pending",
		},
		select: (mutation) => mutation.mutationId,
	});
	useLayoutEffect(() => {
		const bridge = window.api?.desktop?.teamBridge;
		if (!bridge?.setAuthority) return;
		// Subscribe directly to the credential journal, not a rendered account
		// ref: beginTransition publishes revocation without waiting for React.
		// This is a separate authority channel; a late notify cannot update it.
		const publish = () => {
			void bridge
				.setAuthority({
					...observedRadientAuthority(client),
					settling: radientAuthorityPending(client),
				})
				.catch(() => undefined);
		};
		const unsubscribe = subscribeRadientAuthority(client, publish);
		publish();
		return unsubscribe;
	}, [client]);
	const memberships = useMembershipsQuery({ enabled: active });
	/*
	 * The app's notification switch, through the one shared registry read
	 * (`backendSettingsQueryOptions`) and gated on the plane advertising it, the
	 * same arm `useDisplayFlag` applies. Read through a ref at delivery time so a
	 * toggle takes effect on the next banner without re-planning.
	 */
	const capabilities = useDesktopCapabilities();
	const settingsAdvertised = desktopFeatureEnabled(
		capabilities.data,
		"settings",
	);
	const settings = useQuery({
		...backendSettingsQueryOptions(),
		enabled: active && settingsAdvertised,
	});
	const notificationsOff =
		settingsAdvertised &&
		readFlagValue(settings.data?.settings, DESKTOP_NOTIFICATIONS_SETTING) ===
			false;
	const notificationsOffRef = useRef(notificationsOff);
	notificationsOffRef.current = notificationsOff;
	const accountRef = useRef(selfAccountId);
	accountRef.current = selfAccountId;
	const activeRef = useRef(active);
	activeRef.current = active;
	const deliveryAbort = useRef(new AbortController());
	useEffect(() => {
		const controller = new AbortController();
		deliveryAbort.current = controller;
		if (
			!active ||
			notificationsOff ||
			accountAuthority.token !== radientAuthoritySnapshot(client)
		)
			controller.abort();
		return () => controller.abort();
	}, [active, notificationsOff, accountAuthority.token, client]);
	useEffect(() => {
		activeRef.current = active;
		return () => {
			activeRef.current = false;
		};
	}, [active]);
	const membershipsData = memberships.data;

	const accountUnread = useTeamBridgeUnread(active, TEAM_BRIDGE_ALL_SCOPE, {
		accountId: selfAccountId,
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
				queryKey: teamBridgeKeys.unread(
					tenantId,
					selfAccountId ?? "unresolved-owner",
				),
				queryFn: () =>
					readForBridgeOwner(client, selfAccountId, () =>
						TeamBridgeApi.unread({ tenantId }),
					),
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
	const directories = useTeamBridgeDirectories(
		notificationOrganizations.map((organization) =>
			asTeamBridgeTenantId(organization.tenant_id),
		),
		active,
		selfAccountId,
	);
	/*
	 * The descriptors main warms, built in render because they are cheap and
	 * pure. A member's agent posts under the member's account but core draws a
	 * different composite for it (the agent marker, review M2), so a member with
	 * a named agent is described in both variants.
	 *
	 * WHY THE ROSTERS ARE SELECTED THROUGH `TeamBridgeDirectoryReads` AND NOT
	 * ITERATED OFF THE HOOK'S ANSWER. The annotation below is a guard against a
	 * defect class that type-checked and then crashed, so it is not noise to be
	 * deleted in a tidy-up.
	 *
	 * `useTeamBridgeDirectories` answers `{ members, state, retry }`, because a
	 * caller has to draw a failed read as failed and a pending read as pending
	 * (review round 1, F1), which a bare `Record<tenantId, member[]>` cannot say.
	 * This fan-out wants only the loaded rosters, so it takes `members`.
	 *
	 * This loop used to run `Object.entries(directories)` over the WHOLE answer,
	 * and that was silently wrong in a way no type gate caught: `Object.entries`
	 * resolves to its `[string, any][]` overload when an object's value types
	 * disagree - arrays beside a state record beside a function - so `any`
	 * absorbed the `.filter` below, `check-types` stayed green, and every render
	 * threw "members.filter is not a function". Naming the contract type here
	 * makes the hook's shape a compile-time requirement of this call site: a hook
	 * that stops carrying `members` as a roster map - including a return to the
	 * old bare map, where `directories.members` would be one roster rather than a
	 * map of them - fails THIS assignment instead of failing in a render.
	 */
	const directoryMembers: TeamBridgeDirectoryReads["members"] =
		directories.members;
	const directorySenders: Record<string, TeamBridgeNotificationSender[]> = {};
	for (const [tenantId, members] of Object.entries(directoryMembers))
		directorySenders[tenantId] = members
			.filter((member) => member.account_id !== selfAccountId)
			.flatMap((member) => [
				notificationSender(member, "person"),
				...(member.agent?.name
					? [notificationSender(member, "person_agent")]
					: []),
			])
			.filter(
				(sender): sender is TeamBridgeNotificationSender =>
					sender !== undefined,
			);
	/*
	 * Read through a ref for the reason `tenantUnreadRef` exists: the record
	 * above is a fresh object every render, so depending on it directly would
	 * re-send every roster to main on each one. The serialized descriptors are
	 * the change detector - they carry exactly what main keys on (hash, kind,
	 * the name the initials come from), so a rename re-sends and re-warms the
	 * initials while an unchanged roster sends nothing.
	 */
	const directoryVersion = JSON.stringify(directorySenders);
	const directoriesRef = useRef(directorySenders);
	directoriesRef.current = directorySenders;
	/** The roster version last sent to main, so one answer is applied once (and a
	 * StrictMode double-invoke does not repeat every warm). */
	const lastDirectoryKey = useRef<string | null>(null);
	/** Tenants whose roster main currently holds, so one that disappears (the
	 * viewer left the org, or its directory is now refused) is revoked at once
	 * rather than left to age out of the TTL (review m4). */
	const syncedTenants = useRef<Set<string>>(new Set());

	const conversations = useQuery({
		queryKey: teamBridgeKeys.conversations(
			TEAM_BRIDGE_ALL_SCOPE,
			selfAccountId ?? "unresolved-owner",
		),
		queryFn: () =>
			readForBridgeOwner(client, selfAccountId, () =>
				TeamBridgeApi.listConversations("account"),
			),
		enabled: active,
		staleTime: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchInterval: TEAM_BRIDGE_NOTIFY_POLL_MS,
		refetchIntervalInBackground: true,
		refetchOnWindowFocus: true,
		retry: 1,
	});

	const cursors = useRef<Map<string, number>>(new Map());
	/** `latest_seq` last seen per tenant+conversation (see `syncUnmountedConversations`). */
	const observedLatest = useRef<Map<string, number>>(new Map());
	/** Organizations whose first unread answer (or zero total) has been seen. */
	const seededOrganizations = useRef<Set<string>>(new Set());
	const previousAccount = useRef<string | undefined>(undefined);
	/** The last plan key, so one render's worth of answers is applied once. */
	const lastPlanKey = useRef<string | null>(null);

	const planKey = [
		// Disable is a consuming policy transition, not only a delivery abort.
		// Re-plan deferred rows even when no unread/cache timestamp changed;
		// otherwise off -> on could replay them after a failed mute settles.
		active,
		notificationsOff,
		pendingPolicyIds.join(","),
		tenantVersion,
		accountUnread.dataUpdatedAt,
		conversations.dataUpdatedAt,
		(membershipsData?.memberships ?? [])
			.map((membership) => `${membership.tenant_id}:${membership.tenant_name}`)
			.join(","),
		selfAccountId ?? "",
	].join("#");

	// The roster is the sender-photo revocation authority. Every fresh answer
	// evicts missing members/changed hashes in main and warms 64 px composites.
	useEffect(() => {
		if (lastDirectoryKey.current === directoryVersion) return;
		lastDirectoryKey.current = directoryVersion;
		const bridge = window.api?.desktop?.teamBridge;
		if (!bridge?.syncDirectory) return;
		const current = directoriesRef.current;
		// An EMPTY roster is main's per-tenant revocation: every cached or
		// pending composite for that tenant is dropped.
		for (const tenantId of syncedTenants.current)
			if (!(tenantId in current))
				void bridge.syncDirectory({ tenantId, members: [] }).catch(() => {
					// Same as below: the next fenced roster reconciles.
				});
		syncedTenants.current = new Set(Object.keys(current));
		for (const [tenantId, senders] of Object.entries(current)) {
			void bridge.syncDirectory({ tenantId, members: senders }).catch(() => {
				// A navigation/auth transition may close this channel; the next
				// fenced roster will reconcile the cache. Photos never gate delivery.
			});
		}
		// `selfAccountId` is folded into `directoryVersion` (the self filter), so
		// an account change re-sends through the version, not a second dep.
	}, [directoryVersion]);

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
		observedLatest.current = new Map();
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
			if (selfAccountId)
				syncUnmountedConversations(
					client,
					selfAccountId,
					organization.tenant_id,
					data.conversations ?? [],
					observedLatest.current,
				);
			const seeded = seededOrganizations.current.has(organization.tenant_id);
			const owner = observedRadientAuthority(client);
			// A message discovered during an optimistic mute has no delivery to
			// resume yet. Leave its cursor untouched until mutation settlement
			// wakes this planner. First observation still seeds silently; a global
			// disable still consumes rows, so neither case acquires a backlog.
			const settledRows = rows.filter((row) => {
				if (
					!seeded ||
					!activeRef.current ||
					notificationsOffRef.current ||
					!owner.accountId ||
					owner.accountId !== selfAccountId
				)
					return true;
				return !teamBridgeNotifyPolicyPending(
					client,
					{ accountId: owner.accountId, epoch: owner.epoch },
					row.conversation_id,
					row.tenant_id,
				);
			});
			const plan = planTeamBridgeNotifications({
				conversations: conversations.data.conversations,
				rows: settledRows,
				organizations,
				selfAccountId,
				cursors: plannedCursors,
				seeded,
				/*
				 * MAIN IS THE ONLY QUIET AUTHORITY. A renderer cannot tell a focused
				 * window from an occluded one on macOS, and Electron reports both as
				 * hidden; `document.hasFocus()` is a hint at best. So the watcher
				 * always asks, and main's real window check refuses the banner while
				 * the user is actually looking at the app. The cursor advances either
				 * way, so leaving the app does not replay a seq the badge already
				 * showed.
				 */
				// Shell policy consumes disabled intervals without candidates;
				// this is not a renderer-side guess about native window focus.
				quiet: !active || notificationsOff,
			});
			plannedCursors = plan.cursors;
			if (plan.seeded) {
				seededOrganizations.current.add(organization.tenant_id);
			}
			// The switch is checked AFTER planning on purpose: the cursors still
			// advance while it is off, so turning it back on does not replay a
			// backlog of messages the badge already showed.
			if (!active || notificationsOff || !selfAccountId) continue;
			const account = selfAccountId;
			const authToken = radientAuthoritySnapshot(client);
			/* The SAME authority projection the owner-read fence uses, never the
			 * cached object's identity: a status refetch mid-delivery installs a
			 * new object (checked_at/fetched_at move every time) for an unchanged
			 * authority, and an identity compare silently dropped that banner.
			 * Sharing the projection is what keeps the two fences from drifting. */
			const bridgeStatusHolds = captureBridgeStatusAuthority(client, account);
			for (const candidate of plan.candidates) {
				void deliverTeamBridgeBanner(
					client,
					candidate,
					account,
					() =>
						accountRef.current === account &&
						radientAuthoritySnapshot(client) === authToken &&
						bridgeStatusHolds() &&
						activeRef.current &&
						!notificationsOffRef.current &&
						bridgeOwnerCurrent(client, account),
					deliveryAbort.current.signal,
				);
			}
		}

		cursors.current = plannedCursors;
	}, [
		planKey,
		active,
		notificationsOff,
		accountUnread.data,
		conversations.data,
		membershipsData,
		selfAccountId,
		client,
	]);
}
