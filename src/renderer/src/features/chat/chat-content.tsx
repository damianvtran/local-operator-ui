import { Box, Paper, styled } from "@mui/material";
import type {
	AgentDetails,
	AgentExecutionRecord,
	JobStatus,
} from "@renderer/api/local-operator/types";
import { useCanvasStore } from "@renderer/store/canvas-store";
import { isDevelopmentMode } from "@renderer/utils/env-utils";
import Split from "@uiw/react-split";
import { type FC, useEffect, useRef, useState } from "react";
import { Canvas } from "./canvas";
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import { ChatTabs } from "./chat-tabs";
import { ChatUtilities } from "./chat-utilities";
import { MessageInput } from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";
import type { Message } from "./types";

const DEFAULT_MESSAGE_SUGGESTIONS = [
	"Go to my documents folder",
	"What's the latest news?",
	"Make me a research report on the latest trends in AI",
	"Make me a space invaders game",
	"Organize my desktop",
	"Create a presentation outline on climate change",
	"Train a classifier on the MPG dataset",
	"Search for quantum computing papers and download interesting ones to read later",
	"Download some recent papers on fusion energy",
	"Download some recent papers on cancer research",
	"Make me a brick breaker game",
	"Remove downloads that are more than a year old",
	"Put together a competitive analysis report on the agentic AI space",
	"Find me a royalty free gif of a cute cat",
	"Go to my downloads folder",
	"Organize my documents folder",
	"Make me a GDPR compliant privacy policy",
	"Look up trending stocks and put together an investment report",
	"Fetch the MNIST dataset and train a good classifier",
	"Look up interest rate trends and make a projection for the next 5 years",
	"Make a presentation with a dependency graph of genetic factors for Alzheimer's disease",
];

const CANVAS_OPEN_WIDTH = 450;
const CANVAS_CLOSED_WIDTH = 0;

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
	flex: 1,
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
	const canvasContainerRef = useRef<HTMLDivElement>(null);

	const [canvasPanelWidth, setCanvasPanelWidth] = useState(CANVAS_OPEN_WIDTH);
	const [isChatUtilitiesExpanded, setIsChatUtilitiesExpanded] = useState(false);

	const {
		isOpen,
		documents,
		activeDocumentId,
		closeCanvas,
		setActiveDocument,
		closeDocument,
	} = useCanvasStore();

	useEffect(() => {
		if (isOpen) {
			return setCanvasPanelWidth(CANVAS_OPEN_WIDTH);
		}

		if (canvasContainerRef.current) {
			canvasContainerRef.current.style.width = "";
		}
		return setCanvasPanelWidth(CANVAS_CLOSED_WIDTH);
	}, [isOpen]);

	return (
		<Split
			visible={!!canvasPanelWidth}
			style={{ border: "1px solid #d5d5d5", borderRadius: 3 }}
		>
			<Box
				sx={{
					flex: 1,
					minWidth: 500,
				}}
			>
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
							conversationId={agentId}
						/>
					) : (
						/* Raw information tab - only accessible in development mode */
						<RawInfoView content={rawInfoContent} />
					)}
					{/* Message input */}
					{!(isLoadingMessages && messages.length === 0) && (
						<MessageInput
							onSendMessage={onSendMessage}
							initialSuggestions={DEFAULT_MESSAGE_SUGGESTIONS}
							isLoading={isLoading}
							conversationId={agentId}
							messages={messages}
							currentJobId={currentJobId}
							onCancelJob={onCancelJob}
							isFarFromBottom={isFarFromBottom}
							scrollToBottom={scrollToBottom}
							isChatUtilitiesExpanded={isChatUtilitiesExpanded}
						/>
					)}
					{/* Chat utilities section */}
					<ChatUtilities
						agentId={agentId}
						agentData={agentData}
						expanded={isChatUtilitiesExpanded}
						setExpanded={setIsChatUtilitiesExpanded}
					/>
				</ChatContainer>
			</Box>

			<Box
				ref={canvasContainerRef}
				sx={{
					minWidth: canvasPanelWidth,
					width: canvasPanelWidth,
					overflow: "hidden",
				}}
			>
				{isOpen && (
					<Canvas
						open={isOpen}
						onClose={closeCanvas}
						onCloseDocument={closeDocument}
						initialDocuments={documents}
						activeDocumentId={activeDocumentId}
						onChangeActiveDocument={setActiveDocument}
					/>
				)}
			</Box>
		</Split>
	);
};
