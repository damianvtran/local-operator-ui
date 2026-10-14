import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { useDeleteAgent } from "@shared/hooks/use-agent-mutations";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import {
	CloudUpload,
	EllipsisVertical,
	Eraser,
	FileOutput,
	MessageSquare,
	Settings,
	Trash2,
} from "lucide-react";
import type { CSSProperties, FC } from "react";
import { useRef, useState } from "react";
import { t } from "../../../../../i18n/messages";
import { ConfirmationModal } from "./confirmation-modal";

type AgentOptionsMenuProps = {
	/**
	 * Agent ID
	 */
	agentId: string;
	/**
	 * Agent name for display in confirmation
	 */
	agentName: string;
	/**
	 * Optional callback when an agent is deleted
	 * @param agentId - The ID of the deleted agent
	 */
	onAgentDeleted?: (agentId: string) => void;
	/**
	 * Optional styles for the menu button. Plain CSS declarations only: these
	 * land on the button's `style` attribute, so nested selectors, responsive
	 * arrays and theme callbacks are not available.
	 */
	buttonSx?: Record<string, unknown>;
	/**
	 * Whether the current page is the agents page
	 * If true, the "View Agent Settings" option will not be shown
	 */
	isAgentsPage?: boolean;
	/**
	 * Optional callback for navigating to agent settings
	 * This should navigate to the Agents page with this agent selected
	 */
	onViewAgentSettings?: () => void;
	/**
	 * Optional callback for navigating to chat with the agent
	 * This should navigate to the Chat page with this agent selected
	 */
	onChatWithAgent?: () => void;
	/**
	 * Optional callback for exporting the agent
	 * This should export the agent as a ZIP file
	 */
	onExportAgent?: () => void;
	/**
	 * Optional callback to clear the conversation for this agent
	 */
	onClearConversation?: () => void;
	/**
	 * Optional callback to upload the agent to the hub
	 */
	onUploadAgentToHub?: () => void;
};

/**
 * Agent Options Menu Component
 *
 * Provides a menu with options for an agent, including chat, deletion and settings navigation
 */
export const AgentOptionsMenu: FC<AgentOptionsMenuProps> = ({
	agentId,
	agentName,
	onAgentDeleted,
	buttonSx = {},
	isAgentsPage = false,
	onViewAgentSettings,
	onChatWithAgent,
	onExportAgent,
	onClearConversation,
	onUploadAgentToHub,
}) => {
	// Language refresh must preserve entered fields and any open confirmation.
	useI18nLocale();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [isClearModalOpen, setIsClearModalOpen] = useState(false);

	// Selecting a row closes the menu, and Radix then restores focus to the
	// trigger. When the row opened a confirmation modal that restore lands
	// behind the modal, so suppress it for exactly that case.
	const opensModalRef = useRef(false);

	const deleteAgentMutation = useDeleteAgent();

	const { clearAgentFromAllPages } = useAgentSelectionStore();

	const handleConfirmDelete = async () => {
		try {
			await deleteAgentMutation.mutateAsync(agentId);

			clearAgentFromAllPages(agentId);

			onAgentDeleted?.(agentId);
		} catch (error) {
			// Surfaced to the user by the mutation's own error handling.
			console.error("Failed to delete agent:", error);
		} finally {
			setIsDeleteModalOpen(false);
		}
	};

	return (
		<>
			{/*
			 * Not modal. A modal Radix menu puts `pointer-events: none` on the
			 * body, and the onboarding tour's popup is a body-level sibling of the
			 * app root — its buttons would stop responding the moment this menu
			 * opened.
			 */}
			<DropdownMenu
				open={isMenuOpen}
				onOpenChange={setIsMenuOpen}
				modal={false}
			>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.agents.dialogs.menu.accessible")}
						data-tour-tag="agent-options-button"
						onClick={(e) => {
							// The trigger sits inside a clickable agent row; without this
							// the row navigates behind the menu that just opened.
							e.stopPropagation();
							// Radix opens on pointerdown, so a real click is already
							// handled by the time this runs. `detail === 0` means no
							// pointer was involved — which is how the onboarding tour
							// opens this menu, via `element.click()`.
							if (e.detail === 0) {
								setIsMenuOpen((open) => !open);
							}
						}}
						style={buttonSx as CSSProperties}
					>
						<EllipsisVertical aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>

				<DropdownMenuContent
					align="end"
					className="min-w-45"
					onClick={(e) => e.stopPropagation()}
					onInteractOutside={(e) => {
						// The tour attaches a step to a row of this menu, so pressing the
						// tour's own "Next" must not dismiss the menu out from under the
						// click it is about to make.
						const target = e.detail.originalEvent.target;
						if (
							target instanceof Element &&
							target.closest(".shepherd-element")
						) {
							e.preventDefault();
						}
					}}
					onCloseAutoFocus={(e) => {
						if (opensModalRef.current) {
							opensModalRef.current = false;
							e.preventDefault();
						}
					}}
				>
					{/* Only on the agents page: elsewhere you are already in the chat. */}
					{isAgentsPage && onChatWithAgent && (
						<DropdownMenuItem onSelect={onChatWithAgent}>
							<MessageSquare aria-hidden="true" />
							<span>{t("ui.agents.dialogs.menu.chat")}</span>
						</DropdownMenuItem>
					)}

					{/* Inverse of the above: the agents page is where settings already live. */}
					{!isAgentsPage && onViewAgentSettings && (
						<DropdownMenuItem
							data-tour-tag="view-agent-settings-menu-item"
							onSelect={onViewAgentSettings}
						>
							<Settings aria-hidden="true" />
							<span>{t("ui.agents.dialogs.menu.settings")}</span>
						</DropdownMenuItem>
					)}

					{onExportAgent && (
						<DropdownMenuItem onSelect={onExportAgent}>
							<FileOutput aria-hidden="true" />
							<span>{t("ui.agents.dialogs.menu.export")}</span>
						</DropdownMenuItem>
					)}

					{onUploadAgentToHub && (
						<DropdownMenuItem
							data-tour-tag="upload-to-hub-menu-item"
							onSelect={onUploadAgentToHub}
						>
							<CloudUpload aria-hidden="true" />
							<span>{t("ui.agents.dialogs.menu.upload")}</span>
						</DropdownMenuItem>
					)}

					{onClearConversation && (
						<DropdownMenuItem
							className="text-warning data-[highlighted]:bg-warning-wash"
							onSelect={() => {
								opensModalRef.current = true;
								setIsClearModalOpen(true);
							}}
						>
							<Eraser aria-hidden="true" />
							<span>{t("ui.agents.dialogs.menu.clear")}</span>
						</DropdownMenuItem>
					)}

					<DropdownMenuItem
						destructive
						onSelect={() => {
							opensModalRef.current = true;
							setIsDeleteModalOpen(true);
						}}
					>
						<Trash2 aria-hidden="true" />
						<span>{t("ui.agents.dialogs.menu.delete")}</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<ConfirmationModal
				open={isDeleteModalOpen}
				title={t("ui.agents.dialogs.delete.title")}
				message={
					<>
						<p className="text-body text-ink">
							{t("ui.agents.dialogs.delete.question", { name: agentName })}
						</p>
						<p className="mt-2 text-body-sm text-ink-muted">
							{t("ui.agents.dialogs.delete.warning")}
						</p>
					</>
				}
				confirmText={t("ui.agents.dialogs.delete.confirm")}
				cancelText={t("ui.agents.dialogs.delete.cancel")}
				isDangerous
				onConfirm={handleConfirmDelete}
				onCancel={() => setIsDeleteModalOpen(false)}
			/>

			<ConfirmationModal
				open={isClearModalOpen}
				title={t("ui.agents.dialogs.clear.title")}
				message={t("ui.agents.dialogs.clear.warning")}
				confirmText={t("ui.agents.dialogs.clear.confirm")}
				cancelText={t("ui.agents.dialogs.clear.cancel")}
				isDangerous
				onConfirm={() => {
					onClearConversation?.();
					setIsClearModalOpen(false);
				}}
				onCancel={() => setIsClearModalOpen(false)}
			/>
		</>
	);
};
