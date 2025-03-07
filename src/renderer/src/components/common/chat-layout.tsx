import { Box, Divider, styled } from "@mui/material";
import type { FC, ReactNode } from "react";

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

const StyledDivider = styled(Divider)({
  opacity: 0.1,
});

/**
 * ChatLayout Component
 * 
 * Provides a consistent layout for chat-related pages with a sidebar and main content area
 */
export const ChatLayout: FC<ChatLayoutProps> = ({ sidebar, content }) => {
  return (
    <Container>
      {/* Sidebar - fixed width */}
      <SidebarContainer>{sidebar}</SidebarContainer>

      {/* Main Content Area */}
      <ContentContainer>{content}</ContentContainer>
    </Container>
  );
};

export { StyledDivider };
