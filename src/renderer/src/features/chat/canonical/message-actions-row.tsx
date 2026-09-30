/**
 * The row of actions under a turn: Copy, and - on an answer with a speech
 * target - Speak.
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
import { messageSpeechKey, useSpeechStore } from "@shared/store/speech-store";
import { Check, Copy } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { copyTarget } from "../utils/link-open";
import {
	ANSWER_ACTIONS_LABEL,
	type ActionRowRole,
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
};

/**
 * Whether the pointer or the keyboard is already on the row's turn.
 *
 * Walks the ancestors for `:hover` - a descendant's hover makes its ancestors
 * match - and checks `document.activeElement` containment for focus. NOT
 * `element.closest(":hover, :focus-within")`, which reads the same in a
 * browser but lies in jsdom: with nothing focused, `activeElement` is the
 * body, and jsdom's matcher then reports `:focus-within` on every ancestor,
 * so the guard would answer "the reader is here" in every mounted test.
 */
const readerIsOn = (element: Element): boolean => {
	let node: Element | null = element;
	while (node !== null) {
		if (node.matches(":hover")) return true;
		node = node.parentElement;
	}
	return element.contains(element.ownerDocument.activeElement);
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

	const actions = answerActionsFor({ role: kind, agentId });
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
		/*
		 * Pointer or keyboard already on the turn: the hover/focus reveal is on
		 * display already, and a flash would fight it.
		 */
		if (revealRef.current !== null && readerIsOn(revealRef.current)) return;
		setArriving(true);
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

	return (
		<div
			role="toolbar"
			aria-label={kind === "user" ? USER_ACTIONS_LABEL : ANSWER_ACTIONS_LABEL}
			ref={revealRef}
			onAnimationEnd={() => setArriving(false)}
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
			{actions.map((action) =>
				action === "copy" ? (
					/*
					 * `side="bottom"` is design round 1's D5: the tooltip at `top`
					 * opened over the turn's own last prose line (measured against the
					 * frame pair); below is the stamp band, quieter ground to cover.
					 * The design delta verifies it against frames and reverts if the
					 * stamp band reads worse.
					 */
					<Tooltip
						key={action}
						content={copied ? "Copied" : "Copy"}
						side="bottom"
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={copied ? "Copied" : "Copy"}
							className={cn(
								"text-ink-dim hover:bg-accent-wash hover:text-accent",
							)}
							onClick={handleCopy}
						>
							{copied ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
						</Button>
					</Tooltip>
				) : (
					<SpeakButton key={action} control={speechControl} side="bottom" />
				),
			)}
		</div>
	);
});
