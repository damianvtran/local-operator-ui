import { Spinner } from "@shared/components/common/spinner";
import { Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { type FC, type ReactNode, useEffect, useState } from "react";
import type {
	CanonicalFrontendState,
	CanonicalModel,
} from "../../../../../shared/desktop-session-contract";
import { ContextWheel } from "./context-wheel";
import type { ContextReading } from "./session-context";
import { contextReading, contextTooltipLines } from "./session-context";
import { costTooltip, sessionCost } from "./session-cost";
import {
	DURATION_EXPLANATION,
	DURATION_LABEL_EXPLANATION,
	durationReading,
	formatDuration,
} from "./session-duration";
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
	"inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-meta";

/**
 * The readings' control box, and the interactive form of it.
 *
 * Two paragraphs were stacked here and are merged because they are one argument:
 * the box's own rules, and the fact that a second chip species now shares it.
 * Read as two, a reader could take the first as still standing alone and the
 * second as an amendment to it (agent review, round 1, N1).
 *
 * Hover is a colour step and nothing else - no lift, no scale (§ 5).
 * `cursor-pointer` follows the working-directory chip's rule: a control that
 * opens a menu takes the pointer, an inert row does not. No border and no fill at
 * rest (§ 5.1): four bounded chips above the composer's own bounded box is three
 * boxes too many, so these read as text until you reach for one.
 *
 * EXPORTED because `docs/composer-status-tabs.md` § 5.1 fixes the composer's plan
 * count as "the readings' own control", and a restated class string is how two
 * chips over one box drift into two hover grounds and two focus offsets. The name
 * stays the readings' because that is where the box was authored; what is shared
 * is the box, not the readings.
 */
export const READING_BUTTON = cn(
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

/** The duration reading ticks at 1Hz because it shows whole seconds. */
const CLOCK_MS = 1000;

/**
 * Seconds of active time, banked plus the turn currently in flight, re-read
 * once a second while a turn is running.
 *
 * The shape is `tool-row.tsx`'s `useRunningElapsed`, for its reasons: seeded
 * SYNCHRONOUSLY so a session attached mid-turn shows true elapsed rather than
 * restarting at `0s`, and the interval exists only while something is actually
 * running, so an idle composer holds zero timers.
 *
 * Why the cell owns a clock at all, when this component holds no other local
 * state: the canonical stream does not repaint at 1 Hz — that is why the app
 * has a row clock in the first place — so a stream-only reading would FREEZE
 * during a quiet tool call, which is a lie about a running session. What is
 * local here is the clock, not the reading: `banked` only ever comes from the
 * snapshot and the open edge is re-derived from the canonical epoch on every
 * tick, so attaching mid-turn cannot double-count and nothing is optimistically
 * written.
 */
function useActiveSeconds(banked: number, startedAt: number | null): number {
	const read = () =>
		startedAt === null
			? banked
			: banked + Math.max(0, (Date.now() - startedAt) / 1000);
	const [seconds, setSeconds] = useState(read);
	useEffect(() => {
		if (startedAt === null) {
			setSeconds(banked);
			return;
		}
		const tick = () =>
			setSeconds(banked + Math.max(0, (Date.now() - startedAt) / 1000));
		tick();
		const timer = window.setInterval(tick, CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [banked, startedAt]);
	return seconds;
}

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
	/**
	 * A reading that has no action in ANY state, on any backend, in any session.
	 *
	 * The label form is still a `button` with `aria-disabled`, because a control
	 * that cannot be used right now is exactly that - it takes the pointer and it
	 * takes focus, and its tooltip explains why it cannot open. The spend reading
	 * is not that: it has no picker to lose, so calling it an unavailable button
	 * invents an action that never exists and a screen reader relays the spend
	 * figure as "button, dimmed" (UX round 1, U5). A focusable `span` says the
	 * same thing without the false affordance, and keeps the tooltip reachable
	 * from the keyboard, which is the property `aria-disabled` exists to protect
	 * here (§ 6).
	 */
	readout?: boolean;
	children: ReactNode;
	className?: string;
}> = ({ tooltip, label, onOpen, readout = false, children, className }) =>
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
	) : readout ? (
		<Tooltip content={tooltip}>
			<span
				/* The tab stop is deliberate: it keeps the tooltip reachable from the
				   keyboard (see the prop's own note). The rule's remedy - dropping it -
				   is what this reading had before: a `button` announced as an
				   unavailable action. */
				/* biome-ignore lint/a11y/noNoninteractiveTabindex: a focusable readout is the honest form for a reading that can never open */
				tabIndex={0}
				aria-label={label}
				className={cn(READING_LABEL, className)}
			>
				{children}
			</span>
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
 *
 * That test comes FIRST, before the draft's, because "Set once the conversation
 * starts" is itself a claim about a choice: on a spec with an empty (or
 * unreported) ladder the first turn will not be able to set one either, so the
 * sentence would be the D3 lie in a draft's clothes. Found by looking at the
 * draft frames: the no-ladder box was labelled "the effort reading is ABSENT"
 * and showed the reading with that sentence under it.
 */
function effortReason(
	draft: boolean,
	adjustable: boolean,
	dispatch?: (line: string) => void,
): string | null {
	if (!adjustable) return null;
	if (draft) return DRAFT_EFFORT_LINE;
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
	/*
	 * Active time: banked seconds plus the open turn, or `null` for a session
	 * that has done nothing. A draft needs no branch here — its
	 * `active_duration_s` is 0 and its `activity_started_at` null, which is the
	 * same input a freshly opened session gives, and both render no reading
	 * rather than a `0s` that claims a turn completed in under a second (D21).
	 */
	const duration = durationReading(
		frontend.active_duration_s,
		frontend.activity_started_at,
	);
	const activeSeconds = useActiveSeconds(
		duration?.banked ?? 0,
		duration?.startedAt ?? null,
	);

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
				 * `ml-auto` is NOT here, and that is the round-1 blocker fixed by construction.
				 * It used to be the row's ONE live auto margin at this width; but this
				 * cluster renders `null` in three ordinary states (no `frontend`, nothing
				 * known at all, and the error boundary's empty fallback), and in those
				 * states a row whose only auto margin lived here had NO live auto margin -
				 * so the controls sat flush against the working-directory chip, mid-row.
				 * The margin now belongs to the controls group, which is always rendered
				 * (`message-input.tsx`): the free space falls between this cluster and the
				 * controls, the cluster sits immediately after the chip, and the row's
				 * right-justification no longer depends on a sibling that can vanish
				 * (design round 1.5, D7). Two live auto margins would share the free space
				 * evenly and float this cluster mid-row, which is the layout
				 * `justify-between` produced.
				 *
				 * The DOM position is first (the row renders this before the left group)
				 * so that the wrapped order and the tab order agree; `order-2` above the
				 * threshold restores the visual order [attach][chip] [readings]
				 * [mic][send] without a second render tree (UX round 1, U4).
				 *
				 * `flex-nowrap` above the threshold is the other half of the yield order
				 * (design round 1.5, D9): the row already refuses to wrap, and a
				 * still-wrapping cluster would spend the name's 56px floor's worth of
				 * slack on a second internal line instead of letting the name truncate.
				 */
				"basis-full @min-[750px]/chatcol:order-2 @min-[750px]/chatcol:basis-auto @min-[750px]/chatcol:flex-nowrap",
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
						// `shrink` overrides READING_BOX's `shrink-0`: the value readings
						// hold their width (a clipped `≥$2.4` or `66.0%/40` is a false
						// number, and at 750 with a 139-character id they were shrinking
						// into each other), and this is the one item allowed to yield.
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
			{/*
			 * R19: a draft shows the effort reading only where the spec carries a
			 * ladder.
			 *
			 * The preview resolves without the account-metadata step a cold open runs
			 * (`desktop_sessions.py`, the `sessions.preview` route), so its spec
			 * arrives with an EMPTY ladder; `effortState` then takes its
			 * `metadataAbsent` branch and labels the chip `unknown` - a value-shaped
			 * word that branch scopes to a session with a live owner, whose escape
			 * hatch (`/effort <level>`) a session-less draft does not have. The first
			 * turn then publishes the resolved ladder and the reading becomes `auto`,
			 * moving the model chip and the ring beside it 21.6px as the turn starts
			 * (UX round 1, U1). Absence is this strip's own honest rule for "no level
			 * to show here", and it is why the check is on the DRAFT flag rather than
			 * on the label: the same empty ladder on a live session is a fact about
			 * the model and stays.
			 *
			 * `levelKnown`, not `adjustable` and not `knownLadder`. `adjustable` is
			 * wrong because the `unknown` branch is deliberately adjustable (a live
			 * session can open its picker and find out), so it would let the very
			 * state this rule exists to hide straight through. `knownLadder` is wrong
			 * in the other direction: a spec can carry an EXPLICIT level while this
			 * dump does not carry the rungs, and that level is known - dropping it
			 * would shed a fact the first turn then puts back, which is U1's shift
			 * wearing a different hat. What a draft must not print is a level-shaped
			 * word for a level nobody has: that is exactly `unknown`.
			 */}
			{effort && (!draft || effort.levelKnown) && (
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
								...(draft && effort.adjustable
									? [DRAFT_EFFORT_LINE]
									: [effort.detail]),
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
					// Never a control, in any state: `/usage` is a different question
					// (this account's billing), so there is no picker this reading could
					// ever open and nothing for a disabled button to be disabled FOR.
					// Announced as a button, it told a screen-reader user the spend
					// figure was an unavailable action (UX round 1, U5).
					readout
				>
					{/* A cost has no picker of its own: `/usage` is a different
					    question (this account's billing) and opening it from a session
					    figure would answer something the user did not ask. */}
					<span className="font-mono text-mono-sm">{cost.text}</span>
				</Reading>
			)}
			{/*
			 * Active processing time, LAST in the cluster and the first thing shed.
			 *
			 * Render order and shed order are different facts and the band keeps
			 * them apart: its right group ends `… context · cost · duration`, and
			 * its own drop ladder sheds duration first, because it is the one
			 * reading re-derivable from the transcript (`status_line.py`,
			 * `_DROP_LADDER[0]`). The strip copies both. Sitting outboard also
			 * means the one value that moves while the user watches grows into the
			 * row's free space rather than into another reading.
			 *
			 * The drop is a container-range query rather than a wrap, because a
			 * wrap above the threshold is what put the microphone and send on a
			 * second line — the defect this PR's own D1/D8 round fixed. `hidden`
			 * rather than `sr-only`: a shed reading does not exist, and the band
			 * renders it as absent rather than as something a screen reader still
			 * hears (the chip's icon-only form is the opposite case, and uses
			 * `sr-only` for that reason).
			 *
			 * MEASURED, not guessed: at a 750px box the row is 716 and the
			 * cluster's budget is 328 after the chip group (304), the controls
			 * (68) and the gaps (16). The five-reading cluster at the name's floor
			 * measures 320 in its plain state but 372 once the context reading
			 * carries the word `estimate` — 44px over, with the name already at
			 * its floor and nothing left to yield. The threshold is therefore the
			 * width at which the FULLEST state still fits, not the plainest:
			 * measured at 900 in both themes the five readings need 424px of the
			 * 494px available, and the state that sets it is `estimate` plus a
			 * four-digit cost. 860px of column is the first width where that state
			 * fits with the chip at its cap, so the reading is hidden between the
			 * 750px wrap threshold and there.
			 */}
			{duration && (
				<Reading
					label={`Active time: ${formatDuration(activeSeconds)}. ${DURATION_LABEL_EXPLANATION}`}
					tooltip={
						<TooltipLines
							lines={[formatDuration(activeSeconds), DURATION_EXPLANATION]}
						/>
					}
					// Inert, like the spend beside it and like the band's own: it opens
					// nothing, and this is the reading the band ranks least actionable.
					// A readout rather than a disabled button for the same reason the
					// cost is one — there is no picker for it to be unavailable FOR.
					readout
					className="@min-[750px]/chatcol:@max-[860px]/chatcol:hidden"
				>
					{/*
					 * `tabular-nums`: the digits change once a second, and a
					 * proportional `1` would shift the reading's width under the
					 * reader as the number ticks.
					 */}
					<span className="font-mono text-mono-sm tabular-nums">
						{formatDuration(activeSeconds)}
					</span>
				</Reading>
			)}
		</div>
	);
};
