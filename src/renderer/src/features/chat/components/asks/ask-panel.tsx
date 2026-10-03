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

import { cn } from "@shared/lib/utils";
import {
	AlertTriangle,
	Check,
	Clock,
	HelpCircle,
	type LucideIcon,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
	PendingAsk,
	PendingAskQuestion,
} from "../../../../../../shared/desktop-session-contract";
import type {
	AskDraft,
	AskPresentation,
	AskQueueView,
	AskSecrets,
} from "../../ask-queue";
import {
	EMPTY_DRAFT,
	askAnswerMap,
	askSettledAnswers,
	askStatusText,
	draftFor,
} from "../../ask-queue";

export type AskPanelProps = {
	view: AskQueueView;
	/** Answer one ask from a completed draft. */
	onAnswer: (ask: PendingAsk, answers: Record<string, string[]>) => void;
	/** "No answer — decide yourself" for one ask. */
	onDecline: (ask: PendingAsk) => void;
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
	 * sentence on the next one.
	 */
	outcomes?: Record<
		string,
		{ sending: boolean; refused: string | null } | undefined
	>;
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
					{options.map((option) => {
						const chosen = selected.includes(option.label);
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
									{option.label}
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
}: {
	presentation: AskPresentation;
	nowMs: number;
	answering: boolean;
	outcome: { sending: boolean; refused: string | null } | undefined;
	draft: AskDraft;
	onDraftChange: AskPanelProps["onDraftChange"];
	onAnswer: AskPanelProps["onAnswer"];
	onDecline: AskPanelProps["onDecline"];
}) => {
	const { ask, status, waiting, canAnswer, canDecline } = presentation;
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

	return (
		<div
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
			 */}
			{!canAnswer ? (
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
			{canAnswer
				? ask.questions.map((question) => (
						<AskQuestionField
							key={question.id}
							question={question}
							selected={draftFor(draft, question.id)}
							secret={secrets[question.id] ?? ""}
							disabled={disabled}
							onSelect={(label) =>
								setDraft((current) => ({ ...current, [question.id]: [label] }))
							}
							onToggle={(label) =>
								setDraft((current) => {
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
			{outcome?.refused ? (
				/*
				 * The refusal is the panel's own line rather than a toast: it belongs to
				 * the ask on screen, and every refusal in this feature's copy contract is
				 * a sentence about what did NOT happen, which is a state a toast loses the
				 * moment it fades.
				 */
				<p className="flex items-start gap-1.5 text-warning text-xs">
					<AlertTriangle
						aria-hidden="true"
						size={14}
						className="mt-0.5 shrink-0"
					/>
					<span>{outcome.refused}</span>
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
						<button
							type="button"
							disabled={busy}
							onClick={() => onDecline(ask)}
							className="rounded-md px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken"
						>
							Decline
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
};

export const AskPanel = ({
	view,
	onAnswer,
	onDecline,
	answering = false,
	outcomes,
	nowMs,
	drafts,
	onDraftChange,
	className,
}: AskPanelProps) => {
	if (view.asks === null) return null;
	return (
		<div
			data-lo-ask-panel="open"
			className={cn("flex w-full flex-col gap-2", className)}
		>
			{view.rows.length === 0 ? (
				<p className="px-3 py-2 text-ink text-sm">
					No asks outstanding. The agent is not waiting on anything.
				</p>
			) : (
				view.rows.map((presentation) => (
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
					/>
				))
			)}
		</div>
	);
};
