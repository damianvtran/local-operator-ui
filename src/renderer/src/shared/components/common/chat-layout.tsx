import { Box, styled } from "@mui/material";
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

const Container = styled(Box)({
	display: "flex",
	height: "100%",
	width: "100%",
	overflow: "hidden",
});

const SidebarContainer = styled(Box)({
	flexShrink: 0,
	width: 280,
	height: "100%",
});

const ContentContainer = styled(Box)({
	flexGrow: 1,
	height: "100%",
	overflow: "hidden",
});

/**
 * ChatLayout Component
 *
 * Provides a consistent layout for chat-related pages with a sidebar and main content area.
 * Uses the persisted sidebar width from the UI preferences store.
 */
export const ChatLayout: FC<ChatLayoutProps> = ({ sidebar, content }) => {
	const sidebarWidth = useUiPreferencesStore((s) => s.chatSidebarWidth);
	const setSidebarWidth = useUiPreferencesStore((s) => s.setChatSidebarWidth);
	const restoreDefaultSidebarWidth = useUiPreferencesStore(
		(s) => s.restoreDefaultChatSidebarWidth,
	);

	return (
		<Container>
			<SidebarContainer style={{ width: sidebarWidth }}>
				{sidebar}
			</SidebarContainer>
			<ResizableDivider
				sidebarWidth={sidebarWidth}
				onSidebarWidthChange={setSidebarWidth}
				minWidth={180}
				maxWidth={600}
				onDoubleClick={restoreDefaultSidebarWidth}
			/>
			<ContentContainer>{content}</ContentContainer>
		</Container>
	);
};
