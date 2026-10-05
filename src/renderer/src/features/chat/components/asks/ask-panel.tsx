/**
 * The EXPANDED ask surface: the queue, and the form that answers one entry.
 *
 * ## Two states, one component (design §5.0, R7)
 *
 * This is the EXPANDED half of the shared interaction model. The minimized
 * trigger is now the ask ITEM in the composer's status row
 * (`composer-status-row.tsx`), which expands into this panel, and the rule that
 * binds them is the composer's routing invariant: while this panel is open the
 * composer answers the ask, and while it is collapsed the composer is an ordinary
 * conversation box. The panel is entered ONLY by the user - a press on that item,
 * or an explicit action - and never by an ask arriving, which is the
 * no-focus-steal promise the whole redesign is built on.
 *
 * ## Why the whole ask is one form
 *
 * The wire answers an ask ATOMICALLY: one body carrying every question's answer,
 * keyed by question id (design §4). A client that posted one question at a time
 * could die half-settled, and the ask would be neither open nor answered with
 * nothing able to settle it - so the submit control is gated on the whole draft
 * being complete (`askDraftIsComplete`) rather than on the question in view.
 *
 * ## Why a SECRET question keeps its value out of the draft
 *
 * A secret answer is typed into a masked field, and it must not be re-rendered:
 * it therefore lives in its own record (`AskSecrets`) rather than in the draft
 * that drives ticks and enablement, so no render path can paint it into a story
 * fixture or a log. It still travels ON THE ANSWER BODY, because the backend is
 * what turns the value into a key name — it writes the value to the session's
 * memory-only store first and puts `[<key>]` in the durable row, in that order.
 * The field is still the only place the value may live on this side, and the
 * submit stays gated on it being non-empty.
 *
 * ## What the states are allowed to say
 *
 * Every status sentence comes from `ask-queue.ts`'s shared copy contract. The
 * honest states the design note calls out are the reason this panel is not a
 * plain list: QUEUED and TIMED-OUT must not read alike (a timed-out ask is still
 * answerable, and "timed out" alone reads as finished), a LATE answer must name
 * itself as late, and a delivered response must be distinguishable from an
 * answer the model never received.
 */

import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { Check, Clock, HelpCircle, type LucideIcon, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
	PendingAsk,
	PendingAskQuestion,
} from "../../../../../../shared/desktop-session-contract";
import type {
	AskDraft,
	AskOutcome,
	AskPresentation,
	AskQueueView,
	AskSecrets,
} from "../../ask-queue";
import {
	ASK_CHANGE_WINDOW_HINT,
	EMPTY_DRAFT,
	askAnswerMap,
	askRevisionDraft,
	askSettledAnswers,
	askStatusText,
	askStatusWord,
	draftFor,
} from "../../ask-queue";
import { AskRecommendedBadge, recommendedIndex } from "../ask-recommended";

/**
 * WHICH HALF OF THE LIST THE READER IS LOOKING AT (operator ask, 2026-10-05).
 *
 * `all` is the default and the shipped shape: one scannable list, pending first
 * and settled below it. The other two drop one half - the history the operator
 * used to have to escape with a chevron, and the work a reader who has finished
 * answering may want out of the way. See `AskPanel`'s filter block for why this is
 * local state rather than a stored preference.
 *
 * THE MIDDLE KEY IS `outstanding`, NOT `waiting` (agent review round 1, M1 = UX
 * round 1, U1). This module RESERVES "waiting" for the agent-still-waiting subset
 * that EXCLUDES a moved-on row, and the half this button selects is the panel's
 * whole pending half - the outstanding population AND a §10 answer not yet
 * delivered - so an internal name taken from the reserved word is the visible
 * label's own defect one layer down. The label the reader sees is the phrase the
 * removed rail row used for the same population (see the filter control).
 */
type AskFilter = "all" | "outstanding" | "settled";

/**
 * The status chip's variant, one mapping for the whole surface.
 *
 * `success` for a delivered answer (the agent was told), `warning` for a late one
 * (recorded, the model has not seen it), `neutral` for a decline and for anything
 * the wire did not name - so the chip's ink is a reading of the status rather than
 * decoration, and the word inside it stays the contract's own (`askStatusWord`).
 * Every state is drawn from `Badge`'s `wash` family, whose semantic inks the
 * contrast gate already covers; no state inherits its meaning from the hue alone,
 * because the word travels with it.
 */
const settledStatusVariant = (
	status: AskPresentation["status"],
): "success" | "warning" | "neutral" =>
	status === "answered" ? "success" : status === "late" ? "warning" : "neutral";

export type AskPanelProps = {
	view: AskQueueView;
	/** Answer one ask from a completed draft. */
	onAnswer: (ask: PendingAsk, answers: Record<string, string[]>) => void;
	/** "No answer — decide yourself" for one ask. */
	onDecline: (ask: PendingAsk) => void;
	/**
	 * CHANGE a recorded-but-undelivered answer (design §10, #1936). Absent where the
	 * surface cannot revise (a story, a read-only mount), exactly as `onAnswer` is.
	 *
	 * It carries the WHOLE ask map, because that is what the wire takes for both
	 * doors: a revision is the same atomic body as a first answer plus the intent,
	 * never a per-question amend. The caller does not get told which question moved
	 * — it could not act on that, and a per-question shape here is how the amend post
	 * §10 rules out would creep back in.
	 */
	onRevise?: (ask: PendingAsk, answers: Record<string, string[]>) => void;
	/*
	 * There is deliberately NO dismiss door. Design §5.0/§5.2 puts one in scope
	 * ("view-only removal of a timed-out ask"), but the desktop plane has no route
	 * for it: the bridge exposes `ask_respond` (with `decline`) and nothing that
	 * maps to the runtime's `ask_dismiss`, so a Dismiss button here would be a
	 * control that can never work - the dead-affordance defect this codebase
	 * refuses elsewhere (`ask-options.tsx`'s own note on the inert `<ul>`). A
	 * timed-out ask therefore stays visible and answerable (the `late` path), and
	 * dismissal lands when the route does.
	 */
	/** An answer is in flight from any surface: every control is disabled. */
	answering?: boolean;
	/**
	 * This panel's own record of the ask it settled, keyed by id: the sentence the
	 * owner refused with, or `null` while it is still live. Keyed because a
	 * refusal belongs to ONE ask, and a single slot would put the previous ask's
	 * sentence on the next one. `AskOutcome` is the record's own shape — the
	 * revision's receipt travels in it too (design round 1, D3; UX round 1, U3).
	 */
	outcomes?: Record<string, AskOutcome | undefined>;
	/** The client clock the countdown reading is rendered against. */
	nowMs: number;
	/**
	 * The in-flight answers, keyed by ask id then question id.
	 *
	 * OWNED BY THE CALLER, not by this panel, and that is the composer routing's
	 * requirement rather than a preference (design §5.0): while the ask surface is
	 * expanded the COMPOSER answers the question, so the text the user typed there
	 * and the ticks they made here must be the same draft. Two owners would mean a
	 * composer Enter that silently discarded a ticked option, or a tick that
	 * discarded what they typed.
	 */
	drafts: Record<string, AskDraft>;
	onDraftChange: (askId: string, next: AskDraft) => void;
	/**
	 * WHICH CONVERSATION THIS ROW BELONGS TO, when the surface is showing more than
	 * one (the fleet scope).
	 *
	 * A row from the aggregate route names its own session (`session_id`) and where
	 * it ran (`cwd`), so a drawer showing several conversations must SAY which one
	 * each card is about or the reader cannot tell a question meant for the
	 * conversation in front of them from one meant for another. The mapping lives in
	 * the model (`fleet-asks.ts`) and is passed in rather than read here, so this
	 * panel stays scope-agnostic and a session-scoped drawer (whose rows carry no
	 * session) simply omits it - see `AskDrawer`, which owns the scope and so owns
	 * this prop's presence.
	 */
	conversationOf?: (row: AskPresentation) => string | null;
	className?: string;
};

/** Status glyph and ink, in one place so every row reads the same way. */
const askStatusMark = (
	status: AskPresentation["status"],
): { Icon: LucideIcon; className: string } => {
	switch (status) {
		case "answered":
		case "late":
			return { Icon: Check, className: "text-success" };
		case "timed_out":
			return { Icon: Clock, className: "text-warning" };
		case "declined":
		case "dismissed":
		case "expired":
			return { Icon: X, className: "text-ink-muted" };
		default:
			return { Icon: HelpCircle, className: "text-accent" };
	}
};

/**
 * One question's control.
 *
 * Three shapes, decided by the question itself rather than by the ask:
 * an option list (single- or multi-select), a free-text field (an option list is
 * never guaranteed exhaustive - the terminal picker's own rule is that its free
 * row can return a string that was never in `options`), and a masked field for a
 * secret. The secret case is a different DOOR rather than a variant of the text
 * field: its value must never be drafted, echoed, or sent as an answer.
 */
const AskQuestionField = ({
	question,
	selected,
	secret,
	disabled,
	onSelect,
	onToggle,
	onSecret,
}: {
	question: PendingAskQuestion;
	selected: string[];
	secret: string;
	disabled: boolean;
	onSelect: (label: string) => void;
	onToggle: (label: string) => void;
	onSecret: (value: string) => void;
}) => {
	const options = question.options ?? [];
	const multi = question.multi === true;
	/*
	 * THE RECOMMENDATION IS THE WIRE'S INDEX, read exactly as the dock reads it.
	 *
	 * It travels on the QUESTION (`PendingAskQuestion.recommended`), not on the
	 * option. The queued ask's option objects are the core's own `AskOption`
	 * (`label`/`description` with `extra="forbid"`), and `asks/queue.py`'s
	 * `_question_shape` writes the index BESIDE `options` while copying each
	 * option verbatim - so the per-option flag this row used to read
	 * (`option.recommended === true`) was a field no producer sends, and the
	 * drawer drew no badge and no bold on any real install (agent review round 1,
	 * R1-1).
	 *
	 * `recommendedIndex` is the dock's own validation, SHARED rather than copied:
	 * an index that is absent, null, out of range or not an integer badges
	 * NOTHING, and only a real index marks its row (`ask-recommended.tsx`).
	 */
	const marked = recommendedIndex(question.recommended, options.length);
	/*
	 * A SOURCE OF THE DRAFT THAT IS NOT IN THE LIST IS DRAWN, AND DRAWN AS WHAT IT IS
	 * (design round 1, D2's addendum incident). Two doors write this one draft: the
	 * option rows below (always a label) and the COMPOSER, whose Enter is routed to the
	 * ask (design §5.0) and which writes the RAW TYPED TEXT into the first unanswered
	 * question.
	 *
	 * Before this row existed the second door was invisible: typing `prod` at the
	 * staging/production question answered with the string `prod` while every radio
	 * stayed EMPTY, so the card said nothing had been chosen about a question that was
	 * already answered - and an answer that did not come from the list was
	 * indistinguishable from one that did. The row below is the other half of that fix:
	 * the value is shown, labelled `Other` so it reads as a value the list did not
	 * offer rather than as a missing selection, and it is a real choice in the group
	 * (`aria-checked`, the same mark, the same ground) so the two doors agree about
	 * what is selected.
	 *
	 * Only for the LIST shape: a free-text question (no options) already renders the
	 * draft in its own field, and a secret is never drawn anywhere.
	 */
	const freeForm =
		options.length > 0
			? selected.filter(
					(value) =>
						value.trim().length > 0 &&
						!options.some((option) => option.label === value),
				)
			: [];
	return (
		<div className="flex flex-col gap-1.5" data-lo-ask-question={question.id}>
			<p className="text-ink text-sm">{question.question}</p>
			{question.secret ? (
				<input
					data-ask-secret={question.id}
					type="password"
					autoComplete="off"
					autoCorrect="off"
					spellCheck={false}
					disabled={disabled}
					value={secret}
					onChange={(event) => onSecret(event.target.value)}
					placeholder="Your answer (never shown again)"
					/*
					 * A real name, because the placeholder is not one: it vanishes at the
					 * first character and the question <p> beside it is a sibling rather
					 * than an association (`dom_audit` reported `fail input-label`; design
					 * round 1, D8).
					 */
					aria-label={`Your answer to: ${question.question}`}
					className="w-full rounded-md border border-control bg-surface px-2 py-1.5 text-ink text-sm"
				/>
			) : options.length > 0 ? (
				<div className="flex flex-col" role={multi ? "group" : "radiogroup"}>
					{options.map((option, index) => {
						const chosen = selected.includes(option.label);
						/*
						 * THE RECOMMENDATION AND THE SELECTION ARE TWO STATES, and this row
						 * is where that has to be visible rather than merely true: the row's
						 * selection is the DRAFT (a ground step plus the drawn radio/checkbox
						 * mark), while the recommendation is a mark of its own keyed on the
						 * QUESTION's index (`marked`, computed above). Ticking a different
						 * option moves the former and leaves the latter exactly where it was -
						 * which is the whole requirement: the advice the user is choosing
						 * AGAINST must not be erased by the act of weighing it.
						 */
						const recommended = marked === index;
						return (
							<button
								key={option.label}
								type="button"
								data-ask-option={option.label}
								disabled={disabled}
								aria-pressed={multi ? chosen : undefined}
								aria-checked={multi ? undefined : chosen}
								role={multi ? "checkbox" : "radio"}
								onClick={() =>
									multi ? onToggle(option.label) : onSelect(option.label)
								}
								className={cn(
									"flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left",
									// Rows, not controls with edges of their own: this list sits
									// inside the panel's card, so its boundary is its selection
									// ground and its focus outline (the same idiom as `AskOptions`).
									chosen ? "bg-sunken" : "hover:bg-sunken",
									disabled ? "text-ink-dim" : "text-ink",
								)}
							>
								{/* A drawn mark rather than a tick glyph: the tick and the dot this pair
								 * used to be read as emoji-adjacent decoration, and a filled shape is
								 * the same mark in a colour role the contrast gate already covers.
								 *
								 * THE SHAPE CARRIES THE CARDINALITY, and that is not decoration: a
								 * single-select question answers with ONE label and a multi-select
								 * with several, so a round mark on both is a radio that accepts a
								 * second press - an affordance stating the wrong input cardinality,
								 * which is the same class of defect as the inert option list this
								 * card replaced. Round reads "pick one", square reads "pick any",
								 * and both are the app's existing idiom for those two controls
								 * (`shared/components/ui/checkbox.tsx`).
								 * The ARIA roles already split (`role="radio"`/"checkbox"`), so
								 * this brings the pixels in line with what a screen reader is told. */}
								<span
									aria-hidden="true"
									className={cn(
										"mt-1 h-3 w-3 shrink-0 border",
										/*
										 * `rounded-[2px]`, NOT `rounded-sm`: the token is 6px
										 * (`styles/index.css`), which on a 12px box is a
										 * perfect circle - so the class the design round
										 * measured as "identical to the single-select mark"
										 * really was identical, and the claim that it
										 * differed was wrong (design round 1, D1).
										 */
										multi ? "rounded-[2px]" : "rounded-full",
										chosen ? "border-accent bg-accent" : "border-control",
									)}
								/>
								<span className="min-w-0 flex-1">
									{/*
									 * THE MARK STAYS ON THE LABEL'S OWN FIRST LINE, which is the fix
									 * for design round 1's U1 rather than a style preference.
									 *
									 * THE FAILURE, measured on the 65-character label this PR
									 * fixtures: with `flex-wrap`, the badge is a flex ITEM, so the
									 * moment the label fills its first line the badge wraps to a flex
									 * line of its own - 17px directly above the description, in a
									 * dimmer ink at the description's own 12px - and it reads as a
									 * LEAD-IN LINE of the description rather than as a mark on the
									 * label. That is the operator's original "reads as prose" symptom
									 * surviving in the long-label state, and it is exactly the state
									 * the fixture exists for.
									 *
									 * Nowrap plus a shrinkable label fixes it at every width: the
									 * label is a flex item with `min-w-0`, so it shrinks to the space
									 * the badge leaves and wraps INSIDE its own box, while the badge
									 * (a `shrink-0` item) keeps its place on the row's first line. A
									 * short label is not stretched (`flex: 0 1 auto` sizes it to its
									 * content), so the badge still sits immediately beside it; a long
									 * one wraps under it rather than pushing the badge away. A badge
									 * can therefore never become a line of its own above the
									 * description.
									 *
									 * The label is BOLDED where it is recommended - the half of
									 * the signal that survives a reader who skims past the badge.
									 */}
									<span className="flex items-baseline gap-x-2">
										<span
											className={cn("min-w-0", recommended && "font-semibold")}
										>
											{option.label}
										</span>
										{recommended ? <AskRecommendedBadge /> : null}
									</span>
									{/*
									 * `ink-muted` RESTORED (design round 2, D12). Round 1's
									 * D3 premise was a MISMEASUREMENT - the colours it sampled
									 * were the option MARK's `border-control`, not the text -
									 * and the muted pair actually measures 7.85:1 dark /
									 * 8.19:1 light, contract-floored at 5.5:1 across all 59
									 * palettes. Flattening the description to `ink` did not fix
									 * a contrast fault; it spent the two-step ranking inside a
									 * two-line option row, which is the thing the row reads by.
									 */}
									{option.description ? (
										<span className="block text-ink-muted text-xs">
											{option.description}
										</span>
									) : null}
								</span>
							</button>
						);
					})}
					{freeForm.map((value) => (
						<button
							key={`other:${value}`}
							type="button"
							data-ask-option-other={value}
							disabled={disabled}
							aria-pressed={multi ? true : undefined}
							aria-checked={multi ? undefined : true}
							role={multi ? "checkbox" : "radio"}
							onClick={() => (multi ? onToggle(value) : onSelect(value))}
							className={cn(
								"flex w-full items-baseline gap-2 rounded-sm bg-sunken px-2 py-1 text-left",
								disabled ? "text-ink-dim" : "text-ink",
							)}
						>
							{/* The same chosen mark the option rows use, so a reader cannot tell the
							 * two kinds of row apart by their selection state - only by the word. */}
							<span
								aria-hidden="true"
								className={cn(
									"mt-1 h-3 w-3 shrink-0 border border-accent bg-accent",
									multi ? "rounded-[2px]" : "rounded-full",
								)}
							/>
							<span className="min-w-0 flex-1">
								{value}
								{/* `Other` is the ROW's KIND, not part of the answer: it is what tells a
								 * reader this text came from the composer rather than from the list. */}
								<span className="ml-1.5 text-ink-muted text-xs">Other</span>
							</span>
						</button>
					))}
				</div>
			) : (
				<input
					type="text"
					disabled={disabled}
					value={selected[0] ?? ""}
					onChange={(event) => onSelect(event.target.value)}
					placeholder="Type your answer"
					className="w-full rounded-md border border-control bg-surface px-2 py-1.5 text-ink text-sm"
				/>
			)}
		</div>
	);
};

/** One ask: its status line, its questions, and the controls that settle it. */
const AskRow = ({
	presentation,
	nowMs,
	answering,
	outcome,
	draft,
	onDraftChange,
	onAnswer,
	onDecline,
	onRevise,
	conversationOf,
}: {
	presentation: AskPresentation;
	nowMs: number;
	answering: boolean;
	outcome: AskOutcome | undefined;
	draft: AskDraft;
	onDraftChange: AskPanelProps["onDraftChange"];
	onAnswer: AskPanelProps["onAnswer"];
	onDecline: AskPanelProps["onDecline"];
	onRevise?: AskPanelProps["onRevise"];
	conversationOf?: AskPanelProps["conversationOf"];
}) => {
	const { ask, status, waiting, canAnswer, canDecline, delivering } =
		presentation;
	const conversation =
		conversationOf === undefined ? null : conversationOf(presentation);
	const setDraft = useMemo(
		() => (updater: (current: AskDraft) => AskDraft) =>
			onDraftChange(ask.ask_id, updater(draft)),
		[ask.ask_id, draft, onDraftChange],
	);
	// The secret values are their own record rather than draft members ON PURPOSE:
	// the draft is re-rendered on every tick and has to be safe to paint anywhere,
	// and a credential in it would ride into a story fixture or a log the first
	// time someone rendered this row from a captured state. The value reaches the
	// answer body (the backend substitutes the key name) without ever being
	// renderable state.
	const [secrets, setSecrets] = useState<AskSecrets>({});
	const busy = answering || Boolean(outcome?.sending);
	const disabled = busy || !canAnswer;
	const ready = useMemo(
		() => askAnswerMap(ask, draft, secrets) !== null,
		[ask, draft, secrets],
	);
	const mark = askStatusMark(status);
	const StatusIcon = mark.Icon;
	/*
	 * URGENT STEPS THE INK AND KEEPS THE SHAPE (the audit's second item; design round
	 * 1's D5 found the first attempt at it, UX round 2's U7 and round 3's U2 the
	 * scope). The wire carries `urgent` - the backend derives it from the window
	 * itself, `timeout <= 900` - and until this arm NO desktop surface painted it: a
	 * row with ten minutes left looked exactly like one with an hour. The status
	 * switch above still decides WHICH GLYPH the row wears; only its ink steps, to the
	 * same `warning` role the timeout arm already spends, so the two "you are out of
	 * time" readings are one colour rather than two.
	 *
	 * WAITING, NOT OPEN, AND THE SAME PREDICATE THE ITEM USES. `open` folds
	 * `timed_out` in deliberately (a late answer still reaches the agent), which is
	 * why scoping this to it made the panel ink and announce `Urgent.` for an ask the
	 * agent had already walked past - directly contradicting the item below it, which
	 * withholds exactly that (UX round 3's U2; the same defect as round 2's U7). One
	 * surface stating urgency for a queue the other calls moved-on is worse than
	 * either choice alone: the reader cannot tell which one is wrong. A timed-out ask
	 * therefore wears its status arm's own ink and glyph, untouched by this arm.
	 *
	 * A settled ask's stale urgency is not a state anyone can act on either, and
	 * `waiting` excludes those for free.
	 */
	const urgent = ask.urgent === true && waiting;
	/*
	 * THE CHANGE FORM (design §10, #1936). Local to the card ON PURPOSE: `onDraftChange`
	 * owns the FIRST-answer buffer, which the composer's Enter routes into while the ask
	 * is expanded — that buffer is the user's in-progress reply to a question nobody has
	 * answered yet, and a revision is a different act on a body that already exists.
	 * Folding the two together would let an abandoned change ride into the next ask the
	 * composer answers, and would make "which draft is this?" a question the caller has to
	 * ask of every render.
	 *
	 * The SECRET values are the shared record, deliberately: they are already kept out of
	 * renderable draft state (see `secrets` above), and a masked field is the same channel
	 * on both doors — the backend substitutes the key name either way.
	 */
	const [changing, setChanging] = useState(false);
	const [changeDraft, setChangeDraft] = useState<AskDraft>(EMPTY_DRAFT);
	/*
	 * THE OWNER'S OWN REFUSAL CLOSES THE DOOR (design round 1, D1 = UX round 1, U1).
	 *
	 * A frame can predate the response row that shut the window, so a card can be drawn
	 * from a wire that still says "undelivered" while the OWNER has already refused a
	 * change in the words `already delivered — send a new message`. The refusal is the
	 * newer fact, and the old frame will not catch up on this render — so a card that
	 * kept the affordance offered a control whose only possible outcome is the sentence
	 * directly above it, which is the second press the finding measured.
	 *
	 * THIS IS NOT A SURFACE GATE, and the distinction is the whole reason it is spelled
	 * out. §10 forbids a surface re-deriving the window from status or from a value
	 * comparison ("a revision is not a race; the winner rule governs races"); this
	 * derives nothing and predicts nothing — it accepts a fact the OWNER has already
	 * stated about THIS ask, and it is scoped to the surface that holds the sentence.
	 *
	 * ONLY THE OWNER'S VERDICT CLOSES IT, AND A TRANSPORT FAILURE DOES NOT (agent review
	 * round 2, minor). The first cut closed the door on ANY refusal, including one where
	 * the request never reached the backend - and because the outcome record is never
	 * cleared and the "next wire read" it promised does not exist, one failed press left
	 * an answered-undelivered ask with NO affordance at all until the mount changed. A
	 * refusal that reached nothing is not a statement about the window: the door stays
	 * open, the refusal line still says what happened to the press, and the reader may try
	 * again. `outcome.refusedByOwner` is that classification, made where the error was
	 * still in hand (`askRefusalIsOwner`); only `true` shuts this door.
	 */
	const doorShut = outcome?.refusedByOwner === true;
	const changeOpen = delivering && !doorShut;
	/*
	 * A CHANGE THAT LANDED CLOSES THE FORM (UX round 1, U3; design round 1, D3). The
	 * owner accepted the map, so the editable copy of the answers on screen is stale
	 * the moment that acceptance lands — and leaving it open made a change that landed
	 * look exactly like one that never left, with the same seeded value and a re-armed
	 * submit. The card falls back to its answer frame (whose map moves to the new values
	 * on the next wire read) with a receipt where the form was; re-opening is one press,
	 * which is the door's own promise — a revision is free while the answer is undelivered.
	 */
	useEffect(() => {
		if (outcome?.changed === true) setChanging(false);
	}, [outcome?.changed]);
	/*
	 * The FORM'S OWN completeness, read through the SAME `askAnswerMap` the first-answer
	 * door uses — no revision-specific rule exists, because the wire's body is the same
	 * body. A secret question therefore needs a retyped value here too (see
	 * `askRevisionDraft`), which is the honest consequence of the value never being
	 * recoverable rather than a second gate.
	 */
	const changeReady = useMemo(
		() => askAnswerMap(ask, changeDraft, secrets) !== null,
		[ask, changeDraft, secrets],
	);
	/*
	 * FOCUS FOLLOWS THE PRESS INTO THE FORM (UX round 1, U2).
	 *
	 * The pressed `Change answer` is unmounted and replaced by different elements, so
	 * without this the browser drops focus to the BODY and the next Tab restarts at the
	 * top of the page (`Close asks` → the first question → …), which is the same defect
	 * the dock's own press and `chat-page.tsx`'s `restoreFocus` were each fixed for. THIS
	 * IS THAT MECHANISM, not a second policy: the flag is ARMED at the press and spent in
	 * a LAYOUT effect on the commit that mounts the form — so no painted frame shows the
	 * body holding focus — and it lands on the first live control the form offers, the
	 * same hand-off `question-dock.tsx` performs for its own press (`button[data-ask-option]`,
	 * else the masked field, because a secret-only ask has no option to take it).
	 *
	 * It lives here rather than in the drawer because the form is this card's own state:
	 * the panel is mounted by two containers (the session drawer and the fleet pane), so a
	 * host-side restore would be two copies of one rule.
	 */
	const rowRef = useRef<HTMLDivElement>(null);
	const armChangeFocus = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the form's open flag is the trigger, not a value read in the body
	useLayoutEffect(() => {
		if (!armChangeFocus.current) return;
		armChangeFocus.current = false;
		rowRef.current
			?.querySelector<HTMLElement>(
				/*
				 * THE DRAWER'S OWN TWO SHAPES, and they are not the dock's: an option is a
				 * button carrying `data-ask-option`, and the masked field wears
				 * `data-ask-secret` ON THE `<input>` ITSELF (`ask-panel.tsx`'s
				 * `AskQuestionField`). `question-dock.tsx` queries the same pair but its
				 * secret attribute sits on a wrapping div, so its selector cannot be copied
				 * verbatim — a `[data-ask-secret] input` here matches nothing, and the
				 * hand-off would silently fall through to the body for a secret-only ask.
				 */
				"button[data-ask-option]:not([disabled]), input[data-ask-secret]:not([disabled])",
			)
			?.focus();
	}, [changing]);
	/*
	 * ONE EDIT PATH, TWO BUFFERS: the change form and the first-answer form render the
	 * same question fields, so only the buffer and the disabled term differ. A second
	 * copy of the field loop is how the two would drift into two ways of drawing one
	 * question.
	 *
	 * THE FORM CLOSES ITSELF WHEN THE WINDOW DOES. `changingNow` is `changing` AND the
	 * wire's live flag, so the instant the answer is delivered the editable fields go
	 * with the button that submitted them: a revision is refused from that point on, and
	 * an editable card with no submit is a worse failure than the button disappearing.
	 * The card falls back to the answer frame it already knows how to draw.
	 */
	const changingNow = changing && changeOpen;
	const editDraft = changingNow ? changeDraft : draft;
	const writeDraft = changingNow
		? (updater: (current: AskDraft) => AskDraft) => setChangeDraft(updater)
		: setDraft;
	const fieldDisabled = changingNow ? busy : disabled;

	return (
		<div
			ref={rowRef}
			data-lo-ask-row={ask.ask_id}
			data-lo-ask-status={status}
			/*
			 * `border-hairline`, not `border-control`: `border-control` is the contract's
			 * role for the sole boundary of a CONTROL (3:1 floor) and this is a card -
			 * the transcript's own turn rule takes the hairline for the same reason
			 * (design round 1, D9).
			 */
			className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3"
		>
			{conversation === null ? null : (
				/*
				 * THE CONVERSATION LINE (fleet scope only). `ink-dim` and the meta step:
				 * it is provenance rather than the question, so it must not compete with
				 * the question below it - the same register the settled section's own
				 * descriptor takes. One line, truncated, because a `cwd` is a path and a
				 * wrapped path would push the question down the card for a fact the
				 * reader wants at a glance.
				 */
				<span
					data-lo-ask-conversation=""
					className="truncate text-ink-dim text-meta"
				>
					{conversation}
				</span>
			)}
			<div className="flex items-center gap-2">
				<StatusIcon
					aria-hidden="true"
					className={cn("shrink-0", urgent ? "text-warning" : mark.className)}
					size={16}
				/>
				<span className="min-w-0 flex-1 text-ink text-xs">
					{urgent ? <span className="sr-only">Urgent. </span> : null}
					{askStatusText(ask, nowMs)}
				</span>
				{/*
				 * THE ID MOVED INTO A TITLE (design round 1, D6). It is the string a
				 * user quotes in a report, so it stays reachable - but on a row whose job
				 * is "answer the question" it was the only text meaningless to the
				 * reader, and it took the most prominent empty corner on every card. The
				 * TUI spends the id only as a fallback for a missing headline; a tooltip
				 * keeps the support value without spending attention on every row.
				 */}
				<span className="shrink-0 text-ink text-xs" title={ask.ask_id}>
					{"\u00a0"}
				</span>
			</div>
			{/*
			 * A SETTLED ask draws the ANSWER FRAME, not a disabled form: what the
			 * reader needs from a closed question is what was answered, and a form
			 * with every control greyed out answers that with silence. `late` lands
			 * here too - it is settled, and the copy says so.
			 *
			 * THE CHANGE FORM REPLACES IT RATHER THAN STACKING UNDER IT (design §10,
			 * #1936): the form opens with every recorded answer already selected, so
			 * drawing both would print one answer twice on one card - once as prose
			 * and once as a ticked row. The measured frame is what settled that; the
			 * rule is about this pair rather than a preference.
			 */}
			{!canAnswer && !changingNow ? (
				<div className="flex flex-col gap-1.5">
					{askSettledAnswers(ask).map((entry) => (
						<div key={entry.id} className="flex flex-col gap-0.5">
							<span className="text-ink-muted text-xs">{entry.question}</span>
							<span className="text-ink text-sm">
								{entry.answers.length > 0
									? entry.answers.join(", ")
									: "No answer given"}
							</span>
						</div>
					))}
				</div>
			) : null}
			{canAnswer || changingNow
				? ask.questions.map((question) => (
						<AskQuestionField
							key={question.id}
							question={question}
							selected={draftFor(editDraft, question.id)}
							secret={secrets[question.id] ?? ""}
							disabled={fieldDisabled}
							onSelect={(label) =>
								writeDraft((current) => ({
									...current,
									[question.id]: [label],
								}))
							}
							onToggle={(label) =>
								writeDraft((current) => {
									const chosen = draftFor(current, question.id);
									const next = chosen.includes(label)
										? chosen.filter((value) => value !== label)
										: [...chosen, label];
									return { ...current, [question.id]: next };
								})
							}
							onSecret={(value) =>
								setSecrets((current) => ({ ...current, [question.id]: value }))
							}
						/>
					))
				: null}
			{/*
			 * The refusal is the panel's own line rather than a toast: it belongs to the
			 * ask on screen, and every refusal in this feature's copy contract is a
			 * sentence about what did NOT happen, which is a state a toast loses the
			 * moment it fades.
			 *
			 * THE INK IS THE ARM'S, and the lane's other refusal already settled it:
			 * `question-dock.tsx` draws a refused gate answer as a bare sentence in the
			 * danger band, and the designer's finding on the first cut of this line was
			 * that the amber mark + triangle gave a REFUSAL the treatment reserved for a
			 * limit (design round 1, D1's aside). A refusal is what the owner said about
			 * the act, so it wears the danger band here too - and no mark, because the
			 * same refusal must not read differently on the two surfaces.
			 */}
			{outcome?.refused ? (
				<output className="block text-body-sm text-danger">
					{outcome.refused}
				</output>
			) : null}
			{outcome?.changed === true ? (
				/*
				 * THE RECEIPT FOR A CHANGE THAT LANDED (design round 1, D3; UX round 1,
				 * U3). The wire cannot carry one: the fold keeps the FIRST `answered`'s
				 * status, stamp and attribution and requires no marker, so an accepted
				 * revision renders as a first-answer frame with a different map —
				 * indistinguishable from the answer it replaced. Without this line the only
				 * evidence a deliberate change happened is the value the reader has to
				 * remember putting there. It is the same fact the fleet pane already toasts
				 * (`Answer changed for …`), kept in the card because this surface does not
				 * lose the row when the change lands.
				 *
				 * The ICON carries the ink and the sentence stays `text-ink`, which is the
				 * status row's own pairing: a success role on body copy is a contrast claim
				 * this table has not made for this size.
				 */
				<p className="flex items-start gap-1.5 text-xs">
					<Check
						aria-hidden="true"
						size={14}
						className="mt-0.5 shrink-0 text-success"
					/>
					<span className="text-ink">
						Changed — the agent has not been handed it yet.
					</span>
				</p>
			) : null}
			{canAnswer || canDecline ? (
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={disabled || !ready}
						onClick={() => {
							const answers = askAnswerMap(ask, draft, secrets);
							if (answers !== null) onAnswer(ask, answers);
						}}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm",
							/*
							 * The disabled state changes COLOUR, never opacity (branding §2),
							 * and it keeps an EDGE: without one it rendered as body text of the
							 * same weight as `Decline` beside it, so the card's one action that
							 * becomes enabled was also its quietest element (design round 1,
							 * D7).
							 */
							disabled || !ready
								? "border border-hairline bg-surface text-ink-dim"
								: "border border-transparent bg-accent text-on-accent hover:bg-accent-hover",
						)}
					>
						Send answer
					</button>
					{canDecline ? (
						/*
						 * `border-transparent` so the ROW BASELINES (design round 1, D4). The
						 * accent sibling wears a 1px border in both of its states, so without one
						 * here the two controls in one `items-center` row measured 34px and 32px
						 * and the pair sat 1px apart. Fixed here AND on the change row's own
						 * `Cancel`, which inherited the same pair - the finding's own condition is
						 * fix both or neither, because one row alone would leave the drawer drawing
						 * two differently-aligned action rows.
						 */
						<button
							type="button"
							disabled={busy}
							onClick={() => onDecline(ask)}
							className="rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken"
						>
							Decline
						</button>
					) : null}
				</div>
			) : null}
			{/*
			 * THE CHANGE AFFORDANCE (design §10, #1936).
			 *
			 * IT IS GATED ON THE WIRE'S WINDOW AND ON THE OWNER'S OWN REFUSAL, and nothing
			 * else. `changeOpen` is `delivering` — the wire's RECORDED-and-undelivered
			 * reading, `answered` OR `late` (see `AskPresentation.delivering`) — less a
			 * refusal the OWNER made about this ask's window: a control whose only possible
			 * outcome is the sentence directly above it is withdrawn while the sentence stands
			 * (design round 1, D1 = UX round 1, U1). A TRANSPORT FAILURE IS NOT SUCH A REFUSAL
			 * and leaves the door open (`AskOutcome.refusedByOwner`, agent review round 2's
			 * minor). It is deliberately NOT inferred from the status alone
			 * (an ANSWERED ask that has been delivered is finished history and must offer
			 * nothing), and NOT from any comparison between the draft and the recorded
			 * values: §10 forbids that in as many words, because equal values are not a
			 * retry marker and different values are not a revision. The client states the
			 * intent by SENDING the op; it never guesses it.
			 *
			 * NO SURFACE GATE: the button is offered to this surface like any other,
			 * because §10's rule is that a revision is accepted from ANY surface of the
			 * session while the ask is undelivered. The backend decides, and its refusal
			 * (the delivered sentence) is rendered in place by the outcome line above.
			 */}
			{changeOpen && onRevise !== undefined ? (
				<div className="flex flex-col gap-1.5">
					{changingNow ? (
						<>
							{/*
							 * WHAT CLOSES IT, NAMED WHERE THE CONTROL IS (UX round 1, U4; design
							 * round 1, D6). The card's status line states the condition and the
							 * chip states the count, and neither says what the reader is deciding
							 * AGAINST: the answer is still theirs only until the agent is handed
							 * it.
							 */}
							<p className="text-ink-dim text-meta">{ASK_CHANGE_WINDOW_HINT}</p>
							<div className="flex items-center gap-2">
								<button
									type="button"
									disabled={busy || !changeReady}
									onClick={() => {
										const answers = askAnswerMap(ask, changeDraft, secrets);
										if (answers !== null) onRevise(ask, answers);
									}}
									className={cn(
										"rounded-md px-3 py-1.5 text-sm",
										busy || !changeReady
											? "border border-hairline bg-surface text-ink-dim"
											: "border border-transparent bg-accent text-on-accent hover:bg-accent-hover",
									)}
								>
									{/*
									 * `Update answer`, not `Send change` (design round 1, D5): the verb
									 * belongs to the ANSWER this control replaces, so it reads beside
									 * `Send answer` as the same act done twice rather than as a second
									 * mechanic with its own vocabulary.
									 */}
									Update answer
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() => setChanging(false)}
									/*
									 * `border-transparent` so this row baselines exactly as the
									 * first-answer row does — see the `Decline`'s own note (design
									 * round 1, D4: both rows or neither).
									 */
									className="rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken"
								>
									Cancel
								</button>
							</div>
						</>
					) : (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								/*
								 * Seeded from the LOG's own answers, so changing one question is an
								 * edit rather than a re-entry of the whole ask (see `askRevisionDraft`
								 * for what a secret question does here and why).
								 *
								 * THE FOCUS FLAG IS ARMED HERE, at the press, and spent by the layout
								 * effect above on the commit that mounts the form — the same shape
								 * `chat-page.tsx`'s `restoreFocus` uses for the dock's answer press,
								 * because both presses swap the control under the pointer.
								 */
								setChangeDraft(askRevisionDraft(ask));
								armChangeFocus.current = true;
								setChanging(true);
							}}
							className="self-start rounded-md border border-control px-3 py-1.5 text-ink text-sm hover:bg-sunken"
						>
							Change answer
						</button>
					)}
				</div>
			) : null}
		</div>
	);
};

export const AskPanel = ({
	view,
	onAnswer,
	onDecline,
	onRevise,
	answering = false,
	outcomes,
	nowMs,
	drafts,
	onDraftChange,
	conversationOf,
	className,
}: AskPanelProps) => {
	if (view.asks === null) return null;
	/*
	 * PENDING FIRST, THEN SETTLED, IN ONE LIST - NO LONGER ONE COLLAPSED SECTION
	 * (operator ask, 2026-10-05).
	 *
	 * What this was, and why the operator sent it back. Every settled ask sat behind
	 * ONE group node (`Settled . 17`) that had to be opened before any of them could
	 * be read, and each settled ask was then itself a disclosure - "you have to drill
	 * down and drill down again, it's hard to read", in his words. The group node is
	 * gone: the settled rows now sit in the SAME list as the pending cards, one line
	 * each, and the two states a reader has to tell apart are carried on the row
	 * (a status CHIP) rather than by a chevron standing between them and the text.
	 *
	 * WHAT REPLACES THE GROUP'S OWN JOB. The node did three things: it collapsed the
	 * history out of the way, it labelled the section, and its subtitle named the
	 * statuses the section held. The collapse is now the FILTER CONTROL below - which
	 * is a real control rather than a subtitle the reader has to notice is inert -
	 * and the label survives as the quiet `Settled . N` heading that marks the
	 * boundary only while both groups are on screen. The per-status descriptor is
	 * dropped rather than moved: with a status CHIP on every row, a legend above them
	 * is a second spelling of what the rows already say.
	 *
	 * The predicate is `open`, the backend's outstanding set - which deliberately
	 * folds `timed_out` in, because a late answer still reaches the agent - so
	 * "pending" here means "a control on this row can still do something", which is
	 * the same fact the chip's counts state at the other end of the lane.
	 */
	/*
	 * AN ANSWER THE AGENT HAS NOT BEEN HANDED IS STILL THE USER'S (design §10, #1936),
	 * so it belongs with the pending cards rather than in the history section. §10's
	 * own word for it is "answered-but-UNSETTLED": the log holds the answer, the
	 * response row does not exist yet, and the change affordance is live on the row -
	 * which a collapsed one-line history row could not offer. A DELIVERED `answered`
	 * ask takes the opposite branch and is history, because the model has been told
	 * and the row pins what it was told.
	 */
	const pending = view.rows.filter((row) => row.open || row.delivering);
	/*
	 * NEWEST FIRST within the settled half, which is the note's own order and the
	 * reverse of `view.rows`: the queue sorts oldest-first so its head is stable, and
	 * a HISTORY is read the other way round.
	 */
	const settled = view.rows
		.filter((row) => !row.open && !row.delivering)
		.reverse();

	/*
	 * THE FILTER IS A CONTROL, NOT A SUBTITLE (operator ask, 2026-10-05).
	 *
	 * It replaces the `Settled . 17` group node's two jobs with one answerable
	 * question: which half am I reading? `All` is the default and keeps the whole
	 * queue in one list, `Waiting or moved on` drops the history and `Settled` drops
	 * the work - so the history that used to cost a chevron to escape now costs a
	 * press, and the counts are stated ON the controls rather than in a line of
	 * prose about them.
	 *
	 * THE MIDDLE HALF IS `open || delivering`, i.e. every row that has NOT settled -
	 * and its label says so in the module's own words rather than in the one word it
	 * does not own (agent review round 1, M1 = UX round 1, U1). "Waiting" here means
	 * the agent is still waiting, which EXCLUDES a moved-on ask, so the middle button
	 * can no longer claim it: a drawer bar reading `1 waiting, 1 moved on` directly
	 * above a filter reading `Waiting · 2` was two names for one population, and the
	 * row it counted spelled its own status `moved on`. The phrase is the removed rail
	 * row's own for the outstanding population, kept rather than replaced with a new
	 * coinage. A §10 answer that is recorded but not yet delivered belongs to this half
	 * too - the panel draws it as a pending card - and it is named on its own row.
	 *
	 * LOCAL STATE, not the store: which slice of ONE surface's list the reader is
	 * looking at is not a preference that has to survive a remount, and putting it in
	 * the store would add a persisted field the app would then have to keep in step
	 * with a queue whose rows change under it.
	 */
	const [filter, setFilter] = useState<AskFilter>("all");
	const showPending = filter !== "settled";
	const showSettledRows = filter !== "outstanding";

	/*
	 * ONE ROW, ONE CONSTRUCTION, used by both halves of the list: a settled ask's
	 * expanded body is THE SAME CARD a pending ask wears, so the two cannot drift
	 * into two ways of showing one ask. The key rides on the row because every caller
	 * is a list.
	 */
	const askRow = (presentation: (typeof view.rows)[number]) => (
		<AskRow
			key={presentation.ask.ask_id}
			presentation={presentation}
			nowMs={nowMs}
			answering={answering}
			outcome={outcomes?.[presentation.ask.ask_id]}
			draft={drafts[presentation.ask.ask_id] ?? EMPTY_DRAFT}
			onDraftChange={onDraftChange}
			onAnswer={onAnswer}
			onDecline={onDecline}
			onRevise={onRevise}
			conversationOf={conversationOf}
		/>
	);

	/*
	 * THE FILTER, drawn only when there is something to filter. Three pressed-state
	 * buttons rather than a select: the counts are the point of the control (the
	 * reader picks the half by its size as often as by its name), and a select would
	 * hide two of the three numbers.
	 */
	const filterControl = (
		/*
		 * A `<fieldset>` rather than a `role="group"` div: this repo's a11y lint
		 * (`useSemanticElements`) refuses the ARIA role where the native element
		 * exists, and the element is also the one a screen reader announces as a named
		 * group. The UA's border, margin and padding are zeroed so it paints as the
		 * row of buttons it is.
		 */
		<fieldset
			data-lo-ask-filter={filter}
			aria-label="Filter asks"
			className="m-0 flex items-center gap-1 border-0 p-0 px-1"
		>
			{(
				[
					["all", "All", view.rows.length],
					/*
					 * THE MIDDLE BUTTON NAMES THE SET IT COUNTS, and the set is the whole
					 * pending half (`open || delivering`) - not "waiting", which this module
					 * reserves for the agent-still-waiting subset that excludes a moved-on ask
					 * (agent review round 1, M1 = UX round 1, U1). The phrase is the removed
					 * rail row's own for the same population; see the filter block's note.
					 */
					["outstanding", "Waiting or moved on", pending.length],
					["settled", "Settled", settled.length],
				] as const
			).map(([value, label, count]) => (
				<button
					key={value}
					type="button"
					aria-pressed={filter === value}
					onClick={() => setFilter(value)}
					className={cn(
						"rounded-md px-2 py-0.5 text-meta transition-colors duration-fast ease-out-quart",
						filter === value
							? "bg-sunken text-ink"
							: "text-ink-muted hover:bg-row-hover hover:text-ink",
					)}
				>
					{`${label} · ${count}`}
				</button>
			))}
		</fieldset>
	);

	/*
	 * AN EMPTY SLICE OWES A LINE (design round 1, D1 = UX round 1, U2). The zero line
	 * used to be gated on the WHOLE queue (`view.rows.length === 0`), so selecting a
	 * filter whose half was empty left the pane blank under the chips while the chip
	 * stayed a live destination - which reads as "there are no asks" over a queue
	 * that has some. Each half now states its own emptiness, and because the two
	 * halves PARTITION the rows an empty half means every row is in the other one:
	 * so each line is true by construction and names the filter holding them, rather
	 * than claiming a state the other half may not be in.
	 */
	const emptySlice =
		view.rows.length === 0
			? "No asks outstanding. The agent is not waiting on anything."
			: filter === "outstanding" && pending.length === 0
				? "No asks are waiting or moved on. They have all settled — see Settled."
				: filter === "settled" && settled.length === 0
					? "No asks have settled yet. They are all still under Waiting or moved on."
					: null;

	return (
		<div
			data-lo-ask-panel="open"
			className={cn("flex w-full flex-col gap-2", className)}
		>
			{view.rows.length > 0 ? filterControl : null}
			{/*
			 * THE EMPTY LINE SITS UNDER THE CONTROL IT ANSWERS (design round 1, D1 = UX
			 * round 1, U2): the sentence is about the SLICE the chips selected, so it reads
			 * after them rather than above them. With no rows at all there is no chip row, and
			 * the queue's own line is then simply the first thing in the panel.
			 */}
			{emptySlice === null ? null : (
				<p className="px-3 py-2 text-ink text-body">{emptySlice}</p>
			)}
			{showPending ? pending.map(askRow) : null}
			{showSettledRows && settled.length > 0 ? (
				/*
				 * THE SETTLED GROUP: a plain list in the same column, with a quiet boundary
				 * label drawn only while there IS a pending half above it to be separated
				 * from. It carries no chevron of its own - opening one ask is the reader's
				 * own press, and the group is not a door in front of them.
				 */
				<div data-lo-ask-settled="" className="flex flex-col gap-1 pb-1">
					{/*
					 * THE BOUNDARY LABEL (design round 1, D2 = UX round 1, U4, both nits).
					 * Two corrections to one heading: it printed the settled COUNT that the
					 * `Settled · N` button on the filter above already states - ~190px apart in
					 * `All`, and doubled into `Settled · 3 Settled · 3` under the `Settled`
					 * filter, where there is no pending half for it to separate at all. The
					 * count belongs to the control that counts; this is the mark BETWEEN the two
					 * halves, so it is drawn only when the half above it is on screen, and it
					 * names that half without restating a number. The per-status descriptor the
					 * group node used to carry is gone for the same reason: with a chip on every
					 * row, a legend above them names twice what the rows already say.
					 */}
					{showPending && pending.length > 0 ? (
						<p className="px-3 pt-1 text-ink-dim text-meta">Settled</p>
					) : null}
					{settled.map((presentation) => {
						/*
						 * The one line, and the two things it has to keep apart (D9): the
						 * status WORD (`askStatusWord`, the copy contract's own leading clause)
						 * and the question. `Timed out` and `Answered` are what tells the reader
						 * which of two look-alike rows is still answerable, so the word is
						 * DRAWN - now as a chip rather than as a leading word in the same ink as
						 * the question (operator ask, 2026-10-05) - and it travels in the
						 * accessible name as well.
						 */
						const word = askStatusWord(presentation.status);
						const question =
							presentation.ask.questions[0]?.question ?? "No question text";
						/*
						 * THE REFUSAL TRAVELS WITH THE ROW (UX round 1, U1 = design round 1, D1).
						 *
						 * The reachable path this exists for: the user presses `Change answer`
						 * while the wire still says undelivered, and by the time the press lands
						 * the response row exists - the row is what refuses it - so the ask has
						 * already left `pending` for this half of the list, whose collapsed line
						 * painted nothing but the word and the question. The owner's sentence was
						 * then measured on screen and gone, which §10 calls the worse failure than
						 * the refusal itself ("a silent no-op would be the worse failure").
						 */
						const refusal =
							outcomes?.[presentation.ask.ask_id]?.refused ?? null;
						return (
							<Disclosure
								key={presentation.ask.ask_id}
								triggerClassName="text-ink hover:bg-row-hover hover:text-ink"
								chevronClassName="text-ink-dim"
								rowClassName="min-h-7 py-1"
								triggerLabel={`${word} - ${question}`}
								summary={
									<span className="flex min-w-0 flex-col gap-0.5">
										<span className="flex min-w-0 items-start gap-1.5">
											{/*
											 * THE STATUS IS A CHIP (operator ask, 2026-10-05): at the
											 * question's own 12px in `ink-dim`, `Answered` and
											 * `Answered late` read as the first two words of the
											 * sentence rather than as a mark on it - the same
											 * "reads as prose" fault the recommendation badge had
											 * (see `ask-recommended.tsx`), answered the same way.
											 */}
											<Badge
												variant={settledStatusVariant(presentation.status)}
												shape="pill"
												className="mt-px shrink-0"
											>
												{word}
											</Badge>
											{/*
											 * THE QUESTION WRAPS (operator ask, 2026-10-05): "full
											 * questions not truncated" is what he asked for, and a
											 * `truncate` here is what put the whole question behind a
											 * tooltip instead of on the row. `break-words` so a long
											 * unbroken token cannot push the row wider than the pane.
											 */}
											<span className="min-w-0 whitespace-normal break-words text-ink text-meta">
												{question}
											</span>
										</span>
										{refusal === null ? null : (
											/*
											 * The danger band and no mark, for the reason the card's own
											 * line gives above: one refusal, one treatment, on both
											 * surfaces.
											 */
											<span className="min-w-0 text-danger text-meta">
												{refusal}
											</span>
										)}
									</span>
								}
							>
								<div className="pt-1.5">{askRow(presentation)}</div>
							</Disclosure>
						);
					})}
				</div>
			) : null}
		</div>
	);
};
