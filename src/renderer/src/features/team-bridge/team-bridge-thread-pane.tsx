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
import { useRef, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { teamBridgeKeys } from "./use-team-bridge";

export type ThreadPaneProps = {
	root: TeamBridgeMessage;
	replies: readonly TeamBridgeMessage[];
	state: "loading" | "error" | "ready";
	labelFor: (sender: TeamBridgeMessage["sender"]) => string;
	onClose: () => void;
	onRetry: () => void;
	onSend: (body: string, clientRef: string) => Promise<unknown>;
	readOnly?: boolean;
	hasMore?: boolean;
	loadingMore?: boolean;
	onMore?: () => void;
};

/** A sibling surface, not a dialog: the channel stays visible beside its thread.
 * The ground step is the separator (no panel border). Its own composer retains
 * a refused draft and reuses the idempotency key when that same draft is retried.
 */
export function TeamBridgeThreadPaneView({
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
}: ThreadPaneProps) {
	useI18nLocale();
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
			aria-label={t("ui.teamBridge.replies.title")}
			className="flex h-full min-h-0 w-[min(26rem,45%)] min-w-72 shrink-0 flex-col bg-canvas pt-[var(--panel-top-pad,0px)]"
		>
			<header className="flex h-11 shrink-0 items-center justify-between px-5">
				<h2 className="font-semibold text-[15px] text-ink">
					{t("ui.teamBridge.replies.title")}
				</h2>
				<Button
					size="icon-sm"
					variant="ghost"
					onClick={onClose}
					aria-label={t("ui.teamBridge.replies.close")}
				>
					<X size={16} />
				</Button>
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<TeamBridgeMessageList messages={[root]} labelFor={labelFor} />
				<div className="px-5 py-3 text-[12px] text-ink-dim">
					{t("ui.teamBridge.replies.count", {
						count: root.reply_count ?? replies.length,
					})}
				</div>
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
					<TeamBridgeMessageList messages={replies} labelFor={labelFor} />
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
							<span className="min-w-0 flex-1 pl-1.5 text-meta-sm text-ink-dim">
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
 */
export function TeamBridgeThreadPane({
	root,
	tenantId,
	readOnly,
	labelFor,
	onClose,
}: {
	root: TeamBridgeMessage;
	tenantId: string;
	readOnly: boolean;
	labelFor: ThreadPaneProps["labelFor"];
	onClose: () => void;
}) {
	const client = useQueryClient();
	const key = [
		...teamBridgeKeys.all,
		"replies",
		tenantId,
		root.conversation_id,
		root.id,
	] as const;
	const query = useInfiniteQuery({
		queryKey: key,
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam }) =>
			TeamBridgeApi.listReplies(root.conversation_id, root.id, {
				tenantId,
				afterSeq: pageParam,
			}),
		getNextPageParam: (page) =>
			page.has_more ? page.next_after_seq : undefined,
		refetchInterval: 8_000,
	});
	const send = useMutation({
		mutationFn: ({ body, clientRef }: { body: string; clientRef: string }) =>
			TeamBridgeApi.send(root.conversation_id, {
				body,
				clientRef,
				tenantId,
				threadRootId: root.id,
			}),
		onSuccess: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: key }),
				client.invalidateQueries({
					queryKey: teamBridgeKeys.messages(root.conversation_id, tenantId),
				}),
				client.invalidateQueries({
					queryKey: teamBridgeKeys.conversationsPrefix,
				}),
			]);
		},
	});
	return (
		<TeamBridgeThreadPaneView
			root={query.data?.pages[0]?.root ?? root}
			replies={query.data?.pages.flatMap((page) => page.replies) ?? []}
			state={query.isPending ? "loading" : query.isError ? "error" : "ready"}
			labelFor={labelFor}
			onClose={onClose}
			onRetry={() => void query.refetch()}
			onSend={(body, clientRef) => send.mutateAsync({ body, clientRef })}
			readOnly={readOnly}
			hasMore={query.hasNextPage}
			loadingMore={query.isFetchingNextPage}
			onMore={() => void query.fetchNextPage()}
		/>
	);
}
