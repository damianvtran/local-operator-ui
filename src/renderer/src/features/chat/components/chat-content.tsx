import { Box, Paper, styled } from "@mui/material";
import type {
	AgentDetails,
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { type FC, useRef, useState } from "react";
import type { Message } from "../types";
import { ChatUtilities } from "../utils/chat-utilities";
import { Canvas } from "./canvas";
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import { ChatTabs } from "./chat-tabs";
import { MessageInput } from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";

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

const FlexRow = styled(Box)({
	display: "flex",
	flexDirection: "row",
	width: "100%",
	height: "100%",
	position: "relative",
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

	const canvasPanelWidth = useUiPreferencesStore((s) => s.canvasWidth);
	const setCanvasPanelWidth = useUiPreferencesStore((s) => s.setCanvasWidth);
	const restoreDefaultCanvasPanelWidth = useUiPreferencesStore(
		(s) => s.restoreDefaultCanvasWidth,
	);
	const [isChatUtilitiesExpanded, setIsChatUtilitiesExpanded] = useState(false);

	// Get canvas state for the current conversation
	const conversationId = agentId; // assuming agentId is the conversation ID
	const canvasState = useCanvasStore((s) => s.conversations[conversationId]);

	const defaultCanvasState = {
		isOpen: false,
		openTabs: [],
		selectedTabId: null,
		files: [],
	};
	const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
	const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);
	const setFiles = useCanvasStore((s) => s.setFiles);

	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
	const openTabs = (canvasState ?? defaultCanvasState).openTabs;
	const selectedTabId = (canvasState ?? defaultCanvasState).selectedTabId;
	const files = (canvasState ?? defaultCanvasState).files;

	// On conversation change, ensure canvas state is initialized/restored
	// (No longer needed: Zustand store now always provides a default state for any conversationId)

	// No effect needed: always use the value from the store, or fallback to default if 0
	const effectiveCanvasPanelWidth =
		canvasPanelWidth === 0 ? 450 : canvasPanelWidth;

	return (
		<FlexRow>
			<Box
				sx={{
					flex: 1,
					minWidth: 500,
					height: "100%",
					position: "relative",
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

			{isCanvasOpen && (
				<>
					<ResizableDivider
						sidebarWidth={effectiveCanvasPanelWidth}
						onSidebarWidthChange={setCanvasPanelWidth}
						minWidth={220}
						maxWidth={800}
						side="left"
						onDoubleClick={restoreDefaultCanvasPanelWidth}
					/>
					<Box
						ref={canvasContainerRef}
						sx={(theme) => ({
							minWidth: effectiveCanvasPanelWidth,
							width: effectiveCanvasPanelWidth,
							overflow: "hidden",
							height: "100%",
							transition: "width 0.2s cubic-bezier(0.4,0,0.2,1)",
							position: "relative",
							borderLeft: `1px solid ${theme.palette.divider}`,
						})}
					>
						<Canvas
							activeDocumentId={selectedTabId}
							initialDocuments={files}
							onChangeActiveDocument={(documentId: string) =>
								setSelectedTab(conversationId, documentId)
							}
							onClose={() =>
								useUiPreferencesStore.getState().setCanvasOpen(false)
							}
							onCloseDocument={(docId: string) => {
								// Remove from openTabs and files, update selectedTabId if needed
								const newTabs = openTabs.filter((tab) => tab.id !== docId);
								const newFiles = files.filter((file) => file.id !== docId);
								setOpenTabs(conversationId, newTabs);
								setFiles(conversationId, newFiles);
								if (selectedTabId === docId) {
									setSelectedTab(
										conversationId,
										newTabs.length > 0 ? newTabs[0].id : null,
									);
								}
							}}
						/>
					</Box>
				</>
			)}
		</FlexRow>
	);
};
