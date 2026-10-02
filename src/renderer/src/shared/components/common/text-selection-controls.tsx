import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { clipForSpeech } from "@shared/lib/speech-clip";
import { useSpeechBindingFor } from "@shared/lib/speech-target";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import {
	fetchSpeechFor,
	selectionSpeechKey,
	useSpeechStore,
} from "@shared/store/speech-store";
import {
	ClipboardCopy,
	Copy,
	ExternalLink,
	MessageSquareReply,
	Reply,
	Sparkles,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useState } from "react";
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
	const { speak } = useSpeechStore();

	const { addReply, addAttachment } = useConversationInputStore();

	/*
	 * The selection's Speak, through the ONE control every speech surface renders
	 * (`speak-control.tsx`) - the block below used to inline its own copy of the
	 * gate, the ladder and the spinner, which is the second implementation § 9 of
	 * `docs/branding.md` refuses. The key is this selection's own words, clipped
	 * first; `scope` falls back to the agent id when no conversation id rides in,
	 * so two surfaces that speak the same context agree on the one cache entry.
	 *
	 * THE SCOPE AND THE TARGET ARE TWO DIFFERENT QUESTIONS, which is what
	 * `@shared/lib/speech-target` separates: the scope keys the cache (the
	 * conversation's identity), and the TARGET is the catalogue's binding for that
	 * conversation - the role agent's display NAME, which the press resolves to a
	 * registry id - and `null` for a conversation with no binding, which speaks
	 * through the agent-less route rather than being disabled.
	 *
	 * `available` IS STILL THE HIGHLIGHT, AND ONLY THE HIGHLIGHT. The gate it
	 * replaced was `Boolean(agentId)`, which read "no agent" as "nothing to say"
	 * and so denied the press to every conversation with no role binding - the
	 * ordinary shape. What remains true is the surface's own subject: with no
	 * highlight (or no scope to key it under) this control has nothing to speak and
	 * says so by being disabled, instead of offering a press that can only be a
	 * no-op (agent review round 1, MINOR-2).
	 */
	const speechScope = conversationId ?? agentId ?? null;
	const speechBinding = useSpeechBindingFor(speechScope);
	const speechControl = useSpeakControl({
		key:
			selection.text && speechScope
				? selectionSpeechKey(speechScope, clipForSpeech(selection.text).text)
				: null,
		getText: () => selection.text || null,
		play: ({ text }) => {
			if (speechScope) {
				speak(
					selectionSpeechKey(speechScope, text),
					fetchSpeechFor(speechBinding, text),
				);
			}
		},
		available: Boolean(selection.text && speechScope),
	});
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
			{showSpeech && <SpeakButton control={speechControl} />}
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
						<Reply aria-hidden="true" />
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
