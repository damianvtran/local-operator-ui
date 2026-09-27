/**
 * The agent's question, DOCKED above the composer (chat redesign §F1).
 *
 * ## Why it is docked rather than inline
 *
 * The question used to render as the transcript's last item. A long turn put it
 * off-screen - the scroll-hunt failure the UX baseline recorded (U14) - and it is
 * the one thing on screen the agent is blocked on, so § 7's first tier says it must
 * be unmissable. Docking it at the composer's top edge also makes the focus order
 * deterministic (card -> composer) and keeps the scroll-to-bottom control from ever
 * covering it. The spec takes this against the inline reading deliberately.
 *
 * ## What the card is
 *
 * One elevated card, radius 14, with a 1px `accent` border - the accent's one spend
 * on this card (branding § 2); the options inside are rows (`AskOptions`), not
 * controls with edges of their own. The header line names what is happening
 * (`The agent is asking` / `Sending your answer…`), the question is at
 * `text-heading` in `ink`, and a hint line under the options names the keys that
 * actually work.
 *
 * ## Esc collapses it to a pill, and only that
 *
 * `Esc` inside the card collapses it to a `? The agent is asking · Show` pill at
 * the same docked position and hands focus back to the composer - visible and
 * reversible, so the reader who wanted the transcript back has it without losing
 * the question. It never stops the turn: nothing is running while a question is
 * pending, and this is the one place Esc's meaning is not "stop". The press is
 * claimed with `preventDefault`, which is the claim the app-wide interrupt
 * listener already defers to (`use-interrupt-on-escape.ts`'s ladder).
 *
 * The collapsed state is keyed on the QUESTION (`request_id` + `question_index`),
 * not a boolean: collapsing one question does not hide the next one the agent
 * asks, which is a new claim on the reader's attention.
 *
 * ## An approval gate
 *
 * `kind: "approval"` carries the client's own pair (`APPROVAL_OPTIONS` — the wire
 * sends no options for this kind) and docks the same way with its own hint,
 * because it is the same blocked-on-you state. The pair arrived with main's
 * approval-options change and was CARRIED INTO THIS CARRIER BY THE FOLD ONTO
 * `601a9d5032`: the transcript no longer draws the gate at all (§F1), so a
 * resolution that dropped main's arm would have silently removed buttons the
 * shipped app offers. The hint's sentence names the three exits the arm creates
 * — the pair, the composer's typed path (yes/no and the ordininals the rows
 * print), and Escape with its message-box scope.
 *
 * ## A secret ask
 *
 * `secret: true` arrives with EMPTY options: the answer is a credential, and
 * the one surface allowed to hold it is the masked field THIS CARD draws
 * (`SecretAnswer`) — the composer refuses input while a secret question waits
 * (`message-input.tsx`'s `secretAnswer` term), so the field is the whole of the
 * answer path and the hint names it. The field sends through the same
 * one-answer machinery as an option press (`answerGateSecret`), clears once the
 * answer was SENT, and is keyed per question (`questionKeyOf`) so its state
 * cannot survive into the next one. Its DRAFT is owned by this dock rather than
 * by the field, so collapsing the card (which unmounts the field) cannot drop a
 * typed secret (UX round 1, U3). A refusal holds the field only as long as the
 * outcome entitles it to: a DEFINITE not-sent refusal releases the field so the
 * kept value can be sent again, while an UNKNOWABLE outcome holds it (a retry
 * could send it twice) and swaps the hint to a sentence that names no dead
 * control. This is the desktop arm of a rule the phone card and the terminal
 * picker already keep: a credential is never typed into a surface that cannot
 * mask it.
 */

import { Button, Input } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PendingDesktopGate } from "../../../../../../shared/desktop-session-contract";
import { APPROVAL_OPTIONS, gateIsSecret } from "../../ask-answer";
import { focusComposer } from "../../composer-field";
import { MarkdownRenderer } from "../markdown-renderer";
import { AskOptions } from "./ask-options";

export type QuestionDockProps = {
	gate: PendingDesktopGate;
	/** Submit an option's label; absent where the surface cannot answer. */
	onAnswer?: (label: string) => void;
	/**
	 * Submit the secret field's typed value; absent where the surface cannot
	 * answer (the field then renders disabled rather than accepting a value
	 * nothing can hand over).
	 *
	 * A callback of its own rather than a reuse of `onAnswer`: an option press
	 * submits a LABEL whose resolution is the client's own vocabulary rules
	 * (`approvalVerdict`), while a secret is a typed value with its own empty
	 * rule and its own refusal semantics (`answerGateSecret`). Folding the two
	 * into one prop would leave this component deciding which machinery a
	 * string belongs to from the gate it happens to render, which is exactly
	 * the read the two answer paths moved out of the view and into
	 * `ask-answer.ts` for.
	 */
	onAnswerSecret?: (value: string) => void;
	/** An answer is in flight from any surface: every option is disabled. */
	answering?: boolean;
	/**
	 * This panel's own record of the gate it answered: the card holds itself
	 * disabled after a press until the gate moves, and `refused` carries the
	 * sentence when the owner would not take the answer. `retryable` is
	 * `answerReport`'s classification of a refusal — `true` only for the arms
	 * that DEFINITELY did not send (so the secret field may offer the kept value
	 * again), absent/false for the unknowable arm whose hold must stay. Optional
	 * with the hold as the default, because a caller that did not classify a
	 * refusal is not entitled to reopen a send.
	 */
	answer?: {
		sending: boolean;
		refused: string | null;
		retryable?: boolean;
	} | null;
	/** Extra classes on the dock's outer box (the caller owns the measure). */
	className?: string;
};

/** The identity of one question: a new question is a new claim on the reader. */
export const questionKeyOf = (gate: {
	request_id: string;
	question_index: number;
}) => `${gate.request_id}:${String(gate.question_index)}`;

/**
 * The hint line's copy, as a function so the suite asserts it without a DOM.
 *
 * It names only keys that WORK: `Up/Down` and `Enter` inside the options, `1-9`
 * because the card answers a digit directly, `Esc` because it collapses the card,
 * and the composer below because the options are never guaranteed exhaustive. A
 * `secret` ask carries no options and the composer is NOT its answer path
 * (see `SecretAnswer`), so its hint names the field the card itself draws.
 */
export const questionDockHint = (
	gate: PendingDesktopGate,
	held = false,
): string => {
	if (gate.kind === "approval")
		/*
		 * THE THREE EXITS, IN THE ORDER A READER MEETS THEM (main's approval-options
		 * copy, carried into this carrier by the fold): the pair this card now draws
		 * above the sentence, the composer's typed path - yes/no kept from when it
		 * was the only path, plus the `1`/`2` the rows print, which resolve through
		 * `approvalAnswerValue` because digits that work but are unnameable are the
		 * trap the ask hint records (UX round 1, U6) - and Escape, which aborts the
		 * WHOLE turn. On a paired backend that predates the control Escape does
		 * nothing, and the composer says so while the turn runs; the card stays
		 * unconditional rather than reading the capability a second time.
		 *
		 * AND THE HELD SENTENCE IS THE COMPOSER'S (agent review round 1, finding 7;
		 * UX round 1, U2/U3): while a refused or unconfirmed answer holds the card,
		 * its options are disabled for the rest of the card's life, so the
		 * buttons-first sentence would instruct the two controls that cannot send.
		 *
		 * THE ESCAPE CLAUSE KEEPS THIS DOCK'S SCOPE (design round 2, D26): Escape
		 * means two things while a card is docked - inside the card it hides the
		 * card; in the message box it is the turn's interrupt - and this sentence is
		 * where both scopes are named (§F1). Main's card could say "press Escape to
		 * stop the turn" bare because collapsing does not exist there; here the
		 * scopes are the point, so the clause is the dock's own.
		 */
		return held
			? "Answer from the composer instead: type yes, no, 1, or 2 and send, or press Escape in the message box to stop the turn."
			: "Choose Approve or Deny above, type yes, no, 1, or 2 and send, or press Escape in the message box to stop the turn.";
	const prefix =
		gate.question_total > 1
			? `Question ${gate.question_index + 1} of ${gate.question_total}. `
			: "";
	/*
	 * THE SECRET SENTENCE, and what it may name: the field the card draws (type
	 * or paste), `Enter` (the field's form submits, and the button is the same
	 * door), `Esc` (the dock's own collapse - NOT the turn's interrupt, which
	 * this sentence does not claim). It deliberately does NOT repeat the
	 * field's own reassurance line or invite the composer, which refuses input
	 * while this question waits.
	 *
	 * AND THE HELD SENTENCE NAMES NO DEAD CONTROL (design round 1, D1; UX round
	 * 1, U1; QA round 1, Q-1). While an UNKNOWABLE outcome holds the card the
	 * field and Send are disabled, so the idle sentence's "Enter sends" would
	 * instruct a key that cannot send - the same class the approval arm's held
	 * sentence exists for, and `ask-options.test.mjs` pins the pair beside each
	 * other. What remains true in the held state is the reason (the answer may
	 * have landed, so nothing can send again) and the one working key, `Esc` -
	 * the composer cannot be named as an exit: it refuses input while this
	 * question waits.
	 */
	if (gate.kind === "ask" && gateIsSecret(gate))
		return held
			? `${prefix}Held while this answer's fate is unknown — it may have landed, so nothing can send again · Esc hides`
			: `${prefix}Type or paste the secret above · Enter sends · Esc hides`;
	if (gate.options.length === 0) return `${prefix}Type your answer below.`;
	const digits =
		gate.options.length === 1 ? "1" : `1-${Math.min(gate.options.length, 9)}`;
	return `${prefix}Up/Down choose · Enter or ${digits} answers · Esc hides · or type your own answer below`;
};

/**
 * The masked field a `secret` ask is answered from.
 *
 * ## Why the answer moved OFF the composer
 *
 * A `secret` ask used to render like any free-text ask: the hint said "Type
 * your answer below" and the credential was typed into the composer, in
 * clear, through a route that also persisted composer drafts and the
 * recalled-message log. The phone card and the terminal picker never did that
 * — both draw a masked field on the card itself
 * (`mobile/web/src/components/pending-card.tsx`; `tui/widgets/ask_picker.py`'s
 * "Paste the value (hidden)") — and the desktop's own masked capture for
 * `/credential` was the only credential input in this app that suppressed its
 * draft writes. Here the field is on the card, the composer refuses input
 * while a secret question waits (`message-input.tsx`'s `secretAnswer` term),
 * and the value can only travel through `answerGateSecret`.
 *
 * ## The rules, and where each comes from
 *
 * - `type="password"`, `autoComplete` off, `autoCapitalize` none,
 *   `autoCorrect` off, `spellCheck` false: the phone card's exact suppression
 *   (its D1/U2), so the value is not shoulder-surfable on screen and the
 *   keyboard's learn/suggest machinery never sees it.
 * - **Send disabled while empty**, `Enter` submits: the same pair the phone
 *   card enforces (`disabled={inert || !freeText.trim()}` over a form submit),
 *   and the reason the empty half is ALSO a precondition of `answerGateSecret`
 *   rather than only an attribute on a button.
 * - **The value clears when it was SENT** — not at the press. A DEFINITE
 *   refusal (a held lock, a lost owner epoch, a not-sent failure the owner
 *   established) leaves the value masked and RELEASED: the field can send it
 *   again, because clearing or holding would strand a token on exactly the
 *   failures the user has to repeat, and this card's composer is closed so no
 *   other surface can carry it. An UNKNOWABLE outcome (the answer may have
 *   landed) HOLDS the field instead, because a retry could send it twice — the
 *   split `answerReport`'s `retryable` exists for, and the hint swaps with it.
 * - **Per-question state**: the dock renders this keyed on `questionKeyOf`
 *   (`request_id:question_index`), so the next question gets a fresh field.
 *   The phone card keys its whole card the same way, for the same reason. The
 *   DRAFT itself is owned by the dock (keyed the same way) rather than by this
 *   component, so collapsing the card — which unmounts this component, the pill
 *   being an early return — cannot drop it (UX round 1, U3).
 *
 * Read-only is a real state here, not a degradation: with no `onAnswerSecret`
 * (a surface that cannot address an owner) the field renders DISABLED rather
 * than accepting a value nothing can hand over.
 */
const SecretAnswer = ({
	busy,
	value,
	onChange,
	onAnswer,
}: {
	/**
	 * An answer is in flight from any surface, or the hold is on (an unknowable
	 * outcome): the field refuses input. A DEFINITE refusal does not set this —
	 * see the release the dock computes.
	 */
	busy: boolean;
	/**
	 * The draft, owned by the dock so a collapse/Show cycle cannot drop it (the
	 * rules above). A controlled field, not an internal `useState`.
	 */
	value: string;
	onChange: (value: string) => void;
	/** Submit the typed value; absent where the surface cannot answer. */
	onAnswer?: (value: string) => void;
}) => {
	const ready = value.trim().length > 0 && !busy && Boolean(onAnswer);
	return (
		<form
			data-ask-secret=""
			aria-label="Secret answer"
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (!ready) return;
				// The RAW value: `answerGateSecret` owns the trim that reaches the
				// wire, so the rule lives on the answer path rather than on the
				// button that happens to be painted on it.
				onAnswer?.(value);
			}}
		>
			{/*
			 * The reassurance line sits ABOVE the field, which is the phone card's
			 * own placement decision (its D5): a claim about a credential is read
			 * BEFORE pasting it, not after. What it claims is checkable — the field
			 * masks what is typed, the answer goes to the asking agent, and this app
			 * paints no record of it in the transcript.
			 */}
			<p className="text-ink-dim text-meta">
				Hidden as you type — sent to the agent, not shown in the transcript.
			</p>
			<div className="flex items-center gap-2">
				<Input
					type="password"
					aria-label="Secret value"
					placeholder="Paste the secret"
					autoComplete="off"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={busy || !onAnswer}
					// `min-w-0` so the field can shrink inside the flex row; the
					// shared Input is `w-full` and the Send control keeps its width.
					className="min-w-0 flex-1"
				/>
				<Button type="submit" variant="primary" disabled={!ready}>
					Send
				</Button>
			</div>
		</form>
	);
};

export const QuestionDock = ({
	gate,
	onAnswer,
	onAnswerSecret,
	answering = false,
	answer = null,
	className,
}: QuestionDockProps) => {
	const key = questionKeyOf(gate);
	const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
	const collapsed = collapsedKey === key;
	const cardRef = useRef<HTMLElement>(null);
	/*
	 * Re-expanding hands focus to the card's first live answer control: an option
	 * when the card draws a live one, else THE SECRET FIELD, because the press
	 * that expanded the pill was a request to see and answer the question and a
	 * secret card has no option to take it. Without the second selector the
	 * focus fell to `document.body` on every secret Show — the pill button that
	 * was pressed had just unmounted (UX round 1, U4; the restore effect in
	 * `chat-page.tsx` reads the same pair). Collapsing hands focus to the
	 * composer (below), which is where the reader goes next.
	 */
	const [expandedByPress, setExpandedByPress] = useState(false);
	useEffect(() => {
		if (!expandedByPress || collapsed) return;
		setExpandedByPress(false);
		const first = cardRef.current?.querySelector<HTMLElement>(
			"button[data-ask-option]:not([disabled]), [data-ask-secret] input:not([disabled])",
		);
		first?.focus();
	}, [expandedByPress, collapsed]);

	const busy = answering || answer !== null;
	const sending = answering || Boolean(answer?.sending);
	/*
	 * Whether THIS panel's answer for this question was SENT — the signature the
	 * secret field clears on (`SecretAnswer`), and only that: a non-null answer
	 * with neither a send in flight nor a refusal is what the answer machinery
	 * leaves behind once the owner took the answer. The other two states are the
	 * send still out (`answer.sending`, or the shared `answering` flag) and a
	 * refusal (`answer.refused`).
	 */
	const sent = answer !== null && !answer.sending && answer.refused === null;
	/*
	 * THE SECRET DRAFT, OWNED BY THE DOCK (UX round 1, U3).
	 *
	 * It used to live in `SecretAnswer`'s own state; collapsing the card unmounts
	 * that component (the pill is an early return), so Esc silently dropped a
	 * typed or pasted secret and Show returned an empty field. Owning it here
	 * fixes the cycle and keeps every other property:
	 *
	 * - a collapse/Show pair remounts `SecretAnswer` but only reads this record;
	 * - the next question starts empty BY CONSTRUCTION rather than by an effect —
	 *   the record is keyed, and a different key reads as "" (the shape
	 *   `chat-page.tsx`'s `answerState` uses for its own hold);
	 * - the clear below stays tied to the SENT outcome (the contract's "field
	 *   cleared after submit"), never to the press.
	 */
	const [secretDraft, setSecretDraft] = useState<{
		key: string;
		value: string;
	} | null>(null);
	const secretValue = secretDraft?.key === key ? secretDraft.value : "";
	useEffect(() => {
		if (sent) setSecretDraft((draft) => (draft?.key === key ? null : draft));
	}, [sent, key]);
	/*
	 * HELD OR RELEASED (design round 1, D1; UX round 1, U1; QA round 1, Q-1).
	 *
	 * A refusal renders a sentence and holds the card disabled. For an OPTION
	 * press that hold is for the card's whole life — the composer is the retry
	 * path there, and the approval hint names it. The SECRET arm has no composer
	 * (it refuses input while this question waits), so an unconditional hold
	 * would strand the kept value with nothing able to send it — the reviewer's
	 * repro was exactly that dead end. The split is driven by the outcome's own
	 * classification, `answerReport`'s `retryable`: a DEFINITE not-sent refusal
	 * releases the field (a retry carries the live epoch and cannot
	 * double-settle), and an UNKNOWABLE outcome keeps the hold (a retry could
	 * send the answer twice). `secretReleased` is gated on `gateIsSecret` so a
	 * definite refusal of an OPTION press — whose report now also carries
	 * `retryable` — cannot release anything, and the held hint below is false for
	 * exactly the states whose controls work.
	 */
	const secretReleased =
		gateIsSecret(gate) &&
		answer !== null &&
		!answer.sending &&
		answer.refused !== null &&
		answer.retryable === true;
	const secretBusy =
		answering ||
		Boolean(answer?.sending) ||
		(answer !== null && !secretReleased);
	const held = Boolean(answer?.refused) && !secretReleased;
	/*
	 * The rows this card draws: an ask's model-authored set, or the client's own
	 * approval pair (main's arm, carried into this carrier by the fold). ONE
	 * expression for both, because the eyebrow below, the option band and the
	 * hint's digit clause all have to count the same set.
	 */
	const options = gate.kind === "approval" ? APPROVAL_OPTIONS : gate.options;
	const content = gate.detail
		? `**${gate.title}**\n\n${gate.detail}`
		: gate.title;

	if (collapsed) {
		return (
			<div
				className={cn("flex pb-2", className)}
				data-lo-question-dock="collapsed"
			>
				{/*
				 * THE PILL: one control, at the dock's own position, in the same accent
				 * border so the reader still sees that the agent is waiting. A button
				 * rather than a status line because its only job is "Show".
				 */}
				<button
					type="button"
					aria-label="Show the agent's question"
					onClick={() => {
						setCollapsedKey(null);
						setExpandedByPress(true);
					}}
					className={cn(
						"inline-flex h-7 items-center gap-2 rounded-full border border-accent bg-elevated px-3",
						"text-body-sm text-ink transition-colors duration-fast ease-out-quart hover:bg-sunken",
					)}
				>
					<MessageCircleQuestion
						aria-hidden={true}
						className="size-3.5 text-accent"
					/>
					<span>The agent is asking</span>
					<span aria-hidden={true} className="text-ink-dim">
						·
					</span>
					<span className="text-ink-muted">Show</span>
				</button>
			</div>
		);
	}

	return (
		<div className={cn("pb-2", className)} data-lo-question-dock="expanded">
			<section
				ref={cardRef}
				aria-label="Question from the agent"
				/*
				 * Focusable by pointer (`-1`, not in the Tab order): a press anywhere on
				 * the card makes it the focus scope, so Escape reaches the handler
				 * below even on an approval, which has no option to focus.
				 */
				tabIndex={-1}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (event.nativeEvent.isComposing) return;
					event.preventDefault();
					setCollapsedKey(key);
					focusComposer();
				}}
				className="flex flex-col gap-2 rounded-lg border border-accent bg-elevated p-4 outline-none"
			>
				<div className="flex items-center gap-2">
					<MessageCircleQuestion
						aria-hidden={true}
						className="size-4 shrink-0 text-accent"
					/>
					{/*
					 * The eyebrow says what is happening, and switches while an answer
					 * is on its way so a press on a slow round trip visibly landed
					 * (design round 1, D3; UX round 1, U2).
					 */}
					<p className="font-medium text-ink-muted text-meta">
						{sending ? "Sending your answer…" : "The agent is asking"}
					</p>
					{/*
					 * The ordinal eyebrow, for every kind whose rows print digits: an ask's
					 * model-authored set, and the approval pair this card now draws. The `1-2`
					 * matches the rows' own ordinals (`AskOptions`) and the sentence below.
					 */}
					{options.length > 0 && (
						<p aria-hidden={true} className="ml-auto text-ink-dim text-meta">
							{options.length === 1
								? "1 to answer"
								: `1-${Math.min(options.length, 9)} to answer`}
						</p>
					)}
				</div>
				<div className="text-heading text-ink">
					<MarkdownRenderer content={content} />
				</div>
				{gate.kind === "ask" &&
					(gateIsSecret(gate) ? (
						/*
						 * THE SECRET FIELD IS THIS CARD'S, not the composer's: the answer is
						 * a credential, and this field is the only surface allowed to hold it
						 * (see `SecretAnswer`). Keyed on the question as well as keyed at the
						 * draft, so not even DOM state (focus, selection) survives into the
						 * next question. `busy` is `secretBusy` rather than the options'
						 * `busy`: a definite refusal RELEASES this field while it holds the
						 * options band (see the split above).
						 */
						<SecretAnswer
							key={key}
							busy={secretBusy}
							value={secretValue}
							onChange={(value) => setSecretDraft({ key, value })}
							onAnswer={onAnswerSecret}
						/>
					) : (
						<AskOptions
							options={gate.options}
							recommended={gate.recommended}
							requestId={gate.request_id}
							busy={busy}
							onAnswer={(label) => onAnswer?.(label)}
						/>
					))}
				{/*
				 * An approval gets the same affordance as an ask, and the SAME component
				 * (main's approval-options arm, carried into this carrier by the fold):
				 * `AskOptions` holds the contrast triple, the focus handling, the aria and
				 * the busy semantics as one unit, so a forked copy would be a second
				 * implementation of a control the design contract tests by the triple it
				 * is built from. The options are the client's own pair - the wire carries
				 * none for an approval - and the label a press submits is what
				 * `approvalVerdict` turns into the boolean the request carries. `busy` is
				 * the ask arm's own expression, so the two option bands hold identically
				 * across the whole window between a press and the gate moving.
				 */}
				{gate.kind === "approval" && (
					<AskOptions
						options={APPROVAL_OPTIONS}
						requestId={gate.request_id}
						busy={busy}
						onAnswer={(label) => onAnswer?.(label)}
					/>
				)}
				<p className="text-ink-dim text-meta">{questionDockHint(gate, held)}</p>
				{/*
				 * A refused answer lands on the card it was pressed on, outcome first,
				 * and the card stays held so it cannot be pressed twice (QA round 1, Q3;
				 * UX round 1, U4). `output` carries the status role implicitly.
				 */}
				{answer?.refused && (
					<output className="block text-body-sm text-danger">
						{answer.refused}
					</output>
				)}
			</section>
		</div>
	);
};
