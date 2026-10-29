/**
 * The EXPANDED ask surface: the queue, and the form that answers one entry.
 *
 * ## Two states, one component (design §5.0)
 *
 * This is the EXPANDED half of the shared interaction model. The minimized
 * trigger is the ask ITEM in the composer's status row (`composer-status-row.tsx`),
 * which expands into this panel. The panel is the ONLY place an ask is answered
 * from this window: the main composer is an ordinary conversation box whether the
 * panel is open or not, and a send from it never touches an ask draft and never
 * answers anything. (That reverses design §5.0's R7 amendment, under which the
 * composer answered the ask while this panel was open; the operator retired it on
 * 2026-10-07 because nobody could tell that typing in the composer was how an
 * `Other` answer was given. The explicit `Other` row in each question below is the
 * replacement.) The panel is entered ONLY by the user - a press on that item, or an
 * explicit action - and never by an ask arriving, which is the no-focus-steal
 * promise the whole redesign is built on.
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
 * The field is still the only place the value may live on this side. Left EMPTY
 * it is a skip (sent as `[]`, which the backend reports as `<not provided>`),
 * except in the change form over a stored key, where it must be typed again
 * (`askSecretIsSkippable`).
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
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	Check,
	Clock,
	HelpCircle,
	Loader2,
	type LucideIcon,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { t } from "../../../../../../i18n/messages";
import type {
	PendingAsk,
	PendingAskQuestion,
} from "../../../../../../shared/desktop-session-contract";
import type {
	AskDismissReason,
	AskDraft,
	AskOther,
	AskOutcome,
	AskPresentation,
	AskQueueView,
	AskSecrets,
} from "../../ask-queue";
import {
	ASK_CHANGE_WINDOW_HINT,
	COMPOSER_TEXTAREA_SELECTOR,
	EMPTY_DRAFT,
	askAnswerMap,
	askCellWith,
	askDismissReason,
	askOtherSeed,
	askPanelHalves,
	askQuestionIsAnswered,
	askRevisionDraft,
	askSecretPlaceholder,
	askSettledAnswers,
	askStatusText,
	askStatusWord,
	askTicks,
	draftFor,
} from "../../ask-queue";
import { AskRecommendedBadge, recommendedIndex } from "../ask-recommended";
import { AskAnswerField, commitOnEnter } from "./ask-answer-field";

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
 * round 1, U1): the half it selects is the panel's whole pending half - the
 * answerable asks AND a §10 answer not yet delivered - which is wider than
 * "waiting". Its visible label is `Pending` (design round 1 on #1116, D1).
 */
type AskFilter = "all" | "outstanding" | "settled";

/**
 * The status chip's variant, one mapping for the whole surface.
 *
 * `success` for a delivered answer (the agent was told), `warning` for a late one
 * (recorded, the model has not seen it), `neutral` for a decline, for a lapsed
 * (`timed_out`) ask - styled like the decline it now sits beside (D11) - and for
 * anything the wire did not name - so the chip's ink is a reading of the status
 * rather than decoration, and the word inside it stays the contract's own
 * (`askStatusWord`).
 * Every state is drawn from `Badge`'s `wash` family, whose semantic inks the
 * contrast gate already covers; no state inherits its meaning from the hue alone,
 * because the word travels with it.
 */
const settledStatusVariant = (
	status: AskPresentation["status"],
): "success" | "warning" | "neutral" =>
	status === "answered" ? "success" : status === "late" ? "warning" : "neutral";

/**
 * The reason chooser's copy, and the receipt each reason earns: ONE table, so the
 * label a reader chooses and the label the receipt reports cannot drift.
 *
 * Word for word the harness surfaces' vocabulary (the phone sheet's two rows in
 * PR #2841, and `asks/render.py`'s `DISMISS_REASON_LABELS` for the receipt half).
 * `moot` leads: it is the common case and the phone's own order.
 */
const DISMISS_REASONS: readonly AskDismissReason[] = [
	"moot",
	"answered_in_chat",
];

const dismissReasonTitle = (reason: AskDismissReason): string =>
	reason === "moot"
		? t("ui.chat.asks.dismiss.moot.title")
		: t("ui.chat.asks.dismiss.answered_in_chat.title");

const dismissReasonNote = (reason: AskDismissReason): string =>
	reason === "moot"
		? t("ui.chat.asks.dismiss.moot.note")
		: t("ui.chat.asks.dismiss.answered_in_chat.note");

const dismissReceipt = (reason: AskDismissReason): string =>
	reason === "moot"
		? t("ui.chat.asks.dismiss.receipt.moot")
		: t("ui.chat.asks.dismiss.receipt.answered_in_chat");

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
	/**
	 * PUT AN OPEN ASK AWAY without answering it (harness PR #2833, SA-D5).
	 *
	 * Present only where the backend advertises `features.ask_dismiss` — the
	 * caller resolves that key and leaves this prop undefined otherwise, so an
	 * older daemon draws no button at all. That gate is load-bearing rather than
	 * stylistic: the backend's `Answer` is `extra="forbid"`, so a body carrying
	 * `dismiss` is a 422 there, and a control whose only outcome is a refusal is
	 * the dead affordance this panel refuses elsewhere (`ask-options.tsx`'s own
	 * note on the inert `<ul>`).
	 *
	 * The reason is the operator's own word, sent to the owner so the agent knows
	 * whether the conversation already answered the ask or the ask is simply
	 * moot. It is not inferred here: the two values are the wire's vocabulary.
	 */
	onDismiss?: (ask: PendingAsk, reason: AskDismissReason) => void;
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
	 * OWNED BY THE CALLER, not by this panel, so a draft outlives the panel: closing
	 * the drawer to read the transcript (or the fleet pane switching rows) must not
	 * discard a half-made answer. The panel's own controls - the ticks and the
	 * `Other` fields - are the only writers; the main composer is not one.
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
		/*
		 * The Clock tells a timed-out row from a decline; the ink is the settled rows'
		 * muted one (design round 1 on #1116, D3). Amber is this panel's late-answer and
		 * urgency ink, and a read-only row filed with the history is neither.
		 */
		case "timed_out":
			return { Icon: Clock, className: "text-ink-muted" };
		case "declined":
		case "dismissed":
		case "expired":
		case "withdrawn":
			return { Icon: X, className: "text-ink-muted" };
		default:
			return { Icon: HelpCircle, className: "text-accent" };
	}
};

/**
 * A drawn mark rather than a tick glyph: the tick and the dot this pair
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
 * this brings the pixels in line with what a screen reader is told.
 *
 * ONE COMPONENT FOR THE OPTION ROWS AND THE `Other` ROW, because the two must read as
 * the same kind of choice: a second copy of this mark is how the `Other` row would drift
 * from the rows above it (it did once - the readout row this replaced carried its own).
 */
const AskMark = ({ chosen, multi }: { chosen: boolean; multi: boolean }) => (
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
);

/**
 * The first live control a question offers, in document order: an option row, the
 * masked field, or an answer field. Shared by the change form's focus hand-off and by
 * "Enter moves on to the next unanswered question", so the two cannot disagree about
 * what a question's first control is.
 */
const LIVE_CONTROL =
	"button[data-ask-option]:not([disabled]), input[data-ask-secret]:not([disabled]), textarea[data-ask-other]:not([disabled])";

/**
 * The one prompt every free-form entry says: the `Other` row's hint, the placeholder of
 * the field that row opens, and the placeholder of a question that has no options (design
 * review round 1, D4). Three phrasings of one instruction was copy drift, and the two
 * that a user meets in sequence (the row's hint, then the field's placeholder once
 * pressed) are the ones that must agree.
 */
const OTHER_PROMPT = "Type your answer";

/**
 * Focus a control the user's own press asked for, with the CARET AFTER ITS TEXT when it
 * is a text field (round 1, UX U1).
 *
 * A browser places the caret of a textarea at offset 0 when it is focused without a
 * selection, and a field that is mounted with its text already in it is exactly that
 * case: the `Other` the user typed, then pressed an option over, then pressed again came
 * back with the caret in FRONT of its text, so the next keystrokes were PREPENDED (`No`
 * became `NoNo, thanks` and was sent as typed). Typing continues what the user wrote, so
 * the caret goes to the end.
 *
 * THREE doors focus a control over text that is already there, and all three go through
 * here so they cannot disagree: the `Other` row's own press (a field that is already
 * open), the layout effect that press arms (a field that has just mounted over stashed
 * text), and the change form's hand-off (a free-text field seeded from the log). The
 * fourth caller, `Enter` moving on to the next unanswered question, lands on whatever
 * control that question offers first, which is usually an option button.
 *
 * Only press-driven paths call this; a field that mounts over a restored draft is never
 * focused, so nothing here moves a caret the user did not ask to move. The selection is
 * set after focus so it is the one that stands, and the length is read from the DOM
 * value because that is the text the caret is actually in. A button or the masked input
 * is focused as it is: the first has no caret, and the second is never seeded (a secret
 * is retyped, never restored).
 */
const focusAtEnd = (control: HTMLElement | null | undefined) => {
	if (control === null || control === undefined) return;
	control.focus();
	// By tag, not `instanceof`: the global `HTMLTextAreaElement` belongs to a window, and
	// this module must work under the test host's detached jsdom as well as in a page.
	if (control.tagName !== "TEXTAREA") return;
	const field = control as HTMLTextAreaElement;
	const end = field.value.length;
	field.setSelectionRange(end, end);
};

/**
 * One question's control.
 *
 * Three shapes, decided by the question itself rather than by the ask: an option list
 * (single- or multi-select) that ENDS in an `Other` row, a free-text field (a question
 * with no options), and a masked field for a secret. The secret case is a different
 * DOOR rather than a variant of the text field: its value must never be drafted,
 * echoed, or sent as an answer, and it gets no `Other` row on purpose - the masked
 * field IS its free-form entry, and a plain text box beside a credential's field is
 * the credential-in-an-ordinary-box failure the mask exists to prevent. (The
 * composer's own refusal covers only a BLOCKING secret gate; a queued ask leaves
 * the chat box usable and guards the send instead, so this card cannot lean on it
 * - agent review round 1, m4.)
 *
 * ## `Other` is explicit, always there, and written into the SAME draft
 *
 * An option list is never guaranteed exhaustive (the terminal picker's rule is that
 * its free row can return a string that was never in `options`), so every non-secret
 * option question ends in an `Other` row that reveals a field INSIDE the card. What
 * the user types is written into the same `AskDraft` cell the option presses write
 * (`askCellWith`), so `askAnswerMap`, the wire body and an old core are all unchanged.
 * This replaces the main composer answering the ask (design 5.0's R7, reversed on
 * 2026-10-07): the composer is an ordinary chat box and the card is where an ask is
 * answered.
 *
 * The `Other` entry - whether it is selected and the text in it - is this card's own
 * STATE, not a reading of the draft cell (see `AskOther` for the two failures that
 * ruled the derivation out). The cell is seeded INTO that state on mount, so a draft
 * that already holds out-of-list text opens with the field showing it.
 */
const AskQuestionField = ({
	question,
	selected,
	secret,
	secretPlaceholder,
	disabled,
	onCell,
	onSecret,
	onAdvance,
	focusOtherRef,
}: {
	question: PendingAskQuestion;
	/** This question's draft cell: the ticked labels and, last, the `Other` text. */
	selected: string[];
	secret: string;
	/** The masked field's copy; the row reads `askSecretPlaceholder`, the submit's own rules. */
	secretPlaceholder: string;
	disabled: boolean;
	/**
	 * The question's NEW draft cell. One writer for every control on the question -
	 * an option press, a tick, the `Other` row, the field - because each of them has to
	 * rebuild the cell from the ticks AND the `Other` entry (`askCellWith`), and three
	 * callbacks that each rebuilt part of it is how they would disagree.
	 */
	onCell: (cell: string[]) => void;
	onSecret: (value: string) => void;
	/**
	 * Enter in an answer field. The ROW decides what committing means (send the ask when
	 * it is complete, otherwise move to the next unanswered question), because only it
	 * sees every question and the Send control's own gate.
	 */
	onAdvance: (questionId: string) => void;
	/**
	 * Armed by the user's own press on the `Other` row and spent by the field's layout
	 * effect, so the field takes focus on THAT press and on no other commit: not on
	 * mount, not on the drawer opening over a restored draft, not on a re-render.
	 */
	focusOtherRef: React.MutableRefObject<string | null>;
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
	 * THE `Other` ENTRY: card state, seeded from the draft (see `AskOther`).
	 *
	 * It is initialised ONCE, from whatever the draft already holds, so a draft that
	 * outlives the card (the drawer collapsed and reopened; the change form seeded from
	 * the log) mounts with the field OPEN and showing its text - and, because the seed
	 * is state rather than an effect, nothing here focuses anything. A free-text-only
	 * question has no row to open: its field is always shown, and it reads the draft cell
	 * directly because there is no option for a typed word to be mistaken for.
	 *
	 * THE TEXT IS KEPT WHEN AN OPTION IS CHOSEN (single-select) or `Other` IS UNTICKED
	 * (multi-select), so a mis-click does not destroy a typed answer - within this card's
	 * life. Closing the drawer unmounts the card and only the draft cell survives it, so
	 * what a close KEEPS is exactly what the cell holds: a LIVE `Other` (selected, with
	 * its text, or selected and still empty - the cell carries a pending entry for it,
	 * `askCellWith`) and the ticks. What it DROPS is text stashed on an `Other` the user
	 * had moved off. That asymmetry is deliberate: the draft holds ANSWERS, and an
	 * unselected `Other` is not one (pinned by `scripts/ask-other.test.mjs`, N1).
	 */
	const labels = options.map((option) => option.label);
	const [other, setOther] = useState<AskOther>(() =>
		askOtherSeed(selected, labels),
	);
	/** The option rows' own selections: the cell minus the entry `Other` put there. */
	const ticks = askTicks(selected, labels, other);
	const otherField = useRef<HTMLTextAreaElement>(null);
	/*
	 * FOCUS FOLLOWS THE USER'S OWN PRESS, and only that. `focusOtherRef` is armed inside
	 * the click handler of the `Other` row and spent here, in a LAYOUT effect on the
	 * commit that mounts the field - so no painted frame shows the page holding focus,
	 * the same shape the change form's hand-off uses below. Nothing else arms it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the open flag is the trigger, not a value read in the body
	useLayoutEffect(() => {
		if (focusOtherRef.current !== question.id) return;
		focusOtherRef.current = null;
		focusAtEnd(otherField.current);
	}, [other.open]);
	/*
	 * Every write goes through ONE function so the cell can never disagree with the
	 * card's own state: the ticks are read OUT of the current cell (`askTicks`) and the
	 * cell is rebuilt from them and the next `Other` entry (`askCellWith`).
	 */
	const writeOther = (next: AskOther) => {
		setOther(next);
		onCell(askCellWith(ticks, multi, next));
	};
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
					/*
					 * Enter commits here as in every other answer field, through the row's
					 * same gate: send when the ask is complete, else move to the next
					 * unanswered question (QA round 2, Q-2; pre-existing).
					 */
					onKeyDown={commitOnEnter(() => onAdvance(question.id))}
					placeholder={secretPlaceholder}
					/*
					 * A real name, because the placeholder is not one: it vanishes at the
					 * first character and the question <p> beside it is a sibling rather
					 * than an association (`dom_audit` reported `fail input-label`; design
					 * round 1, D8).
					 */
					aria-label={`Your answer to: ${question.question}`}
					/*
					 * The placeholder pair `ui/input.tsx` uses: the placeholder is where the skip
					 * rule is stated, and the browser default measured 2.81:1 on Linen against
					 * `ink-dim`'s 5.0:1 floor (design round 1, D2).
					 */
					className="w-full rounded-md border border-control bg-surface px-2 py-1.5 text-ink text-sm placeholder:text-ink-dim disabled:placeholder:text-ink-disabled"
				/>
			) : options.length > 0 ? (
				<div className="flex flex-col" role={multi ? "group" : "radiogroup"}>
					{options.map((option, index) => {
						const chosen = ticks.includes(option.label);
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
								onClick={() => {
									if (!multi) {
										/*
										 * SINGLE-SELECT: the option and `Other` are exclusive, so choosing
										 * an option CLOSES `Other` - its text stays in `other.text` for a
										 * mis-click, but it is no longer the answer.
										 */
										if (other.open) setOther({ ...other, open: false });
										onCell([option.label]);
										return;
									}
									/*
									 * MULTI-SELECT is additive: toggle the label among the ticks and
									 * leave `Other` exactly as it was, so a typed answer is neither
									 * dropped nor moved in front of the options the user ticks later.
									 */
									onCell(
										askCellWith(
											chosen
												? ticks.filter((label) => label !== option.label)
												: [...ticks, option.label],
											true,
											other,
										),
									);
								}}
								className={cn(
									"flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-start",
									// Rows, not controls with edges of their own: this list sits
									// inside the panel's card, so its boundary is its selection
									// ground and its focus outline (the same idiom as `AskOptions`).
									/*
									 * A CHOSEN ROW KEEPS ITS ROLE FILL ON GLASS (review round 2, minor 3).
									 * It is a selected SURFACE, and the model's answer for a selected
									 * surface is already an exemption: the veil rule skips a block that
									 * wears `bg-row-selected` rather than stacking. Adding the selected ink
									 * (8%) on top of this card's veil (9-12%) is the forbidden stack - the
									 * same arithmetic as the 5% hover that measured 4.30:1 on synthwave -
									 * so the row paints ONE layer, the flat system's chosen ground. The
									 * mark (`AskMark`) is the selection channel that survives any ground.
									 * On glass this is opaque over a translucent card: a stated trade, not
									 * an oversight - a mark-only row is a design decision, and the ask
									 * card cannot be captured by the rig (no queued asks).
									 *
									 * NO HOVER INK IS ADDED HERE either: the label already sits at `ink`,
									 * so a hover step has nowhere brighter to go; the unhovered rows'
									 * fill is suppressed on glass (styles/index.css), so their hover is
									 * cursor-only.
									 */
									chosen ? "bg-sunken" : "hover:bg-sunken",
									disabled ? "text-ink-dim" : "text-ink",
								)}
							>
								<AskMark chosen={chosen} multi={multi} />
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
					{/*
					 * THE `Other` ROW: ALWAYS PRESENT, AND ALWAYS LAST (operator ask, 2026-10-07).
					 *
					 * Every non-secret option question ends in this row, in both select modes,
					 * so how to give an answer the list did not offer is on the card rather than
					 * something a user has to know. It is a member of the SAME group as the
					 * option rows - a radio in a radiogroup, a checkbox in a group - with the
					 * same mark, ground and focus outline, so it reads as one more choice and
					 * a screen reader announces it as one.
					 *
					 * `Other` is the label and `Type your answer` is the hint: the label
					 * alone does not say what pressing it does, which was the operator's
					 * complaint about the old design. The hint goes while the field is open,
					 * because the field's own placeholder says the same thing there and the
					 * two would print it twice.
					 *
					 * ONE SENTENCE, `OTHER_PROMPT`, for the hint, the field's placeholder and the
					 * free-text-only field's placeholder (design review round 1, D4): the first
					 * cut said `Type your own answer` on the row and `Type your answer` in the
					 * field it opens - one prompt in two phrasings, seen one after the other as the
					 * user presses. The accessible name is the same everywhere too, `Your answer
					 * to: <question>`, which is also what the masked field is called.
					 *
					 * Pressing it selects it AND moves focus into the field - this is the user's
					 * own press, the one place this change is allowed to take focus - and
					 * pressing it again when it is already the selected radio re-focuses the
					 * field rather than toggling it off (a radio does not deselect). A ticked
					 * multi-select `Other` unticks, as any checkbox does.
					 */}
					<button
						type="button"
						data-ask-option-other=""
						disabled={disabled}
						aria-pressed={multi ? other.open : undefined}
						aria-checked={multi ? undefined : other.open}
						role={multi ? "checkbox" : "radio"}
						onClick={() => {
							if (multi && other.open) {
								writeOther({ ...other, open: false });
								return;
							}
							focusOtherRef.current = question.id;
							if (other.open) focusAtEnd(otherField.current);
							else writeOther({ ...other, open: true });
						}}
						className={cn(
							"flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-start",
							// Same selected-surface exemption as `AskOptions` above: one role
							// fill, no selected ink on top of the veil. The label is at `ink`,
							// so this row's hover is cursor-only on glass.
							other.open ? "bg-sunken" : "hover:bg-sunken",
							disabled ? "text-ink-dim" : "text-ink",
						)}
					>
						<AskMark chosen={other.open} multi={multi} />
						<span className="min-w-0 flex-1">
							<span>{t("ui.chat.asks.other_label")}</span>
							{/*
							 * A REAL SPACE between the label and the hint, not just the `ms-1.5`
							 * margin: a margin is invisible to the accessible-name computation,
							 * which concatenated the two spans into one announced word -
							 * `OtherType your answer` - as measured in Chrome's own AX tree
							 * (round 2, design D8 / UX U6). The space is what puts the boundary
							 * in the name; the margin stays for the visual gap, which the stills
							 * judge.
							 */} {other.open ? null : (
								<span className="ms-1.5 text-ink-muted text-xs">
									{OTHER_PROMPT}
								</span>
							)}
						</span>
					</button>
					{other.open ? (
						<div className="pt-1 pe-1 pb-1 ps-7">
							<AskAnswerField
								questionId={question.id}
								fieldRef={otherField}
								value={other.text}
								disabled={disabled}
								ariaLabel={`Your answer to: ${question.question}`}
								placeholder={OTHER_PROMPT}
								onChange={(text) => writeOther({ open: true, text })}
								onEnter={() => onAdvance(question.id)}
							/>
						</div>
					) : null}
				</div>
			) : (
				/*
				 * A QUESTION WITH NO OPTIONS: the field IS the control, so it is open - a row
				 * that only reveals the one possible input would be ceremony. It is the same
				 * multi-line, text-only field the `Other` row opens (it replaces a bare
				 * single-line input that gave no sign it accepted more than one line), named
				 * by the question it answers so a first-time user - and a screen reader -
				 * knows it is where to type. It reads the draft cell directly: with no option
				 * list there is no label a typed word could be mistaken for.
				 */
				<AskAnswerField
					questionId={question.id}
					fieldRef={otherField}
					value={other.text}
					disabled={disabled}
					ariaLabel={`Your answer to: ${question.question}`}
					placeholder={OTHER_PROMPT}
					onChange={(text) => writeOther({ open: true, text })}
					onEnter={() => onAdvance(question.id)}
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
	onDismiss,
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
	onDismiss?: AskPanelProps["onDismiss"];
	conversationOf?: AskPanelProps["conversationOf"];
}) => {
	const { ask, status, waiting, canAnswer, canDecline, delivering } =
		presentation;
	/*
	 * THE CARD'S CONTEXT LINE (SA-D7's manager override; harness PR #2833). Read
	 * as a PAIR: a count without its stamp is a shape the queue does not publish,
	 * and the line names both facts (`3 messages from you since this was asked
	 * (last 19:36)`). An older runtime sends neither key, so the line is absent
	 * rather than zero — see `PendingAsk.user_messages_since`.
	 */
	const messagesSince =
		typeof ask.user_messages_since === "number" &&
		Number.isFinite(ask.user_messages_since) &&
		ask.user_messages_since > 0
			? ask.user_messages_since
			: 0;
	const lastUserMessageAt =
		typeof ask.last_user_message_at === "number" &&
		Number.isFinite(ask.last_user_message_at) &&
		ask.last_user_message_at > 0
			? ask.last_user_message_at
			: null;
	const locale = useI18nLocale();
	/*
	 * CHANGING THE INTERFACE LANGUAGE RE-RENDERS THE FORMATTED TIME, which is why
	 * the locale is read through the hook rather than at module scope: a stored
	 * formatter would keep the old locale's clock until the next mount. Memoised on
	 * the pair, because the card re-renders on the countdown's tick and a fresh
	 * formatter per second is work the tick did not ask for.
	 */
	const lastUserMessageTime = useMemo(
		() =>
			lastUserMessageAt === null
				? null
				: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
						new Date(lastUserMessageAt),
					),
		[locale, lastUserMessageAt],
	);
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
	/*
	 * A TYPED SECRET OUTLIVES ITS SEND ONLY WHILE IT MAY BE SENT AGAIN (agent review
	 * round 1, R1-1). The field keeps it through a failure so Retry and an edit both
	 * have it; once the owner ACCEPTS, nothing on this surface needs the value, and a
	 * row that stays mounted as a settled card would otherwise hold it in state for as
	 * long as the pane is open. Cleared on the accepted record, not on the press.
	 */
	const accepted =
		outcome?.settled !== undefined ||
		(status !== "open" && status !== "timed_out");
	useEffect(() => {
		if (accepted)
			setSecrets((current) =>
				Object.keys(current).length === 0 ? current : {},
			);
	}, [accepted]);
	const busy = answering || Boolean(outcome?.sending);
	/*
	 * Count edits, not values (R2-1/U1). Secret fields deliberately live outside
	 * `draft`; comparing only that object's identity left Send disabled after a
	 * secret edit, while Retry still held the original request. Both field paths
	 * advance this non-sensitive revision. Never snapshot plaintext to compare it.
	 * The baseline belongs to ONE retry outcome: a new failed attempt takes a new
	 * baseline, and sending/acceptance removes it. AskRow is keyed by ask id.
	 */
	const [editRevision, setEditRevision] = useState(0);
	const failedRevision = useRef<{
		retry: NonNullable<AskOutcome["retry"]>;
		revision: number;
	} | null>(null);
	const retry = outcome?.retry;
	if (retry === undefined) failedRevision.current = null;
	else if (failedRevision.current?.retry !== retry)
		failedRevision.current = { retry, revision: editRevision };
	const retryPending =
		retry !== undefined && failedRevision.current?.revision === editRevision;
	const retryRef = useRef<HTMLButtonElement>(null);
	/*
	 * Failure disables the pressed Send control. Move focus in the same commit to
	 * its recovery action rather than letting the browser strand it on BODY. A
	 * pairing refusal has no Retry, so its recovery is the answer field itself.
	 */
	const failedOutcome = useRef<AskOutcome | null>(null);
	if (outcome?.refused) failedOutcome.current = outcome;
	useLayoutEffect(() => {
		const failed = failedOutcome.current;
		if (!outcome?.refused || failed !== outcome || failed === null) return;
		failedOutcome.current = null;
		const recovery = retryRef.current;
		const target =
			recovery ?? rowRef.current?.querySelector<HTMLElement>(LIVE_CONTROL);
		target?.focus({ preventScroll: true });
	}, [outcome]);
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
	 * `timed_out` in (the backend's outstanding set), which is
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
	 * owns the FIRST-answer buffer — the user's in-progress reply to a question nobody
	 * has answered yet — and a revision is a different act on a body that already exists.
	 * Folding the two together would let an abandoned change ride into the first answer
	 * of the next ask, and would make "which draft is this?" a question the caller has to
	 * ask of every render.
	 *
	 * The SECRET values are the shared record, deliberately: they are already kept out of
	 * renderable draft state (see `secrets` above), and a masked field is the same channel
	 * on both doors — the backend substitutes the key name either way.
	 */
	const [changing, setChanging] = useState(false);
	/*
	 * THE DISMISS CHOOSER, card-local for the change form's reason (design §10):
	 * the intent belongs to ONE ask, and closing the drawer or settling another ask
	 * must not leave a half-chosen reason on the next card. `open` is the trigger's
	 * own state. THE REASON PRESS DOES NOT CLOSE IT (UX round 1, U6): the press is
	 * what the card reports on while it is in flight, and a refusal has to keep the
	 * chosen reason on screen - closing here was the state the refusal then had no
	 * door back into.
	 */
	const [dismissOpen, setDismissOpen] = useState(false);
	const [pressedReason, setPressedReason] = useState<AskDismissReason | null>(
		null,
	);
	const dismissTrigger = useRef<HTMLButtonElement | null>(null);
	const dismissFirstReason = useRef<HTMLButtonElement | null>(null);
	const armTriggerFocus = useRef(false);
	const dismissSending = outcome?.sending === true;
	/*
	 * FOCUS FOLLOWS THE CONTROL THAT REPLACED THE PRESS (the same contract the
	 * panel's other swaps keep): opening the chooser lands on its first reason.
	 */
	useEffect(() => {
		if (dismissOpen) dismissFirstReason.current?.focus();
	}, [dismissOpen]);
	/*
	 * CANCEL AND ESCAPE RETURN THE KEYBOARD TO THE TRIGGER THEY RE-MOUNT (UX round 1,
	 * U2). The ref is null in the handler that closes the chooser - the trigger only
	 * exists on the NEXT commit - so the move is ARMED there and spent in a layout
	 * effect after the trigger is in the DOM, the same shape this card's `Change
	 * answer` press uses. The first cut called `focus()` in the handler and
	 * measured a no-op (`document.activeElement` stayed on the body).
	 */
	const closeDismiss = () => {
		armTriggerFocus.current = true;
		setPressedReason(null);
		setDismissOpen(false);
	};
	useLayoutEffect(() => {
		if (dismissOpen || !armTriggerFocus.current) return;
		armTriggerFocus.current = false;
		dismissTrigger.current?.focus();
	}, [dismissOpen]);
	/*
	 * A DISMISSAL THAT LANDED ENDS THE CHOOSER. The card usually folds on the same
	 * frame (the wire publishes rows only while the queue is non-empty), but a second
	 * ask can keep it published, and a chooser left open over a settled row would
	 * offer two reasons for an act already done.
	 */
	useEffect(() => {
		if (outcome?.dismissed === undefined) return;
		setDismissOpen(false);
		setPressedReason(null);
	}, [outcome?.dismissed]);
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
	 * body. The one difference is the RECORDED map it is handed: an empty secret field
	 * over a stored key is not a skip here, so that secret needs a retyped value (see
	 * `askSecretIsSkippable`), which is the honest consequence of the value never being
	 * recoverable rather than a second gate. `{}` when the wire carried no map, which
	 * reads conservatively as "retype".
	 */
	const recorded = useMemo(() => ask.answers ?? {}, [ask.answers]);
	const changeReady = useMemo(
		() => askAnswerMap(ask, changeDraft, secrets, recorded) !== null,
		[ask, changeDraft, secrets, recorded],
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
		const row = rowRef.current;
		/*
		 * U7: pressing `Change answer` is a press to EDIT this answer, so when the
		 * answer's own entry is the `Other` field (seeded open from the log), that
		 * field is where the keystrokes go - with the caret at the end, `focusAtEnd`.
		 * It is preferred over the option rows because those cannot be where the
		 * keystrokes were headed: the user is here to revise, and the seeded field
		 * holds the answer they wrote. A question answered by an option has no open
		 * field, so it falls through to the first live control, as before.
		 */
		const seededOther = row?.querySelector<HTMLElement>(
			"textarea[data-ask-other]:not([disabled])",
		);
		focusAtEnd(
			seededOther ??
				row?.querySelector<HTMLElement>(
					/*
					 * THE DRAWER'S OWN SHAPES, and they are not the dock's: an option is a
					 * button carrying `data-ask-option`, the masked field wears
					 * `data-ask-secret` ON THE `<input>` ITSELF, and an answer field is the
					 * `textarea[data-ask-other]` (`LIVE_CONTROL`). `question-dock.tsx` queries a
					 * similar pair but its secret attribute sits on a wrapping div, so its
					 * selector cannot be copied verbatim - a `[data-ask-secret] input` here
					 * matches nothing, and the hand-off would silently fall through to the body
					 * for a secret-only ask. The answer field is in the list because a
					 * free-text-only question has NO option and no secret: without it the change
					 * form for such an ask lands on the body.
					 *
					 * `focusAtEnd`, not `.focus()`: a free-text field seeded from the log holds
					 * text, and a bare focus puts the caret in front of it (round 1, U1).
					 */
					LIVE_CONTROL,
				),
		);
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
	/** The recorded map only in the change form; the first answer has none to keep. */
	const editRecorded = changingNow ? recorded : undefined;
	const writeDraft = changingNow
		? (updater: (current: AskDraft) => AskDraft) => setChangeDraft(updater)
		: setDraft;
	const fieldDisabled = changingNow ? busy : disabled;
	/*
	 * THE TWO SUBMITS, as functions, so the buttons and the answer field's Enter are the
	 * SAME closure rather than two copies that could drift: Enter in a field "does what
	 * `Send answer` does" because it calls this, with the same gate.
	 */
	const sendAnswer = () => {
		const answers = askAnswerMap(ask, draft, secrets);
		if (answers !== null) onAnswer(ask, answers);
	};
	const sendChange = () => {
		if (onRevise === undefined) return;
		const answers = askAnswerMap(ask, changeDraft, secrets, recorded);
		if (answers !== null) onRevise(ask, answers);
	};
	/*
	 * ENTER IN AN ANSWER FIELD (the shared composer's convention: Enter commits,
	 * Shift+Enter is a newline).
	 *
	 *  - A field with NO answer in it commits nothing and stays: moving on from an empty
	 *    answer would skip the question the user is in the middle of.
	 *  - When the whole ask is complete, Enter is `Send answer` (or `Update answer` in the
	 *    change form), through the same gate the button reads - so it cannot send what the
	 *    button would refuse, and it does nothing while an answer is in flight.
	 *  - Otherwise it moves to the next question that still needs an answer (the first one
	 *    after this, wrapping), landing on its first live control. That focus is the
	 *    user's own Enter, so it is allowed; it replaces the retired composer routing's
	 *    "Enter fills the first unanswered question" without ever leaving the card.
	 */
	const advanceFrom = (questionId: string) => {
		const index = ask.questions.findIndex((entry) => entry.id === questionId);
		if (index < 0 || fieldDisabled) return;
		if (
			!askQuestionIsAnswered(
				ask.questions[index],
				editDraft,
				secrets,
				editRecorded,
			)
		)
			return;
		if (changingNow) {
			if (changeReady && onRevise !== undefined) sendChange();
			else focusNextUnanswered(index);
			return;
		}
		if (ready) sendAnswer();
		else focusNextUnanswered(index);
	};
	const focusNextUnanswered = (from: number) => {
		const count = ask.questions.length;
		for (let step = 1; step < count; step++) {
			const candidate = ask.questions[(from + step) % count];
			if (askQuestionIsAnswered(candidate, editDraft, secrets, editRecorded))
				continue;
			// Compared by attribute value, not interpolated into a selector: a question id
			// is the model's string and may carry a quote.
			const block = [
				...(rowRef.current?.querySelectorAll<HTMLElement>(
					"[data-lo-ask-question]",
				) ?? []),
			].find((node) => node.dataset.loAskQuestion === candidate.id);
			focusAtEnd(block?.querySelector<HTMLElement>(LIVE_CONTROL));
			return;
		}
	};
	/** Which question's `Other` field the user's own press just asked to focus. */
	const focusOtherRef = useRef<string | null>(null);
	/*
	 * THE REASON A SETTLED DISMISSAL CARRIES (UX round 1, U1; harness PR-4c adds the
	 * key). PR-4c publishes `dismissed_reason` on the row; an older wire omits it, and
	 * the status contract's own no-reply sentence stands in. Narrowed through the same
	 * reader the request body uses, so a value this app cannot name is never printed
	 * as a reason.
	 */
	const statusDismissReason =
		status === "dismissed" ? askDismissReason(ask.dismissed_reason) : null;
	/*
	 * A REFUSED DISMISSAL SPEAKS THE ACT, NOT THE TRANSPORT (UX round 2, U6). The band
	 * used to print the transport's own sentence ("Desktop controls could not reach the
	 * backend process."), which names the machinery rather than what did not happen to
	 * the ask. The dismissal's band therefore opens with the operator's words - not
	 * dismissed, nothing sent - and appends the ROUTE's sentence when the owner authored
	 * one (`askRefusalIsOwner`), because that sentence is the reason a retry would fail
	 * too. Transport words are never appended: they add no fact the opening does not.
	 */
	const dismissalRefusal =
		outcome?.refused !== undefined && dismissOpen && pressedReason !== null
			? [
					t("ui.chat.asks.dismiss.refused"),
					outcome.refusedByOwner === true ? outcome.refused : null,
				]
					.filter((part): part is string => part !== null && part !== "")
					.join(" ")
			: null;

	return (
		<div
			ref={rowRef}
			data-lo-ask-row={ask.ask_id}
			data-lo-ask-status={status}
			/*
			 * ESCAPE IS CLAIMED AT THE CARD, NOT AT THE CHOOSER'S WRAPPER (agent review
			 * round 2, M-B). The chooser's state is card-local, so the card is the scope
			 * that owns it: with the handler on the wrapper, a reader who clicked another
			 * control in this same card while the chooser was open let Escape fall through
			 * to the drawer and lost the whole panel. Only the OPEN chooser claims the key;
			 * a closed card passes it on unchanged.
			 */
			onKeyDown={(event) => {
				if (!dismissOpen || event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				closeDismiss();
			}}
			/*
			 * `border-hairline`, not `border-control`: `border-control` is the contract's
			 * role for the sole boundary of a CONTROL (3:1 floor) and this is a card -
			 * the transcript's own turn rule takes the hairline for the same reason
			 * (design round 1, D9).
			 */
			/* A text-bearing card whose fill is its boundary: a block on glass
			 * (the veil), so the ask does not read as an opaque island in the
			 * glass drawer. The hairline stays; the fill is the veil. */
			data-glass-block=""
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
					{urgent ? (
						<span className="sr-only">{t("ui.chat.asks.urgent")} </span>
					) : null}
					{statusDismissReason === null
						? askStatusText(ask, nowMs)
						: dismissReceipt(statusDismissReason)}
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
			 *
			 * AND IT IS NOT DRAWN FOR A DISMISSAL (agent review round 1, M1). A dismissed
			 * ask carries its questions but no answers, so this frame printed each
			 * question beside `No answer given` - a receipt that reads as a partial
			 * answer, and the harness refuses the same shape in `asks/render.py`
			 * (`response_text`: a dismissed ask never goes through the report). The
			 * status line above is the whole receipt.
			 */}
			{!canAnswer && !changingNow && status !== "dismissed" ? (
				<div className="flex flex-col gap-1.5">
					{askSettledAnswers(ask).map((entry) => {
						/*
						 * THE ANSWER FRAME KEEPS WHAT WAS WRITTEN. An `Other` answer can be several
						 * lines now, and a plain span collapsed its newlines into one run - so each
						 * value keeps its line breaks (`whitespace-pre-wrap`) and wraps long words
						 * (`break-words`) rather than overflowing the card.
						 *
						 * AND IT NAMES WHAT THE LIST DID NOT OFFER. A value that is none of the
						 * question's labels is tagged with the muted `Other` word, the same word the
						 * pending row carries, so a settled `prod` reads as the user's own answer
						 * rather than as a label that happens to be missing from the list. A secret
						 * question's recorded cell is its KEY NAME (`[deploy_key]`), never an answer
						 * the user typed, so it is never tagged; a free-text-only question has no
						 * list to be outside of.
						 */
						const source = ask.questions.find((q) => q.id === entry.id);
						const offered = (source?.options ?? []).map((o) => o.label);
						const tags = source?.secret !== true && offered.length > 0;
						/*
						 * THE ROW ALREADY NAMED THIS QUESTION (design review round 3, D6). The collapsed
						 * row above the block prints `badge + question`, and the expanded body printed the
						 * SAME sentence again 57 px lower - two lines of repeated reading for the one line
						 * of new information (the status sentence and `No answer given`). Only the
						 * question the trigger already carries is dropped: a second question on a
						 * multi-question ask still gets its label here, because nothing above names it.
						 */
						const echoedByTrigger =
							entry.id === ask.questions[0]?.id &&
							(status === "withdrawn" || status === "timed_out");
						return (
							<div key={entry.id} className="flex flex-col gap-0.5">
								{echoedByTrigger ? null : (
									<span className="text-ink-muted text-xs">
										{entry.question}
									</span>
								)}
								{entry.answers.length > 0 ? (
									entry.answers.map((value, index) => (
										<span
											key={`${index}:${value}`}
											className="whitespace-pre-wrap break-words text-ink text-sm"
										>
											{value}
											{tags && !offered.includes(value) ? (
												/*
												 * A SEPARATOR, so the tag reads as a LABEL and not as the last word
												 * of what the user wrote (design review round 1, D2: `Canary (5% of
												 * traffic) Other` read as one phrase, and a short answer such as
												 * `Staging Other` was ambiguous). The dot is the app's own separator
												 * (the checkpoint rail, the status row) and is decoration only, so it
												 * is hidden from assistive tech; the spaces inside it carry the gap
												 * (the parent keeps whitespace, `whitespace-pre-wrap`).
												 */
												<span className="text-ink-muted text-xs">
													<span aria-hidden="true">{" \u00b7 "}</span>
													{t("ui.chat.asks.other_label")}
												</span>
											) : null}
										</span>
									))
								) : (
									<span className="text-ink text-sm">
										{t("ui.chat.asks.no_answer")}
									</span>
								)}
							</div>
						);
					})}
				</div>
			) : null}
			{canAnswer || changingNow
				? ask.questions.map((question) => (
						<AskQuestionField
							key={question.id}
							question={question}
							selected={draftFor(editDraft, question.id)}
							secret={secrets[question.id] ?? ""}
							secretPlaceholder={askSecretPlaceholder(
								ask,
								question,
								editRecorded,
							)}
							disabled={fieldDisabled}
							onCell={(cell) => {
								setEditRevision((revision) => revision + 1);
								writeDraft((current) => ({ ...current, [question.id]: cell }));
							}}
							onSecret={(value) => {
								setEditRevision((revision) => revision + 1);
								setSecrets((current) => ({ ...current, [question.id]: value }));
							}}
							onAdvance={advanceFrom}
							focusOtherRef={focusOtherRef}
						/>
					))
				: null}
			{/*
			 * THE CONTEXT LINE (SA-D7's manager override; harness PR #2833). It sits
			 * under the question because it is about the conversation's movement since
			 * the question was asked, and it renders ONLY for an ask the agent is still
			 * waiting on: on a settled row it would describe a wait that is over.
			 *
			 * THE COUNT AND THE STAMP ARE ONE FACT, so the line needs both: a count
			 * without a time is a shape the queue does not publish, and an older runtime
			 * publishes neither. `Intl.DateTimeFormat` with `timeStyle: "short"` is the
			 * locale's own clock, so `19:36` does not become `7:36 PM` in a locale that
			 * writes it the other way.
			 */}
			{messagesSince > 0 && lastUserMessageTime !== null && waiting ? (
				<p data-lo-ask-context="" className="text-ink-muted text-meta">
					{t("ui.chat.asks.context.messages_since", {
						count: messagesSince,
						time: lastUserMessageTime,
					})}
				</p>
			) : null}
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
			{/*
			 * THE PRESS IS VISIBLY OUT (Notifications ask-pane fix). The controls disable
			 * while `sending`, but a disabled button alone reads the same as one that never
			 * enabled; the line says the act is in flight. The dismissal chooser states its
			 * own (`Dismissing…`) on the pressed reason, so it is not said twice.
			 */}
			{outcome?.sending === true && !dismissOpen ? (
				<output
					data-lo-ask-sending=""
					className="flex items-center gap-1.5 text-ink-muted text-xs"
				>
					<Loader2 aria-hidden="true" size={14} className="animate-spin" />
					{t("ui.agents.config.state.sending")}
				</output>
			) : null}
			{outcome?.refused ? (
				<output
					data-lo-ask-refused=""
					className="flex flex-wrap items-center gap-2 text-body-sm text-danger"
				>
					<span className="min-w-0 break-words">
						{dismissalRefusal ?? outcome.refused}
					</span>
					{/*
					 * RETRY, ONLY WHERE A SECOND PRESS CAN LAND. `retry` exists only for a
					 * transport failure (`useAskOutcomes`): the request never reached the
					 * owner, so the same act may succeed. An owner's verdict carries none -
					 * a Retry whose only outcome is the sentence above it is the dead
					 * control this panel refuses elsewhere. The draft is untouched, so the
					 * reader's typed answer is still in its field.
					 */}
					{retryPending ? (
						<button
							ref={retryRef}
							type="button"
							disabled={busy || !retryPending}
							onClick={outcome.retry}
							className="min-h-6 rounded-md border border-control px-2 py-1 text-ink text-xs hover:bg-sunken"
						>
							{t("ui.common.actions.retry")}
						</button>
					) : null}
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
					<span className="text-ink">{t("ui.chat.asks.changed_handoff")}</span>
				</p>
			) : null}
			{/*
			 * THE RECEIPT FOR A DISMISSAL THAT LANDED, the `changed` line's sibling - and
			 * SKIPPED WHEN THE STATUS LINE ALREADY SAYS IT (agent review round 1, N1): the
			 * wire (PR-4c) carries `dismissed_reason` on the settled row, so the status line
			 * and this line printed one sentence twice on the mount that dismissed. The
			 * line survives for the frame where the local outcome is ahead of the wire, and
			 * for an older wire that cannot name the reason at all.
			 */}
			{outcome?.dismissed !== undefined &&
			outcome.dismissed !== statusDismissReason ? (
				/*
				 * THE RECEIPT FOR A DISMISSAL THAT LANDED, the `changed` line's sibling and
				 * for its reason: the wire folds the ask to `dismissed` with no marker for
				 * WHICH reason a surface sent, so the card says what the operator chose
				 * rather than only what the backend recorded. The collapsed row carries the
				 * same sentence (see `collapsedRow`), because this card unmounts when the
				 * fold files the ask under Settled.
				 */
				<p className="flex items-start gap-1.5 text-xs">
					<Check
						aria-hidden="true"
						size={14}
						className="mt-0.5 shrink-0 text-success"
					/>
					<span className="text-ink">{dismissReceipt(outcome.dismissed)}</span>
				</p>
			) : null}
			{(canAnswer || canDecline) && !dismissOpen ? (
				<div className="flex items-center gap-2">
					{/*
					 * ONE NEXT ACTION AFTER A TRANSPORT FAILURE (design round 1, D2). While
					 * a retryable failure stands, Retry beside the sentence sends exactly
					 * this answer, and a filled Send answer below it was a second primary
					 * for the same act. Send answer is DISABLED (not hidden, so the row does
					 * not reflow under the pointer) until the reader edits the answer, which
					 * makes it a different act than the one Retry repeats.
					 */}
					<button
						type="button"
						disabled={disabled || !ready || retryPending}
						onClick={sendAnswer}
						className={cn(
							"rounded-md px-3 py-1.5 text-sm",
							/*
							 * The disabled state changes COLOUR, never opacity (branding §2),
							 * and it keeps an EDGE: without one it rendered as body text of the
							 * same weight as `Decline` beside it, so the card's one action that
							 * becomes enabled was also its quietest element (design round 1,
							 * D7).
							 */
							disabled || !ready || retryPending
								? "border border-hairline bg-surface text-ink-dim"
								: "border border-transparent bg-accent text-on-accent hover:bg-accent-hover",
						)}
					>
						{t("ui.chat.asks.send_answer")}
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
							className="rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken hover:text-ink"
						>
							{t("ui.chat.asks.decline")}
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
									onClick={sendChange}
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
									{t("ui.chat.asks.update_answer")}
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
									className="rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken hover:text-ink"
								>
									{t("ui.chat.asks.cancel")}
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
							{t("ui.chat.asks.change_answer")}
						</button>
					)}
				</div>
			) : null}
			{/*
			 * THE DISMISS DOOR (harness PR #2833, SA-D5), on an OPEN ask only and only
			 * where the caller resolved `features.ask_dismiss` — see
			 * `AskPanelProps.onDismiss`. `canAnswer` is the same live-arm predicate the
			 * answer controls read, so a lapsed or settled ask never offers it (D10).
			 *
			 * THE CHOOSER IS INLINE, not a dialog: the card is already the surface the
			 * reader is on, and a modal would dim the question they are deciding about.
			 * Its two rows carry the harness surfaces' vocabulary and order (the phone
			 * sheet, PR #2841): the reason leads, the one-line note says what it means.
			 *
			 * AND IT TAKES THE ACTION ROW'S PLACE WHILE IT IS OPEN (design round 1, D1).
			 * Drawing it UNDER a still-armed `Send answer` put two accent-loud, opposite
			 * actions 28.5px apart, with the one the reader had just opened the quieter of
			 * the two; a misclick sent the answer they had stepped away from. One live
			 * intent at a time, and `Cancel` returns the row.
			 *
			 * ESCAPE CLOSES ONLY THE CHOOSER (UX round 1, U7): the drawer claims Escape as
			 * "put this overlay away", which is right one level up, but the transient step
			 * inside it answers the key first — the sibling TUI does the same with `esc
			 * back`. The claim is cancelled here so the drawer's handler does not also fire.
			 */}
			{onDismiss !== undefined && canAnswer ? (
				<div className="flex flex-col gap-2">
					{dismissOpen ? (
						<>
							<p className="text-ink-muted text-meta">
								{t("ui.chat.asks.dismiss.heading")}
							</p>
							{DISMISS_REASONS.map((reason) => (
								<button
									key={reason}
									ref={reason === "moot" ? dismissFirstReason : undefined}
									type="button"
									/*
									 * `aria-disabled`, NOT `disabled` (UX round 2, U2). A native `disabled`
									 * drops the focused button out of the tab order and the browser resets
									 * `document.activeElement` to BODY for the whole POST; the reader loses
									 * their place on the very press that is supposed to keep it. The control
									 * stays focusable, announces its disabled state, and ignores activation
									 * in the handler.
									 */
									aria-disabled={busy ? true : undefined}
									onClick={() => {
										if (busy) return;
										/*
										 * THE REASON PRESS LEAVES THE CHOOSER UP (UX round 1, U3/U6): while the
										 * POST is in flight the pressed row says so, and a refusal keeps the
										 * choice on screen instead of collapsing the door the reader must
										 * re-open and re-pick.
										 */
										setPressedReason(reason);
										onDismiss(ask, reason);
									}}
									data-lo-ask-dismiss-reason={reason}
									className={cn(
										"flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-control px-3 py-1.5 text-start hover:bg-sunken",
										busy && "text-ink-dim",
										pressedReason === reason && "bg-sunken",
									)}
								>
									<span className="flex min-w-0 items-center gap-1.5 text-ink text-sm">
										{pressedReason === reason ? (
											<Check
												aria-hidden="true"
												className="size-3.5 shrink-0 text-ink-muted"
											/>
										) : null}
										<span className="min-w-0 break-words">
											{dismissReasonTitle(reason)}
										</span>
									</span>
									<span className="truncate text-ink-muted text-meta">
										{dismissSending && pressedReason === reason
											? t("ui.chat.asks.dismiss.in_flight")
											: dismissReasonNote(reason)}
									</span>
								</button>
							))}
							<button
								type="button"
								onClick={closeDismiss}
								className="self-start rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken hover:text-ink"
							>
								{t("ui.chat.asks.dismiss.cancel")}
							</button>
						</>
					) : (
						<button
							ref={dismissTrigger}
							type="button"
							disabled={busy}
							onClick={() => setDismissOpen(true)}
							className="self-start rounded-md border border-transparent px-3 py-1.5 text-ink-muted text-sm hover:bg-sunken hover:text-ink disabled:text-ink-dim"
						>
							{t("ui.chat.asks.dismiss.trigger")}
						</button>
					)}
				</div>
			) : null}
		</div>
	);
};

/**
 * THE RESERVED SLOT IS DRAWN AS THE CARD'S EMPTY FOOTPRINT (design round 3 on #1116, D1
 * = UX U8). Plain space under a collapsed header read as a broken layout; the card's own
 * rounded hairline, with no fill, reads as "this card folded" and keeps the geometry M1
 * reserved. Same radius and border role as the card (`AskRow`), so the two edges align.
 */
const HELD_SLOT_FRAME = "rounded-md border border-hairline";

/**
 * How long the lapse sentence stays in its live region before it is cleared: long
 * enough to be read out behind whatever the screen reader is already saying, short
 * enough that a reader browsing the panel later does not meet a stale sentence.
 */
export const LAPSE_NOTE_CLEAR_MS = 8000;

export const AskPanel = ({
	view,
	onAnswer,
	onDecline,
	onRevise,
	onDismiss,
	answering = false,
	outcomes,
	nowMs,
	drafts,
	onDraftChange,
	conversationOf,
	className,
}: AskPanelProps) => {
	/*
	 * AN UNREAD FRAME DRAWS NOTHING; AN EMPTY ONE STATES ITS EMPTINESS.
	 *
	 * The gate was `view.asks === null`, which was the same fact as "this backend does
	 * not publish queued asks" until the runtime's wire fix - a live-but-empty queue is
	 * now published as `asks` ABSENT with `asks_open: 0` present, so the old read drew
	 * nothing over a live engine, which is the state the drawer now renders as its
	 * designed empty sentence instead. `view.published` is the capability read (asks OR
	 * asks_open present, `ask-queue.ts`'s `askQueuePublished`); the rows and the counts
	 * below are unaffected by it, because an absent list is still zero rows.
	 */
	if (!view.published) return null;
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
	 * "Pending" means "a control on this row can still do something": `canAnswer`, not
	 * the backend's outstanding set. A LAPSED (`timed_out`) ask is outstanding to the
	 * backend but read-only on every surface (D10), so it collapses into the settled
	 * half behind a `Timed out` badge, exactly as a declined ask does (D11) - seeing it
	 * is the reader's own press on its row.
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
	/* NEWEST FIRST within the settled half: a HISTORY is read newest-first. */
	const { pending, settled } = askPanelHalves(view.rows);

	/*
	 * THE FILTER IS A CONTROL, NOT A SUBTITLE (operator ask, 2026-10-05).
	 *
	 * It replaces the `Settled . 17` group node's two jobs with one answerable
	 * question: which half am I reading? `All` is the default and keeps the whole
	 * queue in one list, `Pending` drops the history and `Settled` drops the work -
	 * so the history that used to cost a chevron to escape now costs a press, and
	 * the counts are stated ON the controls rather than in a line of prose about them.
	 *
	 * THE MIDDLE HALF IS `canAnswer || delivering` (`askPanelHalves`): every row a
	 * control can still act on. A §10 answer that is recorded but not yet delivered
	 * belongs to it too - the panel draws it as a pending card. A timed-out ask does
	 * not (D11), which is why the label is `Pending` and no longer
	 * `Waiting or moved on` (design round 1 on #1116, D1).
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
	 * A CARD THAT LAPSES UNDER THE READER STAYS WHERE IT IS (UX round 1 on #1116, U1).
	 *
	 * `answerableSeen` is every ask this MOUNT has drawn as answerable. One of them that
	 * lapses is HELD in the pending half, collapsed in its own slot behind its `Timed out`
	 * badge, instead of jumping to Settled: the jump slid the next card up, and that
	 * card's one-click, irreversible Decline landed exactly under the pointer. The hold
	 * lasts for this mount only, so the row files under Settled the next time the drawer
	 * opens or the conversation changes (both remount the panel). A ref, written during
	 * render, because the hold has to apply on the very frame that lapses the ask; the
	 * adds are idempotent, so a StrictMode double render changes nothing.
	 *
	 * THE SLOT KEEPS THE CARD'S HEIGHT (agent review round 2 on #1116, M1 = QA Q-3).
	 * Collapsing to the 32px header alone still slid the next card up by the difference,
	 * and when the lapsed card had one more option row than the next one, that put the
	 * next card's live Decline exactly under the old Decline point. So the slot reserves
	 * the card's LAST MEASURED height (`cardHeights`, read after every commit while the
	 * card is answerable), header at the top and quiet space below: nothing under it moves.
	 *
	 * The COUNTS stay the truth (`pending`/`settled` above): a held ask is settled, so the
	 * filter, the bar and the empty sentences never count it as pending (m1). What the
	 * views draw for it: under `All`, the collapsed header in its reserved slot; under
	 * `Pending`, an `aria-hidden` spacer of the same height and nothing else, because a
	 * settled row has no place in that view but the card below it still must not move
	 * (U4); under `Settled`, the row with the rest of the history.
	 *
	 * A FILTER PRESS RELEASES EVERY HOLD (U4): the press is the reader's own act, so nothing
	 * is being moved out from under them, and the hold has no reason left. `releaseHolds`
	 * forgets every ask that is not answerable now; the counter re-renders even when the
	 * pressed chip was already selected, which `setFilter` alone would skip.
	 */
	const answerableSeen = useRef<Set<string>>(new Set());
	for (const row of view.rows) {
		if (row.canAnswer) answerableSeen.current.add(row.ask.ask_id);
	}
	const cardHeights = useRef<Map<string, number>>(new Map());
	const [, setReleases] = useState(0);
	const releaseHolds = () => {
		answerableSeen.current = new Set(
			view.rows.filter((row) => row.canAnswer).map((row) => row.ask.ask_id),
		);
		setLanding((current) => ({ ...current, text: "" }));
		setReleases((count) => count + 1);
	};
	const shown = askPanelHalves(view.rows, answerableSeen.current);
	const heldIds = new Set(
		shown.pending.filter((row) => row.lapsed).map((row) => row.ask.ask_id),
	);
	/*
	 * AND THE KEYBOARD FOLLOWS IT. A focused control inside the card unmounts when the
	 * card collapses, and the browser drops focus to BODY (measured, U1). So the ask the
	 * keyboard is inside is read DURING RENDER, while the DOM still holds the frame
	 * before the commit - the one moment the doomed control is still `activeElement`.
	 * Focus EVENTS are not the source: a window without OS focus fires no `focusin`
	 * (measured in headless Chrome), which left the reader's position unrecorded. When
	 * that ask has JUST become held and focus fell to BODY, the keyboard lands on the
	 * held row's own header - never on the next card's controls. "Just" is `prevHeld`:
	 * an ask held on an earlier frame is never re-focused, so this cannot steal a
	 * keyboard the reader has since moved away. Focus outside the panel records nothing.
	 */
	const panelRef = useRef<HTMLDivElement | null>(null);
	const prevHeld = useRef<ReadonlySet<string>>(new Set());
	/*
	 * FOCUS AFTER A DISMISSAL (UX round 1 U2; round 2 U2 = QA Q-1). A landed dismissal
	 * unmounts the card under the reader's keyboard, so the hand-off has to land on
	 * something that SURVIVES the landing. The rule is positional: the NEXT card's first
	 * control (the card that takes the empty slot); with no card left, the COMPOSER - not
	 * the panel's list, which is the element the drawer's #864 auto-close removes in the
	 * very next commit (the single-ask case, and the common one). The list remains the
	 * fallback only where no composer exists (the fleet pane).
	 *
	 * AND IT ONLY MOVES A KEYBOARD THAT LOST ITS PLACE (agent review round 2, M-A): the
	 * effect fires for a row leaving the panel, not for the reader choosing to type while
	 * the POST is in flight. If focus is somewhere outside the panel and still connected,
	 * the arm is dropped and nothing is stolen.
	 *
	 * WHY THE INDEX AND NOT THE ID ALONE: the next card is positional. A `nextElement`
	 * read after unmount would skip a row the reader never saw; the recorded index is
	 * where the removed card was, and it clamps to the list length for the last card.
	 */
	const dismissFocus = useRef<{ id: string; index: number } | null>(null);
	const dismissAsk = (ask: PendingAsk, reason: AskDismissReason) => {
		const index = view.rows.findIndex((row) => row.ask.ask_id === ask.ask_id);
		if (index >= 0) dismissFocus.current = { id: ask.ask_id, index };
		onDismiss?.(ask, reason);
	};
	/*
	 * THE HAND-OFF ITSELF, shared by the two moments that can take the focused node
	 * away. The landing is computed from the cards OTHER than the dismissed one, so the
	 * same rule answers both "the card is still here" (the response landed, the frame
	 * has not) and "the card has gone" (the frame landed first): the card that takes
	 * the slot, else the composer, else the list.
	 */
	const handOffDismissFocus = useCallback(
		(pending: { id: string; index: number }) => {
			const list = panelRef.current;
			if (list === null) return;
			const now = document.activeElement;
			const lost =
				now === null ||
				now === document.body ||
				!now.isConnected ||
				list.contains(now);
			dismissFocus.current = null;
			if (!lost) return;
			const others = [
				...list.querySelectorAll<HTMLElement>("[data-lo-ask-row]"),
			].filter((node) => node.dataset.loAskRow !== pending.id);
			const next = others[Math.min(pending.index, others.length - 1)];
			const target =
				next?.querySelector<HTMLElement>(
					"button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
				) ??
				document.querySelector<HTMLElement>(COMPOSER_TEXTAREA_SELECTOR) ??
				list;
			target.focus({ preventScroll: true });
		},
		[],
	);
	/*
	 * THE RESPONSE TAKES THE FOCUSED ROW BEFORE THE FRAME DOES (UX round 3, U2). A
	 * landed dismissal closes the chooser - and unmounts the focused reason - as soon as
	 * the response arrives, while the card itself waits for the next ask-state frame
	 * (measured ~1.2 s later). Between the two there was no owner for the keyboard, so
	 * `document.activeElement` was BODY and anything typed in that window was lost. The
	 * arm is therefore spent HERE, in a layout effect on the outcome, before the chooser
	 * closes.
	 */
	useLayoutEffect(() => {
		const pending = dismissFocus.current;
		if (pending === null) return;
		const landed = outcomes?.[pending.id];
		if (landed?.dismissed === undefined || landed.sending === true) return;
		handOffDismissFocus(pending);
	}, [outcomes, handOffDismissFocus]);
	/*
	 * AND THE FRAME THAT REMOVES THE CARD, for every departure this surface did not
	 * cause (UX round 3, U9): another surface settling the ask removes the row here
	 * while this press is still in flight, and the 409 arrives afterwards. The arm is
	 * deliberately NOT cleared on a refusal for that reason - the `lost` guard above is
	 * what keeps a stale arm harmless (it moves nothing while the keyboard is somewhere
	 * connected and outside the panel), and clearing it would leave that race with no
	 * owner at all.
	 */
	useLayoutEffect(() => {
		const pending = dismissFocus.current;
		const list = panelRef.current;
		if (pending === null || list === null) return;
		const cards = [...list.querySelectorAll<HTMLElement>("[data-lo-ask-row]")];
		if (cards.some((node) => node.dataset.loAskRow === pending.id)) return;
		handOffDismissFocus(pending);
	});
	const active =
		typeof document === "undefined" ? null : document.activeElement;
	const focusedRow =
		active !== null && panelRef.current?.contains(active)
			? active.closest("[data-lo-ask-row], [data-lo-ask-held]")
			: null;
	const focusedAsk =
		focusedRow?.getAttribute("data-lo-ask-held") ??
		focusedRow?.getAttribute("data-lo-ask-row") ??
		null;
	/*
	 * WHAT A LAPSE DROPPED IS SAID ONCE (UX round 2 on #1116, U5). Text typed or an
	 * option picked in a card that lapses cannot be sent, and the collapse removed it
	 * without a word. The panel's own polite region states it, only when the card held
	 * something: an untouched card lost nothing. `prevDrafts` is the draft as it stood on
	 * the frame before, in case the owner of the drafts clears it on the same frame.
	 *
	 * "Something" is a pick or typed text: an opened `Other` writes `[""]` with nothing in
	 * it (review round 3, m2), which could never have been sent.
	 *
	 * EACH LAPSE IS ITS OWN ANNOUNCEMENT (review round 3, m1 = QA Q-4). A live region
	 * speaks on a DOM change, so writing the same sentence twice said nothing the second
	 * time. The sentence is keyed per lapse, so React replaces the text node each time,
	 * and it is cleared after `LAPSE_NOTE_CLEAR_MS` so a reader browsing later does not
	 * find a stale sentence.
	 */
	const [lapseNote, setLapseNote] = useState<{ seq: number; text: string }>({
		seq: 0,
		text: "",
	});
	const prevDrafts = useRef(drafts);
	/*
	 * THE LANDING FOR A LAPSE UNDER `Pending` (UX round 4 on #1116, U10/U11 = QA round 5,
	 * Q-5). The held ask is only a spacer there, with nothing to focus. Landing on the
	 * selected chip let Space/Enter press it (U7); landing on the filter group let
	 * Tab+Space press `All` (Q-5) - either press releases every hold and slides the next
	 * card under the pointer. So focus lands on a hidden element placed AFTER the chips
	 * and BEFORE the first card: its text says why focus moved, Tab from it goes forward
	 * into the next card (as under `All`), and only a deliberate Shift+Tab reaches the
	 * chips. Its text is set first and focused on the commit that renders it.
	 *
	 * A REQUEST, NOT A FLAG (agent review round 6, M1 = QA round 6, Q-6). A second lapse
	 * set the same text, React bailed out, nothing committed and focus stayed on BODY;
	 * and the armed flag then took the keyboard on some later, unrelated render. So each
	 * lapse is a NEW request (`seq`), which always commits; the layout effect consumes it
	 * exactly once, and moves focus only if focus is still lost - BODY, disconnected, or
	 * inside the card that lapsed (`from`). A request that finds the reader elsewhere is
	 * dropped, never deferred.
	 *
	 * AND THE SENTENCE IS GONE ONCE FOCUS LEAVES (review m1 = UX U14): it explains a
	 * focus move, so it stays only while focus is on it, never as a stale line between
	 * the chips and the first card.
	 */
	const [landing, setLanding] = useState<{
		seq: number;
		text: string;
		from: string | null;
	}>({ seq: 0, text: "", from: null });
	const landingText = landing.text;
	const landingRef = useRef<HTMLDivElement | null>(null);
	const landingConsumed = useRef(0);
	useEffect(() => {
		if (lapseNote.text === "") return;
		const clear = setTimeout(
			() => setLapseNote((note) => ({ seq: note.seq, text: "" })),
			LAPSE_NOTE_CLEAR_MS,
		);
		return () => clearTimeout(clear);
	}, [lapseNote]);
	useLayoutEffect(() => {
		/*
		 * `preventScroll` on BOTH landings (U10): a target above the fold scrolled the
		 * list back to it, which moved the next card under the pointer by another route.
		 */
		if (landing.seq !== landingConsumed.current) {
			landingConsumed.current = landing.seq;
			const now = document.activeElement;
			const lost =
				now === null ||
				now === document.body ||
				!now.isConnected ||
				(landing.from !== null &&
					now.closest("[data-lo-ask-row]")?.getAttribute("data-lo-ask-row") ===
						landing.from);
			if (lost && landingRef.current !== null)
				landingRef.current.focus({ preventScroll: true });
		}
		const newlyHeld = [...heldIds].filter((id) => !prevHeld.current.has(id));
		const held = prevHeld.current;
		prevHeld.current = heldIds;
		/*
		 * Last measured height of every card still answerable, for the held slot (M1).
		 * One query per commit, indexed by id (review round 3, n1): this runs on the
		 * clock's tick as well, so a per-row query would grow with the square of the rows.
		 */
		const cards = new Map(
			[
				...(panelRef.current?.querySelectorAll<HTMLElement>(
					"[data-lo-ask-row]",
				) ?? []),
			].map((el) => [el.getAttribute("data-lo-ask-row"), el]),
		);
		for (const row of view.rows) {
			if (!row.canAnswer) continue;
			const height =
				cards.get(row.ask.ask_id)?.getBoundingClientRect().height ?? 0;
			if (height > 0) cardHeights.current.set(row.ask.ask_id, height);
		}
		const dropped = newlyHeld.filter((id) =>
			Object.values(prevDrafts.current[id] ?? drafts[id] ?? {}).some((values) =>
				values.some((value) => value.trim() !== ""),
			),
		).length;
		prevDrafts.current = drafts;
		/* Counted, so two answers lost in one lapse are not called one (UX U9). */
		if (dropped > 0)
			setLapseNote((note) => ({
				seq: note.seq + 1,
				text:
					dropped === 1
						? "That question timed out; your answer was not sent."
						: `${dropped} questions timed out; your answers were not sent.`,
			}));
		const id = focusedAsk;
		if (id === null || !heldIds.has(id) || held.has(id)) return;
		const now = document.activeElement;
		if (now !== null && now !== document.body && now.isConnected) return;
		/* Under `Pending`: the landing above (U10/U11, Q-5), counted per commit. */
		if (filter === "outstanding") {
			setLanding((current) => ({
				seq: current.seq + 1,
				text:
					newlyHeld.length === 1
						? "Question timed out"
						: `${newlyHeld.length} questions timed out`,
				from: id,
			}));
			return;
		}
		/* Matched by attribute VALUE rather than a composed selector: an ask id is the
		 * backend's string and needs no escaping this way. */
		const slot = [
			...(panelRef.current?.querySelectorAll<HTMLElement>(
				"[data-lo-ask-held]",
			) ?? []),
		].find((row) => row.getAttribute("data-lo-ask-held") === id);
		slot
			?.querySelector<HTMLElement>("button[aria-expanded]")
			?.focus({ preventScroll: true });
	});

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
			onDismiss={onDismiss === undefined ? undefined : dismissAsk}
			conversationOf={conversationOf}
		/>
	);

	/*
	 * ONE COLLAPSED ROW, used by the settled half AND by a held lapsed card (UX round 1
	 * on #1116, U1): a card that lapses under the reader collapses IN ITS OWN SLOT into
	 * exactly the row it will be under Settled on the next mount, so the two cannot drift.
	 */
	/*
	 * THE ANSWER RIDES ON THE ONE-LINE ROW (operator report on the Notifications pane):
	 * one conversation can hold two near-identical asks, and a settled history of
	 * `Answered · <question>` rows told the reader WHICH question was settled but not
	 * WITH WHAT - so an answered ask could be mistaken for its open twin. Each answered
	 * question's recorded values follow the question, in the muted step and clamped to
	 * two lines (the expanded card keeps the full text). A secret question's cell is a
	 * key name, never shown here.
	 */
	const settledAnswerLine = (presentation: (typeof view.rows)[number]) => {
		const answered = askSettledAnswers(presentation.ask)
			.filter(
				(entry) =>
					presentation.ask.questions.find((q) => q.id === entry.id)?.secret !==
					true,
			)
			.flatMap((entry) => entry.answers)
			.filter((value) => value.trim() !== "");
		return answered.length === 0 ? null : (
			<span
				data-lo-ask-settled-answer=""
				className="line-clamp-2 min-w-0 whitespace-normal break-words text-ink-muted text-meta"
			>
				{answered.join(", ")}
			</span>
		);
	};

	const collapsedRow = (
		presentation: (typeof view.rows)[number],
		/*
		 * A HELD row sits inside the reserved slot's rounded frame, so its trigger's
		 * hover fill and ring take the frame's inner radius (design round 4, D6).
		 */
		{ held = false }: { held?: boolean } = {},
	) => {
		/*
		 * The one line, and the two things it has to keep apart (D9): the
		 * status WORD (`askStatusWord`, the copy contract's own leading clause)
		 * and the question. `Timed out`, `Declined` and `Answered` are what tells the
		 * reader what became of two look-alike rows, so the word is
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
		const refusal = outcomes?.[presentation.ask.ask_id]?.refused ?? null;
		/*
		 * THE DISMISSAL'S RECEIPT, ON THE ONE-LINE ROW (harness PR #2833). A
		 * dismissal folds the ask into the settled half, so the card that carried the
		 * chooser is normally collapsed by the next frame — this is where the reader
		 * can still see WHICH reason they gave. No mark: the chip already says
		 * `Dismissed`, and a second success glyph on a one-line row would compete with
		 * it (the same restraint the refusal line takes).
		 */
		const dismissal = outcomes?.[presentation.ask.ask_id]?.dismissed;
		return (
			<Disclosure
				key={presentation.ask.ask_id}
				triggerClassName={cn(
					"text-ink hover:bg-row-hover hover:text-ink",
					held && "rounded-t-[9px]",
				)}
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
							{/*
							 * THE ANSWER SITS IN THE QUESTION'S COLUMN (design round 1, D1): as a
							 * sibling of the chip row it started under the chevron, so a stack of
							 * settled rows scanned chip, question, then an answer jutting left.
							 */}
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="min-w-0 whitespace-normal break-words text-ink text-meta">
									{question}
								</span>
								{settledAnswerLine(presentation)}
							</span>
						</span>

						{refusal === null ? null : (
							/*
							 * The danger band and no mark, for the reason the card's own
							 * line gives above: one refusal, one treatment, on both
							 * surfaces.
							 */
							<span className="min-w-0 text-danger text-meta">{refusal}</span>
						)}
						{dismissal === undefined ||
						askDismissReason(presentation.ask.dismissed_reason) !==
							null ? null : (
							/*
							 * ONE RECEIPT (agent review round 1, N1). The local outcome is the only
							 * source on an older wire; harness PR-4c puts the reason on the ROW, and
							 * then the card's own status line states it - printing this line as well
							 * made the sentence appear twice on the mount that dismissed.
							 */
							<span className="min-w-0 text-ink-muted text-meta">
								{dismissReceipt(dismissal)}
							</span>
						)}
					</span>
				}
			>
				<div className="pt-1.5">{askRow(presentation)}</div>
			</Disclosure>
		);
	};

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
			aria-label={t("ui.chat.asks.filter_label")}
			className="m-0 flex items-center gap-1 border-0 p-0 px-1"
		>
			{(
				[
					["all", "All", view.rows.length],
					/*
					 * `Pending`, the panel's own word for the half (`askPanelHalves`) and the
					 * opposite of `Settled` (design round 1 on #1116, D1). It replaced
					 * `Waiting or moved on`, coined when a timed-out ask was a pending card;
					 * since D11 that ask is settled, so the old label named a set the half no
					 * longer held. The backend's TUI filter takes the same word (#2481).
					 */
					["outstanding", "Pending", pending.length],
					["settled", "Settled", settled.length],
				] as const
			).map(([value, label, count]) => (
				<button
					key={value}
					type="button"
					aria-pressed={filter === value}
					onClick={() => {
						releaseHolds();
						setFilter(value);
					}}
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
	 *
	 * AND "NO ROWS" IS NOT "NOTHING OUTSTANDING" (remediation round 1, R1). The wire
	 * bound drops the whole row list while deliberately keeping the tally
	 * (`_bound_asks_in_place`), so a frame can arrive carrying `asks_open: 4` and no
	 * rows at all. Gating this sentence on the rows alone printed `No asks
	 * outstanding. The agent is not waiting on anything.` over four answerable asks -
	 * the panel denying the count in the bar above it. So a nonzero tally states what
	 * is missing instead.
	 *
	 * IN THE USER'S WORDS, AND WITHOUT REPEATING THE BAR (design round 2, D2-1 = UX
	 * round 2, U2-2). The first spelling was `${askChipCountClause(view)}. This frame
	 * carries the count, not the rows.` - "frame" is the wire's word for the payload
	 * and the reader has none to act on, and the count it opened with was the count the
	 * bar had already given 30px above it, in the same ink rung (the shape D5 corrected
	 * in the unread pair). The body now says only what the bar cannot: the rows behind
	 * that count are the half that is missing. `asks_open` is still NOT translated into
	 * the lane's `waiting` (see `askChipClause`), because that word means "inside its own
	 * window", which a rowless frame cannot know.
	 */
	const emptySlice =
		view.rows.length === 0
			? view.open > 0
				? "The details for these asks could not be loaded."
				: "No asks outstanding. The agent is not waiting on anything."
			: /*
				 * The TRUE pending count, not the drawn one (m1): a held ask is settled, so
				 * `Pending · 0` owes its sentence even while a spacer still holds a slot. It
				 * is drawn only when nothing is pending, so it cannot push a live card down.
				 */
				filter === "outstanding" && pending.length === 0
				? "No asks are pending. They have all settled — see Settled."
				: filter === "settled" && settled.length === 0
					? "No asks have settled yet. They are all still pending."
					: null;

	return (
		<div
			ref={panelRef}
			data-lo-ask-panel="open"
			tabIndex={-1}
			className={cn("flex w-full flex-col gap-2", className)}
		>
			{view.rows.length > 0 ? filterControl : null}
			{/*
			 * A bare polite live region rather than an `<output>` (U5): the panel's
			 * `<output>`s are its per-card refusal lines, and the rigs and tests that read
			 * "the panel's output" mean those. Mounted empty, so the first sentence written
			 * into it is announced.
			 */}
			<div data-lo-ask-lapse-note="" aria-live="polite" className="sr-only">
				{lapseNote.text === "" ? null : (
					<span key={lapseNote.seq}>{lapseNote.text}</span>
				)}
			</div>
			{/*
			 * THE EMPTY LINE SITS UNDER THE CONTROL IT ANSWERS (design round 1, D1 = UX
			 * round 1, U2): the sentence is about the SLICE the chips selected, so it reads
			 * after them rather than above them. With no rows at all there is no chip row, and
			 * the queue's own line is then simply the first thing in the panel.
			 */}
			{emptySlice === null ? null : (
				/*
				 * `data-lo-ask-empty` IS THE MARKER THE EVIDENCE RIG READS (remediation round 1,
				 * D4): without it the story run's `emptySentence` read `null` for a frame that
				 * does draw this sentence, so the set's own record asserted the claim with a
				 * substring of `bodyText` prose instead of with a marker.
				 *
				 * AND ITS INK IS THE QUIET RUNG (D2). `text-ink` made the emptier state the
				 * LOUDER one - measured 11.95:1 on the drawer ground against the scope line's
				 * 7.08:1 directly above it - so the read landing on `nothing` weight-popped. The
				 * two "no rows" bodies now read as one family, and `ink` stays for rows.
				 */
				<p data-lo-ask-empty="" className="px-3 py-2 text-ink-muted text-body">
					{emptySlice}
				</p>
			)}
			{filter === "outstanding" && landingText !== "" ? (
				<div
					ref={landingRef}
					data-lo-ask-lapse-landing=""
					tabIndex={-1}
					className="sr-only"
					/*
					 * Space on a focused non-control scrolls its container by a page, which
					 * slid the next card under the pointer (U7, measured). Only when the
					 * landing itself is the target; nothing else handles keys here.
					 */
					onKeyDown={(event) => {
						if (event.target === event.currentTarget && event.key === " ")
							event.preventDefault();
					}}
					onBlur={() => setLanding((current) => ({ ...current, text: "" }))}
				>
					{landingText}
				</div>
			) : null}
			{showPending
				? shown.pending.map((presentation) => {
						const id = presentation.ask.ask_id;
						if (!heldIds.has(id)) return askRow(presentation);
						const height = cardHeights.current.get(id);
						const reserve =
							height === undefined ? undefined : { minHeight: `${height}px` };
						return filter === "outstanding" ? (
							<div
								key={id}
								data-lo-ask-spacer={id}
								aria-hidden="true"
								className={HELD_SLOT_FRAME}
								style={reserve}
							/>
						) : (
							<div
								key={id}
								data-lo-ask-held={id}
								className={HELD_SLOT_FRAME}
								style={reserve}
							>
								{collapsedRow(presentation, { held: true })}
							</div>
						);
					})
				: null}
			{showSettledRows && (showPending ? shown.settled : settled).length > 0 ? (
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
					{showPending && shown.pending.length > 0 ? (
						<p className="px-3 pt-1 text-ink-dim text-meta">
							{t("ui.chat.asks.settled_heading")}
						</p>
					) : null}
					{(showPending ? shown.settled : settled).map((presentation) =>
						collapsedRow(presentation),
					)}
				</div>
			) : null}
		</div>
	);
};
