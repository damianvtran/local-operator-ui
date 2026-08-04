import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useSpeechStore } from "@shared/store/speech-store";
import {
	ClipboardCopy,
	Copy,
	ExternalLink,
	MessageSquareReply,
	ReplyIcon,
	Sparkles,
	Square,
	Volume2,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

const URL_REGEX = /https?:\/\/[^\s]+/i;

// Props for the TextSelectionControls component
type TextSelectionControlsProps = {
	targetRef: React.RefObject<HTMLElement>;
	scrollableContainerRef?: React.RefObject<HTMLElement>;
	// Config for buttons
	showSpeech?: boolean;
	showCopy?: boolean;
	showReply?: boolean;
	showEdit?: boolean;
	showRefer?: boolean;
	// Props for speech
	agentId?: string;
	// Props for reply
	conversationId?: string;
	filePath?: string;
	// Callback for edit
	onEdit?: (
		selection: string,
		rect: DOMRect,
		range: Range,
		close: () => void,
	) => void;
	isUser?: boolean;
};

/*
 * The toolbar leaves the flow — it is positioned over the selected text — so
 * it takes the elevated ground and the one overlay shadow. It is not a Radix
 * popover: its anchor is a `Range`, which no popover primitive can take, and
 * the positioning is recomputed from the range's own rect on scroll and
 * resize.
 */
const CONTROLS_WRAPPER_CLASSES =
	"absolute z-10 flex items-center gap-1 rounded-sm border border-hairline bg-elevated p-1 shadow-overlay";

export const TextSelectionControls: FC<TextSelectionControlsProps> = ({
	targetRef,
	scrollableContainerRef,
	showSpeech,
	showCopy,
	showReply,
	showEdit,
	showRefer,
	agentId,
	conversationId,
	filePath,
	onEdit,
	isUser,
}) => {
	const [selection, setSelection] = useState<{
		text: string;
		html: string;
		rect: DOMRect | null;
		range: Range | null;
	}>({ text: "", html: "", rect: null, range: null });
	const { playSpeech, stopSpeech, loadingMessageId, playingMessageId } =
		useSpeechStore();
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
	const { addReply, addAttachment } = useConversationInputStore();

	const isRadientApiKeyConfigured = useMemo(
		() => credentialsData?.keys?.includes("RADIENT_API_KEY"),
		[credentialsData?.keys],
	);

	const canEnableSpeechFeature = useMemo(
		() => isRadientApiKeyConfigured && !isLoadingCredentials,
		[isRadientApiKeyConfigured, isLoadingCredentials],
	);

	const [currentSelectionId, setCurrentSelectionId] = useState<string | null>(
		null,
	);
	const isPlaying = playingMessageId && playingMessageId === currentSelectionId;
	const isLoading = loadingMessageId && loadingMessageId === currentSelectionId;

	const handleMouseUp = useCallback(() => {
		if (!targetRef.current) {
			setSelection({ text: "", html: "", rect: null, range: null });
			return;
		}

		const sel = window.getSelection();
		if (
			sel &&
			sel.rangeCount > 0 &&
			!sel.isCollapsed &&
			sel.anchorNode &&
			targetRef.current.contains(sel.anchorNode)
		) {
			const range = sel.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			const text = sel.toString().trim();
			const container = document.createElement("div");
			container.appendChild(range.cloneContents());
			const html = container.innerHTML;

			if (text) {
				setSelection({ text, html, rect, range });
			} else {
				setSelection({ text: "", html: "", rect: null, range: null });
			}
		} else {
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	}, [targetRef]);

	useEffect(() => {
		const handleMouseUpEvent = () => {
			// Use a timeout to allow the selection to finalize before checking it
			setTimeout(handleMouseUp, 0);
		};

		document.addEventListener("mouseup", handleMouseUpEvent);
		return () => {
			document.removeEventListener("mouseup", handleMouseUpEvent);
		};
	}, [handleMouseUp]);

	useEffect(() => {
		const handleScrollAndResize = () => {
			if (selection.range) {
				const rect = selection.range.getBoundingClientRect();
				setSelection((s) => ({ ...s, rect }));
			}
		};

		const scrollableElement = scrollableContainerRef?.current || window;
		scrollableElement.addEventListener("scroll", handleScrollAndResize, true);
		window.addEventListener("resize", handleScrollAndResize, true);

		return () => {
			scrollableElement.removeEventListener(
				"scroll",
				handleScrollAndResize,
				true,
			);
			window.removeEventListener("resize", handleScrollAndResize, true);
		};
	}, [selection.range, scrollableContainerRef]);

	const handlePlay = () => {
		if (agentId && selection.text) {
			const newSelectionId = uuidv4();
			setCurrentSelectionId(newSelectionId);
			playSpeech(newSelectionId, agentId, selection.text);
		}
	};

	const handleStop = () => {
		stopSpeech();
	};

	const handleCopy = () => {
		if (selection.html) {
			const htmlBlob = new Blob([selection.html], { type: "text/html" });
			const textBlob = new Blob([selection.text], { type: "text/plain" });
			const item = new ClipboardItem({
				"text/html": htmlBlob,
				"text/plain": textBlob,
			});
			navigator.clipboard.write([item]).finally(() => {
				setSelection({ text: "", html: "", rect: null, range: null });
			});
		} else {
			handleCopyWithoutFormatting();
		}
	};

	const handleCopyWithoutFormatting = () => {
		if (selection.text) {
			navigator.clipboard.writeText(selection.text).finally(() => {
				setSelection({ text: "", html: "", rect: null, range: null });
			});
		}
	};

	const handleReply = () => {
		if (selection.text && conversationId) {
			addReply(conversationId, {
				id: uuidv4(),
				text: selection.text,
			});
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	};

	const handleRefer = () => {
		if (selection.text && conversationId && filePath) {
			addReply(conversationId, {
				id: uuidv4(),
				text: selection.text,
			});
			addAttachment(conversationId, {
				id: uuidv4(),
				path: filePath,
			});
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	};

	const handleEdit = () => {
		if (selection.text && selection.rect && selection.range && onEdit) {
			onEdit(selection.text, selection.rect, selection.range, () => {
				setSelection({ text: "", html: "", rect: null, range: null });
			});
		}
	};

	// Extract link URL from selected content
	const extractLinkFromSelection = useCallback(() => {
		if (!selection.range) return null;

		// Check if the selection contains or is within a link element
		const container = document.createElement("div");
		container.appendChild(selection.range.cloneContents());

		// Look for anchor tags in the selected content
		const linkElement = container.querySelector("a");
		if (linkElement?.href) {
			return linkElement.href;
		}

		// Check if the selection is within a link element
		let node: Node | null = selection.range.startContainer;
		while (node && node !== targetRef.current) {
			if (
				node.nodeType === Node.ELEMENT_NODE &&
				(node as Element).tagName === "A"
			) {
				const anchor = node as HTMLAnchorElement;
				if (anchor.href) {
					return anchor.href;
				}
			}
			node = node.parentNode;
		}

		// Check if the selected text looks like a URL
		const match = selection.text.match(URL_REGEX);
		if (match) {
			return match[0];
		}

		return null;
	}, [selection.range, selection.text, targetRef]);

	const linkUrl = extractLinkFromSelection();

	const handleOpenInBrowser = () => {
		if (linkUrl) {
			window.open(linkUrl, "_blank", "noopener,noreferrer");
			setSelection({ text: "", html: "", rect: null, range: null });
		}
	};

	if (!selection.rect || !selection.text || isUser) {
		return null;
	}

	const containerRect = targetRef.current?.getBoundingClientRect();
	if (!containerRect) return null;

	const style = {
		// The toolbar is 38px tall (28px control + 4px padding + 1px border, both
		// sides), so this clears the selection by 8px.
		top: selection.rect.top - containerRect.top - 46,
		left: selection.rect.left - containerRect.left,
	};

	return (
		/*
		 * Preventing mousedown keeps the browser from collapsing the selection
		 * the toolbar exists to act on.
		 */
		<div
			className={CONTROLS_WRAPPER_CLASSES}
			style={style}
			onMouseDown={(e) => e.preventDefault()}
		>
			{showEdit && (
				<Tooltip content="Ask for an edit">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Ask for an edit"
						onClick={handleEdit}
					>
						<Sparkles aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{showSpeech &&
				(isPlaying ? (
					<Tooltip content="Stop">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Stop"
							onClick={handleStop}
						>
							<Square aria-hidden="true" />
						</Button>
					</Tooltip>
				) : (
					<Tooltip
						content={
							isLoading
								? "Loading"
								: !canEnableSpeechFeature
									? "Sign in to Radient in the settings page to enable text to speech"
									: "Speak aloud"
						}
					>
						{/*
						 * A disabled button fires no pointer events, so the tooltip needs
						 * a wrapper that does — which is also the only way the reason it
						 * is disabled reaches the user.
						 */}
						<span className="flex">
							<Button
								variant="ghost"
								size="icon-sm"
								// The spinner is hidden from the accessibility tree, so the
								// button's own name is what says the app is busy.
								aria-label={isLoading ? "Loading speech" : "Speak aloud"}
								onClick={handlePlay}
								disabled={isLoading || !agentId || !canEnableSpeechFeature}
							>
								{isLoading ? (
									<Spinner size="xs" />
								) : (
									<Volume2 aria-hidden="true" />
								)}
							</Button>
						</span>
					</Tooltip>
				))}
			{showCopy && (
				<>
					<Tooltip content="Copy">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Copy"
							onClick={handleCopy}
						>
							<Copy aria-hidden="true" />
						</Button>
					</Tooltip>
					<Tooltip content="Copy without formatting">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Copy without formatting"
							onClick={handleCopyWithoutFormatting}
						>
							<ClipboardCopy aria-hidden="true" />
						</Button>
					</Tooltip>
				</>
			)}
			{showReply && (
				<Tooltip content="Reply">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Reply"
						onClick={handleReply}
					>
						<MessageSquareReply aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{showRefer && (
				<Tooltip content="Refer to this from file">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Refer to this from file"
						onClick={handleRefer}
					>
						<ReplyIcon aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{linkUrl && (
				<Tooltip content="Open in browser">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Open in browser"
						onClick={handleOpenInBrowser}
					>
						<ExternalLink aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
		</div>
	);
};
