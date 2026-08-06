import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC, ReactNode } from "react";
import { ResizableDivider } from "./resizable-divider";

/**
 * Props for the ChatLayout component
 */
type ChatLayoutProps = {
	sidebar: ReactNode;
	content: ReactNode;
};

/**
 * Sidebar and main content for the chat routes, at the user's persisted
 * sidebar width.
 *
 * The width stays an inline `style` rather than becoming a class: it is a
 * continuously dragged pixel value from the preferences store, and a Tailwind
 * class cannot express a value that does not exist until the user lets go of
 * the divider. The old `styled` wrapper's `width: 280` was dead for the same
 * reason — the inline style always overrode it.
 */
export const ChatLayout: FC<ChatLayoutProps> = ({ sidebar, content }) => {
	const sidebarWidth = useUiPreferencesStore((s) => s.chatSidebarWidth);
	const setSidebarWidth = useUiPreferencesStore((s) => s.setChatSidebarWidth);
	const restoreDefaultSidebarWidth = useUiPreferencesStore(
		(s) => s.restoreDefaultChatSidebarWidth,
	);

	return (
		<div className="flex h-full w-full overflow-hidden">
			<div className="h-full shrink-0" style={{ width: sidebarWidth }}>
				{sidebar}
			</div>
			<ResizableDivider
				sidebarWidth={sidebarWidth}
				onSidebarWidthChange={setSidebarWidth}
				minWidth={180}
				maxWidth={600}
				onDoubleClick={restoreDefaultSidebarWidth}
			/>
			<div className="h-full grow overflow-hidden">{content}</div>
		</div>
	);
};
