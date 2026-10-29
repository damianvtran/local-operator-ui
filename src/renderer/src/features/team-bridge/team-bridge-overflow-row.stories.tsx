import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { MessagesSquare, MoreHorizontal } from "lucide-react";

/**
 * The Team Bridge row inside the sidebar's More group, collapsed and expanded.
 *
 * WHY A SEPARATE STORY. The real row lives in `sidebar-navigation.tsx`, which
 * the Library lane owns until its overflow group lands; this board is the
 * design-review surface for the one question that lane has to answer visually:
 * does the unread badge read as "something is waiting" on the overflow row
 * WITHOUT expanding the group, and does it hold in both themes and with glass
 * on? The row markup mirrors the sidebar's 30px geometry, and the count is the
 * sidebar's own shared `AttentionBadge` (operator, 2026-10-28, #1465) rather
 * than a copy of its classes, so the board cannot show a register the product
 * no longer draws. The real rail's every-count frame is
 * `sidebar-attention.stories.tsx`; this board stays for the one row's states.
 *
 * THE BADGE IS ONE MARK, NOT TWO. When the group is collapsed the count rides
 * the More row; when it is expanded the count rides the Team Bridge row itself
 * and More draws no mark (design follow-up to #1465, D2: the group's summary
 * would otherwise double the same number - `sidebar-navigation.tsx` draws
 * More's sum only while the group is closed). Both states are below.
 */

type RowProps = {
	label: string;
	expanded: boolean;
	unread: number;
	active?: boolean;
};

const Row = ({ label, expanded, unread, active = false }: RowProps) => {
	useI18nLocale();
	return (
		<li
			className={cn(
				"flex h-[30px] w-full items-center rounded-md",
				active
					? "bg-row-selected text-ink"
					: "text-ink-muted hover:bg-row-hover hover:text-ink",
			)}
		>
			<button
				type="button"
				aria-label={
					unread > 0 ? t("ui.teamBridge.nav.unread", { count: unread }) : label
				}
				className={cn(
					"flex h-full min-w-0 flex-1 items-center gap-2 rounded-md",
					expanded ? "px-2" : "justify-center px-0",
				)}
			>
				<MessagesSquare
					size={16}
					aria-hidden="true"
					className={cn("shrink-0", active && "text-accent")}
				/>
				{expanded && <span className="truncate">{label}</span>}
				{unread > 0 && (
					<span className={cn(expanded && "ml-auto", "inline-flex")}>
						<AttentionBadge count={unread} />
					</span>
				)}
			</button>
		</li>
	);
};

const GroupBoard = ({
	expanded,
	unread,
	glass,
}: {
	expanded: boolean;
	unread: number;
	glass?: boolean;
}) => {
	useI18nLocale();
	return (
		<div
			className={cn(
				"flex min-h-screen items-start bg-canvas p-6",
				glass && "[--lo-glass-canvas:transparent]",
			)}
		>
			<div
				data-glass-region="page-sidebar"
				className="w-[260px] shrink-0 rounded-lg bg-surface/80 p-2"
			>
				<ul className="flex flex-col gap-0.5">
					{expanded ? (
						<>
							<li className="flex h-[30px] items-center gap-2 rounded-md px-2 text-ink-muted">
								<span className="min-w-0 flex-1 truncate text-[13px]">
									{t("ui.teamBridge.group.more")}
								</span>
								{/* Open: no mark here - the row below carries the count. */}
								<MoreHorizontal size={16} aria-hidden="true" />
							</li>
							<Row
								label={t("ui.teamBridge.nav.label")}
								expanded
								unread={unread}
							/>
						</>
					) : (
						/* Collapsed: the count rides the More row ITSELF. There is no Team
						   Bridge row here, which is the point of the overflow group — the rail
						   spends no row on a destination it is not showing. */
						<li
							className={cn(
								"flex h-[30px] w-full items-center gap-2 rounded-md px-2",
								"text-ink-muted hover:bg-row-hover hover:text-ink",
							)}
						>
							<span className="min-w-0 flex-1 truncate text-[13px]">
								{t("ui.teamBridge.group.more")}
							</span>
							{unread > 0 && (
								<span className="inline-flex shrink-0">
									<AttentionBadge count={unread} />
								</span>
							)}
							<MoreHorizontal size={16} aria-hidden="true" />
						</li>
					)}
				</ul>
			</div>
		</div>
	);
};

const meta = {
	title: "Team Bridge/Overflow row",
	component: GroupBoard,
	parameters: { layout: "fullscreen" },
	args: { expanded: false, unread: 3 },
} satisfies Meta<typeof GroupBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsedGroup: Story = {};
export const ExpandedGroup: Story = { args: { expanded: true } };
export const NoUnread: Story = { args: { unread: 0 } };
export const HighCount: Story = { args: { unread: 128 } };
