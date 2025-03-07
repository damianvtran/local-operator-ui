import { Paper, styled } from "@mui/material";
import type { FC } from "react";
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import { ChatTabs } from "./chat-tabs";
import { MessageInput } from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { StyledDivider } from "@renderer/components/common/chat-layout";
import type { Message } from "./types";
import type { JobStatus } from "@renderer/api/local-operator/types";

/**
 * Props for the ChatContent component
 */
type ChatContentProps = {
  activeTab: "chat" | "raw";
  onTabChange: (tab: "chat" | "raw") => void;
  agentName: string;
  description: string;
  onOpenOptions: () => void;
  isOptionsSidebarOpen: boolean;
  onCloseOptions: () => void;
  agentId: string;
  messages: Message[];
  isLoading: boolean;
  isLoadingMessages: boolean;
  isFetchingMore: boolean;
  isFarFromBottom: boolean;
  jobStatus?: JobStatus | null;
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  scrollToBottom: () => void;
  rawInfoContent: string;
  onSendMessage: (content: string, file: File | null) => void;
  currentJobId: string | null;
  onCancelJob: (jobId: string) => void;
};

const ChatContainer = styled(Paper)({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  flexGrow: 1,
  borderRadius: 0,
});

/**
 * ChatContent Component
 * 
 * Displays the main chat content area with tabs, messages, and input
 */
export const ChatContent: FC<ChatContentProps> = ({
  activeTab,
  onTabChange,
  agentName,
  description,
  onOpenOptions,
  isOptionsSidebarOpen,
  onCloseOptions,
  agentId,
  messages,
  isLoading,
  isLoadingMessages,
  isFetchingMore,
  isFarFromBottom,
  jobStatus,
  messagesContainerRef,
  messagesEndRef,
  scrollToBottom,
  rawInfoContent,
  onSendMessage,
  currentJobId,
  onCancelJob,
}) => {
  return (
    <ChatContainer elevation={0}>
      {/* Scroll to bottom button */}
      <ScrollToBottomButton 
        visible={isFarFromBottom} 
        onClick={scrollToBottom} 
      />
      
      {/* Chat header */}
      <ChatHeader
        agentName={agentName}
        description={description}
        onOpenOptions={onOpenOptions}
      />

      {/* Chat Options Sidebar */}
      <ChatOptionsSidebar
        open={isOptionsSidebarOpen}
        onClose={onCloseOptions}
        agentId={agentId}
      />

      {/* Tabs for chat and raw */}
      <ChatTabs
        activeTab={activeTab}
        onChange={onTabChange}
      />

      {activeTab === "chat" ? (
        /* Messages container */
        <MessagesView
          messages={messages}
          isLoading={isLoading}
          isLoadingMessages={isLoadingMessages}
          isFetchingMore={isFetchingMore}
          jobStatus={jobStatus}
          agentName={agentName}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
        />
      ) : (
        /* Raw information tab */
        <RawInfoView content={rawInfoContent} />
      )}

      <StyledDivider />

      {/* Message input */}
      <MessageInput
        onSendMessage={onSendMessage}
        isLoading={isLoading}
        conversationId={agentId}
        messages={messages}
        currentJobId={currentJobId}
        onCancelJob={onCancelJob}
      />
    </ChatContainer>
  );
};
