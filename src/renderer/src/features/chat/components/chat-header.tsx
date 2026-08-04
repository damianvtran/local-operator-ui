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
			className={cn(
				"flex h-21 items-center gap-3 border-hairline border-b px-4",
			)}
			data-tour-tag="chat-header"
		>
			<Avatar className={cn("size-10")}>
				<AvatarFallback>
					<Bot size={22} aria-hidden={true} />
				</AvatarFallback>
			</Avatar>
			<div className={cn("flex min-w-0 flex-col")}>
				<h2 className={cn("truncate text-ink text-title")}>{agentName}</h2>
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
						size="icon-lg"
						className={cn("ml-auto")}
						onClick={() => setCanvasOpen(true)}
						aria-label={`Open canvas (${shortcut})`}
						data-tour-tag="open-canvas-button"
					>
						<FileText strokeWidth={1.5} aria-hidden={true} />
					</Button>
				</Tooltip>
			)}
		</div>
	);
};
