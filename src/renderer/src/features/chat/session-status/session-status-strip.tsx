import { Spinner } from "@shared/components/common/spinner";
import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";
import type {
	CanonicalFrontendState,
	CanonicalModel,
} from "../../../../../shared/desktop-session-contract";
import { ContextWheel } from "./context-wheel";
import type { ContextReading } from "./session-context";
import { contextReading, contextTooltipLines } from "./session-context";
import { costTooltip, sessionCost } from "./session-cost";
import {
	bandReadings,
	effortState,
	modelIdentity,
	reconcileEffort,
} from "./session-model";

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
 * The readings sit INSIDE the composer's button row, between the working-directory
 * chip and the microphone — in the row's own free space, immediately left of the
 * controls whose session they describe. That row already carries attach, the
 * directory chip, the microphone and send, and this cluster is its smallest
 * element: `h-6 text-meta`, 12px glyphs against 32px (28px under 550px) buttons,
 * so they read as facts one step below the controls rather than as four more
 * buttons.
 *
 * WHICH LINE they occupy is a container query on `@container/chatcol`, not a
 * viewport breakpoint: above 750px of column (`CHAT_MEASURE`'s own threshold)
 * the cluster is inline and pushed right by its `ml-auto`; below it the cluster
 * takes the row's first line in full and the controls keep the second, which is
 * the shape these readings had when they had a row of their own. So the narrow
 * case continues rather than being replaced, and no reading needs a compact
 * spelling to survive it.
 *
 * The cluster wraps internally as well as the row: at the 220px column floor it
 * folds onto two lines of its own while the button line stays intact and no
 * reading leaves the composer box. Only the model name truncates, because it is
 * the one item with unbounded length and the one whose full value the tooltip
 * already carries — and it is floored, so a truncated name still names
 * something. Truncating a value reading (`≥$0.0…`, `52.5%/40…`) would be a false
 * or unverifiable claim, which § 8 forbids.
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
	/**
	 * A model the user just chose, not yet confirmed by the owner.
	 *
	 * Passed in, not read off `frontend`: the paint is the session handle's, and
	 * this component must not be the thing that decides what "confirmed" means
	 * (the handle drops the paint when an authoritative frame names the model).
	 * While it is set the model reading is drawn as PENDING — dim, with the
	 * spinner the dialog shows for the same state, because a colour step plus a
	 * hover-only tooltip is a cue the user has to have been taught (UX U3).
	 */
	pendingModel?: CanonicalModel | null;
	/**
	 * Whether this is a NEW conversation's draft — a pane with no session yet.
	 *
	 * TOLD, never inferred. `onCommand === undefined` already means a backend
	 * whose command surface is off, and the two states need different sentences
	 * for different reasons; one missing prop cannot carry two meanings (R22).
	 *
	 * A draft renders the identity the FIRST turn will use — from the same
	 * backend resolution a session gets (`sessions.preview`) — as three inert
	 * readings: model, effort where the spec carries a ladder, and an empty
	 * context ring. No spend: nothing has been sent, and both `$0.00` and `$—`
	 * would be claims (R19).
	 */
	draft?: boolean;
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

/**
 * The tooltip's closing line, which has to agree with the number above it.
 *
 * The chip reports what has been MEASURED so far; the breakdown it opens
 * estimates the NEXT request, so the two legitimately differ (3.1% against
 * 4.0% in the reported case) and naming both is worth a line (round 1, U7).
 *
 * But round 1 appended that line unconditionally, which made the two states
 * that have measured nothing contradict themselves in three lines: the
 * no-reading tooltip said "No reading yet" and then "Measured now", and the
 * estimate tooltip labelled its number an estimate and then called it a
 * measurement (round 2, D8). The distinction between measured and estimated is
 * the one this strip is built on - `context_spelling` refuses the
 * invented-window lie in words - so the closing line follows the reading
 * rather than overriding it.
 */
function contextBreakdownLine(
	status: ContextReading["status"],
	openable: boolean,
): string {
	// Nothing to open says so FIRST: the three lines below all name a control, and
	// naming one that cannot open is the D3 defect in the context reading.
	if (!openable) return COMMANDS_OFF;
	if (status === "measured")
		return "Measured now; click for the full breakdown, which estimates your next request";
	if (status === "estimate")
		return "Estimated now; click for the full breakdown, which estimates your next request";
	// Nothing has been counted, so there is no "now" to contrast with.
	return "Click for the full breakdown";
}

/**
 * What an inert reading says when the pane IS a live session but the backend
 * has no command surface.
 *
 * `onCommand === undefined` on a session means exactly this: there is no
 * dispatcher to send `/model`, `/effort` or `/context` through, so every
 * reading renders as a label. `backend-error.ts` names the same state for the
 * banner ("slash commands … are off"), and this sentence is deliberately about
 * the ability, not about the reason, because the reason is the server's.
 */
const COMMANDS_OFF =
	"Slash commands are off on this server, so this reading cannot be opened from here.";

/**
 * The model reading's closing line — the tooltip's second line and the tail of
 * its `aria-label` — chosen from what the reading can DO, never from its value.
 *
 * D3: the line was the constant "Click to choose a different model", so a chip
 * with nothing to click still advertised a control. There are two ways to have
 * nothing to click and they need different sentences: a draft, where the model
 * WILL be used and simply cannot be chosen yet, and a backend with commands
 * off. `dispatch` is the affordance — present only when the chip can open.
 */
function modelReason(
	draft: boolean,
	dispatch?: (line: string) => void,
): string {
	if (dispatch) return "Click to choose a different model";
	if (draft)
		return "The first message will use it. Change it once the conversation starts.";
	return COMMANDS_OFF;
}

/**
 * The effort reading's trailing sentence, or `null` when the reading is whole
 * without one.
 *
 * `null` is the model whose SPEC says it has no ladder: there the level IS the
 * reading, and a closing sentence would imply an action that does not exist.
 */
function effortReason(
	draft: boolean,
	adjustable: boolean,
	dispatch?: (line: string) => void,
): string | null {
	if (draft) return DRAFT_EFFORT_LINE;
	if (!adjustable) return null;
	if (dispatch) return "Change it.";
	return COMMANDS_OFF;
}

/**
 * The draft's context reading, in both of its forms.
 *
 * One sentence, spelled twice because the two places read differently: the
 * tooltip leads with the word "Context" as a proportional heading (`mono =
 * false`, § 4) over a sentence, and the `aria-label` is one utterance. A draft
 * has no machine value to lead with, so the heading is a word.
 *
 * The sentence names the fact and the reason (R21). "No reading yet" would be
 * TRUE of a draft too and is deliberately NOT used: that is the resumed
 * session whose transcript carries no receipts, a state that fills in on its
 * own, where a draft's fills in because the user sends the first message.
 */
const DRAFT_CONTEXT_LINE =
	"Nothing measured yet. The window fills as the conversation runs.";
const DRAFT_CONTEXT_TOOLTIP = ["Context", DRAFT_CONTEXT_LINE];
// The same sentence as one utterance, which is why it starts lower-case.
const DRAFT_CONTEXT_LABEL =
	"Context: nothing measured yet. The window fills as the conversation runs.";

/**
 * The effort reading's sentence on a draft: the ladder is real, the choice is
 * not available yet.
 */
const DRAFT_EFFORT_LINE = "Set once the conversation starts.";

export const SessionStatusStrip: FC<SessionStatusStripProps> = ({
	frontend,
	onCommand,
	effortEntities,
	pendingModel = null,
	draft = false,
	className,
}) => {
	if (!frontend) return null;

	/*
	 * The dispatcher a reading may use, or `undefined` when nothing here opens.
	 *
	 * A draft has no session for a command to address — `slash-dispatch.ts`
	 * refuses every picker destination without one — and a backend with the
	 * command surface off supplies none at all. Both render as labels; the copy
	 * says which of the two it is, because the remedies differ.
	 */
	const dispatch = draft ? undefined : onCommand;

	// The EFFECTIVE spec is what is answering; see `session-model.ts` for why
	// this differs from the pickers, which read the selected one on purpose.
	// `selected_model` is the fallback for an owner that reports no effective
	// spec (nothing has run yet), which is the state a fresh session is in.
	//
	// The user's own unconfirmed paint OUTRANKS both: a pick that pays a cold
	// runtime bind takes 1.1-4.2 s, and the one thing the user asked is whether
	// their choice registered. The paint is not a claim that it landed — the
	// reading is drawn as pending and reverts the moment the owner's frame names
	// a model of its own (latency U1).
	const pending = pendingModel !== null;
	/*
	 * The identity reading and the effort reading come from different specs on
	 * purpose — see `bandReadings` for why the paint must not outrank the effort
	 * chip (reviewer round 1, major 1: `effortState` answers `null` for a row's
	 * spec, so the chip vanished for the whole 1.1-4.2 s pending window).
	 */
	const readings = bandReadings(frontend, pendingModel);
	const model = readings.identity;
	const identity = modelIdentity(model);
	const effort = reconcileEffort(effortState(readings.effort), effortEntities);
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
				/*
				 * Where the cluster sits in the composer's button row.
				 *
				 * The row is `flex-wrap`, so below 750px of COLUMN the cluster takes
				 * the row's first line in full (`order-first basis-full`) and the
				 * controls keep the second — the shape these readings had as a row of
				 * their own, which is what keeps the narrow case carrying every reading
				 * rather than a compacted spelling. A draft, a live session and a
				 * restored one all take this rule; only the contents vary (R15).
				 *
				 * 750 is `CHAT_MEASURE`'s own number, so the app has one "wide column"
				 * threshold rather than two that agree by accident, and it is keyed on
				 * `@container/chatcol` rather than the viewport: with the canvas open at
				 * a 1380px window the column is at its 220px floor while `md:` is still
				 * comfortably active (see `chat-measure.ts`).
				 *
				 * `ml-auto` here is the row's ONE live auto margin at this width; below
				 * 750 it is the right-hand group's (see the row in `message-input.tsx`).
				 * Two live auto margins would share the free space evenly and float
				 * this cluster mid-row, which is the layout `justify-between` produced.
				 */
				"order-first basis-full @min-[750px]/chatcol:order-none @min-[750px]/chatcol:basis-auto @min-[750px]/chatcol:ml-auto",
				className,
			)}
			data-lo-session-strip={true}
			// The QA/E2E hook for "this strip is a draft", so a frame or a probe can
			// ask the question without reading the copy (R22).
			data-lo-session-strip-draft={draft ? true : undefined}
		>
			{identity && (
				<Reading
					// Pending is a state of a chip that CAN open; `modelReason` answers
					// whether it can open at all (a draft, or a backend with commands
					// off). Both sentences are needed and they never apply at once: a
					// draft has no session to confirm a switch against.
					label={
						pending
							? `Model: ${identity.selector}. Switching; waiting for the session to confirm it.`
							: `Model: ${identity.selector}. ${modelReason(draft, dispatch)}`
					}
					tooltip={
						<TooltipLines
							lines={
								pending
									? [
											identity.selector,
											"Switching the model; waiting for the session to confirm it",
										]
									: [identity.selector, modelReason(draft, dispatch)]
							}
						/>
					}
					onOpen={dispatch ? () => dispatch("/model") : undefined}
					// The one item with unbounded length, so it is the one that
					// truncates. `min-w-0` is what lets the span inside it shrink at
					// all -- a flex item's automatic floor is its content.
					//
					// `min-w-14` (56px) is the floor: about eight monospace glyphs, so a
					// truncated name still names something rather than becoming an
					// ellipsis with no subject. It cannot force a wrap at 750px, where
					// the row's arithmetic leaves 56px of slack for exactly this item.
					//
					// `text-ink-dim` while pending: a colour step, never opacity (the
					// branding contract's rule for a control that is not yet live), so a
					// user can see that the value on screen is the one they chose and
					// not yet the one the session runs.
					className={cn(
						"min-w-14 max-w-full shrink",
						pending && "text-ink-dim",
					)}
				>
					<span className="truncate">{identity.name}</span>
					{/*
					 * The pending state's non-hover cue (UX U3).
					 *
					 * The colour step alone is seen only by a user who already knows to
					 * look for it, and the sentence that explains it lived in the tooltip —
					 * i.e. behind a hover. The dialog says the same thing with the same
					 * spinner while the same operation is in flight, so the band does too;
					 * the label is what carries it into the accessibility tree.
					 */}
					{pending && <Spinner size="xs" label="Switching the model" />}
				</Reading>
			)}
			{effort && (
				<Reading
					label={[
						`Reasoning effort: ${effort.label}.`,
						effortReason(draft, effort.adjustable, dispatch),
					]
						.filter(Boolean)
						.join(" ")}
					tooltip={
						<TooltipLines
							lines={[
								effort.label,
								...(draft ? [DRAFT_EFFORT_LINE] : [effort.detail]),
							]}
						/>
					}
					// A model with no ladder gets the label form, not a dead button.
					// Opening `/effort` there reaches a picker whose own empty text is
					// "Effort is not adjustable on this model" -- true, but a worse way
					// to learn it than never offering the control.
					onOpen={
						dispatch && effort.adjustable
							? () => dispatch("/effort")
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
					draft
						? DRAFT_CONTEXT_LABEL
						: reading.status === "no-reading"
							? `Context: no reading yet. ${contextBreakdownLine("no-reading", Boolean(dispatch))}`
							: `Context: ${reading.spelling}${
									reading.status === "estimate" ? ", estimated" : ""
								}. ${contextBreakdownLine(reading.status, Boolean(dispatch))}`
				}
				tooltip={
					<TooltipLines
						/*
						 * The no-reading tooltip leads with the word "Context", which is
						 * prose, not a machine value - § 4 forbids monospace there
						 * (round 1, D2). Every other context state leads with a number.
						 */
						mono={reading.status !== "no-reading"}
						lines={
							draft
								? DRAFT_CONTEXT_TOOLTIP
								: [
										...contextTooltipLines(
											reading,
											typeof model?.max_context_window === "number"
												? model.max_context_window
												: null,
										),
										contextBreakdownLine(reading.status, Boolean(dispatch)),
									]
						}
					/>
				}
				onOpen={dispatch ? () => dispatch("/context") : undefined}
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
