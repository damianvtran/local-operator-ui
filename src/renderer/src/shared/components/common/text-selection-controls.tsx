import { placeSharedStrip } from "@features/chat/canonical/quote-anchor";
import { FloatingToolbar } from "@shared/components/common/floating-toolbar";
import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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
	useI18nLocale();
	const [selection, setSelection] = useState<{
		text: string;
		html: string;
		rect: DOMRect | null;
		range: Range | null;
	}>({ text: "", html: "", rect: null, range: null });
	const { speak } = useSpeechStore();

	const { addReply, addAttachment } = useConversationInputStore();
	/*
	 * ONE HIGHLIGHT, ONE STRIP (design round 2, D1). The quote/link toolkits are
	 * also selection strips, and they already own the highlight that begins in
	 * their turn. This toolbar stays mounted for every other selection (tool rows,
	 * receipts, a drag that starts outside a quotable turn), but it must not paint
	 * a second panel under the one that owns the press. The observer is on the
	 * content root rather than a shared store because the toolkits mount and
	 * unmount with their own selection; the DOM is the only place both facts meet.
	 */
	const [peerObserved, setPeerObserved] = useState(false);
	useEffect(() => {
		const root = targetRef.current;
		if (!root) return;
		const check = () => {
			setPeerObserved(
				root.querySelector(
					"[data-lo-quote-toolkit], [data-lo-link-toolbar]",
				) !== null,
			);
		};
		check();
		/*
		 * A jsdom harness that never installed MutationObserver still mounts the
		 * transcript; the only consequence is that the cross-toolbar guard cannot
		 * observe a late mount there. The browser always has it.
		 */
		if (typeof MutationObserver === "undefined") return;
		const observer = new MutationObserver(check);
		observer.observe(root, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [targetRef]);

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
	/*
	 * THE SELECTION IS READ ON `selectionchange`, NOT ON `mouseup` + A TIMER
	 * (operator report, 2026-10-19). The old gate waited for `mouseup` and then
	 * deferred one task (`setTimeout(..., 0)`) "to allow the selection to
	 * finalize". A deferred read is a frame in which this toolbar has not yet
	 * heard about a selection the quote toolkit has ALREADY painted - so the
	 * reader could see this panel appear near the selection and then stand down
	 * as the owning strip took over. `selectionchange` is the selection's own
	 * event, it fires before paint during a drag, and it is the same event the
	 * quote toolkit's gate reads - so both toolbars now derive from ONE
	 * notification rather than from two clocks.
	 *
	 * `mouseup`, `keyup` and `mouseup`-less programmatic selections are covered
	 * by the mount-time read and by `selectionchange` firing on them; the
	 * explicit `mouseup` listener is kept for engines that collapse a selection
	 * without a `selectionchange` (jsdom among them), and is read SYNCHRONOUSLY -
	 * there is no timer left in this component.
	 */
	const readSelection = useCallback(() => {
		const target = targetRef.current;
		if (!target) {
			setSelection({ text: "", html: "", rect: null, range: null });
			return;
		}

		const sel = typeof window === "undefined" ? null : window.getSelection();
		if (
			sel &&
			sel.rangeCount > 0 &&
			!sel.isCollapsed &&
			sel.anchorNode &&
			target.contains(sel.anchorNode)
		) {
			const range = sel.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			const text = sel.toString().trim();
			if (!text) {
				setSelection({ text: "", html: "", rect: null, range: null });
				return;
			}
			const container = document.createElement("div");
			container.appendChild(range.cloneContents());
			setSelection({ text, html: container.innerHTML, rect, range });
			return;
		}
		setSelection({ text: "", html: "", rect: null, range: null });
	}, [targetRef]);

	useEffect(() => {
		const handler = () => readSelection();
		document.addEventListener("selectionchange", handler);
		document.addEventListener("mouseup", handler);
		document.addEventListener("keyup", handler);
		readSelection();
		return () => {
			document.removeEventListener("selectionchange", handler);
			document.removeEventListener("mouseup", handler);
			document.removeEventListener("keyup", handler);
		};
	}, [readSelection]);

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

	/*
	 * THE SYNCHRONOUS HALF OF "ONE HIGHLIGHT, ONE STRIP". The observer above
	 * answers a tick later, which was the frame this component could paint in
	 * beside an already-mounted quote strip. The DOM query in the render path
	 * cannot be a tick late: if an owning strip is in the document at the moment
	 * this component renders, this component renders NOTHING. The observer keeps
	 * the value current for a later unmount; the query closes the mount frame.
	 */
	const peerOwnsNow =
		peerObserved ||
		Boolean(
			targetRef.current?.querySelector(
				"[data-lo-quote-toolkit], [data-lo-link-toolbar]",
			),
		);
	/*
	 * THE PRE-PAINT HALF, and the reason a state read in render is not enough.
	 * The render that first shows this component runs BEFORE the rows commit
	 * their own quote strips, so the query above answers "nobody owns it" and
	 * this panel would be painted for one frame beside the owning strip - the
	 * flash, exactly. A layout effect runs after that commit and before the
	 * browser paints, so the query there sees the strip the rows just mounted
	 * and the state update it triggers re-renders this component to `null`
	 * inside the same frame. That is the difference between "the observer will
	 * catch up" and "no frame exists in which both are painted".
	 */
	useLayoutEffect(() => {
		/*
		 * Only a live selection can raise a competing strip; reading the text here
		 * is also what makes it a genuine dependency rather than a trigger the
		 * linter would have to be told about.
		 */
		if (!selection.text) return;
		const root = targetRef.current;
		if (!root) return;
		setPeerObserved(
			root.querySelector("[data-lo-quote-toolkit], [data-lo-link-toolbar]") !==
				null,
		);
	}, [targetRef, selection.text]);

	/*
	 * THE ROW'S OWN CLUSTERS STAND DOWN WHILE THIS STRIP IS THE SELECTION'S
	 * TOOLBAR. `data-lo-selection-live` in the stylesheet already hides them for
	 * the paint; this effect is the accessibility half - the same `inert` +
	 * `aria-hidden` pair the quote toolkit writes for its own row, applied to
	 * every cluster under the reader's selection because this toolbar's subject
	 * is not one turn. Without it the row's Copy stays in the tab order while a
	 * selection strip is the visible toolbar, which is the "both are up" state
	 * expressed for a keyboard reader.
	 */
	const ownsSelection = Boolean(selection.text) && !isUser && !peerOwnsNow;
	useEffect(() => {
		const root = targetRef.current;
		if (!root || !ownsSelection) return;
		/*
		 * ONLY WHAT THIS EFFECT ACTUALLY WROTE, AND ONLY WHAT STILL BELONGS TO
		 * IT (code review round 1, C1). The first version wrote every cluster
		 * and then, on cleanup, refused to remove anything whenever a peer strip
		 * existed - so the rows this effect had touched and the quote toolkit
		 * never would (the user row and the intermediate response) kept
		 * `inert`/`aria-hidden` after the selection was cleared: their Copy and
		 * Fork presses did nothing and assistive technology lost them. The
		 * tracked write is the fix: a node is restored only if THIS effect set
		 * it, and only if no peer row owns it now.
		 */
		const written: Element[] = [];
		for (const cluster of root.querySelectorAll(
			"[data-lo-answer-actions], [data-lo-gutter-actions], [data-lo-user-actions], [data-lo-response-actions]",
		)) {
			if (cluster.closest("[data-lo-selection-active]")) continue;
			cluster.setAttribute("inert", "");
			cluster.setAttribute("aria-hidden", "true");
			written.push(cluster);
		}
		return () => {
			for (const cluster of written) {
				/*
				 * A peer may have taken the row over since this effect wrote it.
				 * The quote toolkit's cleanup owns that row's attributes; removing
				 * them here would strip the owning strip's suppression one commit
				 * after it wrote them. A node that has left the document is not
				 * ours to touch either.
				 */
				if (
					!cluster.isConnected ||
					cluster.closest("[data-lo-selection-active]")
				) {
					continue;
				}
				cluster.removeAttribute("inert");
				cluster.removeAttribute("aria-hidden");
			}
		};
	}, [ownsSelection, targetRef]);

	if (!selection.rect || !selection.text || isUser || peerOwnsNow) {
		return null;
	}

	const containerRect = targetRef.current?.getBoundingClientRect();
	if (!containerRect) return null;

	/*
	 * `transform` rather than a hard-coded `-46`, which was "the 38px toolbar
	 * plus the 8px clearance" written as one number. The shell is the shared
	 * 32px one now, so the number would silently over-clear by 6px; the
	 * transform derives the offset from the element's own height and cannot
	 * drift when the chrome does. The flip is the same rule the quote strip
	 * holds: above the selection, below it when there is no room above.
	 */
	/*
	 * THE FLIP IS ASKED ABOUT THE SCROLLER, NOT THE CONTENT COLUMN (code review
	 * round 1, C6). The strip's `top` is expressed against the content column,
	 * but "is there room above" is a question about what is currently visible:
	 * once the column is scrolled, its top is far above the pane and the
	 * comparison is always true. The scroll viewport is the box that answers it;
	 * the content column is still the coordinate origin for `top`.
	 */
	const placed = placeSharedStrip({
		selection: {
			top: selection.rect.top,
			bottom: selection.rect.bottom,
			left: selection.rect.left,
		},
		container: { top: containerRect.top, left: containerRect.left },
		scrollerTop:
			scrollableContainerRef?.current?.getBoundingClientRect().top ??
			containerRect.top,
	});
	const style = {
		top: placed.top,
		left: placed.left,
		transform:
			placed.placement === "above"
				? "translateY(calc(-100% - 8px))"
				: "translateY(8px)",
	};

	return (
		<FloatingToolbar
			{...{ "data-lo-selection-toolbar": "" }}
			label={t("ui.chat.transcript_copy.selection.toolbar")}
			className="absolute z-20"
			style={style}
		>
			{showEdit && (
				<Tooltip
					content={t(
						"ui.common.actions.text_selection_controls.ask_for_an_edit",
					)}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t(
							"ui.common.actions.text_selection_controls.ask_for_an_edit",
						)}
						onClick={handleEdit}
					>
						<Sparkles aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{showSpeech && <SpeakButton control={speechControl} />}
			{showCopy && (
				<>
					<Tooltip
						content={t("ui.common.actions.text_selection_controls.copy")}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.common.actions.text_selection_controls.copy")}
							onClick={handleCopy}
						>
							<Copy aria-hidden="true" />
						</Button>
					</Tooltip>
					<Tooltip
						content={t(
							"ui.common.actions.text_selection_controls.copy_without_formatting",
						)}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t(
								"ui.common.actions.text_selection_controls.copy_without_formatting",
							)}
							onClick={handleCopyWithoutFormatting}
						>
							<ClipboardCopy aria-hidden="true" />
						</Button>
					</Tooltip>
				</>
			)}
			{showReply && (
				<Tooltip content={t("ui.common.actions.text_selection_controls.reply")}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.common.actions.text_selection_controls.reply")}
						onClick={handleReply}
					>
						<MessageSquareReply aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{showRefer && (
				<Tooltip
					content={t(
						"ui.common.actions.text_selection_controls.refer_to_this_from_file",
					)}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t(
							"ui.common.actions.text_selection_controls.refer_to_this_from_file",
						)}
						onClick={handleRefer}
					>
						<Reply aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
			{linkUrl && (
				<Tooltip
					content={t(
						"ui.common.actions.text_selection_controls.open_in_browser",
					)}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t(
							"ui.common.actions.text_selection_controls.open_in_browser",
						)}
						onClick={handleOpenInBrowser}
					>
						<ExternalLink aria-hidden="true" />
					</Button>
				</Tooltip>
			)}
		</FloatingToolbar>
	);
};
