import {
	CHAT_COLUMN_CONTAINER,
	CHAT_MEASURE,
} from "@features/chat/chat-measure";
import { AttachmentsPreview } from "@features/chat/components/attachments-preview";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { useMessageInput } from "@shared/hooks/use-message-input";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { normalizePath } from "@shared/utils/path-utils";
import { ArrowUp, ImagePlus } from "lucide-react";
import type { FC, ReactNode } from "react";
import type {
	ClipboardEvent as ReactClipboardEvent,
	DragEvent as ReactDragEvent,
} from "react";
import { useCallback, useId, useLayoutEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { imageFiles } from "./team-bridge-attachments-model";

/**
 * Team Bridge's message composer: one bar, anchored to the foot of the pane.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `MessageInput` (operator report,
 * 2026-10-30). The page briefly mounted the shared agent composer, which is the
 * chat pane's assembly: a `p-4` card at the frame radius, with a status row and
 * a separate action row inside it. In a conversation pane that is a field with
 * room for a working-directory chip, a model picker and a dictation strip; in a
 * messaging pane it is a 110px card where a 46px bar belongs, and the two extra
 * rows are the dead space the reader sees above and below the box. Adopting it
 * did fix a real defect - the bespoke box could not grow, so the second line of
 * a draft was invisible - and this file keeps that fix and drops the component:
 * the growth belongs to the field (below), not to a foreign shell.
 *
 * WHAT THE SHAPE IS, and each part is an acceptance criterion rather than taste:
 *   - one line plus tight padding at rest (~46px), the placeholder at the left;
 *   - the field grows UPWARD as the draft wraps, to a cap, and then scrolls;
 *   - it shrinks back when the draft comes back to one line, so the pane never
 *     keeps the height a long draft once used;
 *   - the attach control and the send arrow live INSIDE the bar, right-aligned
 *     and centred on the first line, so there is no footer row to reserve;
 *   - slight rounding and a thin `border-control` edge rather than a card.
 *
 * THE TEXT AND THE SEND ARE `useMessageInput`'s, deliberately. That hook owns
 * the draft's one register and the two rules this composer must not restate: an
 * accepted send retires only the text it sent (so a sentence typed during the
 * request survives), and a refused send hands the payload back. Re-deriving
 * either here is how a host grows a second opinion of "what the box holds".
 */
const FIELD_LINE_PX = 20;
/**
 * The field's cap, in px, as a BORDER-BOX height.
 *
 * `CAPPED_BLOCK` (`features/chat/chat-measure.ts`) is this app's cap device: six
 * whole lines at `leading-5`, 120px, chosen so the boundary never lands inside a
 * line's glyphs. That value is a CONTENT height; this field also carries 8px of
 * vertical padding on each side, so the border-box cap is 120 + 16. Sizing the
 * box to a bare 120px would put the boundary through line six and reproduce the
 * exact defect that constant was introduced to remove.
 */
const FIELD_MAX_HEIGHT = 6 * FIELD_LINE_PX + 16;

/** A stable empty array: a selector that returns a fresh `[]` re-renders forever. */
const NO_ATTACHMENTS = [] as const;

const readFileAsDataUrl = (file: File): Promise<string | null> =>
	new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === "string"
				? resolve(reader.result)
				: resolve(null);
		reader.onerror = () => resolve(null);
		reader.readAsDataURL(file);
	});

export type TeamBridgeComposerProps = {
	/** The draft row this box owns; also the store key its chips live under. */
	conversationId: string;
	placeholder: string;
	/** The box refuses input: no destination, an archived pane, a held attempt. */
	disabled?: boolean;
	/** Nothing can leave right now (a send or a schedule in flight). */
	sendDisabled?: boolean;
	/** A send of this box is going out: the arrow becomes the spinner. */
	sending?: boolean;
	/** The hub takes images. Absent means the attach control is not offered. */
	canAttach?: boolean;
	/** Host chrome with no bar slot of its own (the schedule control). */
	trailing?: ReactNode;
	/**
	 * The line at the point of typing (UX round 1, U3 + U4). It states the chord
	 * while the box is idle and WHY the schedule control is refusing while a send
	 * is in flight - one slot, two facts, so the bar never grows a second row.
	 */
	hint?: string;
	/** Id of the sentence that says why the box refuses input, when one is up. */
	disabledReasonId?: string;
	onSendMessage: (
		content: string,
		attachments: string[],
	) => boolean | Promise<boolean>;
};

export const TeamBridgeComposer: FC<TeamBridgeComposerProps> = ({
	conversationId,
	placeholder,
	disabled = false,
	sending = false,
	sendDisabled = false,
	canAttach = false,
	trailing,
	hint,
	disabledReasonId,
	onSendMessage,
}) => {
	useI18nLocale();
	const fieldId = useId();
	const attachments = useConversationInputStore(
		(state) => state.inputByConversation[conversationId]?.attachments,
	);
	const removeAttachment = useConversationInputStore(
		(state) => state.removeAttachment,
	);
	const chips = attachments ?? NO_ATTACHMENTS;

	const {
		inputValue,
		setInputValue,
		handleKeyDown,
		handleSubmit,
		textareaRef,
		sendInFlight,
	} = useMessageInput({
		conversationId,
		// A pane with no transcript has no echo to retire its box on, so its
		// accepted send retires it (`transcriptless`, U1). The chips travel beside
		// the text because this host binds them into the request itself.
		transcriptless: true,
		onSubmit: (message) =>
			onSendMessage(
				message,
				(
					useConversationInputStore.getState().inputByConversation[
						conversationId
					]?.attachments ?? NO_ATTACHMENTS
				).map((entry) => entry.path),
			),
	});

	/*
	 * THE FIELD'S HEIGHT, ASKED OF ITS OWN CONTENT.
	 *
	 * A layout effect rather than an effect, so the growth is in the same frame
	 * as the keystroke that caused it: measuring after paint shows the old height
	 * for one frame, which reads as a lag on every line break. `height: auto`
	 * first because `scrollHeight` is the content height and a field still sized
	 * to its previous value reports the smaller of the two.
	 *
	 * `scrollHeight` includes the padding, and so does a border-box `height`, so
	 * the two are the same unit here. Past the cap the field keeps the cap and
	 * scrolls, which is the only way the bar stops growing without hiding text.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `inputValue` is a re-measure TRIGGER, not a value the body reads (the field is sized from its own ref); dropping it leaves the bar at its previous height after a restored draft or a paste.
	useLayoutEffect(() => {
		const field = textareaRef.current;
		if (!field) return;
		/*
		 * THE SCROLL POSITION SURVIVES THE MEASURE. `height: auto` collapses the
		 * scroll range, and a collapsed range takes `scrollTop` with it - so the
		 * measure alone put the field back at its FIRST line on every keystroke.
		 * Past the cap that is the line the author is not looking at: they keep
		 * typing into a box pinned five lines above the caret. Measured at the cap
		 * before this line existed, the first line was in view and the caret was
		 * not.
		 */
		const held = field.scrollTop;
		field.style.height = "auto";
		// `scrollHeight` is an integer and the laid-out text is not, so a bare
		// assignment can leave a sub-pixel overflow that clips the last line.
		const needed = Math.ceil(field.scrollHeight);
		field.style.height = `${Math.min(needed, FIELD_MAX_HEIGHT)}px`;
		field.style.overflowY = needed > FIELD_MAX_HEIGHT ? "auto" : "hidden";
		if (field.scrollTop !== held) field.scrollTop = held;
	}, [inputValue]);

	/*
	 * PASTE AND DROP, ON THE BAR RATHER THAN ON AN ANCESTOR.
	 *
	 * The rules are `attachmentPasteHandlers`' (team-bridge-attachments.tsx), which
	 * is what the bridge's own strip has always used: only IMAGES are taken, a paste
	 * that also carries text keeps its default because the reader is pasting prose,
	 * and `dragover` is prevented only when the drag actually carries files - a
	 * `preventDefault` on every dragover makes the whole pane a drop target and
	 * swallows text drags.
	 *
	 * They live here, not in that module, because that helper needs the staging
	 * HOOK's state while this bar stages local PATHS into the input store; sharing
	 * the shape and not the object is what keeps the two from being rewritten apart.
	 */
	const pasteHandlers = {
		onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => {
			const files = imageFiles(event.clipboardData);
			if (files.length === 0) return;
			if (!Array.from(event.clipboardData.types).includes("text/plain"))
				event.preventDefault();
			void addFiles(files);
		},
		onDragOver: (event: ReactDragEvent<HTMLElement>) => {
			if (Array.from(event.dataTransfer.types).includes("Files"))
				event.preventDefault();
		},
		onDrop: (event: ReactDragEvent<HTMLElement>) => {
			const files = imageFiles(event.dataTransfer);
			if (files.length === 0) return;
			event.preventDefault();
			void addFiles(files);
		},
	};

	const addFiles = useCallback(
		async (files: readonly File[]) => {
			/*
			 * THE BOX'S WRITABILITY IS THE GATE, NOT THE HUB'S CAPABILITY.
			 *
			 * `canAttach` is what offers the CONTROL - an affordance that cannot work
			 * is a dead end - but a picture that arrives by drop or paste is already
			 * the reader's, and refusing to stage it would leave them holding a file
			 * with nothing on screen to explain it. So it stages, and the SEND is
			 * where the capability is refused, in words (see the page's `submit`):
			 * pinned by `team-bridge-attachments.test.mjs`'s page R3-01, which stages
			 * a picture against a hub with no capability and expects exactly one chip
			 * plus the capability sentence.
			 */
			if (disabled) return;
			const store = useConversationInputStore.getState();
			for (const file of files) {
				/*
				 * THE DRAFT KEEPS PATHS, NOT BYTES. `conversation-input-store` is
				 * persisted to localStorage, so a data URL here would write a base64
				 * copy of every dropped image to disk; a path is a short string whose
				 * bytes are read only if the message is sent. A `File` with no path -
				 * one dragged out of another page - answers "" and there the data URL
				 * is all the renderer will ever have.
				 */
				const path = window.api?.getPathForFile?.(file) ?? "";
				if (path) {
					store.addAttachment(conversationId, {
						id: uuidv4(),
						path: normalizePath(path),
					});
					continue;
				}
				const dataUrl = await readFileAsDataUrl(file);
				if (dataUrl)
					store.addAttachment(conversationId, { id: uuidv4(), path: dataUrl });
			}
		},
		[conversationId, disabled],
	);

	const picker = useRef<HTMLInputElement>(null);
	const hasContent = inputValue.trim().length > 0 || chips.length > 0;
	const blocked = disabled;
	const showSpinner = sending || sendInFlight;

	return (
		<div className={cn(CHAT_COLUMN_CONTAINER, "flex w-full flex-col")}>
			<div className={cn(CHAT_MEASURE, "flex w-full flex-col gap-1.5")}>
				{chips.length > 0 && (
					// Chips are not part of the bar's one line (operator: an attachment
					// may legitimately change the height). They sit ABOVE it so the bar
					// itself stays a bar.
					<div className="max-h-[240px] shrink-0 overflow-y-auto">
						<AttachmentsPreview
							attachments={chips}
							onRemoveAttachment={(id) => removeAttachment(conversationId, id)}
							disabled={blocked}
						/>
					</div>
				)}
				{/*
				 * THE BAR. `items-center` is what keeps the controls centred on the
				 * line at rest and in the middle of the bar once it grows; the field
				 * below carries the padding that sets the rest height, so the bar's own
				 * vertical padding is the tight 4px rather than a card's 16px.
				 *
				 * THE RING IS DRAWN OUTSIDE THE BAR (`outline-2` at `outline-offset-2`)
				 * and promoted from the field with `:has`, so the box a user sees
				 * focused is the box they type into. Nothing that encloses this file's
				 * root may become a bounded scroller: that clips the ring's top edge,
				 * which is the defect `team-bridge-composer-ring.test.mjs` pins.
				 */}
				<div
					/* THE DROP TARGET IS THE BAR, not the field: a drag lands anywhere over
					   the box, including its border and its padding, and the strip's own
					   helper has always read it that way. */
					{...pasteHandlers}
					className={cn(
						"flex w-full items-center gap-1 rounded-md border border-control bg-elevated py-1 ps-1 pe-1 transition-colors duration-fast ease-out-quart",
						"has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-accent has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-solid",
					)}
				>
					<textarea
						ref={textareaRef}
						id={fieldId}
						rows={1}
						value={inputValue}
						disabled={blocked}
						aria-label={placeholder}
						aria-describedby={disabledReasonId}
						placeholder={placeholder}
						onChange={(event) => setInputValue(event.target.value)}
						onKeyDown={handleKeyDown}
						/*
						 * `resize-none` because the growth is the field's own (above), and
						 * the cap is `FIELD_MAX_HEIGHT` in the same place: a drag handle that
						 * could exceed it would be a second opinion of the bar's height.
						 */
						className="min-w-0 flex-1 resize-none bg-transparent py-2 ps-3 pe-1 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-dim disabled:cursor-not-allowed disabled:text-ink-dim"
					/>
					{/* THE CHORD, AT THE POINT OF TYPING (UX round 1, U3) and inside the bar,
					    so it reserves no row of its own. It never leaves the layout: `opacity`
					    carries "there is nothing to send yet" so the field cannot reflow when
					    a draft appears, and `hidden` below 560px of column is the one case
					    where the bar's width, not its height, is the scarce thing. */}
					<span
						className={cn(
							"hidden shrink-0 truncate text-meta-sm text-ink-dim transition-opacity duration-fast @min-[560px]/chatcol:block",
							hasContent ? "opacity-100" : "opacity-0",
						)}
						aria-hidden={!hasContent}
					>
						{hint ?? t("ui.teamBridge.composer.hint")}
					</span>{" "}
					{canAttach && (
						<>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.teamBridge.attachments.add")}
								title={t("ui.teamBridge.attachments.add")}
								disabled={blocked}
								onClick={() => picker.current?.click()}
							>
								<ImagePlus size={16} aria-hidden="true" />
							</Button>
							<input
								ref={picker}
								type="file"
								// A hint for the OS picker only; the bytes are sniffed regardless.
								accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
								multiple
								hidden
								tabIndex={-1}
								onChange={(event) => {
									void addFiles(Array.from(event.target.files ?? []));
									// Reset so picking the same file twice still fires a change.
									event.target.value = "";
								}}
							/>
						</>
					)}
					{trailing}
					<Button
						size="icon-sm"
						variant="primary"
						// The circular arrow the pane reads as a send, not the square the
						// chat composer's icon size gives.
						className="shrink-0 rounded-full"
						disabled={!hasContent || blocked || sendDisabled || showSpinner}
						aria-label={t("ui.teamBridge.composer.send")}
						onClick={() => void handleSubmit()}
					>
						{showSpinner ? <Spinner size="sm" /> : <ArrowUp size={16} />}
					</Button>
				</div>
			</div>
		</div>
	);
};
