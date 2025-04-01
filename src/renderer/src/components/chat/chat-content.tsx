import { Paper, styled } from "@mui/material";
import type {
	AgentDetails,
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
import { StyledDivider } from "@renderer/components/common/chat-layout";
import { isDevelopmentMode } from "@renderer/utils/env-utils";
import type { FC } from "react";
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import { ChatTabs } from "./chat-tabs";
import { ChatUtilities } from "./chat-utilities";
import { MessageInput } from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";
import type { Message } from "./types";

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
	currentExecution?: AgentExecutionRecord | null;
	messagesContainerRef: React.RefObject<HTMLDivElement>;
	messagesEndRef: React.RefObject<HTMLDivElement>;
	scrollToBottom: () => void;
	rawInfoContent: string;
	onSendMessage: (content: string, attachments: string[]) => void;
	currentJobId: string | null;
	onCancelJob: (jobId: string) => void;
	agentData?: AgentDetails | null;
	refetch?: () => void;
};

const ChatContainer = styled(Paper)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	height: "100%",
	flexGrow: 1,
	borderRadius: 0,
	backgroundColor: theme.palette.background.paper,
}));

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
	currentExecution,
	messagesContainerRef,
	messagesEndRef,
	scrollToBottom,
	rawInfoContent,
	onSendMessage,
	currentJobId,
	onCancelJob,
	agentData,
	refetch,
}) => {
	return (
		<ChatContainer elevation={0}>
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

			{/* Tabs for chat and raw - only shown in development mode */}
			{isDevelopmentMode() && (
				<ChatTabs activeTab={activeTab} onChange={onTabChange} />
			)}

			{/* In production, always show chat view. In development, respect the active tab */}
			{!isDevelopmentMode() || activeTab === "chat" ? (
				/* Messages container */
				<MessagesView
					messages={messages}
					isLoading={isLoading}
					isLoadingMessages={isLoadingMessages}
					isFetchingMore={isFetchingMore}
					jobStatus={jobStatus}
					agentName={agentName}
					currentExecution={currentExecution}
					messagesContainerRef={messagesContainerRef}
					messagesEndRef={messagesEndRef}
					scrollToBottom={scrollToBottom}
					refetch={refetch}
				/>
			) : (
				/* Raw information tab - only accessible in development mode */
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
				isFarFromBottom={isFarFromBottom}
				scrollToBottom={scrollToBottom}
			/>

			{/* Chat utilities section */}
			<ChatUtilities agentId={agentId} agentData={agentData} />
		</ChatContainer>
	);
};
