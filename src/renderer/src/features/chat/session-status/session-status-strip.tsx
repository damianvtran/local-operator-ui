import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { ContextWheel } from "./context-wheel";
import { contextReading, contextTooltipLines } from "./session-context";
import { costTooltip, sessionCost } from "./session-cost";
import { effortState, modelIdentity, reconcileEffort } from "./session-model";

/**
 * The session status strip: model, reasoning effort, context and spend.
 *
 * ## Why this exists
 *
 * The terminal's status band has carried these four readings since it shipped,
 * and the desktop app carried none of them — so a user who learned to check
 * "how full is the window, what has this cost" at a glance had to open
 * `/context` and do arithmetic to get the same answer here. The readings are
 * the same facts from the same canonical stream; only the instrument differs.
 *
 * ## Where the numbers come from
 *
 * Nowhere in this file. Every value is computed by one of three sibling
 * modules — `session-cost.ts`, `session-context.ts`, `session-model.ts` —
 * each a documented port of a specific Python symbol, each asserted by
 * `scripts/session-status.test.mjs`. This component chooses layout, roles and
 * wording and owns no arithmetic, which is what keeps a second accumulation
 * from appearing the next time a surface wants a total.
 *
 * ## Why the clicks go through slash dispatch
 *
 * Each control calls `onCommand("/model")`, `onCommand("/effort")`,
 * `onCommand("/context")` — the SAME string the user could type. The picker
 * is then reached by the one path that already exists (composer -> dispatch ->
 * owner command -> `native_action` -> `picker-registry`), so the chip cannot
 * drift from the command: there is no second way to open a picker, and a
 * change to how `/model` presents is automatically a change to what this chip
 * does. A chip that mounted `ModelPicker` directly would have been a shorter
 * path and a second one.
 *
 * ## No local state
 *
 * Every reading is derived from the canonical frontend snapshot on each
 * render, and a click changes nothing here: the owner applies the command and
 * the next projection repaint shows the truth. This matches the pickers, and
 * it is why a failed `/model` cannot leave the strip claiming a model the
 * session is not running.
 *
 * ## Layout
 *
 * A dedicated row above the composer's button row rather than four more
 * controls inside it. That row already carries attach, the working-directory
 * chip, the microphone and send, and at the 220px column floor (canvas open)
 * it is over budget before anything is added — the working-directory chip's
 * own shrink notes record it hanging 97px past the column edge. The readings
 * also belong together: they describe the SESSION, where the button row
 * describes the message being composed.
 *
 * The row wraps rather than truncating as a group. At 220px the model chip
 * takes the first line and the three small readings sit on the second, which
 * keeps every reading legible instead of shrinking all four toward
 * illegibility. Only the model name truncates, because it is the one item with
 * unbounded length and the one whose full value the tooltip already carries.
 */

export type SessionStatusStripProps = {
	/**
	 * The canonical snapshot. `null` while the stream is connecting, which
	 * renders nothing — an empty strip is honest about a session that has not
	 * reported yet, where a strip full of dashes would be four claims.
	 */
	frontend: CanonicalFrontendState | null | undefined;
	/**
	 * Run a slash command exactly as typing it would. Absent on a surface with
	 * no dispatcher (an older backend with commands disabled), which renders
	 * every reading as a plain label rather than a control that cannot succeed.
	 */
	onCommand?: (line: string) => void;
	/**
	 * The effort rungs `/effort` will accept, or `undefined` while unknown.
	 *
	 * Passed in rather than queried here so this component stays a pure
	 * projection of state it is handed — the same reason it holds no optimistic
	 * local state. See `reconcileEffort` for why the picker's list wins over the
	 * stream's on adjustability, and why pending is not the same as empty.
	 */
	effortEntities?: readonly unknown[];
	className?: string;
};

/**
 * One reading's box, shared by the button and the label forms so they differ
 * only where they are meant to.
 *
 * `h-6` and `text-meta`: this is metadata about the session, one step below
 * the composer's own controls, and § 4 reserves `meta` for exactly that. It is
 * deliberately smaller than the 28px control floor the icon ramp assumes,
 * which is why the glyphs here are 12px.
 *
 * No border and no fill at rest. § 5: "when a panel feels busy, the fix is
 * almost always removing a border or a background". Four bounded chips above
 * the composer's own bounded box is three boxes too many, so these read as
 * text until you reach for one.
 */
const READING_BOX =
	"inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-meta";

/**
 * The interactive form. Hover is a colour step and nothing else — no lift, no
 * scale (§ 5). `cursor-pointer` follows the working-directory chip's rule: a
 * control that opens a menu takes the pointer, an inert row does not.
 */
const READING_BUTTON = cn(
	READING_BOX,
	"cursor-pointer text-ink-muted transition-colors duration-fast ease-out-quart",
	"hover:bg-accent-wash hover:text-ink",
	// Focus is the base layer's `:focus-visible` outline. Offset pulled in to
	// 1px like the app's other dense controls, since a 2px ring at 2px offset
	// on a 24px control bleeds into its neighbours.
	"focus-visible:outline-offset-1!",
);

/** The inert form, for a reading with nothing to open. */
const READING_LABEL = cn(READING_BOX, "cursor-default text-ink-dim");

/**
 * One reading, as a button when it can be opened and a label when it cannot.
 *
 * The two forms are one component so a reading that loses its picker (a model
 * with no effort ladder, a backend with commands off) changes affordance
 * without changing place, weight or spacing.
 */
const Reading: FC<{
	tooltip: ReactNode;
	label: string;
	onOpen?: () => void;
	children: ReactNode;
	className?: string;
}> = ({ tooltip, label, onOpen, children, className }) =>
	onOpen ? (
		<Tooltip content={tooltip}>
			<button
				type="button"
				onClick={onOpen}
				aria-label={label}
				className={cn(READING_BUTTON, className)}
			>
				{children}
			</button>
		</Tooltip>
	) : (
		<Tooltip content={tooltip}>
			{/*
			 * A real `button` with `aria-disabled`, following the read-only
			 * working-directory chip rather than inventing a second idiom for the
			 * same situation (see `directory-indicator.tsx`'s read-only branch).
			 *
			 * `aria-disabled` rather than `disabled`: the element stays focusable,
			 * so a keyboard user can still reach the tooltip — which matters more
			 * here than on most controls, because the tooltip carries the WHOLE
			 * reading and the visible text is an abbreviation of it. The real
			 * attribute would take it out of the tab order and strand the
			 * explanation behind a pointer.
			 *
			 * No hover step, unlike the interactive form above: a dead control that
			 * lights up under the pointer advertises an interaction it does not
			 * have.
			 */}
			<button
				type="button"
				aria-disabled="true"
				aria-label={label}
				className={cn(READING_LABEL, className)}
			>
				{children}
			</button>
		</Tooltip>
	);

/** A tooltip body of several lines: the first at reading weight, rest as meta. */
/**
 * A tooltip's lines: the machine value on top, prose under it.
 *
 * `mono` is explicit per call rather than inferred from position. Round 1
 * monospaced the first line of every multi-line tooltip, which is right for
 * `3.4%/400k` and `>=$2.10` and wrong for the no-reading tooltip, whose first
 * line is the English word "Context" used as a heading - rendered in Geist Mono
 * it broke the branding contract's "monospace is machine voice, never prose"
 * and made the empty state look like a different component from the populated
 * one (round 1, D2). Position is not a reliable proxy for voice, so the caller
 * says which it is.
 */
const TooltipLines: FC<{ lines: string[]; mono?: boolean }> = ({
	lines,
	mono = true,
}) => (
	<span className="flex flex-col gap-0.5">
		{lines.map((line, index) => (
			<span
				key={line}
				className={cn(
					index === 0 ? "text-ink" : "text-ink-muted",
					// The leading line is the machine value where there is one; the
					// explanations under it are prose and stay proportional.
					mono && index === 0 && lines.length > 1 && "font-mono text-mono-sm",
				)}
			>
				{line}
			</span>
		))}
	</span>
);

export const SessionStatusStrip: FC<SessionStatusStripProps> = ({
	frontend,
	onCommand,
	effortEntities,
	className,
}) => {
	if (!frontend) return null;

	// The EFFECTIVE spec is what is answering; see `session-model.ts` for why
	// this differs from the pickers, which read the selected one on purpose.
	// `selected_model` is the fallback for an owner that reports no effective
	// spec (nothing has run yet), which is the state a fresh session is in.
	const model = frontend.effective_model ?? frontend.selected_model;
	// The catalogue is the backend's own curated naming pass (see
	// `modelIdentity`), and it is on the wire even on a cold snapshot where the
	// spec's `display_name` is still empty.
	const identity = modelIdentity(model, frontend.model_catalogue);
	const effort = reconcileEffort(effortState(model), effortEntities);
	const reading = contextReading({
		context_tokens: frontend.context_tokens,
		context_window: frontend.context_window,
		context_is_estimate: frontend.context_is_estimate,
	});
	const cost = sessionCost(frontend, frontend.last_usage);

	// Nothing known at all: a session that has connected but reported no model,
	// no reading and no spend. An empty row is better than a row of dashes.
	if (!identity && !effort && reading.status === "no-reading" && !cost.text)
		return null;

	return (
		<div
			className={cn(
				// `-mx-1.5` cancels the readings' own inner padding so the strip's
				// text aligns with the composer's text rather than sitting 6px in.
				// The padding has to be on the readings themselves, because it is
				// what gives their hover fill a body to be.
				"-mx-1.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5",
				className,
			)}
			data-lo-session-strip={true}
		>
			{identity && (
				<Reading
					label={`Model: ${identity.selector}. Choose a different model.`}
					tooltip={
						<TooltipLines
							lines={[identity.selector, "Click to choose a different model"]}
						/>
					}
					onOpen={onCommand ? () => onCommand("/model") : undefined}
					// The one item with unbounded length, so it is the one that
					// truncates. `min-w-0` is what lets the span inside it shrink at
					// all -- a flex item's automatic floor is its content.
					className="max-w-full shrink"
				>
					<span className="truncate">{identity.name}</span>
				</Reading>
			)}
			{effort && (
				<Reading
					label={
						effort.adjustable
							? `Reasoning effort: ${effort.label}. Change it.`
							: `Reasoning effort: ${effort.label}.`
					}
					tooltip={<TooltipLines lines={[effort.label, effort.detail]} />}
					// A model with no ladder gets the label form, not a dead button.
					// Opening `/effort` there reaches a picker whose own empty text is
					// "Effort is not adjustable on this model" -- true, but a worse way
					// to learn it than never offering the control.
					onOpen={
						onCommand && effort.adjustable
							? () => onCommand("/effort")
							: undefined
					}
				>
					{/*
					 * The level is a machine-reported value, not prose, so it is
					 * monospace like every other value in this row.
					 */}
					<span className="font-mono text-mono-sm">{effort.label}</span>
				</Reading>
			)}
			<Reading
				label={
					reading.status === "no-reading"
						? "Context: no reading yet. Open the context breakdown."
						: `Context: ${reading.spelling}${
								reading.status === "estimate" ? ", estimated" : ""
							}. Open the context breakdown.`
				}
				tooltip={
					<TooltipLines
						/*
						 * The no-reading tooltip leads with the word "Context", which is
						 * prose, not a machine value - § 4 forbids monospace there
						 * (round 1, D2). Every other context state leads with a number.
						 */
						mono={reading.status !== "no-reading"}
						lines={[
							...contextTooltipLines(
								reading,
								typeof model?.max_context_window === "number"
									? model.max_context_window
									: null,
							),
							/*
							 * Names both numbers before the user meets the second one.
							 * This reading is what has been MEASURED so far; the
							 * breakdown behind it estimates the NEXT request, so the
							 * two legitimately differ (3.1% here, 4.0% there). The
							 * duality is inherited from the Python `/context` and is
							 * not new — but the chip makes it the primary way users
							 * reach that view, so the pairing is now seen far more
							 * often (UX round 1, U7).
							 */
							"Measured now; click for the full breakdown, which estimates your next request",
						]}
					/>
				}
				onOpen={onCommand ? () => onCommand("/context") : undefined}
			>
				<ContextWheel reading={reading} />
				{/*
				 * The wheel alone at `no-reading` is a track with no number, which
				 * reads as "nothing to say" without claiming a figure. Once there is
				 * a reading the percentage sits beside it, because a ring 14px across
				 * can be compared but not read.
				 */}
				{reading.spelling && (
					<span className="font-mono text-mono-sm">
						{reading.spelling}
						{/*
						 * The estimate marker is a WORD, not a glyph or a dimmed
						 * colour. § 8: every claim checkable, no adjective doing a
						 * verb's job -- and a tilde or a lighter ink is a hint the user
						 * has to have been taught. This is the one place the row spends
						 * a word instead of a symbol, and it spends it on the
						 * distinction between a measurement and a guess.
						 */}
						{reading.status === "estimate" && (
							<span className="ml-1 text-ink-dim">estimate</span>
						)}
					</span>
				)}
			</Reading>
			{cost.text && (
				<Reading
					label={costTooltip(cost)}
					tooltip={<TooltipLines lines={[cost.text, costTooltip(cost)]} />}
				>
					{/* A cost has no picker of its own: `/usage` is a different
					    question (this account's billing) and opening it from a session
					    figure would answer something the user did not ask. */}
					<span className="font-mono text-mono-sm">{cost.text}</span>
				</Reading>
			)}
		</div>
	);
};
