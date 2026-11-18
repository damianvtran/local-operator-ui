import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { TeamBridgeRouteColumn } from "@features/team-bridge/team-bridge-route-column";
/**
 * D4 - the community home: rail, channel header, timeline, composer, thread,
 * Browse and the Requests placeholder (RFC v2.4 §5.3).
 *
 * WHY ITS OWN PAGE, NOT A MODE OF THE PRIVATE BRIDGE. A community is a
 * different server, namespace and trust model (Amendment A §1): its ids are
 * community ids, its posts are moderated before anyone sees them, and its
 * drafts must never mix with a private org's. Rendering it beside the private
 * view, selected through the same org switcher, keeps every private Team Bridge
 * code path untouched - which is what "ships dark" requires - and makes the
 * switch a remount, so nothing of one scope can paint under the other's title.
 *
 * DRAFTS ARE MEMORY ONLY, per channel, for the life of this home (RFC §5.3:
 * "Switching clears the other org's composer and caches from view; drafts never
 * move between orgs"). They are deliberately NOT written to the persisted Team
 * Bridge draft store.
 *
 * SEAMS LEFT FOR LATER LANES: `CommunityRailSection` already names `dms`, and
 * Requests renders as an entry whose pane says what will arrive there (DM and
 * contact requests, agent approvals). Private-channel invites, settings and
 * staff tools have no entry point here at all.
 */
import type {
	CommunityChannel,
	CommunityMessage,
} from "@shared/api/local-operator/community-api";
import { communityFailure } from "@shared/api/local-operator/community-api";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { cn } from "@shared/lib/utils";
import { Globe, Hash, Inbox, Lock, RefreshCw, Search } from "lucide-react";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CommunityBrowseView } from "./community-browse";
import {
	CommunityComposerView,
	type CommunityDraft,
	EMPTY_DRAFT,
} from "./community-composer";
import {
	type CommunityMessageHandlers,
	CommunityMessageListView,
	CommunityThreadPane,
} from "./community-messages";
import {
	COMMUNITY_BROWSE_CHORD,
	COMMUNITY_GENERAL_CHANNEL,
	type CommunityRequestsSeam,
	type ComposerPhase,
	composerAudience,
	guidelinesNeedReaccept,
	isCommunityBrowsePress,
	isOwnMessage,
	landingChannel,
	learnSelfPublicId,
	mergeHistory,
	phaseAfterFailure,
	phaseAfterSubmission,
	postingFor,
	postingState,
	railChannels,
	readSelfPublicId,
	threadReplies,
	timelineMessages,
	writeSelfPublicId,
} from "./community-model";
import {
	useCommunityBootstrap,
	useCommunityChannels,
	useCommunityComposer,
	useCommunityEvents,
	useCommunityHistory,
	useCommunityMessageActions,
	useCommunityOwner,
} from "./use-community";

/* ================================================================ the rail */

const RailRow: FC<{
	selected: boolean;
	onSelect: () => void;
	icon: ReactNode;
	label: string;
	unread?: number;
	attr?: Record<string, string>;
}> = ({ selected, onSelect, icon, label, unread = 0, attr }) => (
	<li>
		<button
			type="button"
			aria-current={selected ? "page" : undefined}
			onClick={onSelect}
			{...attr}
			className={cn(
				"flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-[13px]",
				selected
					? "bg-elevated text-ink"
					: unread > 0
						? "font-medium text-ink hover:bg-surface"
						: "text-ink-muted hover:bg-surface",
			)}
		>
			<span aria-hidden="true" className="shrink-0 text-ink-dim">
				{icon}
			</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{unread > 0 && (
				<span className="shrink-0 text-meta-sm tabular-nums text-ink-muted">
					<span aria-hidden="true">{unread}</span>
					<span className="sr-only">
						{t("ui.community.rail.unread", { count: unread })}
					</span>
				</span>
			)}
		</button>
	</li>
);

const SectionLabel: FC<{ children: ReactNode }> = ({ children }) => (
	<p className="px-2 pt-4 pb-1 text-meta-sm text-ink-dim">{children}</p>
);

export const CommunityRailView: FC<{
	switcher: ReactNode;
	channels: readonly CommunityChannel[];
	state: "loading" | "error" | "ready";
	onRetry: () => void;
	selectedChannelId: string | null;
	requestsSelected: boolean;
	requests: CommunityRequestsSeam;
	onSelectChannel: (channelId: string) => void;
	onSelectRequests: () => void;
	onBrowse: () => void;
	browseShortcut: string;
	/** The WAI-ARIA spelling of the same chord (`aria-keyshortcuts`). */
	browseShortcutAria?: string;
}> = ({
	switcher,
	channels,
	state,
	onRetry,
	selectedChannelId,
	requestsSelected,
	requests,
	onSelectChannel,
	onSelectRequests,
	onBrowse,
	browseShortcut,
	browseShortcutAria,
}) => {
	useI18nLocale();
	const sections = railChannels(channels);
	return (
		<nav
			aria-label={t("ui.community.rail.label")}
			data-community-rail=""
			className="flex min-h-0 flex-1 flex-col"
		>
			<header className="flex h-12 shrink-0 items-center px-2">
				{switcher}
			</header>
			<div className="px-2">
				<button
					type="button"
					data-community-action="browse"
					aria-keyshortcuts={browseShortcutAria}
					onClick={onBrowse}
					className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-ink-muted hover:bg-surface"
				>
					<Search size={13} aria-hidden="true" />
					<span className="flex-1 text-start">
						{t("ui.community.rail.browse")}
					</span>
					<kbd className="rounded-sm border border-hairline px-1 font-mono text-mono-sm text-ink-dim">
						{browseShortcut}
					</kbd>
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
				<SectionLabel>{t("ui.community.rail.channels")}</SectionLabel>
				{state === "loading" ? (
					<output className="block px-2 text-meta-sm text-ink-dim">
						{t("ui.community.rail.loading")}
					</output>
				) : state === "error" ? (
					<div className="flex flex-col items-start gap-2 px-2">
						<p className="text-meta-sm text-ink-muted">
							{t("ui.community.rail.error")}
						</p>
						<Button variant="secondary" size="sm" onClick={onRetry}>
							<RefreshCw size={12} aria-hidden="true" />
							{t("ui.community.channel.retry")}
						</Button>
					</div>
				) : sections.channels.length === 0 ? (
					<p className="px-2 text-meta-sm text-ink-dim">
						{t("ui.community.rail.empty")}
					</p>
				) : (
					<ul>
						{sections.channels.map((channel) => (
							<RailRow
								key={channel.id}
								selected={!requestsSelected && channel.id === selectedChannelId}
								onSelect={() => onSelectChannel(channel.id)}
								icon={<Hash size={14} />}
								label={channel.name}
								unread={channel.unread ?? 0}
								attr={{ "data-community-channel": channel.name }}
							/>
						))}
					</ul>
				)}
				{sections.private.length > 0 && (
					<>
						<SectionLabel>{t("ui.community.rail.private")}</SectionLabel>
						<ul>
							{sections.private.map((channel) => (
								<RailRow
									key={channel.id}
									selected={
										!requestsSelected && channel.id === selectedChannelId
									}
									onSelect={() => onSelectChannel(channel.id)}
									icon={<Lock size={14} />}
									label={channel.name}
									unread={channel.unread ?? 0}
									attr={{ "data-community-channel": channel.name }}
								/>
							))}
						</ul>
					</>
				)}
				<SectionLabel>{t("ui.community.rail.requests")}</SectionLabel>
				<ul>
					<RailRow
						selected={requestsSelected}
						onSelect={onSelectRequests}
						icon={<Inbox size={14} />}
						label={t("ui.community.rail.requests")}
						unread={requests.available ? requests.count : 0}
						attr={{ "data-community-requests": "" }}
					/>
				</ul>
			</div>
		</nav>
	);
};

/* ============================================================ the header */

export const CommunityChannelHeader: FC<{
	communityName: string;
	channel: CommunityChannel | null;
}> = ({ communityName, channel }) => (
	<header
		data-community-header=""
		className="flex h-12 shrink-0 items-center gap-2 px-4"
	>
		{channel?.visibility === "private" ? (
			<Lock size={15} aria-hidden="true" className="text-ink-dim" />
		) : (
			<Hash size={15} aria-hidden="true" className="text-ink-dim" />
		)}
		<h1 className="truncate text-[15px] font-medium text-ink">
			{channel?.name ?? t("ui.community.channel.pick")}
		</h1>
		<span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 text-meta-sm text-ink-muted">
			<Globe size={11} aria-hidden="true" />
			{communityName}
		</span>
		<span className="shrink-0 rounded-sm border border-hairline px-1.5 text-meta-sm text-ink-muted">
			{t("ui.community.public")}
		</span>
		{channel?.purpose && (
			<span className="min-w-0 truncate text-meta-sm text-ink-muted">
				{channel.purpose}
			</span>
		)}
	</header>
);

/* =========================================================== the requests */

export const CommunityRequestsPane: FC = () => {
	useI18nLocale();
	return (
		<div
			data-community-pane="requests"
			className="flex flex-1 flex-col items-center justify-center px-6 text-center"
		>
			<span
				aria-hidden="true"
				className="mb-3 flex size-9 items-center justify-center rounded-md bg-elevated text-ink-muted"
			>
				<Inbox size={16} />
			</span>
			<h1 className="text-[15px] font-medium text-ink">
				{t("ui.community.requests.title")}
			</h1>
			<p className="mt-2 max-w-sm text-[13px] text-ink-muted">
				{t("ui.community.requests.placeholder")}
			</p>
		</div>
	);
};

/* ============================================================== the frame */

/** The home's layout: rail, main column, optional thread. Props-only. */
/**
 * The home's layout: rail, main column, optional thread. Props-only.
 *
 * The rail goes through `TeamBridgeRouteColumn`, exactly like the private
 * page's: in the app shell it is portaled into the left column the navigation
 * vacates (which owns width, ground, top pad and the back row), and outside the
 * shell (a story) it is the page's own 288px `surface` column. The reading
 * column paints `canvas` and wears `panel-top-pad` itself - the box that pads is
 * the box that paints (AGENTS.md "Panels run to the window edge").
 */
export const CommunityHomeView: FC<{
	rail: ReactNode;
	header: ReactNode;
	main: ReactNode;
	composer?: ReactNode;
	thread?: ReactNode;
	overlay?: ReactNode;
}> = ({ rail, header, main, composer, thread, overlay }) => (
	<div
		data-community-home=""
		data-glass-split=""
		data-glass-region="canvas"
		className="panel-flush relative flex min-h-0 w-full flex-1 overflow-hidden bg-canvas"
	>
		<TeamBridgeRouteColumn
			inline={
				<aside
					data-glass-region="page-sidebar"
					className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"
				>
					{rail}
				</aside>
			}
		>
			<aside
				data-community-rail-host=""
				className="flex min-h-0 flex-1 flex-col"
			>
				{rail}
			</aside>
		</TeamBridgeRouteColumn>
		<main
			data-glass-region="canvas-content"
			className="panel-top-pad flex min-w-0 flex-1 flex-col bg-canvas"
		>
			{header}
			<div className="flex min-h-0 flex-1 flex-col">{main}</div>
			{composer && <div className="shrink-0 px-4 pb-3">{composer}</div>}
		</main>
		{thread && (
			<div className="panel-top-pad flex shrink-0 bg-surface">{thread}</div>
		)}
		{overlay}
	</div>
);

/* ========================================================= the container */

const isMac =
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

/** One chord, both captions (glyph for the eye, ARIA for a screen reader). */
const browseChord = chordCaption(
	COMMUNITY_BROWSE_CHORD,
	isMac ? "mac" : "linux",
);

/**
 * The community home with its reads. Mounted by the Team Bridge page when a
 * community is selected in the switcher; `switcher` is that page's switcher so
 * the reader can go back to a private org from here.
 */
export const CommunityHome: FC<{
	communityId: string;
	switcher: ReactNode;
	/** Open this channel by name first (a fresh join lands on #welcome-and-rules). */
	initialChannelName?: string | null;
	/**
	 * Open the join dialog at step 1 for THIS community: a member re-accepts the
	 * current guidelines through the same join (the contract allows it), which
	 * is the only way back to posting after a guidelines update (RFC §5.2).
	 */
	onReviewGuidelines?: () => void;
}> = ({
	communityId,
	switcher,
	initialChannelName = null,
	onReviewGuidelines,
}) => {
	useI18nLocale();
	const accountId = useCommunityOwner();
	const bootstrap = useCommunityBootstrap(communityId);
	const channelsRead = useCommunityChannels(communityId);
	const { offline } = useCommunityEvents(communityId);
	const channels = channelsRead.data ?? [];
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [requestsOpen, setRequestsOpen] = useState(false);
	const [browseOpen, setBrowseOpen] = useState(false);
	const [threadRootId, setThreadRootId] = useState<string | null>(null);
	/* Memory-only drafts, per channel and per thread (see the file note). */
	const [drafts, setDrafts] = useState<Record<string, CommunityDraft>>({});
	/* Ids this app published in this session: "mine" until the hub says so. */
	const published = useRef(new Set<string>());

	// Land once: the named channel (welcome after a join), else the rule's pick.
	useEffect(() => {
		if (selectedId || channels.length === 0) return;
		const named = initialChannelName
			? channels.find((channel) => channel.name === initialChannelName)
			: null;
		setSelectedId((named ?? landingChannel(channels))?.id ?? null);
	}, [channels, selectedId, initialChannelName]);

	// ⌘⇧K / Ctrl+Shift+K opens Browse (D5). Not ⌘K: that is the app-wide
	// palette's (review round 1, M4; `COMMUNITY_BROWSE_CHORD` has the why).
	// Capture phase + preventDefault, so the keymap router, which skips a
	// claimed press, cannot also run an action a user assigned to this chord.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!isCommunityBrowsePress(event)) return;
			if (pressLandsOnOverlay(event.target)) return;
			event.preventDefault();
			setBrowseOpen(true);
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKey, { capture: true });
	}, []);

	const channel = channels.find((row) => row.id === selectedId) ?? null;
	const history = useCommunityHistory(communityId, channel?.id ?? null);
	const messages = useMemo(
		() => mergeHistory(history.data?.pages ?? []),
		[history.data],
	);
	const communityState = bootstrap.data?.community.state ?? "active";
	const guidelinesVersion = bootstrap.data?.membership?.guidelines_version;
	/*
	 * STALE GUIDELINES (review round 1, M2 / design D2). Bootstrap says so when
	 * its two versions differ; a 409 says so before a cached bootstrap does, and
	 * is remembered against the version the reader HAD accepted, so a refreshed
	 * bootstrap after re-acceptance (a new accepted version) clears it.
	 */
	const [staleAgainst, setStaleAgainst] = useState<string | null>(null);
	const guidelinesStale =
		guidelinesNeedReaccept(bootstrap.data ?? null) ||
		(staleAgainst !== null && staleAgainst === (guidelinesVersion ?? ""));
	const onGuidelinesChanged = useCallback(() => {
		setStaleAgainst(guidelinesVersion ?? "");
		void bootstrap.refetch();
	}, [guidelinesVersion, bootstrap.refetch]);
	const channelPosting = postingState(channel, communityState);
	const posting = guidelinesStale ? "guidelines_changed" : channelPosting;
	const actions = useMessageActionsFor(communityId, channel?.id ?? "");

	const draftKey = (threadRoot: string | null) =>
		`${channel?.id ?? ""}${threadRoot ? `:${threadRoot}` : ""}`;
	const draftFor = (threadRoot: string | null) =>
		drafts[draftKey(threadRoot)] ?? EMPTY_DRAFT;
	const setDraftFor = (threadRoot: string | null, draft: CommunityDraft) =>
		setDrafts((current) => ({ ...current, [draftKey(threadRoot)]: draft }));

	const onPublished = useCallback(
		(key: string) => (messageId: string | null) => {
			if (messageId) published.current.add(messageId);
			setDrafts((current) => ({ ...current, [key]: EMPTY_DRAFT }));
		},
		[],
	);
	const mainKey = draftKey(null);
	const threadKey = draftKey(threadRootId);
	const mainOnPublished = useMemo(
		() => onPublished(mainKey),
		[onPublished, mainKey],
	);
	const threadOnPublished = useMemo(
		() => onPublished(threadKey),
		[onPublished, threadKey],
	);
	const composer = useCommunityComposer({
		communityId,
		conversationId: channel?.id ?? "",
		...(guidelinesVersion ? { guidelinesVersion } : {}),
		onPublished: mainOnPublished,
		onGuidelinesChanged,
	});
	const threadComposer = useCommunityComposer({
		communityId,
		conversationId: channel?.id ?? "",
		...(threadRootId ? { threadRootId } : {}),
		...(guidelinesVersion ? { guidelinesVersion } : {}),
		onPublished: threadOnPublished,
		onGuidelinesChanged,
	});
	// Re-accepted: the D7 notice has done its job; the box is open again.
	const { dismiss: dismissMain } = composer;
	const { dismiss: dismissThread } = threadComposer;
	const mainPhase = composer.phase.kind;
	const threadPhase = threadComposer.phase.kind;
	useEffect(() => {
		if (guidelinesStale) return;
		if (mainPhase === "guidelines_changed") dismissMain();
		if (threadPhase === "guidelines_changed") dismissThread();
	}, [guidelinesStale, mainPhase, threadPhase, dismissMain, dismissThread]);

	/*
	 * Own messages after a reload (review round 1, m4): learn the reader's
	 * public id from a message this app published, remember it per account and
	 * community, and judge ownership by it (`COMMUNITY_SELF_KEY` has the why).
	 */
	const [selfPublicId, setSelfPublicId] = useState<string | null>(() =>
		typeof localStorage === "undefined"
			? null
			: readSelfPublicId(localStorage, accountId, communityId),
	);
	useEffect(() => {
		if (typeof localStorage === "undefined") return;
		setSelfPublicId(readSelfPublicId(localStorage, accountId, communityId));
	}, [accountId, communityId]);
	useEffect(() => {
		if (selfPublicId || typeof localStorage === "undefined") return;
		const learned = learnSelfPublicId(messages, published.current);
		if (!learned) return;
		writeSelfPublicId(localStorage, accountId, communityId, learned);
		setSelfPublicId(learned);
	}, [messages, selfPublicId, accountId, communityId]);

	const handlers: CommunityMessageHandlers = {
		accountId,
		isOwn: (message: CommunityMessage) =>
			message.mine === true ||
			published.current.has(message.id) ||
			isOwnMessage(message, selfPublicId),
		onReact: (messageId, emoji) => actions.react.mutate({ messageId, emoji }),
		onDelete: (messageId) => actions.remove.mutate(messageId),
		onEdit: async (messageId, text): Promise<ComposerPhase> => {
			try {
				const outcome = await actions.edit.mutateAsync({
					messageId,
					text,
					...(guidelinesVersion ? { guidelinesVersion } : {}),
				});
				// A verdict that outlived the request settles by status read.
				const settled =
					outcome.state === "checking"
						? await actions.followEdit(outcome.idempotency_key)
						: outcome;
				return phaseAfterSubmission(settled).phase;
			} catch (error) {
				const failure = communityFailure(error);
				if (failure.kind === "guidelines_changed") onGuidelinesChanged();
				return phaseAfterFailure(failure, Date.now());
			}
		},
		onOpenThread: (messageId) => setThreadRootId(messageId),
		readOnly: posting !== "open",
	};

	const paneState = history.isError
		? "error"
		: history.isPending
			? "loading"
			: "ready";
	const channelsState = channelsRead.isError
		? "error"
		: channelsRead.isPending
			? "loading"
			: "ready";
	const communityName = bootstrap.data?.community.name ?? "";
	const generalId =
		channels.find((row) => row.name === COMMUNITY_GENERAL_CHANNEL)?.id ?? null;
	const threadRoot = threadRootId
		? (messages.find((message) => message.id === threadRootId) ?? null)
		: null;

	const composerFor = (threadRoot: string | null) => {
		const state = threadRoot ? threadComposer : composer;
		const draft = draftFor(threadRoot);
		return (
			<CommunityComposerView
				channelName={channel?.name ?? ""}
				posting={postingFor(channelPosting, guidelinesStale, state.phase)}
				onReviewGuidelines={onReviewGuidelines}
				audience={composerAudience(channel)}
				phase={state.phase}
				draft={draft}
				offline={offline}
				variant={threadRoot ? "thread" : "channel"}
				allowImages={!threadRoot}
				onDraftChange={(next) => setDraftFor(threadRoot, next)}
				onSend={() =>
					void state.send(
						draft.text,
						draft.images.map(({ content_type, data_base64 }) => ({
							content_type,
							data_base64,
						})),
					)
				}
				onCancel={() => void state.cancel()}
				onRetry={() =>
					void state.send(
						draft.text,
						draft.images.map(({ content_type, data_base64 }) => ({
							content_type,
							data_base64,
						})),
					)
				}
				onDismiss={state.dismiss}
				onGoGeneral={
					generalId
						? () => {
								setRequestsOpen(false);
								setThreadRootId(null);
								setSelectedId(generalId);
							}
						: undefined
				}
			/>
		);
	};

	const selectChannel = (channelId: string) => {
		setRequestsOpen(false);
		setThreadRootId(null);
		setSelectedId(channelId);
	};

	return (
		<CommunityHomeView
			rail={
				<CommunityRailView
					switcher={switcher}
					channels={channels}
					state={channelsState}
					onRetry={() => void channelsRead.refetch()}
					selectedChannelId={selectedId}
					requestsSelected={requestsOpen}
					requests={{ available: false }}
					onSelectChannel={selectChannel}
					onSelectRequests={() => {
						setThreadRootId(null);
						setRequestsOpen(true);
					}}
					onBrowse={() => setBrowseOpen(true)}
					browseShortcut={browseChord.glyph}
					browseShortcutAria={browseChord.aria}
				/>
			}
			header={
				requestsOpen ? null : (
					<CommunityChannelHeader
						communityName={communityName}
						channel={channel}
					/>
				)
			}
			main={
				requestsOpen ? (
					<CommunityRequestsPane />
				) : channel ? (
					<CommunityMessageListView
						channelName={channel.name}
						channelPurpose={channel.purpose}
						state={paneState}
						offline={offline}
						messages={timelineMessages(messages)}
						hasOlder={history.hasNextPage}
						loadingOlder={history.isFetchingNextPage}
						onLoadOlder={() => void history.fetchNextPage()}
						onRetry={() => void history.refetch()}
						{...handlers}
					/>
				) : channelsState === "ready" ? null : (
					<CommunityMessageListView
						channelName=""
						state={channelsState === "error" ? "error" : "loading"}
						offline={offline}
						messages={[]}
						hasOlder={false}
						loadingOlder={false}
						onLoadOlder={() => {}}
						onRetry={() => void channelsRead.refetch()}
						{...handlers}
					/>
				)
			}
			composer={!requestsOpen && channel ? composerFor(null) : undefined}
			thread={
				!requestsOpen && threadRoot ? (
					<CommunityThreadPane
						root={threadRoot}
						replies={threadReplies(messages, threadRoot.id)}
						onClose={() => setThreadRootId(null)}
						composer={composerFor(threadRoot.id)}
						{...handlers}
					/>
				) : undefined
			}
			overlay={
				<CommunityBrowseView
					open={browseOpen}
					onClose={() => setBrowseOpen(false)}
					communityName={communityName}
					channels={channels}
					state={channelsState}
					onRetry={() => void channelsRead.refetch()}
					onOpenChannel={(channelId) => {
						setBrowseOpen(false);
						selectChannel(channelId);
					}}
				/>
			}
		/>
	);
};

/** One stable actions object per conversation (hooks cannot be conditional). */
function useMessageActionsFor(communityId: string, conversationId: string) {
	return useCommunityMessageActions(communityId, conversationId);
}
