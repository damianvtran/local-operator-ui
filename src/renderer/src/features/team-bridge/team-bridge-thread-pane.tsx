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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { manageThreadFocus } from "./team-bridge-thread-focus";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";
import {
	type ThreadTarget,
	loadThreadPage,
	observeDisplayedThreadReplies,
} from "./team-bridge-thread-read";
import { teamBridgeKeys, useMarkTeamBridgeRead } from "./use-team-bridge";

export type ThreadPaneProps = {
	root: TeamBridgeMessage | null;
	replies: readonly TeamBridgeMessage[];
	state: "loading" | "error" | "ready";
	/* Null = nobody names this sender (directory loading/failed, a member who
	   left, the legacy "Member" label); the list renders it as unknown. */
	labelFor: (sender: TeamBridgeMessage["sender"]) => string | null;
	onClose: () => void;
	onRetry: () => void;
	onSend: (body: string, clientRef: string) => Promise<unknown>;
	readOnly?: boolean;
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
}: ThreadPaneProps) {
	useI18nLocale();
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
	const pending = useRef<{ body: string; clientRef: string } | null>(null);
	const lock = useRef(false);
	const submit = async () => {
		const body = draft.trim();
		if (!body || lock.current || readOnly || state !== "ready") return;
		const entry =
			pending.current?.body === body
				? pending.current
				: { body, clientRef: crypto.randomUUID() };
		pending.current = entry;
		lock.current = true;
		setSending(true);
		setFailed(false);
		try {
			await onSend(body, entry.clientRef);
			pending.current = null;
			setDraft((current) => (current.trim() === body ? "" : current));
		} catch {
			setFailed(true);
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
			<ScrollArea className="min-h-0 flex-1">
				{root && (
					<TeamBridgeMessageList
						messages={[root]}
						labelFor={labelFor}
						reactionContext={reactionContext}
						forceToolbar={forceToolbar}
					/>
				)}
				{/* Pending/error pages cannot assert an empty count from an empty array. */}
				{(state === "ready" || root?.reply_count !== undefined) && (
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
					<p className="px-5 py-6 text-[13px] text-ink-muted">
						{t("ui.teamBridge.replies.empty")}
					</p>
				) : (
					<TeamBridgeMessageList
						messages={replies}
						labelFor={labelFor}
						reactionContext={reactionContext}
						forceToolbar={forceToolbar}
					/>
				)}
				{hasMore && (
					<Button
						variant="ghost"
						size="sm"
						disabled={loadingMore}
						onClick={onMore}
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
					<div className="rounded-xl bg-elevated has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid">
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
							<Button
								size="icon-sm"
								variant="primary"
								className="rounded-lg"
								disabled={!draft.trim() || sending || state !== "ready"}
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
	onClose: () => void;
	reactionContext?: ThreadPaneProps["reactionContext"];
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
	onClose,
	reactionContext,
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
		queryFn: ({ pageParam }) => loadThreadPage(target, pageParam),
		getNextPageParam: (page) =>
			page.has_more ? page.next_after_seq : undefined,
		refetchInterval: 8_000,
	});
	const replies = useMemo(
		() => query.data?.pages.flatMap((page) => page.replies) ?? [],
		[query.data],
	);
	const send = useMutation({
		mutationFn: ({ body, clientRef }: { body: string; clientRef: string }) =>
			TeamBridgeApi.send(conversationId, {
				body,
				clientRef,
				tenantId,
				threadRootId: rootId,
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
			onClose={onClose}
			onRead={acknowledge}
			onRetry={() => void query.refetch()}
			onSend={(body, clientRef) => send.mutateAsync({ body, clientRef })}
			readOnly={readOnly}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			onMore={() => void query.fetchNextPage()}
			reactionContext={reactionContext}
		/>
	);
}
