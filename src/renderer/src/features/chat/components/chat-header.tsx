import { Avatar, AvatarFallback, Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Bot, FileText } from "lucide-react";
import type { FC } from "react";

/**
 * ChatHeaderProps
 * @property agentName - The name of the agent to display.
 * @property description - The description of the agent.
 * @property onOpenOptions - Optional callback for opening options/canvas.
 */
type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	onOpenOptions?: () => void;
};

export const ChatHeader: FC<ChatHeaderProps> = ({
	agentName = "Local Operator",
	description = "Your on-device AI assistant",
	onOpenOptions,
}) => {
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);

	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const shortcut = isMac ? "⌘+Shift+C" : "Ctrl+Shift+C";

	return (
		<div
			/*
			 * 56px and `shrink-0`, matching the bar band its peers occupy: 52px
			 * command palette, 48px nav rail header, 40px canvas header. The old
			 * `h-21` declared 84px - 1.6x the largest peer - and, without `shrink-0`,
			 * never drew it: the column's flex deficit came out of this box, so it
			 * rendered 46.5px at one window size and 61.4px at another. A height that
			 * moves with composer content cannot be designed against, which is why
			 * the geometry is pinned before anything here is styled.
			 *
			 * 56 rather than 52: this bar carries two lines (16px name over 13px
			 * description, about 41px of text), where the command palette carries
			 * one. It is the smallest step on the 4px ramp that holds both without
			 * crowding them.
			 */
			className={cn(
				"flex h-14 shrink-0 items-center gap-3 border-hairline border-b px-4",
			)}
			data-tour-tag="chat-header"
		>
			{/* No `size-*` override: the Avatar primitive's own 32px is the app's
			 * control size, and the 40px override made the same agent wear two
			 * different faces on one screen against the transcript's 28px marker.
			 * The glyph is sized by class rather than lucide's numeric `size` prop
			 * so a `size-*` sweep can see it; 16px is the ramp's default step and
			 * what a 32px circle carries. */}
			<Avatar>
				<AvatarFallback>
					<Bot className={cn("size-4")} aria-hidden={true} />
				</AvatarFallback>
			</Avatar>
			<div className={cn("flex min-w-0 flex-col")}>
				{/* `text-heading`, not `text-title`: branding.md reserves the 20px step
				 * for section and dialog titles and states that a desktop app has no
				 * hero. 20px over 13px also skipped two ramp steps in one bar. */}
				<h2 className={cn("truncate text-heading text-ink")}>{agentName}</h2>
				<span
					className={cn("truncate text-ink-muted text-body-sm")}
					title={description}
				>
					{description}
				</span>
			</div>

			{onOpenOptions && !isCanvasOpen && (
				<Tooltip content={`Open canvas (${shortcut})`} side="top">
					<Button
						variant="ghost"
						/* 32px `icon`, the size every other header action in the app
						 * uses. `icon-lg` (36px) made this one button the outlier. */
						size="icon"
						className={cn("ml-auto")}
						onClick={() => setCanvasOpen(true)}
						aria-label={`Open canvas (${shortcut})`}
						data-tour-tag="open-canvas-button"
					>
						<FileText aria-hidden={true} />
					</Button>
				</Tooltip>
			)}
		</div>
	);
};
