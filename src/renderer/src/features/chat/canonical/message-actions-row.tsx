/**
 * The row of actions under a turn: Copy, Speak on an answer with a speech
 * target, and Fork on any message that is a point a fork can be cut at.
 *
 * THE FORK PRESS ASKS THE PANE TO PRESENT THE PICKER, it does not open one
 * itself: the pane owns the presentation slot and the picker's adapter needs
 * the pane's canonical handle, command catalogue and rebind path
 * (`panel-presentation-store.ts` carries the argument for a request over a
 * function call). What this row contributes is the two facts only it holds -
 * which conversation, and which transcript entry - and they ride the request.
 *
 * WHY THIS IS NOT THE LINK TOOLBAR'S COMPONENT. That strip floats over what the
 * pointer is on, takes the elevated ground and the one overlay shadow, and
 * lives inside its subject's box. This row is IN THE FLOW, permanently, on one
 * of the transcript's own lines - a bordered ground here would read as a card
 * around a meta line (branding §7: a completed action is one quiet line, not a
 * card), so it takes no ground at rest and the only colour it owns is the ink
 * step on hover. It shares the toolbar ROLE and the button anatomy with that
 * strip rather than its register.
 *
 * THE ROW FADES AT REST, and the reason is the operator's ask on the
 * speak-aloud round: a permanent control under every turn reads as chrome on
 * every turn. The reveal is opacity-only (`message-actions.ts` carries the
 * class set and its why), so the row keeps its place and revealing it moves
 * nothing - and a press that is loading, playing or showing `Copied` PINS it
 * visible, because a state must not fade out from under the reader who caused
 * it.
 *
 * A NEW ARRIVAL SHOWS ITSELF ONCE. A row mounting for a message that just
 * arrived (inside `ROW_ARRIVAL_RECENT_MS`) wears `data-lo-arrive` for one
 * animation - fade in, hold, fade out; the keyframe and its media gates are in
 * `styles/index.css` - so the control is discoverable without a hover (UX
 * review round 1, U4 - the operator's item). It is silenced when the turn is
 * already hovered or focused, runs at most once per record id per session
 * (`ARRIVED`), and its resting state is where it ends: nothing here can leave
 * the row permanently visible.
 *
 * ONE COMPONENT, TWO KINDS. `kind` decides what the row offers
 * (`answerActionsFor`), which marker it carries and what its accessible name
 * is; an answer row offers Copy + Speak, a user row offers Copy alone. The
 * user arm exists because the operator asked for a copy affordance on their
 * own messages, and it is this component rather than a second one because
 * everything here - the copy press, the reveal, the toolbar semantics - is the
 * same row (branding § 9).
 *
 * WHAT IT IS GIVEN, AND WHY THAT IS THE WHOLE CONTRACT. `bodyText` is the
 * answer's VISIBLE text - `parseReplies(record.text).remainingContent`, exactly
 * the string the prose above renders - so a reply-quoted send copies the reply
 * rather than the `<reply-to>` markup that prefixed it (memo (e)). The row
 * never reads `record.text` itself: one derivation, one answer, and the payload
 * cannot drift from what the reader is looking at.
 *
 * `agentId` is the conversation the speech engine synthesises against, and its
 * ABSENCE is what keeps Speak off the row altogether (`answerActionsFor`): a
 * button whose every press would be a no-op is not offered. `speechId` keys this
 * row in the speech store (`msg:<id>`), so the button's busy and playing states
 * belong to this answer and cannot be claimed by another. The Speak CONTROL
 * itself - gate, tooltip, labels, press - is `useSpeakControl`, shared with the
 * selection toolbars and the legacy strip so the surfaces cannot drift; its
 * disabled sentence comes from the one copy table (`@shared/lib/speech-gate`) -
 * the reading UX round 2's U6 moved this row onto, alongside the surfaces
 * converted before it.
 */

import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { usePanelPresentationStore } from "@shared/store/panel-presentation-store";
import { messageSpeechKey, useSpeechStore } from "@shared/store/speech-store";
import { Check, Copy, GitFork } from "lucide-react";
import {
	Fragment,
	type ReactNode,
	memo,
	useEffect,
	useRef,
	useState,
} from "react";
import { copyTarget } from "../utils/link-open";
import {
	ANSWER_ACTIONS_LABEL,
	type ActionRowRole,
	type AnswerActionId,
	COPY_FEEDBACK_MS,
	USER_ACTIONS_LABEL,
	actionRowVisibility,
	answerActionsFor,
} from "./message-actions";

export type AnswerActionRowProps = {
	/** The turn's visible text, as the prose above renders it (memo (e)). */
	bodyText: string;
	/**
	 * Which turn the row belongs to, in the transcript's own word
	 * (`TranscriptRecord.kind`). Named `kind` rather than `role` because `role`
	 * on a component element reads as an ARIA role to the a11y lint (and
	 * `role="user"` is not one); the model's choice is the same one, under its
	 * own name (`answerActionsFor({ role })`).
	 */
	kind?: ActionRowRole;
	/** The conversation the speech engine synthesises against, when there is one. */
	agentId?: string;
	/** This row's key in the speech store. */
	speechId?: string;
	/**
	 * The record id this row belongs to, for the one-time arrival reveal. A row
	 * mounted without it (tests, a story surface) simply never arrives.
	 */
	revealId?: string;
	/** The record's own timestamp; the arrival reveal's recency window reads it. */
	revealAt?: number;
	/**
	 * The conversation this row's message belongs to, when there is one.
	 *
	 * REQUIRED FOR FORK AND ABSENT ELSEWHERE, which is why it is its own prop
	 * rather than a second name for `agentId`: a user row offers no Speak, so it
	 * is handed no agent, and reusing that prop would state something false about
	 * the row to reach a fact about the fork. A row mounted without it (the
	 * run-details child reader, the story surfaces, tests) simply offers no Fork.
	 */
	conversationId?: string;
	/**
	 * The transcript entry this row's message IS, when the record carries one.
	 *
	 * WHAT IT ADDRESSES: the point a fork is cut at - `forkEntryId` in
	 * `message-actions.ts` is the rule, and the transcript calls it for the
	 * record it is drawing. Absent means this row is not a cut point (or is a
	 * surface with no transcript behind it), and the row offers no Fork for it.
	 */
	entryId?: string;
};

/**
 * Whether the pointer or the keyboard is already on the row's TURN - the
 * record's own container, the element carrying the reveal's `group` class and
 * the nearest `.group` above the row.
 *
 * WHY THE WALK STOPS AT THE TURN (UX review round 2, U-r2-1). It used to climb
 * every ancestor, and the transcript's scroll pane is an ancestor of every
 * row - so a pointer parked anywhere inside the pane answered "the reader is
 * already here" and the nudge never fired, which is the ordinary state of a
 * mouse reader watching a live turn. The focus arm never walked (it reads
 * `activeElement` containment), so the two arms disagreed about what "on the
 * turn" meant; both now read the same boundary, scoped the way the comment
 * always claimed.
 *
 * Not `element.closest(":hover, :focus-within")`, which reads the same in a
 * browser but lies in jsdom: with nothing focused, `activeElement` is the
 * body, and jsdom's matcher then reports `:focus-within` on every ancestor,
 * so the guard would answer "the reader is here" in every mounted test.
 */
const readerIsOn = (element: Element, turn: Element): boolean => {
	let node: Element | null = element;
	while (node !== null) {
		if (node.matches(":hover")) return true;
		if (node === turn) break;
		node = node.parentElement;
	}
	const active = element.ownerDocument.activeElement;
	return active !== null && turn.contains(active);
};

/**
 * How recently a record must have arrived for its row to reveal itself.
 * Wide on purpose: the desktop's normal configuration has the owner's clock
 * and this renderer's on the same host, and a remote session that cannot prove
 * recency simply gets no flash rather than a stale one.
 */
export const ROW_ARRIVAL_RECENT_MS = 90_000;

/** Records that have had their one arrival reveal, per session. */
const ARRIVED = new Set<string>();

/** Slack over the keyframe's 1.8s, after which the attribute is dropped anyway. */
const ROW_ARRIVAL_FALLBACK_MS = 2600;

export const AnswerActionRow = memo(function AnswerActionRow({
	bodyText,
	kind = "answer",
	agentId,
	speechId,
	revealId,
	revealAt,
	conversationId,
	entryId,
}: AnswerActionRowProps) {
	const [copied, setCopied] = useState(false);
	const [arriving, setArriving] = useState(false);
	/*
	 * The reset timer is held in a ref rather than in state: the button is
	 * re-rendered per delta on a live row, and a timer id in state would re-render
	 * it a second time for a fact nothing paints.
	 */
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const revealRef = useRef<HTMLDivElement | null>(null);
	const arrivalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { playSpeech } = useSpeechStore();
	const speechControl = useSpeakControl({
		key: speechId ? messageSpeechKey(speechId) : null,
		getText: () => bodyText,
		play: ({ text }) => {
			if (agentId && speechId) playSpeech(speechId, agentId, text);
		},
	});

	const requestPanel = usePanelPresentationStore((state) => state.requestPanel);

	/*
	 * A fork needs BOTH halves to be offered at all: the conversation it would
	 * copy (the picker's subject) and the entry it would cut at. One without the
	 * other is not a weaker fork, it is a request that can only be refused - so
	 * the action is WITHDRAWN rather than disabled, the convention every
	 * inapplicable action in these toolbars follows (`linkToolbarModel` omits the
	 * actions a target cannot carry, and `answerActionsFor` omits Speak when no
	 * agent resolves).
	 */
	const forkable = Boolean(conversationId && entryId);
	const actions = answerActionsFor({ role: kind, agentId, forkable });
	/*
	 * The row is kept up while anything it owns is mid-state: a `Copied` tick
	 * or a Speak that is loading or playing is the reader's own press talking
	 * back, and it must not fade out from under them when the pointer leaves.
	 */
	const pinned = copied || speechControl.active;

	useEffect(() => {
		return () => {
			if (resetTimer.current !== null) clearTimeout(resetTimer.current);
		};
	}, []);

	/*
	 * The arrival reveal's decision, once per record (see the header). The
	 * one-time set is consulted FIRST and written before any of the bail-outs,
	 * so a row that arrived while the pointer was already on its turn cannot
	 * flash later when the pointer leaves.
	 */
	useEffect(() => {
		if (!revealId || revealAt === undefined) return;
		if (ARRIVED.has(revealId)) return;
		ARRIVED.add(revealId);
		if (Date.now() - revealAt > ROW_ARRIVAL_RECENT_MS) return;
		const element = revealRef.current;
		if (element === null) return;
		/*
		 * The turn boundary both arms read: nearest `.group`, the record's own
		 * container (MessageContainer for an answer, the user column for a
		 * message). A row mounted bare (tests, stories) falls back to itself.
		 */
		const turn = element.closest(".group") ?? element;
		/*
		 * Pointer or keyboard already on the turn: the hover/focus reveal is on
		 * display already, and a flash would fight it.
		 */
		if (readerIsOn(element, turn)) return;
		setArriving(true);
		/*
		 * And if the reader arrives WHILE the flash runs, the flash YIELDS
		 * (agent review round 2, MINOR-2): the keyframe animates `opacity`, an
		 * animated value outranks every normal declaration, so for its 1.8s it
		 * would override `group-hover:opacity-100`, `group-focus-within:opacity-100`
		 * and the pinned state alike. Dropping the attribute on the reader's own
		 * arrival hands the row back to those classes for the rest of its life -
		 * the flash does not resume when they leave, on purpose: the reader has
		 * seen the row, and a second fade would be noise. Listener scope matches
		 * the guard's: the record's own turn, via `pointerenter` (which fires for
		 * descendants too) and `focusin`.
		 */
		const yieldToReader = () => {
			setArriving(false);
			turn.removeEventListener("pointerenter", yieldToReader);
			turn.removeEventListener("focusin", yieldToReader);
		};
		turn.addEventListener("pointerenter", yieldToReader);
		turn.addEventListener("focusin", yieldToReader);
		return () => {
			turn.removeEventListener("pointerenter", yieldToReader);
			turn.removeEventListener("focusin", yieldToReader);
		};
	}, [revealId, revealAt]);

	/*
	 * The attribute's deadline. `animationend` normally drops it (the render
	 * below); this is the belt for the gates that mean no animation ran at all
	 * (reduced motion, a touch context), where no `animationend` will ever
	 * arrive.
	 */
	useEffect(() => {
		if (!arriving) return;
		arrivalTimer.current = setTimeout(() => {
			arrivalTimer.current = null;
			setArriving(false);
		}, ROW_ARRIVAL_FALLBACK_MS);
		return () => {
			if (arrivalTimer.current !== null) clearTimeout(arrivalTimer.current);
		};
	}, [arriving]);

	const handleCopy = async () => {
		/*
		 * `Copied` is set ONLY on a true answer. `copyTarget` is the canonical
		 * path's single clipboard call site - it writes the text, logs and raises
		 * the existing `Failed to copy` toast when the write is refused - so a
		 * press that failed leaves the label alone instead of claiming an outcome
		 * the app did not get.
		 */
		if (!(await copyTarget(bodyText))) return;
		setCopied(true);
		if (resetTimer.current !== null) clearTimeout(resetTimer.current);
		resetTimer.current = setTimeout(() => {
			resetTimer.current = null;
			setCopied(false);
		}, COPY_FEEDBACK_MS);
	};

	/**
	 * Present the fork picker for THIS row's message - "fork from this message
	 * on", without the reader having to type `/fork` or re-find the message in
	 * the picker.
	 *
	 * THE ROW ASKS, IT DOES NOT OPEN. A destination's adapter needs the pane's
	 * canonical handle, command catalogue and rebind path, so the pane owns the
	 * presentation slot (`slash-dispatch.ts`); a control writing picker state
	 * directly would be a second presenter. The request carries the conversation
	 * AND the entry id: the entry is what makes this a cut rather than a whole-
	 * conversation fork, and it travels because this row is the only layer that
	 * knows which message it belongs to.
	 *
	 * The row itself is the invoker, so Escape from the picker comes back to the
	 * control that opened it rather than to the composer.
	 */
	const handleFork = () => {
		if (!conversationId || !entryId) return;
		requestPanel("session.fork", revealRef.current, conversationId, entryId);
	};

	/*
	 * One control per action id, chosen by the id the MODEL published rather than
	 * by a second list of buttons here. It is `link-toolkit.tsx`'s shape (`icons`
	 * / `presses` keyed by `LinkActionId`) for that file's reason: the model
	 * decides what is OFFERED - including that a row with no fork point offers no
	 * Fork - and this file decides only what each offer looks like. A hard-coded
	 * button list here would be a second place that has to agree with the model,
	 * which is the defect that convention exists to prevent.
	 *
	 * The `Record` is exhaustive over `AnswerActionId` on purpose: a fifth action
	 * added to the union fails the typecheck here rather than rendering nothing,
	 * which is how a withdrawn action stays a decision rather than an omission.
	 */
	const controls: Record<AnswerActionId, ReactNode> = {
		copy: (
			/*
			 * `side="bottom"` is design round 1's D5: the tooltip at `top`
			 * opened over the turn's own last prose line (measured against the
			 * frame pair); below is the stamp band, quieter ground to cover.
			 * The design delta verifies it against frames and reverts if the
			 * stamp band reads worse.
			 */
			<Tooltip content={copied ? "Copied" : "Copy"} side="bottom">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={copied ? "Copied" : "Copy"}
					className={cn("text-ink-dim hover:bg-accent-wash hover:text-accent")}
					onClick={handleCopy}
				>
					{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
				</Button>
			</Tooltip>
		),
		speak: <SpeakButton control={speechControl} side="bottom" />,
		fork: (
			/*
			 * THE GLYPH IS THE SIDEBAR'S. `chat-sidebar.tsx`'s row menu offers the
			 * same verb (`Fork conversation`) with `GitFork`, and two marks for one
			 * action would read as two different actions; this one names the
			 * DIRECTION the sidebar's cannot (the cut is at this message, not at
			 * the end), so the label carries the rest.
			 */
			<Tooltip content="Fork from this message" side="bottom">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Fork from this message"
					className={cn("text-ink-dim hover:bg-accent-wash hover:text-accent")}
					onClick={handleFork}
				>
					<GitFork aria-hidden="true" />
				</Button>
			</Tooltip>
		),
	};

	return (
		<div
			role="toolbar"
			aria-label={kind === "user" ? USER_ACTIONS_LABEL : ANSWER_ACTIONS_LABEL}
			ref={revealRef}
			onAnimationEnd={(event) => {
				/*
				 * `animationend` BUBBLES (agent review round 2, NIT-1): without this
				 * guard a descendant's animation ending would drop this row's
				 * attribute and truncate the flash. Latent today - the only animated
				 * descendant is the infinite spinner, which never ends - but the guard
				 * is what keeps it latent.
				 */
				if (event.target !== event.currentTarget) return;
				setArriving(false);
			}}
			{...(arriving ? { "data-lo-arrive": "" } : {})}
			/*
			 * The marker names the ROLE, not the component: the transcript's own
			 * tests and rigs count answer rows (`data-lo-answer-actions`) as a fact
			 * about answers, and a user row wearing the same attribute would make
			 * that count lie the day a user row is on screen.
			 */
			{...(kind === "user"
				? { "data-lo-user-actions": "" }
				: { "data-lo-answer-actions": "" })}
			/*
			 * `shrink-0` and one line at every width (memo (c)): the buttons are the
			 * row's fixed part and the caption beside them is the part that truncates,
			 * so the toolbar must never be the thing a narrow column squeezes.
			 */
			className={cn(
				"flex shrink-0 items-center gap-1",
				actionRowVisibility(pinned),
			)}
		>
			{actions.map((action) => (
				/*
				 * A `Fragment` per action keeps the DOM identical to the flat list the
				 * row rendered before the map existed: no wrapper element is added
				 * between the toolbar and its buttons.
				 */
				<Fragment key={action}>{controls[action]}</Fragment>
			))}
		</div>
	);
});
