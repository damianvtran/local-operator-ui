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
 * triple (`surface` fill, `border-control` edge, `ink` label) — the same triple
 * the `secondary` button variant uses. They are one unit with the callout by
 * proximity and a shared left rail, which is what "one card" buys the reader;
 * they are not one element, because the contrast contract says that element
 * cannot exist in all twelve themes.
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
	 * An answer is in flight. Disables every option so a second click — or a
	 * click racing a typed send — cannot post a second answer for one question.
	 */
	busy?: boolean;
	/** Submit this option's label as the answer. */
	onAnswer: (label: string) => void;
	/** Stable prefix for option keys, so two gates never share a key. */
	requestId: string;
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
		 */
		<fieldset
			aria-label="Answer options"
			className="mt-2 flex min-w-0 flex-col gap-1 border-0 p-0"
		>
			{options.map((option, index) => (
				<button
					key={`${requestId}-${String(index)}`}
					type="button"
					disabled={busy}
					onClick={() => onAnswer(option.label)}
					className={cn(
						"flex w-full items-baseline gap-2 rounded-sm border px-3 py-2 text-left",
						// Colour-only transition: hover is a colour step, and nothing on
						// this card lifts, scales or translates.
						"transition-colors duration-fast ease-out-quart",
						"border-control bg-surface hover:bg-elevated active:bg-sunken",
						// Disabled changes colour, never opacity. An opacity fade would
						// also fade the ground under it, so the same disabled option
						// lands on a different colour in the wash than on the canvas.
						"disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
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
					 */}
					<span
						aria-hidden={true}
						className={cn(
							"shrink-0 font-mono text-mono-sm",
							busy ? "text-ink-disabled" : "text-ink-dim",
						)}
					>
						{index + 1}.
					</span>
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
								 * searching. It is `text-meta` on the same ground rather
								 * than a filled badge, so it marks the row without becoming
								 * a second control beside the one it describes.
								 */
								<span
									className={cn(
										"shrink-0 font-medium text-meta uppercase",
										busy ? "text-ink-disabled" : "text-accent",
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
