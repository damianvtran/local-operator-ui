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
 * each candidate the watcher reads the ONE newest message through the existing
 * history route (`limit: 1`, newest-first by contract) and composes sender /
 * place / preview (`team-bridge-banner-format.ts`). That read:
 *  - goes straight through `TeamBridgeApi`, NOT the query cache, so the body
 *    is held in a local for the length of one call and then dropped;
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
	type QueryClient,
	useMutationState,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
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
	readForBridgeOwner,
	useTeamBridgeAccount,
} from "./team-bridge-owner";
import { useTeamBridgeThreadCacheFence } from "./team-bridge-thread-cache";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";
import { assertThreadPage } from "./team-bridge-thread-read";
import { teamBridgeViewingConversation } from "./team-bridge-viewing";
import {
	teamBridgeKeys,
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
 * The organization's people, for naming a sender the way the rail does.
 *
 * Through the SAME cache entry the page's People section reads, so a banner and
 * the rail never disagree about a name and an open page costs no second read.
 * A refused or failed directory is an empty list: the sender's own wire label
 * is then the name, which is still a person's name.
 */
async function directoryPeople(
	client: QueryClient,
	tenantId: string,
	accountId: string,
): Promise<readonly TeamBridgeDirectoryMember[]> {
	try {
		const directory = await client.fetchQuery({
			queryKey: teamBridgeKeys.directory(tenantId, accountId),
			queryFn: () =>
				readForBridgeOwner(client, accountId, () =>
					TeamBridgeApi.directory(tenantId),
				),
			staleTime: 30_000,
			retry: false,
		});
		return directory.members;
	} catch {
		return [];
	}
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
	let preview: string | null = null;
	/*
	 * THE THREAD READ IS OWNER-GUARDED. A reply banner addresses `listReplies` for
	 * its preview with the account this delivery was commissioned for
	 * (`selfAccountId`, checked against the live authority just below) as the
	 * REQUIRED receipt, so the runtime refuses the read if the machine signed in
	 * as someone else in between. The read writes no query cache (it is a direct
	 * call), and `stillCurrent()` is re-checked before anything it returned is
	 * shown. With the hold constant false (an older build of this file), a reply
	 * banner degrades to the timeline read, which excludes replies.
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
		const newest = threadId
			? assertThreadPage(
					await TeamBridgeApi.listReplies(candidate.conversationId, threadId, {
						expectedAccountId: selfAccountId,
						tenantId: candidate.tenantId,
						afterSeq: candidate.seq,
						limit: 1,
					}),
					{
						tenantId: candidate.tenantId,
						conversationId: candidate.conversationId,
						rootId: threadId,
					},
				).replies.find((reply) => reply.seq === candidate.seq)
			: (
					await TeamBridgeApi.listMessages(candidate.conversationId, {
						tenantId: candidate.tenantId,
						limit: 1,
					})
				).messages[0];
		if (newest && newest.seq >= candidate.seq) {
			if (
				newest.sender.kind === "human" &&
				newest.sender.account_id === selfAccountId
			) {
				return;
			}
			if (!stillCurrent()) return;
			const people = await directoryPeople(
				client,
				candidate.tenantId,
				selfAccountId,
			);
			senderLabel = participantLabel(newest.sender, people, {
				named: (agent, person) =>
					t("ui.teamBridge.chief.label", { agent, person }),
				unnamed: (person) => t("ui.teamBridge.chief.unnamed", { person }),
			});
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
			tenantId: candidate.tenantId,
			seq: candidate.seq,
			title: text.title,
			subtitle: text.subtitle,
			body: text.body,
			viewing: teamBridgeViewingConversation() === candidate.conversationId,
		})
		.catch(() => undefined);
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
	/*
	 * The thread cache's auth-transition clear lives in the SHELL (this hook is
	 * mounted once by app.tsx, whether or not the page is open), because a thread
	 * page cached under A outlives the page's unmount by the query gc window. It
	 * runs unconditionally: clearing a foreign owner's thread bodies is right even
	 * where banners are off or the preload bridge is absent.
	 */
	useTeamBridgeThreadCacheFence();
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
			const bridgeStatus = client.getQueryData(
				teamBridgeKeys.statusFor(account),
			);
			for (const candidate of plan.candidates) {
				void deliverTeamBridgeBanner(
					client,
					candidate,
					account,
					() =>
						accountRef.current === account &&
						radientAuthoritySnapshot(client) === authToken &&
						client.getQueryData(teamBridgeKeys.statusFor(account)) ===
							bridgeStatus &&
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
