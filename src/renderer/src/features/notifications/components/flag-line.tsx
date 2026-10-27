/**
 * The in-transcript "Flagged for you" line (design.md § 17.2): one quiet line
 * where a `notify` tool call sits in the turn, and the ANCHOR whose visibility
 * the in-view reader measures (contract § 6.4).
 *
 * WHY IT REPLACES THE TOOL ROW. The call's ledger row would say "notify …" in
 * tool vocabulary; the reader needs the item: its title, whether it is still
 * unread, and a way to it. One rendering of one call (the image-gen card rule
 * in `canonical-transcript.tsx`).
 *
 * WHY NO CARD AND NO WRAP. It is trace weight (branding § 7): label in
 * `ink-muted`, title in `ink` 500, state in `ink-dim`, the unread dot in
 * `accent`. It never wraps: a wrapping line moved the message under it in the
 * designer's first capture.
 *
 * FAIL-CLOSED. Without `features.notifications`, or before the session's items
 * have loaded, the line is not drawn and the ordinary tool row is (the caller's
 * fallback), so an older core keeps today's transcript exactly.
 */
import { Tooltip } from "@shared/components/ui/tooltip";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Eye } from "lucide-react";
import {
	type FC,
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopNotificationItem } from "../../../../../shared/desktop-control-contract";
import { type InViewReader, createInViewReader } from "../in-view-read";
import {
	applyConfirmedWrite,
	postNotificationsSeen,
	tokensOf,
	useNotificationsEnabled,
	useNotificationsWrite,
	useSessionNotifications,
} from "../notifications-api";
import { PriorityBars } from "./priority-bars";

type FlagContext = {
	byAnchor: ReadonlyMap<string, DesktopNotificationItem>;
	reader: InViewReader | null;
};

const FlagLinesContext = createContext<FlagContext | null>(null);

/**
 * Provided once per transcript: this conversation's items by anchor id, and
 * the one in-view reader every line registers with. Absent provider (a story
 * of the bare transcript, an older core) means no line draws.
 */
export const FlagLinesProvider: FC<{
	sessionId: string | null;
	children: ReactNode;
}> = ({ sessionId, children }) => {
	const enabled = useNotificationsEnabled();
	const items = useSessionNotifications(sessionId, enabled);
	const { client } = useOptionalQueryClient();
	const [reader, setReader] = useState<InViewReader | null>(null);
	useEffect(() => {
		if (!enabled || !sessionId) {
			setReader(null);
			return;
		}
		// Register browser observers/listeners only after commit: creating them in
		// useMemo leaks listeners when React abandons or double-renders a tree.
		const owned = createInViewReader((batch) => {
			void postNotificationsSeen({
				items: batch.items,
				evidence: {
					sessionId,
					inputKind: batch.inputKind,
					inputAtMs: batch.inputAtMs,
					visibleSinceMs: batch.visibleSinceMs,
				},
			})
				.then((result) => {
					const changed = new Set(result.changed);
					owned.forget(batch.items.filter((item) => !changed.has(item.id)));
					applyConfirmedWrite(client, "read", [...changed]);
				})
				.catch(() => {
					// Stay unread on failure, but allow a later fresh human edge to retry.
					owned.forget(batch.items);
				});
		});
		setReader(owned);
		return () => owned.dispose();
	}, [enabled, sessionId, client]);
	const value = useMemo<FlagContext | null>(() => {
		if (!enabled || !items.data) return null;
		const byAnchor = new Map<string, DesktopNotificationItem>();
		for (const item of items.data.items) {
			if (item.anchor_id) byAnchor.set(item.anchor_id, item);
		}
		return { byAnchor, reader };
	}, [enabled, items.data, reader]);
	return (
		<FlagLinesContext.Provider value={value}>
			<div
				className="contents"
				data-notification-owner={sessionId ?? undefined}
			>
				{children}
			</div>
		</FlagLinesContext.Provider>
	);
};

/** The item a `notify` call raised, when the reel knows it; null otherwise. */
export const useFlaggedItem = (
	toolCallId: string,
): DesktopNotificationItem | null =>
	useContext(FlagLinesContext)?.byAnchor.get(toolCallId) ?? null;

export const FlagLine: FC<{ item: DesktopNotificationItem }> = ({ item }) => {
	useI18nLocale();
	const context = useContext(FlagLinesContext);
	const navigate = useNavigate();
	const write = useNotificationsWrite();
	const ref = useRef<HTMLDivElement>(null);
	const unread = !item.read;
	const anchorId = item.anchor_id ?? "";
	useEffect(() => {
		const element = ref.current;
		const owner = element?.closest<HTMLElement>("[data-notification-owner]");
		if (!element || !owner || !context?.reader || !unread || !anchorId) return;
		return context.reader.register({
			owner,
			id: item.id,
			revision: item.revision,
			anchorId,
			updatedAtMs: item.updated_at,
			unread,
			element,
		});
	}, [
		context?.reader,
		item.id,
		item.revision,
		item.updated_at,
		anchorId,
		unread,
	]);
	return (
		<div
			ref={ref}
			data-notification-flag={item.id}
			data-notification-flag-state={unread ? "unread" : "seen"}
			className="flex h-5 min-w-0 items-center gap-1.5 whitespace-nowrap text-body-sm"
		>
			<PriorityBars priority={item.priority} />
			<span className="shrink-0 text-ink-muted">
				{t("ui.notifications.flag.label")}
			</span>
			<button
				type="button"
				aria-label={`${t("ui.notifications.flag.open")}: ${item.title}`}
				onClick={() =>
					navigate(`/notifications/${encodeURIComponent(item.id)}`)
				}
				className="min-w-0 truncate font-medium text-ink hover:underline"
			>
				{item.title}
			</button>
			{unread ? (
				<span className="inline-flex shrink-0 items-center gap-1 text-ink-dim">
					<span
						aria-hidden="true"
						className="size-1.5 rounded-full bg-accent"
					/>
					{t("ui.notifications.flag.unread")}
				</span>
			) : (
				<Tooltip content={t("ui.notifications.flag.seen_hint")}>
					<button
						type="button"
						aria-label={t("ui.notifications.row.mark_unread")}
						onClick={() =>
							write.mutate({
								verb: "unread",
								target: { items: tokensOf([item]) },
							})
						}
						className="inline-flex shrink-0 items-center gap-1 text-ink-dim hover:text-ink"
					>
						<Eye size={12} aria-hidden="true" />
						{t("ui.notifications.flag.seen")}
					</button>
				</Tooltip>
			)}
		</div>
	);
};
