/**
 * The asks drawer's Updates tab and its tab strip (decisions D9, design.md
 * § 18, contract § 6.5).
 *
 * RECONCILE, DON'T ADD. The rail keeps one ask door; its panel gains three
 * tabs, Asks | Updates | All conversations, so "what does this conversation
 * need from me?" stays one question behind one door. All conversations is the
 * existing fleet scope moved into the strip, so scope and kind are one control.
 *
 * THE DRAWER'S LIST IS NOT AN ANCHOR. It overlays part of the transcript, so
 * a flag line under it is covered (design § 17.3), and a row here becomes
 * read only by an explicit action.
 *
 * GATED: without `features.notifications` the strip is absent and the drawer
 * renders exactly as before (contract § 6.5).
 */
import { Badge, Button } from "@shared/components/ui";
import { Tooltip } from "@shared/components/ui/tooltip";
import { formatNumber, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ChevronsUp, ExternalLink } from "lucide-react";
import { type FC, type KeyboardEvent, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopNotificationItem } from "../../../../../shared/desktop-control-contract";
import {
	tokensOf,
	useNotificationsWrite,
	useSessionNotifications,
} from "../notifications-api";
import { seenMarkOf } from "../notifications-model";
import { rowTimeOf } from "../notifications-model";
import { rowTimeText } from "./notification-row";
import { PriorityBars } from "./priority-bars";

export type DrawerTab = "asks" | "updates" | "all";

/**
 * The default tab (design § 18): Asks if a live ask exists, else Updates.
 * In fleet scope the strip opens on All conversations.
 */
export const defaultDrawerTab = (
	scope: "session" | "fleet",
	liveAsks: number,
): DrawerTab => (scope === "fleet" ? "all" : liveAsks > 0 ? "asks" : "updates");

export const DrawerTabs: FC<{
	tab: DrawerTab;
	onTab: (tab: DrawerTab) => void;
	asks: number;
	unreadUpdates: number;
	/** No conversation is open: only All conversations applies. */
	sessionless: boolean;
}> = ({ tab, onTab, asks, unreadUpdates, sessionless }) => {
	useI18nLocale();
	const tabs: { id: DrawerTab; label: string; count: number }[] = [
		{ id: "asks", label: t("ui.notifications.drawer.tab.asks"), count: asks },
		{
			id: "updates",
			label: t("ui.notifications.drawer.tab.updates"),
			count: unreadUpdates,
		},
		{ id: "all", label: t("ui.notifications.drawer.tab.all"), count: 0 },
	];
	const shown = sessionless ? tabs.filter((entry) => entry.id === "all") : tabs;
	/* Ctrl+Tab / Ctrl+Shift+Tab and the arrows cycle (design § 18). */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === "ArrowRight" ||
			(event.key === "Tab" && event.ctrlKey && !event.shiftKey)
				? 1
				: event.key === "ArrowLeft" ||
						(event.key === "Tab" && event.ctrlKey && event.shiftKey)
					? -1
					: 0;
		if (step === 0) return;
		event.preventDefault();
		const index = shown.findIndex((entry) => entry.id === tab);
		const next = shown[(index + step + shown.length) % shown.length];
		onTab(next.id);
		(
			event.currentTarget.querySelector(
				`[data-drawer-tab="${next.id}"]`,
			) as HTMLElement | null
		)?.focus();
	};
	return (
		<div
			role="tablist"
			aria-label={t("ui.notifications.drawer.tabs_label")}
			onKeyDown={onKeyDown}
			className="flex h-9 shrink-0 items-end gap-1 border-hairline border-b px-2"
		>
			{shown.map((entry) => (
				<button
					key={entry.id}
					type="button"
					role="tab"
					aria-selected={tab === entry.id}
					tabIndex={tab === entry.id ? 0 : -1}
					data-drawer-tab={entry.id}
					onClick={() => onTab(entry.id)}
					className={cn(
						"-mb-px flex h-8 items-center gap-1.5 border-b-2 px-2 text-body-sm",
						tab === entry.id
							? "border-accent text-ink"
							: "border-transparent text-ink-muted hover:text-ink",
					)}
				>
					{entry.label}
					{entry.count > 0 && (
						<Badge variant="neutral" size="count">
							{entry.id === "updates"
								? t("ui.notifications.drawer.unread_count", {
										count: formatNumber(entry.count),
									})
								: formatNumber(entry.count)}
						</Badge>
					)}
				</button>
			))}
		</div>
	);
};

/** This conversation's unread update count, for the tab and the rail door. */
export function useSessionUnreadUpdates(
	sessionId: string | null,
	enabled: boolean,
): number {
	const list = useSessionNotifications(sessionId, enabled);
	return useMemo(
		() =>
			(list.data?.items ?? []).filter((item) => !item.read && !item.dismissed)
				.length,
		[list.data],
	);
}

export const DrawerUpdates: FC<{
	sessionId: string;
	nowMs?: number;
}> = ({ sessionId, nowMs: pinnedNow }) => {
	useI18nLocale();
	const navigate = useNavigate();
	const list = useSessionNotifications(sessionId, true);
	const write = useNotificationsWrite();
	const nowMs = pinnedNow ?? Date.now();
	const rows = useMemo(
		() =>
			(list.data?.items ?? [])
				.filter((item) => !item.dismissed)
				.sort((a, b) => b.updated_at - a.updated_at),
		[list.data],
	);
	const unread = rows.filter((item) => !item.read);
	const read = rows.filter((item) => item.read);
	const showInConversation = (item: DesktopNotificationItem) => {
		const line = document.querySelector<HTMLElement>(
			`[data-notification-flag="${CSS.escape(item.id)}"]`,
		);
		line?.scrollIntoView({ block: "center", behavior: "smooth" });
		line?.animate?.(
			[
				{ backgroundColor: "var(--color-accent-wash)" },
				{ backgroundColor: "transparent" },
			],
			{ duration: 900, easing: "ease-out" },
		);
	};
	if (list.isLoading) return null;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-2">
				{rows.length === 0 ? (
					<p className="px-3 py-8 text-center text-body-sm text-ink-muted">
						{t("ui.notifications.drawer.empty")}
					</p>
				) : (
					<>
						{unread.length > 0 && (
							<DrawerGroup
								title={t("ui.notifications.drawer.group.unread")}
								action={
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											write.mutate({
												verb: "read",
												target: { items: tokensOf(unread) },
											})
										}
									>
										{t("ui.notifications.drawer.mark_read")}
									</Button>
								}
							>
								{unread.map((item) => (
									<DrawerRow
										key={item.id}
										item={item}
										nowMs={nowMs}
										onShow={showInConversation}
									/>
								))}
							</DrawerGroup>
						)}
						{read.length > 0 && (
							<DrawerGroup title={t("ui.notifications.drawer.group.read")}>
								{read.map((item) => (
									<DrawerRow
										key={item.id}
										item={item}
										nowMs={nowMs}
										onShow={showInConversation}
									/>
								))}
							</DrawerGroup>
						)}
					</>
				)}
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-hairline border-t px-3 py-2 text-meta">
				<span className="truncate text-ink-dim">
					{t("ui.notifications.drawer.footer")}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						navigate(`/notifications?from=${encodeURIComponent(sessionId)}`)
					}
				>
					{t("ui.notifications.drawer.open_notifications")}
					<ExternalLink aria-hidden="true" className="rtl:-scale-x-100" />
				</Button>
			</div>
		</div>
	);
};

const DrawerGroup: FC<{
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}> = ({ title, action, children }) => (
	<section className="flex flex-col">
		<div className="flex h-8 items-center justify-between px-2 text-ink-muted text-meta">
			<h3>{title}</h3>
			{action}
		</div>
		<ul className="flex flex-col">{children}</ul>
	</section>
);

const DrawerRow: FC<{
	item: DesktopNotificationItem;
	nowMs: number;
	onShow: (item: DesktopNotificationItem) => void;
}> = ({ item, nowMs, onShow }) => {
	const seen = seenMarkOf(item);
	return (
		<li
			className="flex h-12 items-center gap-2 rounded-sm px-2 hover:bg-row-hover"
			data-drawer-update={item.id}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 shrink-0 rounded-full bg-accent",
					item.read && "invisible",
				)}
			/>
			<PriorityBars priority={item.priority} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span
					className={cn(
						"truncate text-body-sm",
						item.read ? "text-ink-muted" : "font-semibold text-ink",
					)}
				>
					{item.title}
				</span>
				<span className="truncate text-ink-dim text-meta">
					{seen === "live"
						? t("ui.notifications.seen.live")
						: seen === "in_view"
							? t("ui.notifications.seen.in_view")
							: rowTimeText(rowTimeOf(item.updated_at, nowMs))}
				</span>
			</div>
			<Tooltip content={t("ui.notifications.drawer.show_in_conversation")}>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t("ui.notifications.drawer.show_in_conversation")}
					onClick={() => onShow(item)}
				>
					<ChevronsUp aria-hidden="true" />
				</Button>
			</Tooltip>
		</li>
	);
};
