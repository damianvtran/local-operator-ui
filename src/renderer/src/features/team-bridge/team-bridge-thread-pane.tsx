import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { ScrollArea } from "@shared/components/ui/scroll-area";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { ArrowUp, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	TeamBridgeAttachmentCapability,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { teamBridgeArrivalStreamKey } from "./team-bridge-arrival-model";
import {
	TeamBridgeAttachButton,
	TeamBridgeAttachmentStrip,
	attachmentPasteHandlers,
} from "./team-bridge-attachments";
import { isAttachmentNotFound } from "./team-bridge-attachments-model";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { manageThreadFocus } from "./team-bridge-thread-focus";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";
import {
	type ThreadTarget,
	loadThreadPage,
	observeDisplayedThreadReplies,
} from "./team-bridge-thread-read";
import { useStickToBottom } from "./use-stick-to-bottom";
import { teamBridgeKeys, useMarkTeamBridgeRead } from "./use-team-bridge";
import { useTeamBridgeAttachments } from "./use-team-bridge-attachments";

export type ThreadPaneProps = {
	root: TeamBridgeMessage | null;
	replies: readonly TeamBridgeMessage[];
	state: "loading" | "error" | "ready";
	/* Null = nobody names this sender (directory loading/failed, a member who
	   left, the legacy "Member" label); the list renders it as unknown. */
	labelFor: (sender: TeamBridgeMessage["sender"]) => string | null;
	profileFor?: React.ComponentProps<typeof TeamBridgeMessageList>["profileFor"];
	canMessagePerson?: React.ComponentProps<
		typeof TeamBridgeMessageList
	>["canMessagePerson"];
	onMessagePerson?: React.ComponentProps<
		typeof TeamBridgeMessageList
	>["onMessagePerson"];
	onClose: () => void;
	onRetry: () => void;
	onSend: (
		body: string,
		clientRef: string,
		attachmentIds?: readonly string[],
	) => Promise<unknown>;
	readOnly?: boolean;
	/*
	 * Images in a reply: the SAME staging hook and chips as the channel
	 * composer (one lifecycle, not two). The thread always has a conversation,
	 * so uploads go straight to it; the reply draft is in-memory like its text.
	 */
	tenantId?: string;
	conversationId?: string;
	accountId?: string;
	attachmentCapability?: TeamBridgeAttachmentCapability | null;
	hasMore?: boolean;
	loadingMore?: boolean;
	onMore?: () => void;
	onRead?: (seq: number) => Promise<unknown>;
	/*
	 * Lets the pane's rows carry the message toolbar's react and more. There is
	 * deliberately no `onReply`: threads are one level deep, so a reply (and
	 * the root, which this pane already is the thread of) never offers
	 * reply-in-thread.
	 */
	reactionContext?: { accountId: string; tenantId: string; disabled?: boolean };
	/** Story/capture seed only: show the rows' toolbars without hover. */
	forceToolbar?: boolean;
};

/**
 * May the forward-pagination hold lift?
 *
 * A forward page is history the reader asked for, so the replies list must not
 * animate it - but the hold may only last as long as the read does. It lifts as
 * soon as the read's own in-flight state has come back (`sawInFlight`), or when
 * the page arrived without one (`grew`), which is what a cached or instantly
 * resolved page looks like. What it must NOT do is wait for a page that never
 * comes: a failed or empty read clears it exactly like a full one.
 */
export function pagingSettled({
	loadingMore,
	sawInFlight,
	grew,
}: {
	loadingMore: boolean;
	sawInFlight: boolean;
	grew: boolean;
}): boolean {
	if (loadingMore) return false;
	return sawInFlight || grew;
}

/**
 * THE HOLD, AT THE VIEW'S FRONT DOOR (a hook-safe wrapper: no hook runs on the
 * closed path, so no story or rig can mount the unsafe body by importing this
 * component directly). The full rationale is in `team-bridge-thread-gate.ts`.
 */
export function TeamBridgeThreadPaneView(props: ThreadPaneProps) {
	if (!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeThreadPaneBody {...props} />;
}

/** A sibling surface, not a dialog: the channel stays visible beside its thread.
 * The ground step is the separator (no panel border). Its own composer retains
 * a refused draft and reuses the idempotency key when that same draft is retried.
 */
function TeamBridgeThreadPaneBody({
	root,
	replies,
	state,
	labelFor,
	profileFor,
	canMessagePerson,
	onMessagePerson,
	onClose,
	onRetry,
	onSend,
	readOnly = false,
	hasMore = false,
	loadingMore = false,
	onMore,
	onRead,
	reactionContext,
	forceToolbar,
	tenantId,
	conversationId,
	accountId,
	attachmentCapability = null,
}: ThreadPaneProps) {
	useI18nLocale();
	/*
	 * A FORWARD PAGE IS RESTORED HISTORY, NOT LIVE TRAFFIC, and the hold that
	 * says so must release on EVERY outcome (review round 1, M2). It used to
	 * clear only when `replies.length` changed, so a failed or empty next page
	 * left it stuck on and every later live reply in that thread stayed still -
	 * silently. The rule is `pagingSettled`, which releases when the read's own
	 * in-flight state has come back, or when the page arrived without one; it is
	 * safe to lift because the list OBSERVES a page even while it may not animate
	 * it, so those ids are already known by then and cannot animate after all.
	 */
	const [paging, setPaging] = useState(false);
	const sawInFlight = useRef(false);
	const pageStart = useRef(replies.length);
	if (loadingMore) sawInFlight.current = true;
	useLayoutEffect(() => {
		if (!paging) return;
		if (
			!pagingSettled({
				loadingMore,
				sawInFlight: sawInFlight.current,
				grew: replies.length !== pageStart.current,
			})
		)
			return;
		sawInFlight.current = false;
		setPaging(false);
	}, [paging, loadingMore, replies.length]);
	// Backstop: a request whose read never reports at all must not hold forever.
	useEffect(() => {
		if (!paging) return;
		const timer = setTimeout(() => setPaging(false), 10_000);
		return () => clearTimeout(timer);
	}, [paging]);
	const pane = useRef<HTMLElement>(null);
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		if (pane.current)
			return manageThreadFocus(pane.current, () => close.current());
	}, []);
	useEffect(() => {
		if (!pane.current || state !== "ready" || !onRead) return;
		return observeDisplayedThreadReplies(pane.current, replies, onRead);
	}, [replies, state, onRead]);
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [imagesBlocked, setImagesBlocked] = useState(false);
	const images = useTeamBridgeAttachments({
		scopeKey: `${tenantId ?? ""}|${conversationId ?? ""}|${root?.id ?? ""}`,
		accountId,
		tenantId,
		conversationId: conversationId ?? null,
		capability: conversationId && tenantId ? attachmentCapability : null,
	});
	const pending = useRef<{
		body: string;
		images: string;
		clientRef: string;
	} | null>(null);
	const lock = useRef(false);
	// Same stick-to-bottom as the channel timeline (F9): opens at the newest
	// reply and follows new ones only while the reader is at the bottom.
	const scroll = useStickToBottom({
		resetKey: `${tenantId ?? ""}:${conversationId ?? ""}:${root?.id ?? ""}:${state}`,
		contentKey: `${replies.length}:${replies.at(-1)?.id ?? ""}`,
	});
	const hasContent = Boolean(draft.trim()) || images.count > 0;
	/* CAN THIS PANE ACTUALLY SEND? An empty state must not INVITE a reply that has
	 * nowhere to go (design round 1, D3). Only `readOnly` can answer no here: the
	 * render below dispatches `loading` and `error` before it ever reaches the
	 * empty branch, so `state` is already `ready` at this use site, and carrying
	 * it as a term would advertise a case the branch order owns (code round 2,
	 * F2). With no invitation to make, the empty state renders nothing: the
	 * read-only note in the composer slot is the sentence that explains the pane,
	 * and minting a second "No replies yet." variant would owe a translation
	 * round in seven locales to say what that note already says. */
	const canStartThread = !readOnly;
	const submit = async () => {
		const body = draft.trim();
		if (images.blocked) {
			setImagesBlocked(true);
			return;
		}
		if (
			!hasContent ||
			images.busy ||
			lock.current ||
			readOnly ||
			state !== "ready"
		)
			return;
		const ids = images.readyIds();
		// The idempotency key is reused only for the SAME text AND image set: the
		// hub's replay check compares both hashes, so a changed set needs a new key.
		const signature = ids.join(",");
		const entry =
			pending.current?.body === body && pending.current.images === signature
				? pending.current
				: { body, images: signature, clientRef: crypto.randomUUID() };
		pending.current = entry;
		lock.current = true;
		setSending(true);
		setFailed(false);
		setImagesBlocked(false);
		scroll.pin();
		try {
			await onSend(body, entry.clientRef, ids);
			pending.current = null;
			images.clearSent(ids);
			setDraft((current) => (current.trim() === body ? "" : current));
		} catch (error) {
			setFailed(true);
			if (ids.length > 0 && isAttachmentNotFound(error)) images.markExpired();
		} finally {
			lock.current = false;
			setSending(false);
		}
	};
	return (
		<aside
			ref={pane}
			aria-label={t("ui.teamBridge.replies.title")}
			className="panel-top-pad flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col bg-canvas"
		>
			<header className="flex h-11 shrink-0 items-center justify-between px-5">
				<h2 className="font-semibold text-[15px] text-ink">
					{t("ui.teamBridge.replies.title")}
				</h2>
				<Button
					data-thread-close
					size="icon-sm"
					variant="ghost"
					onClick={onClose}
					aria-label={t("ui.teamBridge.replies.close")}
				>
					<X size={16} />
				</Button>
			</header>
			{/* Radix wraps the content in `display: table; min-width: 100%`, which
			    grows to the widest row's min-content: one wide table or code line
			    and every reply's hover ground and toolbar would run past the pane.
			    A block wrapper is the viewport's width, as the page timeline's is. */}
			<ScrollArea
				ref={scroll.rootRef}
				className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:block!"
			>
				{root && (
					<TeamBridgeMessageList
						messages={[root]}
						/* ITS OWN STREAM (review round 1, A2). Without a key this list
						   defaulted to the TIMELINE's, and because the pane is keyed per
						   root, closing a thread unmounted the list and suspended the
						   open timeline's journal - the next live timeline message then
						   never animated. The root is a single row and never animates. */
						arrivalKey={`${teamBridgeArrivalStreamKey(tenantId, root.conversation_id)}/root`}
						arrivalsEnabled={false}
						labelFor={labelFor}
						profileFor={profileFor}
						canMessagePerson={canMessagePerson}
						onMessagePerson={onMessagePerson}
						tenantId={tenantId}
						accountId={accountId}
						density="compact"
						reactionContext={reactionContext}
						forceToolbar={forceToolbar}
					/>
				)}
				{/* Pending/error pages cannot assert an empty count from an empty array.
				    A ZERO IS NOT A COUNT: printing "0 replies" directly above "No
				    replies yet" states one fact twice (design round 1, D2), so the
				    line appears only when there is something to count. */}
				{(state === "ready" || root?.reply_count !== undefined) &&
					(root?.reply_count ?? replies.length) > 0 && (
						<div className="px-5 py-3 text-[12px] text-ink-dim">
							{t("ui.teamBridge.replies.count", {
								count: root?.reply_count ?? replies.length,
							})}
						</div>
					)}
				{state === "loading" ? (
					<div className="flex justify-center py-8">
						<Spinner size="sm" label={t("ui.teamBridge.thread.loading")} />
					</div>
				) : state === "error" ? (
					<div role="alert" className="px-5 py-6 text-[13px] text-ink-muted">
						<p>{t("ui.teamBridge.thread.error")}</p>
						<Button variant="ghost" size="sm" onClick={onRetry}>
							{t("ui.teamBridge.list.retry")}
						</Button>
					</div>
				) : replies.length === 0 ? (
					canStartThread ? (
						<p className="px-5 py-6 text-[13px] text-ink-muted">
							{t("ui.teamBridge.replies.empty")}
						</p>
					) : null
				) : (
					<TeamBridgeMessageList
						messages={replies}
						arrivalKey={teamBridgeArrivalStreamKey(
							tenantId,
							conversationId,
							root?.id,
						)}
						arrivalsEnabled={!paging}
						accountId={accountId}
						labelFor={labelFor}
						profileFor={profileFor}
						canMessagePerson={canMessagePerson}
						onMessagePerson={onMessagePerson}
						tenantId={tenantId}
						density="compact"
						reactionContext={reactionContext}
						forceToolbar={forceToolbar}
					/>
				)}
				{hasMore && (
					<Button
						variant="ghost"
						size="sm"
						disabled={loadingMore}
						onClick={() => {
							// Read the loaded page from here, not from its end (r8 m2).
							setPaging(true);
							pageStart.current = replies.length;
							scroll.hold();
							onMore?.();
						}}
						className="mx-5 my-2"
					>
						{t("ui.teamBridge.replies.more")}
					</Button>
				)}
			</ScrollArea>
			{readOnly ? (
				<p className="px-5 pb-4 text-[12px] text-ink-dim">
					{t("ui.teamBridge.read_only.composer")}
				</p>
			) : (
				<div className="shrink-0 px-4 pb-4">
					{failed && (
						<p role="alert" className="pb-1 text-[12px] text-danger">
							{t("ui.teamBridge.composer.error")}
						</p>
					)}
					{/* A hub that cannot take images is already explained by the strip's
					   unsupported note; this alert is only for error-marked chips (R2-02). */}
					{imagesBlocked && images.blocked && !images.unsupported && (
						<p role="alert" className="pb-1 text-[12px] text-danger">
							{t("ui.teamBridge.attachments.send_blocked")}
						</p>
					)}
					<div
						className="rounded-xl bg-elevated has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid"
						{...(state === "ready" ? attachmentPasteHandlers(images) : {})}
					>
						<TeamBridgeAttachmentStrip state={images} />
						<textarea
							rows={2}
							aria-label={t("ui.teamBridge.replies.placeholder")}
							placeholder={t("ui.teamBridge.replies.placeholder")}
							value={draft}
							disabled={state !== "ready"}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									!e.shiftKey &&
									!e.nativeEvent.isComposing
								) {
									e.preventDefault();
									void submit();
								}
							}}
							className="block max-h-40 min-h-10 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] text-ink outline-none placeholder:text-ink-dim"
						/>
						<div className="flex items-center gap-2 px-2 pb-2">
							<span className="min-w-0 flex-1 ps-1.5 text-meta-sm text-ink-dim">
								{t("ui.teamBridge.composer.hint")}
							</span>
							<TeamBridgeAttachButton
								state={images}
								disabled={sending || state !== "ready"}
							/>
							<Button
								size="icon-sm"
								variant="primary"
								className="rounded-lg"
								disabled={
									!hasContent || images.busy || sending || state !== "ready"
								}
								aria-label={t("ui.teamBridge.composer.send")}
								onClick={() => void submit()}
							>
								{sending ? <Spinner size="sm" /> : <ArrowUp size={16} />}
							</Button>
						</div>
					</div>
				</div>
			)}
		</aside>
	);
}

/** Query identity includes tenant, conversation AND root; a scope change cannot
 * reuse another thread's body. Infinite pages keep long threads readable; send
 * invalidates both the pane and timeline rollup, never inserts replies there.
 *
 * THE HOLD IS CHECKED BEFORE ANY HOOK MOUNTS. The exported name is a wrapper
 * that renders nothing while the thread surface is held; the mount below is the
 * only place its hooks run. An early return inside the body after its queries
 * would make the hook count conditional, which is why the guard is a separate
 * component rather than a first line.
 */
export type ThreadPaneMountProps = {
	target: ThreadTarget;
	initialRoot?: TeamBridgeMessage;
	readOnly: boolean;
	labelFor: ThreadPaneProps["labelFor"];
	profileFor?: ThreadPaneProps["profileFor"];
	canMessagePerson?: ThreadPaneProps["canMessagePerson"];
	onMessagePerson?: ThreadPaneProps["onMessagePerson"];
	onClose: () => void;
	reactionContext?: ThreadPaneProps["reactionContext"];
	/* The account captured with this pane binds both its reads and its replies
	   to the same signed-in owner. A missing owner cannot dispatch either. */
	accountId: string;
	attachmentCapability?: TeamBridgeAttachmentCapability | null;
};

export function TeamBridgeThreadPane(props: ThreadPaneMountProps) {
	if (!TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeThreadPaneMount {...props} />;
}

function TeamBridgeThreadPaneMount({
	target,
	initialRoot,
	readOnly,
	labelFor,
	profileFor,
	canMessagePerson,
	onMessagePerson,
	onClose,
	reactionContext,
	accountId,
	attachmentCapability,
}: ThreadPaneMountProps) {
	const client = useQueryClient();
	const { tenantId, conversationId, rootId } = target;
	const read = useMarkTeamBridgeRead(conversationId, tenantId);
	// Observer recreation (paging/refetch) must not turn a successful read into a
	// second mutation loop. This ref belongs to the keyed tenant/conversation/root.
	const acknowledged = useRef(-1);
	const acknowledge = useCallback(
		async (seq: number) => {
			if (seq <= acknowledged.current) return;
			acknowledged.current = seq;
			try {
				await read.mutateAsync({ seq });
			} catch (error) {
				if (acknowledged.current === seq) acknowledged.current = -1;
				throw error;
			}
		},
		[read.mutateAsync],
	);
	const key = [
		...teamBridgeKeys.all,
		"replies",
		tenantId,
		conversationId,
		rootId,
	] as const;
	const query = useInfiniteQuery({
		queryKey: key,
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam }) => loadThreadPage(target, accountId, pageParam),
		getNextPageParam: (page) =>
			page.has_more ? page.next_after_seq : undefined,
		refetchInterval: 8_000,
	});
	const replies = useMemo(
		() => query.data?.pages.flatMap((page) => page.replies) ?? [],
		[query.data],
	);
	const send = useMutation({
		mutationFn: ({
			body,
			clientRef,
			attachmentIds,
		}: {
			body: string;
			clientRef: string;
			attachmentIds?: readonly string[];
		}) =>
			TeamBridgeApi.send(conversationId, {
				body,
				clientRef,
				tenantId,
				expectedAccountId: accountId,
				threadRootId: rootId,
				attachmentIds,
			}),
		onSuccess: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: key }),
				client.invalidateQueries({
					queryKey: teamBridgeKeys.messages(conversationId, tenantId),
				}),
				client.invalidateQueries({
					queryKey: teamBridgeKeys.conversationsPrefix,
				}),
			]);
		},
	});
	return (
		<TeamBridgeThreadPaneView
			root={query.data?.pages[0]?.root ?? initialRoot ?? null}
			replies={replies}
			state={query.isPending ? "loading" : query.isError ? "error" : "ready"}
			labelFor={labelFor}
			profileFor={profileFor}
			canMessagePerson={canMessagePerson}
			onMessagePerson={onMessagePerson}
			onClose={onClose}
			onRead={acknowledge}
			onRetry={() => void query.refetch()}
			onSend={(body, clientRef, attachmentIds) =>
				send.mutateAsync({ body, clientRef, attachmentIds })
			}
			tenantId={tenantId}
			conversationId={conversationId}
			accountId={accountId}
			attachmentCapability={attachmentCapability}
			readOnly={readOnly}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			onMore={() => void query.fetchNextPage()}
			reactionContext={reactionContext}
		/>
	);
}
