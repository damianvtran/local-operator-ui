import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	conversationTitleForDisplay,
} from "@shared/store/canonical-sessions-store";
import { ChevronDown, ChevronRight, MessageSquareDashed } from "lucide-react";
import { type FC, useState } from "react";
import {
	deletesInLabel,
	groupOpenByDefault,
	holdLabelKey,
	showCountdown,
	temporaryInfo,
} from "../chat-temporary";
import { useAskClock } from "../use-ask-clock";

/**
 * The sidebar's `Temporary · N` group: the one place a temporary chat is listed.
 *
 * Collapsed at rest and drawn at the HEAD of the chats list (above Pinned), so a
 * live temporary chat is never lost while it stays out of the normal history.
 * It opens by itself while it holds the conversation on screen
 * (`groupOpenByDefault`); a press on its header overrides that for the life of
 * the panel. Rows are plain buttons rather than the full conversation row: a
 * temporary chat has no pin, tag or archive affordance to offer (each is refused
 * until it is kept), so the row is its title, the dashed mark and one line
 * saying how long it has left or why it is held.
 *
 * TWO LINES, THE TITLE ON TOP (design round 1, D2/D3; QA Q-3): on one line the
 * state sentence (95 px for "Kept while it runs") took the title's width, down
 * to one character at the default sidebar width. Under it, both truncate on
 * their own and the row's `title` carries both whole. The rows are inset to the
 * header label's x - the ordinary rows' lead - so they read as the group's
 * content rather than as siblings of its header.
 *
 * Not rendered at all with no temporary rows, and the caller renders it only
 * under `features.temporary_chats`.
 */
export const SidebarTemporaryGroup: FC<{
	rows: CanonicalSessionRow[];
	currentId: string | null | undefined;
	onSelect: (sessionId: string) => void;
	/** A fixed clock (epoch ms) for stories and frames; the live group ticks. */
	nowMs?: number;
}> = ({ rows, currentId, onSelect, nowMs }) => {
	useI18nLocale();
	const [pressed, setPressed] = useState<boolean | null>(null);
	const now = useAskClock(rows.length > 0, nowMs) / 1000;
	if (rows.length === 0) return null;
	const open = pressed ?? groupOpenByDefault(currentId, rows);
	return (
		<div data-sidebar-temporary-group="" className="flex flex-col">
			<button
				type="button"
				data-chat-row
				data-chat-section="temporary"
				className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 font-medium text-body-sm text-ink-muted hover:bg-row-hover"
				aria-expanded={open}
				onClick={() => setPressed(!open)}
			>
				{open ? (
					<ChevronDown className="size-3.5" />
				) : (
					<ChevronRight className="size-3.5" />
				)}
				<MessageSquareDashed
					aria-hidden="true"
					className="size-3.5 shrink-0 text-ink-dim"
				/>
				<span className="min-w-0 flex-1 truncate text-start">
					{t("ui.chat.sidebar_view.section.temporary", { count: rows.length })}
				</span>
			</button>
			{open && (
				<ul className="flex flex-col">
					{rows.map((row) => {
						const info = temporaryInfo(row, true);
						if (info === null) return null;
						const label = deletesInLabel(info, now);
						const counting =
							label.key === "deletes_in" && showCountdown(info.deletes_at, now);
						const current = currentId === row.session_id;
						const title = conversationTitleForDisplay(row.title);
						const meta =
							label.key === "deletes_in"
								? t("ui.chat.sidebar_view.temporary.deletes_in", {
										minutes: label.minutes,
									})
								: t(holdLabelKey(label.code));
						return (
							<li key={row.session_id} data-temporary-row={row.session_id}>
								<button
									type="button"
									data-chat-row
									aria-current={current ? "page" : undefined}
									onClick={() => onSelect(row.session_id)}
									title={`${title}\n${meta}`}
									className={cn(
										"flex w-full min-w-0 items-start gap-1.5 rounded-md py-1 ps-[1.375rem] pe-1 text-start text-body-sm leading-5 hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
										current &&
											"bg-row-selected font-medium text-ink hover:bg-row-selected",
									)}
								>
									{/* On the title's line box (`leading-5`), not centred on both lines. */}
									<MessageSquareDashed
										aria-hidden="true"
										className="mt-[3px] size-3.5 shrink-0 text-ink-dim"
									/>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate">{title}</span>
										<span
											data-temporary-countdown={counting ? "" : undefined}
											data-temporary-meta=""
											className={cn(
												"truncate font-normal text-meta",
												counting ? "text-warning" : "text-ink-muted",
											)}
										>
											{meta}
										</span>
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};
