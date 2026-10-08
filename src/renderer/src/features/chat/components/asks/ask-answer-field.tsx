/**
 * The multi-line field an ask is answered in when the answer is the user's own words:
 * the `Other` answer of an option question, and the only control of a question that
 * offers no options.
 *
 * ## Why this exists, and why it is not the composer
 *
 * The operator retired the main composer as an answer box (design 5.0's R7, reversed
 * on 2026-10-07: nobody could tell that typing there was how an "other" answer was
 * given) and asked for an explicit `Other` answer inside the card instead. The end
 * state he named is the shared composer's field - multi-line, paste, attachments,
 * dictation. THIS FIELD IS TEXT-ONLY, and says so, because no RELEASED runtime accepts
 * an attachment on an ask answer (`answers` is `Record<string, string[]>`; core's
 * `images` key on the answer body, core #2058, is merged to core's main but unreleased
 * as of v0.68.7, and is gated on the owner capability `features.ask_attachments`,
 * which this renderer does not read yet). Attachments follow in a later change that
 * reads that capability, and this component is the seam it extends: the leaves it will
 * compose (the attachment strip, the image-paste branch, the encode/bound helpers)
 * already exist in `shared/components/composer/`.
 *
 * It is a textarea of its own and NOT a mount of `MessageInput`, for reasons that are
 * about co-mounting a second composer inside the chat page rather than about taste:
 * the composer is a page singleton (`aria-label="Message"` is read through
 * `COMPOSER_TEXTAREA_SELECTOR` by the focus restore, the Escape ladder and
 * `pressIsOurs`, so a second match is DOM-order luck), it autofocuses on mount (the
 * one thing this change must never do), and its draft store persists to localStorage.
 * The chrome is the shared `Textarea` primitive with this card's own box tokens, so
 * the field reads as a sibling of the card's masked secret input.
 *
 * ## No control may take what it then drops
 *
 * The composer accepts a pasted image or a dropped file as an attachment. This field
 * cannot, and the failure to avoid is the quiet one: a screenshot pasted into a box
 * that shows nothing happened, or a file dropped on a page that discards it. So a
 * paste that carries a file and no text is REFUSED IN WORDS (an announced sentence
 * under the field, never a silent no-op), and a file dragged over it is answered with
 * the pointer's own "no drop". Text pastes and text drags are left entirely to the
 * browser. A paste that carries a picture AND text (a spreadsheet range puts an image
 * of the cells beside the text) is treated as the text paste it is: refusing it would
 * make the text un-pasteable, and the user's intent was the text.
 *
 * ## Keys
 *
 * Enter follows the shared composer's convention - it commits, Shift+Enter is a
 * newline - with an IME's composition Enter left alone. Cmd/Ctrl/Alt+Enter commit too,
 * exactly as in the composer (which tests only `shiftKey`), so no chord is a trap. WHAT
 * "commit" means is the card's decision (`onEnter`): send the ask when it is complete,
 * otherwise move on to the next question that still needs an answer. Escape is not
 * handled here at all: it bubbles to the drawer, which collapses it, and the field
 * carries no `aria-label="Message"`, so the app's interrupt ladder (which exempts only
 * the composer) stands down for it.
 *
 * ## It never takes focus by itself
 *
 * Nothing here focuses anything. The card focuses the field only inside the handler of
 * the user's own press on the `Other` row, because the auto-open of the drawer can
 * mount this field over a restored draft and a field that grabbed focus on mount would
 * steal it from whatever the user was doing.
 */

import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import { type RefObject, useState } from "react";
import { ASK_ANSWER_MAX_CHARS } from "../../ask-queue";

/**
 * What the refusal says, in the order the app's voice asks for: what happened, what
 * it means, what to do. The chat is named because it is the one place a file CAN go
 * today - a chat message carries attachments and leaves the ask pending, and the agent
 * decides whether the message answers it.
 */
const ATTACHMENT_REFUSAL =
	"Files and images can't be attached to an answer yet. Type your answer here, or send the file in the chat.";

/**
 * Said when the field has reached the wire's cap on one answer. The browser stops
 * accepting characters at `maxLength` and a paste that does not fit is cut to what
 * does - which is the quiet truncation this field refuses elsewhere - so the limit is
 * stated the moment it is reached instead of surfacing as a failed Send.
 */
const LIMIT_NOTICE = `Answers stop at ${ASK_ANSWER_MAX_CHARS.toLocaleString("en-US")} characters; anything past that is not kept.`;

export type AskAnswerFieldProps = {
	value: string;
	onChange: (value: string) => void;
	/** Enter (no Shift, not mid-composition): the card decides what committing means. */
	onEnter: () => void;
	disabled: boolean;
	/** The accessible name. NEVER `Message`: that is the page composer's identity. */
	ariaLabel: string;
	placeholder: string;
	/** The question this field answers; it is the field's `data-ask-other` marker. */
	questionId: string;
	/** Owned by the card, which focuses the field on the user's own press. */
	fieldRef: RefObject<HTMLTextAreaElement>;
};

export const AskAnswerField = ({
	value,
	onChange,
	onEnter,
	disabled,
	ariaLabel,
	placeholder,
	questionId,
	fieldRef,
}: AskAnswerFieldProps) => {
	/*
	 * The refusal is local to the field and clears on the next edit: it describes the
	 * paste that just happened, and a sentence that outlived the user's next keystroke
	 * would be a stale claim about a box that has moved on.
	 */
	const [refusal, setRefusal] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-1">
			<Textarea
				ref={fieldRef}
				data-ask-other={questionId}
				value={value}
				disabled={disabled}
				aria-label={ariaLabel}
				placeholder={placeholder}
				autoComplete="off"
				maxLength={ASK_ANSWER_MAX_CHARS}
				onChange={(event) => {
					setRefusal(null);
					onChange(event.target.value);
				}}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || event.shiftKey) return;
					// An IME's Enter confirms a candidate; it is not the user's commit.
					if (event.nativeEvent.isComposing) return;
					event.preventDefault();
					/*
					 * A HELD KEY DOES NOT REPEAT THE COMMIT. Committing can move focus onto
					 * an option row, where the same Enter would activate it - a user who
					 * leans on the key would answer the NEXT question by accident.
					 */
					if (event.repeat) return;
					onEnter();
				}}
				onPaste={(event) => {
					const data = event.clipboardData;
					if (!data) return;
					const files = Array.from(data.files ?? []);
					const carriesFile =
						files.length > 0 ||
						Array.from(data.items ?? []).some((item) => item.kind === "file");
					if (!carriesFile) return;
					/*
					 * TEXT STILL PASTES. The only text a pure file paste carries is the
					 * file's own name (a file copied in the Finder pastes as its name), and
					 * that is the file, not words the user typed; any OTHER text means the
					 * picture is incidental to a text paste.
					 */
					const text = data.getData("text/plain");
					const names = files.map((file) => file.name);
					const justTheFiles =
						names.length > 0 &&
						text.split("\n").every((line) => names.includes(line.trim()));
					if (text.trim() !== "" && !justTheFiles) return;
					event.preventDefault();
					setRefusal(ATTACHMENT_REFUSAL);
				}}
				onDragOver={(event) => {
					/*
					 * `dragover` must be CANCELLED for the page not to navigate to the file,
					 * and `dropEffect: none` is what makes the pointer say it is refused
					 * (a cancelled dragover with any other effect would show the copy badge
					 * of a drop that then goes nowhere). Limited to FILE drags: cancelling
					 * every dragover would also stop the browser inserting dragged text.
					 */
					if (!event.dataTransfer?.types.includes("Files")) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = "none";
				}}
				onDrop={(event) => {
					// Normally unreachable (`dropEffect: none` stops the drop firing); the
					// belt to that brace, for any platform that delivers it anyway.
					if (!event.dataTransfer?.files?.length) return;
					event.preventDefault();
					setRefusal(ATTACHMENT_REFUSAL);
				}}
				/*
				 * Two lines to start, so it reads as a multi-line field, and it grows with
				 * the text up to `max-h-40` and scrolls past that. `field-sizing-content`
				 * is the browser sizing the box (Electron 44's Chromium has it); the
				 * composer measures `scrollHeight` in an effect instead, which sets the
				 * height to `auto` first - harmless in its fixed band, but inside this
				 * drawer's scroller that momentary collapse can move the scroll offset
				 * under the reader. Where the property is unsupported the box simply stays
				 * two lines and scrolls, which is a worse field and never a broken one.
				 *
				 * The box (`rounded-md`, `px-2 py-1.5`, `text-sm`) is the card's own input
				 * box, the one its masked secret field wears, so the two read as siblings.
				 */
				className={cn(
					"field-sizing-content max-h-40 min-h-14 rounded-md px-2 py-1.5 text-sm",
				)}
			/>
			{refusal === null && value.length < ASK_ANSWER_MAX_CHARS ? null : (
				<output className="block text-ink-muted text-xs">
					{refusal ?? LIMIT_NOTICE}
				</output>
			)}
		</div>
	);
};
