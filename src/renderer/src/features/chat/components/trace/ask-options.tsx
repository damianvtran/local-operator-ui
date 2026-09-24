/**
 * The pending `ask` gate's options, as controls the user can actually press.
 *
 * ## Why this exists
 *
 * The options used to render as an inert `<ul>` of muted text under the
 * question callout, numbered `1.`, `2.`, `3.`. Nothing was clickable, so the
 * only way to answer was to retype a label into the composer — and the
 * numerals invited the one answer the agent could not use, because typing `1`
 * sent the literal string "1" rather than the first option. A list that
 * enumerates choices and then refuses to accept one is a dead affordance
 * wearing a live one's clothes.
 *
 * The parity target is the terminal's ask picker
 * (`local_operator/tui/widgets/ask_picker.py`), which is the backend repo's
 * own answer to this: one question, options selectable by keyboard and mouse,
 * and — the part that matters for the wire — **it answers with TEXT, not an
 * index**. Its module docstring states the rule directly: "It answers with
 * TEXT, not an index", because the free-text row hands back a string that was
 * never in `options` and an index cannot express that. So these buttons submit
 * `option.label`, and the composer remains a first-class way to answer.
 *
 * ## Why the options are NOT inside the accent wash
 *
 * The obvious layout puts the buttons inside the `AgentQuestion` callout, so
 * the gate is literally one bordered card. Measured against the twelve
 * palettes, that layout cannot be built out of the roles we have:
 *
 * - A control's edge must clear 3:1 against the ground behind it (branding
 *   § 3, enforced by `CONTROLS` in `scripts/contrast-contract.mjs`). On
 *   `accent-wash`, `border-control` measures **2.89:1 on iceberg** — under the
 *   floor, so a standard control border inside the wash is not legal.
 * - The one border role that does clear it there is `accent` (4.73:1 at worst,
 *   sage). Spending it here is what the TUI deliberately refused: its
 *   `RECOMMENDED_TAG` comment records that the accent is already spent on this
 *   card for "what ENTER will take", and a second accent meaning on the same
 *   frame makes the accent say two things at once. Eight accent-bordered
 *   buttons would also blow § 2's budget of about three accent spends a screen.
 *
 * So the callout keeps the accent and owns the question, and the options sit
 * directly beneath it on the transcript's own ground with the standard control
 * triple (`surface` fill, `border-control` edge, `ink` label) — the same
 * triple the `secondary` button variant uses. They are one unit with the
 * callout by proximity and a shared left rail, which is what "one card" buys
 * the reader; they are not one element, because the contrast contract says
 * that element cannot exist in any theme.
 *
 * ## The docked form (chat redesign §F1)
 *
 * The card no longer sits in the transcript: `QuestionDock` draws it above the
 * composer, on the pane's own ground, with the accent spent on the dock's border
 * alone. So the options drop their own `border-control` edge and become full-width
 * ROWS - a keycap in `ink-dim`, the label in `ink`, a ground step under the
 * pointer and on the roving selection - which is the list-row idiom this app
 * already has, stepped to `sunken` because the card is `elevated` (the browser tab
 * strip's measured hover step), not a fourth way to draw a control. The row's
 * boundary is its focus outline and its hover ground; it is inside a bordered
 * card, so it needs no edge of its own to read as one of a set.
 *
 * KEYS, and why they live on the fieldset rather than on each button. `Up`/`Down`
 * move a ROVING selection (focus moves with it, so the browser's own outline is the
 * selection mark and a screen reader follows it), `1`-`9` answer directly, and
 * `Enter` answers the focused row by the button's native activation. The mapping is
 * `askOptionKeyIntent` - a pure function, so the suite can assert every key without
 * a DOM - and the component only applies what it returns. `Escape` is NOT handled
 * here: it belongs to the dock, which collapses the card to a pill.
 *
 * ## Why this is not the shared `Button`
 *
 * `Button` is `inline-flex`, `whitespace-nowrap` and fixed-height by size. An
 * option carries a label AND its consequence line, both of which wrap, so it
 * needs a left-aligned block that grows. The colour rules are copied from the
 * `secondary` variant rather than re-invented, so the two stay in step:
 * `hover:bg-elevated` (hover is a colour step; nothing lifts or scales),
 * `disabled:` changes colour and never opacity, and focus is the global
 * `:focus-visible` outline from `styles/index.css` rather than a local ring.
 */

import { cn } from "@shared/lib/utils";
import type { KeyboardEvent } from "react";
import type { PendingDesktopGate } from "../../../../../../shared/desktop-session-contract";

export type AskOptionsProps = {
	/** The gate's options, in the order the wire carried them. */
	options: PendingDesktopGate["options"];
	/**
	 * Index of the recommended option, into `options` as carried.
	 *
	 * Marked, never pre-selected: this card is a set of actions, not a form
	 * with a default, and a pre-selected control implies an Enter that submits
	 * something the user never chose. The harness has already rotated the
	 * recommended option to index 0, so this is normally 0 when present.
	 */
	recommended?: number | null;
	/**
	 * An answer is in flight, or this gate's answer has already been sent.
	 * Disables every option so a second click — or a click racing a typed send —
	 * cannot post a second answer for one question.
	 *
	 * "Already been sent" is the second half of that, and it is not the same
	 * moment: `pending_gate` is only cleared by the next stream frame, so between
	 * the owner accepting an answer and that frame arriving the card would come
	 * back live against a gate that is already answered, and a second press would
	 * post a second answer for a one-shot question (code review round 1, R-MINOR).
	 */
	busy?: boolean;
	/** Submit this option's label as the answer. */
	onAnswer: (label: string) => void;
	/** Stable prefix for option keys, so two gates never share a key. */
	requestId: string;
};

/**
 * What one key press on the options means, or `null` when it is not the card's.
 *
 * Pure so every key is assertable without a DOM (`scripts/ask-options.test.mjs`).
 * `focused` is the index of the option holding focus, or -1 when focus is on the
 * fieldset itself. Modified chords are never the card's: `Cmd+1` and friends
 * belong to the app. Digits past the option count, and every key while an answer
 * is in flight, fall through so the browser keeps their native meaning.
 */
export type AskOptionKeyIntent =
	| { kind: "move"; index: number }
	| { kind: "answer"; index: number };

export const askOptionKeyIntent = (
	event: Pick<
		KeyboardEvent,
		"key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
	>,
	focused: number,
	count: number,
	busy: boolean,
): AskOptionKeyIntent | null => {
	if (busy || count === 0) return null;
	if (event.altKey || event.ctrlKey || event.metaKey) return null;
	if (event.key === "ArrowDown" && !event.shiftKey)
		return { kind: "move", index: focused < 0 ? 0 : (focused + 1) % count };
	if (event.key === "ArrowUp" && !event.shiftKey)
		return {
			kind: "move",
			index: focused <= 0 ? count - 1 : focused - 1,
		};
	if (/^[1-9]$/.test(event.key)) {
		const index = Number(event.key) - 1;
		return index < count ? { kind: "answer", index } : null;
	}
	return null;
};

export const AskOptions = ({
	options,
	recommended,
	busy = false,
	onAnswer,
	requestId,
}: AskOptionsProps) => {
	if (options.length === 0) return null;

	// A `secret` ask arrives with EMPTY options and is answered by the
	// composer's masked input, so the guard above is also what keeps this
	// component out of the credential path entirely.
	const marked =
		typeof recommended === "number" &&
		Number.isInteger(recommended) &&
		recommended >= 0 &&
		recommended < options.length
			? recommended
			: null;

	return (
		/*
		 * A `fieldset`, not a `div role="group"`: it IS the semantic element for a
		 * labelled group of controls, so the grouping survives without an ARIA
		 * role restating what the markup already says.
		 *
		 * The browser's default `fieldset` box is reset (`min-w-0` in particular,
		 * which a fieldset sets to `min-content` and which would stop the long
		 * labels below from wrapping inside a flex column).
		 *
		 * ## Why the band has a ceiling, and why it scrolls inside itself
		 *
		 * Eight options put the question out of the pane. Measured at the app's own
		 * default window (1380x900, a ~617px pane): the gate's ink ran 664.6px from
		 * the callout's top to the last row, so with the transcript pinned to its
		 * newest content the callout, the eyebrow and the whole first row sat above
		 * the top edge — the question the options are answers to, gone, which is the
		 * one thing § 7's first tier cannot do (design round 1, D1). The parity
		 * target caps its own option list and keeps the question pinned for exactly
		 * this reason.
		 *
		 * 380px is six two-line rows: past that the band stops growing and scrolls
		 * itself, so the callout above it and the hint below it stay on screen at the
		 * app's default window and at every size above it (measured on the live surface
		 * and on the eight-option story: panes 620 and 617 put the callout at 79.4 and
		 * 76.4 with the hint at 541.2 and 538.2, both fully visible). The scope is
		 * stated rather than implied because an earlier version of this comment claimed
		 * "every window size the app allows", and at the 800x600 floor it does not: the
		 * pane is 317px there and the callout still sits at -223.56, above the pane
		 * entirely (design round 2, D11). No band cap can fix that — at 317 the scroller
		 * is 269px against a gate of roughly 475 — the fix is pinning the pane to a
		 * pending gate, which is a transcript-scroller change and is tracked as a
		 * follow-up rather than smuggled into this one. The padding is not decorative
		 * either —
		 * a `2px` focus ring at `offset 2px` is clipped by an overflow container, so
		 * the top and bottom rows need 4px of room inside it. The `mt-1` above
		 * compensates so the callout→first-row distance the design round approved
		 * stays 8px (`mt-1` 4px + `py-1` 4px).
		 */
		<fieldset
			aria-label="Answer options"
			className="flex min-w-0 max-h-[380px] flex-col gap-0.5 overflow-y-auto border-0 p-1"
			onKeyDown={(event) => {
				const buttons = Array.from(
					event.currentTarget.querySelectorAll<HTMLButtonElement>(
						"button[data-ask-option]",
					),
				);
				const intent = askOptionKeyIntent(
					event,
					buttons.indexOf(event.target as HTMLButtonElement),
					options.length,
					busy,
				);
				if (intent === null) return;
				event.preventDefault();
				if (intent.kind === "move") buttons[intent.index]?.focus();
				else onAnswer(options[intent.index].label);
			}}
		>
			{options.map((option, index) => (
				<button
					key={`${requestId}-${String(index)}`}
					type="button"
					data-ask-option=""
					disabled={busy}
					onClick={() => onAnswer(option.label)}
					className={cn(
						// A full-width 34px row at radius 6 (§F1). `items-baseline` keeps
						// the keycap on the label's first line when the label wraps.
						"flex min-h-[34px] w-full items-baseline gap-3 rounded-sm px-2 py-2 text-left",
						// Colour-only transition: hover is a colour step, and nothing on
						// this card lifts, scales or translates.
						"transition-colors duration-fast ease-out-quart",
						// The roving selection IS focus, so the selected row takes the same
						// ground as the hovered one: the eye reads one "this row" state.
						// `sunken`, not `row-hover`: on the card's `elevated` ground
						// `row-hover` is ΔE00 0.00 in some palettes, and `elevated` ->
						// `sunken` is the measured step (`question dock option row hover
						// fill` in scripts/contrast-contract.mjs).
						"hover:bg-sunken focus-visible:bg-sunken",
						// Disabled changes colour, never opacity.
						"disabled:bg-transparent disabled:text-ink-disabled",
					)}
				>
					{/*
					 * The ordinal is decoration, and `aria-hidden` is what keeps it
					 * that way: without it the accessible name reads "1. Popup is
					 * open" and a reader has to parse a number that means nothing to
					 * the agent. It is kept visible because it is the shortcut the
					 * terminal card teaches (digits 1-9 jump to an option) and
					 * because a numbered list is how the model wrote the question —
					 * and typing that numeral now resolves to this label rather than
					 * sending "1", so the numeral is no longer a lie.
					 *
					 * Which is exactly why it stops at nine. `resolveNumericAnswer`
					 * accepts 1-9, and the terminal's shortcut has no tenth rung
					 * either, so a `10.` here would be a key that cannot be pressed —
					 * the same class of lie as the numeral that used to reach the
					 * wire verbatim. Rows past nine lose the ordinal column and stay
					 * pressable, which is the honest drawing of what they are (UX
					 * round 2, U11).
					 */}
					{index >= 9 && <span aria-hidden={true} className="w-4 shrink-0" />}
					{index < 9 && (
						<span
							aria-hidden={true}
							className={cn(
								// The keycap column: a fixed width so every label starts on one
								// edge, `ink-dim` because it is a hint rather than content.
								"w-4 shrink-0 text-center font-mono text-mono-sm",
								busy ? "text-ink-disabled" : "text-ink-dim",
							)}
						>
							{index + 1}
						</span>
					)}
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span
								className={cn(
									"min-w-0 text-body-sm",
									busy ? "text-ink-disabled" : "text-ink",
								)}
							>
								{option.label}
							</span>
							{marked === index && (
								/*
								 * Words, not a bare glyph or a colour difference. The TUI
								 * learned this one in a design round (D4): the marker was a
								 * muted style identical to the prose around it, and the
								 * designer could not find it in the rendered frame without
								 * searching.
								 *
								 * `ink` at `font-medium`, NOT the accent and NOT uppercase. The
								 * caps were borrowed from a surface that has no hue to work with
								 * (`ask_picker.py` draws its badge at `fg` + bold because hue is
								 * not available there); on this side the accent is already spent
								 * on the callout above, so a second accent spend here makes the
								 * accent say two things on one frame and takes the screen's
								 * budget past § 2's three (design round 1, D2, measured: the
								 * badge and the callout border were the same `rgb` in every
								 * palette). Dropping the caps also drops the renderer's only
								 * uppercase utility, which § 8 reserves for no register this
								 * app has.
								 */
								<span
									className={cn(
										// §F1: the word only, in `ink-dim`, no colour and no weight
										// - the accent is spent on the dock's border and nowhere
										// else on the card.
										"shrink-0 text-meta",
										busy ? "text-ink-disabled" : "text-ink-dim",
									)}
								>
									Recommended
								</span>
							)}
						</span>
						{/*
						 * The consequence line stays. Both the phone card and the
						 * terminal picker show it, and it is frequently the only thing
						 * that distinguishes two options whose labels are near
						 * synonyms — dropping it makes the user answer a thinner
						 * question than the model asked.
						 */}
						{option.description && (
							<span
								className={cn(
									"text-body-sm",
									busy ? "text-ink-disabled" : "text-ink-muted",
								)}
							>
								{option.description}
							</span>
						)}
					</span>
				</button>
			))}
		</fieldset>
	);
};
