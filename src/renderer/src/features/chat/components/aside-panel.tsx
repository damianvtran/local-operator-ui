import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Button } from "@shared/components/ui/button";
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import { type AsideStream, useAsideStore } from "@shared/store/aside-store";
import { X } from "lucide-react";
import {
	type FC,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	adoptAside,
	asideAdoptBlockedReason,
	asideAdoptCap,
	asideAdoptReady,
	asideAnnouncement,
	asideCapIsMeasured,
	asideQuestionTopOffset,
	asideScrollToTurn,
	asideScrollTrigger,
	asideScrollWasClamped,
	closeAside,
} from "../aside";
import { CHAT_MEASURE } from "../chat-measure";
/**
 * The aside panel: an off-the-record exchange, attached to the composer.
 *
 * WHAT THIS REPLACES, AND WHY THE OLD SURFACE COULD NOT STAY. `/btw` used to
 * mount a Radix MODAL dialog (`AsidePicker`, through `PickerHost`). A modal traps
 * focus and marks everything outside itself `aria-hidden` with `pointer-events:
 * none`, so while it was up the composer — the surface the answer is meant to be
 * discussed in — took no keystrokes and no clicks: the operator's report, "the
 * composer does not register typing at all". The panel below is deliberately NOT
 * a dialog, a drawer or a popover, and that is the load-bearing property rather
 * than a style choice: it is an in-flow sibling of the composer box, inside the
 * same band, so nothing is trapped, the box keeps its focus and the user can keep
 * typing while an answer streams. A surface that helps the user COMPOSE cannot be
 * the surface that takes composing away.
 *
 * It carries `role="region"` and a real accessible name, and it deliberately does
 * NOT carry any of the roles in `keyboard-scopes.ts`'s `PRESS_OWNER_SELECTOR`
 * (`dialog`, `alertdialog`, `menu`, `listbox`): that selector decides whether
 * app-level shortcuts are handed to the overlay the press landed in, and a panel
 * that took the app's keys would be half-way back to the modal this replaces.
 *
 * WHERE THE TEXT COMES FROM. Deltas arrive on the session's own SSE stream and go
 * to `aside-store` from `use-canonical-session`'s flush; the POST's returned text
 * settles the turn and is authoritative (see `AsideStream`). This component reads
 * that store and nothing else — it does not own a socket, a timer or a copy of
 * the answer — which is also what lets the composer and the command dispatcher
 * agree with it about which aside is open.
 */
import { MarkdownRenderer } from "../components/markdown-renderer";
import { parseReplies } from "../utils/reply-utils";

export type AsidePanelProps = {
	/** The session whose aside this is; the store is keyed by session. */
	sessionId: string;
	/**
	 * Whether that session is mid-turn — the second term of the adopt gate
	 * (`asideAdoptReady`, mirroring the TUI's `_aside_can_fork`). Passed in rather
	 * than read here: the page that owns the canonical stream owns this answer,
	 * and a second reading of it is a second thing that can be wrong.
	 */
	sessionStreaming: boolean;
	isSmallView?: boolean;
	/**
	 * Put the caret back in the composer, after this panel took it away.
	 *
	 * WHY THE PANEL CANNOT DO THIS ITSELF (UX round 1, U6). Every control here
	 * unmounts the panel it sits in — Add to conversation, Close, and Escape from
	 * either control — so the element the user was standing on leaves the document
	 * and `document.activeElement` falls to `<body>`. A keyboard or screen-reader
	 * user then starts their next Tab from the top of the page, whereas Escape from
	 * the box already returns them to the composer: the same gesture ending in two
	 * different places, which is what made this a finding rather than a preference.
	 * The composer owns its own textarea, so the focus call is handed in.
	 */
	onReturnFocus?: () => void;
};

/**
 * The answer's own type step, in ONE place, because the exchange's cap is derived
 * from it (see `asideExchangeCap`).
 *
 * `lineHeight: 1.6` is the transcript's own leading, and `var(--text-body)` its
 * own size at the wide step — the aside reads as the agent's answer, not as a
 * second kind of prose, and a surface that picked its own step would be the
 * second typography this panel exists to avoid.
 */
const ASIDE_ANSWER_LINE_HEIGHT = 1.6;

/** The whole number of the answer's line boxes the exchange shows before it scrolls. */
const ASIDE_EXCHANGE_LINES = 10;

/**
 * The QUESTION's own line box, and the gap under it — the ceiling's other two terms
 * (design round 2, D10).
 *
 * `1.5` is the leading `--text-body-sm` carries (`--text-body-sm--line-height` in
 * `styles/index.css`), and the question is painted at that step at both window
 * sizes. `gap-1` is the 4px the turn's own `flex flex-col` puts between the question
 * and its answer. The cap counts the question block as the panel MEASURES it and not
 * as a multiple of this box (design round 4, D16), so `1.5` now survives only as the
 * floor `ASIDE_QUESTION_MIN_BOX` states for the pass before that measurement exists.
 */
const ASIDE_QUESTION_LINE_HEIGHT = 1.5;
const ASIDE_TURN_GAP_REM = "0.25rem";

/**
 * The question block's SMALLEST box: one line of the question's own step.
 *
 * The cap takes the block's MEASURED box (`asideExchangeCap`, which says why), and this
 * is what it uses for the one pass that has no measurement yet. A `useLayoutEffect`
 * measures before the browser's first paint, so a browser never paints that pass; in a
 * host that lays nothing out it is the smallest a question block can be, where zero
 * would be a whole line less than the block that is actually there - the cut D1 exists
 * to remove, entered by construction.
 */
const ASIDE_QUESTION_MIN_BOX = `var(--text-body-sm) * ${ASIDE_QUESTION_LINE_HEIGHT}`;

/** The answer's size and leading, from the step it is painted at. */
const asideAnswerType = (
	isSmallView: boolean,
): { fontSize: string; lineHeight: number } => ({
	fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
	lineHeight: ASIDE_ANSWER_LINE_HEIGHT,
});

/**
 * The class that keeps the answer's BLOCK SPACING on the line grid the cap cuts on.
 *
 * WHY A PARAGRAPH BREAK USED TO BREAK THE WHOLE-ROW PROPERTY (design round 3, D12,
 * a regression of round 1's D1). `markdown.css` spaces paragraphs by `0.5rem`, which
 * is not a multiple of the answer's line box - so with a paragraph break in the
 * answer the cap's edge fell INSIDE a row and the last visible line was a row of
 * letter tops: measured 11.9px into a 16.5px glyph box at wide, on an answer round
 * 2 had measured at 0 cut rows. Round 2's 0 was that answer's luck rather than the
 * fix holding, exactly as D12 says. Round 1's arithmetic is only true while every
 * block boundary is a whole number of line boxes, so the aside states the gap as one
 * line box and the property holds at any number of paragraphs.
 *
 * `calc(1em * var(--md-line-height, 1.6))` rather than a length: the line box is
 * the answer's own font size times the leading `MarkdownRenderer` is painting it
 * with, so the two steps this panel uses (14px at 1.6 and 13px at 1.6) both get
 * their own exact box, and a caller that moves the leading moves the gap with it
 * instead of silently breaking the cut. The rule itself lives in `markdown.css`,
 * where the rest of this renderer's descendant rules are - the same reason that file
 * exists rather than forty `[&_p]:...` variants.
 */
const ASIDE_ANSWER_ROW_GRID = "lo-markdown--row-grid";

/**
 * The exchange's cap: `ASIDE_EXCHANGE_LINES * ASIDE_ANSWER_LINE_HEIGHT *
 * answerFontSize + Q + G`, where `Q` is the newest question's own measured box and `G`
 * is the gap under it (`ASIDE_TURN_GAP_REM`).
 *
 * WHY IT IS DERIVED (design round 1, D1). A cap in round pixels lands wherever
 * it lands inside a line, and the one this replaces did exactly that: 240px
 * against this answer's 22.4px line box (14px at `1.6`) cuts at 10.71 lines, so
 * the last visible row was a row of letter TOPS under a complete line — read as
 * a rendering accident rather than as "there is more", which is the precise
 * symptom `chat-measure.ts`'s `CAPPED_BLOCK` was introduced to remove for the
 * composer's other capped blocks. The cap is therefore a WHOLE NUMBER OF THE
 * ANSWER'S OWN LINE BOXES, and the size and leading in the expression are the
 * ones the answer is painted at (both read from `asideAnswerType`), so moving
 * the type step moves the cap with it instead of silently re-introducing the
 * partial line.
 *
 * The cap is on the exchange REGION and the panel carries no `max-height` and no
 * `overflow` of its own: the composer band must carry neither (the slash popup
 * is an unportaled child of it), so each growable part of the band caps itself —
 * the shape the composer's attachment strip and textarea already use.
 *
 * IT COUNTS THE QUESTION BLOCK AS MEASURED, NOT AS ONE LINE (design round 2's D10 and
 * agent review round 6's R6-4, both recalled by design round 4's D16 and UX round 3's
 * U20/Q46). D10 counted ONE question line and R6-4 one line box per staged quote, and
 * both are assumptions about a box the BROWSER lays out: whether a quote or a question
 * is one line is decided by the rendered width, not by the question. Measured on the
 * render: the ordinary 44-character quote the R6-4 cases stage WRAPS to two lines at
 * 800px, so with one quote the answer's top sat 70.5px down against a 259px cap and the
 * edge landed at 9.1 line boxes instead of 10.0 - a 0.9px sliver of a row at wide, and
 * 4.4 at narrow for a 7-line quote (a row of letter tops, 9.7-10.5px of it hidden),
 * under half of what the ceiling promises.
 *
 * SO THE CAP TAKES THE QUESTION NODE'S OWN BOX - `Q` above - as the panel MEASURES it
 * (a `ResizeObserver`, below), and the edge is `ASIDE_EXCHANGE_LINES` of the answer's
 * own line boxes below the answer's top for ANY question shape at ANY width. No set of
 * arithmetic terms can promise that, because a term for the wrap would re-derive a
 * decision the browser has already made: `stagedQuotes`, `ASIDE_QUOTE_PAD_Y_REM` and
 * `ASIDE_QUOTE_GAP_REM` are gone with the assumption they encoded, and a two-line quote
 * style, an image chip on the question or a longer quote prefix is now just a taller
 * `Q`. The node measured is the question PARAGRAPH, which is the turn's own flex item -
 * so a quote's `mb-1` inside it counts, because a flex item's children cannot collapse
 * their margins through it. `ASIDE_QUESTION_MIN_BOX` is the floor for the pass before
 * the node is measured.
 *
 * THE MEASUREMENT NEEDS A STABLE WIDTH, AND THE REGION IS WHERE THAT IS PROMISED. A cap
 * that grows with a box inside the region can grow the box: on a platform whose
 * scrollbar takes layout width (not macOS), an overflow narrows the content, the
 * question wraps a line taller, the cap grows by that same line, and the pair can sit
 * on the boundary toggling. `scrollbar-gutter: stable` on the region reserves that
 * gutter whether or not the exchange overflows, so the width the question wraps at -
 * and therefore the fixed point this rule needs - does not depend on the cap.
 *
 * WHAT IT DOES NOT REACH (design round 4, D17). The answer's OWN blocks are not on this
 * grid: `ASIDE_ANSWER_ROW_GRID` puts the renderer's paragraphs on the answer's line box
 * and nothing spaces the lines inside a list item or a `pre`, so an edge landing inside
 * one of those cuts it at any cap. That is the class no cap arithmetic reaches, and it
 * is deliberately left to the follow-up the review named rather than papered over here.
 */
const asideExchangeCap = (
	isSmallView: boolean,
	questionBox: number | null,
): string => {
	const answer = asideAnswerType(isSmallView);
	const question =
		questionBox === null ? ASIDE_QUESTION_MIN_BOX : `${questionBox}px`;
	return `calc(${answer.fontSize} * ${ASIDE_ANSWER_LINE_HEIGHT} * ${ASIDE_EXCHANGE_LINES} + ${question} + ${ASIDE_TURN_GAP_REM})`;
};

/**
 * One turn's QUESTION, as the user actually sent it.
 *
 * THE PAYLOAD IS A WIRE FORMAT, NOT PROSE (UX round 2, U14). An aside ask carries
 * the same payload `buildSendPayload` assembles at the send boundary, so a question
 * asked with a staged quote reaches this panel as the quoted turn's markup followed
 * by the typed words - and the panel painted that string verbatim, tags and all,
 * while the transcript renders the very same string as a quote block (QA round 3,
 * observation 3, which is where it was first exercised). `parseReplies` is the one
 * reader of that format (`reply-utils.ts`, already shared by the canonical transcript
 * and the legacy `message-paper` path), so the panel renders it by that rule rather
 * than by a scan of its own that could disagree with the message the user is reading
 * beside it.
 *
 * The quote takes the transcript's own shape for a quote - the left rule and the
 * quieter step `reply-preview.tsx` uses inside the composer - so a question replying
 * to something reads as the same object on both surfaces; the typed words are the
 * question itself and keep the panel's own question step.
 *
 * Memoized because `parseReplies` mints an id per quote, and this panel re-renders on
 * every chunk of the answer below it.
 */
const AsideQuestion: FC<{ question: string }> = ({ question }) => {
	const { replies, remainingContent } = useMemo(
		() => parseReplies(question),
		[question],
	);
	return (
		<>
			<span className="sr-only">Question: </span>
			{replies.map((reply) => (
				<span
					key={reply.id}
					className="mb-1 block border-hairline border-l-2 py-0.5 pl-2"
				>
					{reply.text}
				</span>
			))}
			{remainingContent}
		</>
	);
};

/**
 * One turn's answer, in the state it is in.
 *
 * `text` is painted through `MarkdownRenderer` at the transcript's own steps, so
 * an aside reads as the agent's answer rather than as a second kind of prose
 * (§ 7's tier 2: the answer is the document). A streaming answer is NOT linkified,
 * for the reason the transcript's streaming row gives — the text is a prefix the
 * next chunk falsifies, so a half-written path would become a link to a target
 * that does not exist.
 */
const AsideAnswer: FC<{
	stream: AsideStream | undefined;
	isSmallView: boolean;
}> = ({ stream, isSmallView }) => {
	if (!stream) return null;
	return (
		<div className="flex flex-col gap-1">
			{stream.text.length > 0 && (
				<MarkdownRenderer
					content={stream.text}
					styleProps={asideAnswerType(isSmallView)}
					linkify={stream.settled}
					className={ASIDE_ANSWER_ROW_GRID}
				/>
			)}
			{/*
			 * The thinking state, and the ONLY liveness element this panel paints:
			 * § 7's one element per turn. It borrows the working line's own verb so
			 * the panel and the transcript's line say the same word for the same
			 * state, and it is withheld the moment text arrives — the line's own
			 * state carries the wait, and a spinner beside a growing answer would be
			 * the second liveness element the rule forbids.
			 */}
			{stream.streaming &&
				stream.text.length === 0 &&
				stream.error === null && (
					<p className="text-body-sm text-ink-muted">thinking…</p>
				)}
			{/*
			 * `role="alert"`: the ask failed and the user is waiting on it, so it is
			 * the assertive case — the same role the composer's own send failure
			 * carries. The sentence is the backend's or the transport's, chosen by
			 * `userFacingMessage` rather than composed here.
			 */}
			{stream.error !== null && (
				<p role="alert" className="text-body-sm text-danger">
					{stream.error}
				</p>
			)}
		</div>
	);
};

export const AsidePanel: FC<AsidePanelProps> = ({
	sessionId,
	sessionStreaming,
	isSmallView = false,
	onReturnFocus,
}) => {
	const attachment = useAsideStore(
		(state) => state.attached[sessionId] ?? null,
	);
	const streams = useAsideStore((state) => state.streams);
	const titleId = useId();
	/** The blocked reason's own id, so the disabled control can name it (U9). */
	const blockedId = useId();
	/*
	 * The two nodes the append-scroll needs, and the turn it last honoured.
	 *
	 * The ref on the region and the one on the newest turn are read together, in an
	 * effect keyed on the newest turn's ID — which is what makes this ONE scroll per
	 * appended question rather than a follow that re-pins the region on every chunk
	 * and fights a user reading above (below).
	 */
	const exchangeRef = useRef<HTMLDivElement>(null);
	const newestTurnRef = useRef<HTMLDivElement>(null);
	/**
	 * Where this effect last put the region, and whether the turn's target is settled.
	 *
	 * The offset is the one READ BACK after the write rather than the one asked for,
	 * because a browser is free to round or clamp a `scrollTop` assignment, and the
	 * comparison below is asking whether the position is still OURS - a reader's
	 * scroll and the browser's own clamp have to be separable, which is what the
	 * height the cap had at that moment is for (`asideScrollWasClamped`).
	 */
	const scrollWritten = useRef<{
		turnId: string;
		offset: number;
		clientHeight: number;
	} | null>(null);
	const scrollDone = useRef<string | null>(null);
	const lastTurnId = attachment?.turns.at(-1)?.asideId ?? null;
	/*
	 * The newest turn's growth FROM THE STORE, as the effect's first trigger.
	 *
	 * The target below is only reachable once the turn has grown enough for the
	 * region to be able to scroll that far, so the effect has to re-run as the turn
	 * grows - and this is the value that says it has, without subscribing to the
	 * whole stream object (which is replaced on every chunk and would re-render the
	 * panel for its own sake). It is the answer's length AND the turn's phase, because
	 * a refusal replaces the thinking line without adding a character of answer (QA
	 * round 4, Q33; `asideScrollTrigger`). It is a string, so an idle re-render cannot
	 * re-run the effect at all.
	 *
	 * IT IS ONLY HALF THE TRIGGER, WHICH IS WHAT R7-3 CAUGHT: it answers every STORE
	 * change that can grow the box, and a box can also grow with the store untouched -
	 * a mermaid SVG rendering into a settled answer, KaTeX's lazily loaded stylesheet
	 * arriving. Measured in the flow (UX round 3's U21): the region held 43px, then
	 * 625px once the diagram was in, with `scrollTop` still 0 the whole time, so the
	 * newest answer was left cut at the edge with no sign it had grown. The other half
	 * is the turn's own MEASURED box (`newestTurnBox`, below), which is the growth
	 * itself rather than a proxy for it.
	 */
	const newestTurnGrowth = asideScrollTrigger(
		lastTurnId ? streams[lastTurnId] : undefined,
	);
	/*
	 * THE NEWEST TURN'S BOXES, MEASURED (design round 4's D16 for the cap; agent review
	 * round 7's R7-3 for the move).
	 *
	 * `newestQuestionBox` is the cap's `Q` term: the height of the newest turn's question
	 * PARAGRAPH as laid out, because whether a quote or a question is one line is the
	 * browser's decision at the width it was given and not a fact about the question -
	 * R6-4's per-quote term held the identity at one width and lost it at another (the
	 * same 44-character quote is one line at 1380 and two at 800).
	 *
	 * `newestTurnBox` is the move's other trigger: THE BOX ITSELF, so a change that
	 * arrives with nothing on the wire behind it still re-runs the move. The store's own
	 * trigger cannot see one (`asideScrollTrigger`), and it is not hypothetical - UX round
	 * 3's U21 measured a mermaid diagram landing 3s after the answer settled and growing
	 * the turn 43px to 625px with the region's `scrollTop` still 0, so the newest answer
	 * was left cut with no sign it had grown.
	 *
	 * ONE PASS READS BOTH and one `ResizeObserver` watches the turn, because the question
	 * is inside it: a question that grows a line grows the box it is in. The comparison in
	 * each write is what makes these values safe as effect dependencies - the same number
	 * for the same box never re-runs the move - and measuring before the observer is
	 * installed is what the first paint uses, so no frame is laid out against the floor
	 * `ASIDE_QUESTION_MIN_BOX` states.
	 */
	const [newestTurnBox, setNewestTurnBox] = useState<number | null>(null);
	const [newestQuestionBox, setNewestQuestionBox] = useState<number | null>(
		null,
	);
	/**
	 * The same measurement as the LIVE value rather than as this render's copy.
	 *
	 * `newestQuestionBox` is what the render in flight handed the cap, so it is one
	 * pass behind the moment the observer reads a taller question; this one is the
	 * observer's own last reading, and the move asks whether the two agree before it
	 * writes (`asideCapIsMeasured` - QA round 6, F1, where writing against the stale
	 * cap is what the browser then clamped). Both are written together in `measure`,
	 * so they can differ only while a cap is a pass behind the box that feeds it.
	 */
	const newestQuestionMeasured = useRef<number | null>(null);
	const newestQuestionRef = useRef<HTMLParagraphElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the newest turn's ID re-attaches the observers - both refs move to the new turn's boxes with it - and the body reads only the DOM.
	useLayoutEffect(() => {
		const node = newestTurnRef.current;
		if (!node) {
			setNewestTurnBox(null);
			setNewestQuestionBox(null);
			newestQuestionMeasured.current = null;
			return;
		}
		const measure = () => {
			const box = node.getBoundingClientRect().height;
			const question = newestQuestionRef.current;
			const questionBox = question
				? question.getBoundingClientRect().height
				: null;
			newestQuestionMeasured.current = questionBox;
			setNewestTurnBox((current) => (current === box ? current : box));
			setNewestQuestionBox((current) =>
				current === questionBox ? current : questionBox,
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [lastTurnId]);
	/*
	 * THE QUESTION MOVES TO THE REGION'S TOP, AND THE MOVE SURVIVES THE ANSWER ARRIVING
	 * (design round 3, D11, and it is not D6's per-chunk follow).
	 *
	 * D6 fixed the ask that looked like nothing had happened by scrolling the new turn
	 * into view, and the clamp landed it at the region's BOTTOM - because at that
	 * moment the turn is only its question and its thinking line (43px of the 248px
	 * region at wide). The answer then streamed downward out of sight: measured 43 of
	 * 300px visible for the whole stream at wide and 62 of 883px at narrow. So the
	 * effect keeps asking for the SAME target - the question at the top - until the
	 * clamp stops biting, and then stops for good.
	 *
	 * What makes that not a follow: the target is fixed, so this never chases content
	 * downward and never passes the question; and the reader wins at any moment, which
	 * is the drift test on what this effect last wrote - one pixel of drift is the
	 * device's rounding, and a scroll ends this turn's move permanently. The one drift
	 * that is NOT a scroll is the browser's own clamp, which is what a cap that grows
	 * after the write leaves behind (`asideScrollWasClamped`, QA round 6, F1), and the
	 * one pass this effect does not write in at all is the pass before the cap carries
	 * the newest question's own measurement (`asideCapIsMeasured`, same finding).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the newest turn's growth and its two measured boxes are the effect's TRIGGERS and not values it moves against -- the target is reachable only once the turn has grown enough, the cap is the box the write is judged against, and the movement itself is read from the DOM. See the three blocks above.
	useEffect(() => {
		if (!lastTurnId) return;
		if (scrollDone.current === lastTurnId) return;
		/*
		 * THE MEASUREMENT'S OWN CAP COMES FIRST (QA round 6, F1). The commit that appends
		 * a turn lays the region out against the cap the PREVIOUS turn's question asked
		 * for, and a wrapping question makes the cap a line taller than that one: writing
		 * here asks for a position against a cap that is about to grow, the browser clamps
		 * the write back when it does, and the guard below used to read that clamp as the
		 * reader arriving and end the turn's move for good. So the pass the measurement's
		 * cap is laid out in is the pass the move writes in - it is deferred, never
		 * dropped, because landing that measurement is what re-runs this effect (the cap
		 * is `asideExchangeCap(isSmallView, newestQuestionBox)`, and that state is a
		 * dependency). Nothing else about the move changes: the target is the newest
		 * question's own top, fixed, and this is still the only place it is written.
		 */
		if (!asideCapIsMeasured(newestQuestionBox, newestQuestionMeasured.current))
			return;
		const region = exchangeRef.current;
		const turn = newestTurnRef.current;
		if (!region || !turn) return;
		const written = scrollWritten.current;
		if (
			written !== null &&
			written.turnId === lastTurnId &&
			Math.abs(region.scrollTop - written.offset) > 1
		) {
			/*
			 * A position that is not ours is the reader's - UNLESS the browser clamped our
			 * own write when the cap grew, which is nobody's decision at all and used to
			 * end the turn's move with the newest answer still below the fold (QA round 6,
			 * F1). `asideScrollWasClamped` holds the four facts that tell the two apart; a
			 * hand scroll fails them and still wins, and still ends the following.
			 */
			if (
				!asideScrollWasClamped({
					scrollTop: region.scrollTop,
					offset: written.offset,
					maxScroll: Math.max(0, region.scrollHeight - region.clientHeight),
					clientHeight: region.clientHeight,
					writtenClientHeight: written.clientHeight,
				})
			) {
				scrollDone.current = lastTurnId;
				return;
			}
		}
		const geometry = {
			regionTop: region.getBoundingClientRect().top,
			turnTop: turn.getBoundingClientRect().top,
			scrollTop: region.scrollTop,
			scrollHeight: region.scrollHeight,
			clientHeight: region.clientHeight,
		};
		const wanted = asideScrollToTurn(geometry);
		region.scrollTop = wanted;
		scrollWritten.current = {
			turnId: lastTurnId,
			offset: region.scrollTop,
			clientHeight: region.clientHeight,
		};
		/*
		 * Reached when the region's own ceiling was not what limited the move - the one
		 * condition under which the question is really at the top of the region.
		 */
		if (wanted === Math.max(0, asideQuestionTopOffset(geometry))) {
			scrollDone.current = lastTurnId;
		}
	}, [lastTurnId, newestTurnGrowth, newestTurnBox, newestQuestionBox]);
	// Absent rather than conditional-in-the-parent at this level too: the panel's
	// own store subscription is what makes it appear, and a caller that removed it
	// must remove the attachment (or the panel would paint over the composer).
	if (!attachment) return null;

	const lastTurn = attachment.turns.at(-1);
	const stream = lastTurn ? streams[lastTurn.asideId] : undefined;
	const ready = asideAdoptReady(stream, sessionStreaming);
	const blocked = asideAdoptBlockedReason(stream, sessionStreaming);
	/*
	 * WHAT A SCREEN READER IS TOLD, AND WHY IT IS A PHASE SENTENCE RATHER THAN
	 * THE ANSWER (review round 1, F4).
	 *
	 * The panel is the app's only streaming surface outside the transcript's own
	 * live regions, and it announced nothing: the question was taken, the answer
	 * was arriving and the exchange had settled all in silence. The house pattern
	 * for a transition a reader did not initiate is one `<output aria-live="polite">`
	 * carrying the PHASE (`older-history-slot.tsx`, the working line) — and the
	 * phase is the whole point here. Mirroring the answer into a live region would
	 * announce once per chunk, which is worse than announcing nothing: the text
	 * arrives many times per answer, a `polite` region is not interruptible, and
	 * the reader would be hearing the answer's tail long after it finished.
	 *
	 * SO THE ANNOUNCEMENT IS A FUNCTION OF THE PHASE AND NOT OF THE STREAMING TEXT
	 * (and since UX round 1's U10, of the answer ONCE, at the moment it settles -
	 * see `asideAnnouncement`, which is where the sentence and its bound live). React
	 * re-renders the panel on every chunk, and the region's CONTENT changes only on
	 * the phase edges and once at settle, so the reader hears one phase sentence per
	 * phase and one answer, never an announcement per chunk.
	 * `streaming` covers the thinking state and the streaming one together, because
	 * they are one phase to a listener: nothing had arrived, and text is arriving.
	 *
	 * The empty panel is deliberately silent. Its text is one sentence, it is the
	 * surface the user has just summoned with their own keypress, and there is
	 * nothing yet to wait for — whereas the states below are the ones a reader
	 * cannot see arrive.
	 */
	const announcement = asideAnnouncement(stream);
	// `navigator.platform`, derived at the call site exactly as `chat-sidebar.tsx`
	// and `chat-header.tsx` do it: the cap is a promise about a key, and an
	// awaited platform would flash the wrong one.
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

	return (
		<section
			/*
			 * A `<section>` WITH AN ACCESSIBLE NAME, and no explicit `role="region"`:
			 * that combination IS the region role (ARIA's own mapping, which is also why
			 * biome's `noRedundantRoles` refuses the attribute), and the name is what
			 * makes it a region rather than an anonymous generic. Annotating it by hand
			 * would be stating the same fact twice, in the one place where the two can
			 * disagree.
			 *
			 * WHAT IT IS NOT is the load-bearing half: it carries none of
			 * `keyboard-scopes.ts`'s `PRESS_OWNER_SELECTOR` roles (`dialog`,
			 * `alertdialog`, `menu`, `listbox`), so a press inside the panel still belongs
			 * to the page — the app-level shortcuts keep working while an aside is open,
			 * which is the property the modal it replaces took away.
			 */
			aria-labelledby={titleId}
			/*
			 * ESCAPE, FROM INSIDE THE PANEL, and it announces itself the same way the
			 * composer's own handler does. The composer's textarea claims Escape while it
			 * has focus (that is where a user typing is), but a user who just pressed the
			 * panel's own control has focus ON THAT CONTROL, and a closing gesture that
			 * depends on which of the panel's two controls was last clicked is a trap.
			 * `preventDefault` is what stops the app-level interrupt ladder from ALSO
			 * acting on the press: that listener runs on `window`, sees
			 * `defaultPrevented`, and stands down — the rung the slash popup's Escape
			 * already occupies (`use-interrupt-on-escape.ts`).
			 */
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				closeAside(sessionId);
				/*
				 * AND THE CARET GOES BACK TO THE BOX (UX round 1, U6). Escape from the
				 * composer's own field already leaves focus there; Escape from INSIDE this
				 * panel takes the pressed control away with the panel, so the alternative
				 * is `document.activeElement === <body>` and a next Tab from the top of the
				 * page. The two Escapes now end in the same place.
				 */
				onReturnFocus?.();
			}}
			className={cn(
				CHAT_MEASURE,
				// The composer box's own steps (`rounded-md`/`rounded-frame`, `p-2`/`p-4`),
				// so the two surfaces share one left edge, one right edge and one internal
				// inset. A panel on its own steps would read as unrelated chrome.
				isSmallView
					? "mb-2 gap-2 rounded-md p-2"
					: "mb-3 gap-3 rounded-frame p-4",
				"flex flex-col border border-hairline bg-sunken",
				// `hairline`, not `border-control`: the panel is not a control and this
				// rule is not any control's sole boundary. The composer box below keeps
				// `border-control` because it IS one, and conflating the two is how this
				// app once shipped inputs bounded at 1.25:1 (branding § 2).
			)}
			data-lo-aside-panel
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col">
					<h2 id={titleId} className="text-body-sm text-ink">
						Aside
					</h2>
					{/*
					 * The feature's own contract sentence, borrowed verbatim from the TUI
					 * card that states it (`aside_panel.py`): "nothing HERE" is the clause
					 * that makes the adopt control an act rather than a surprise, and a
					 * second wording for it here would be a second promise.
					 */}
					<p className="text-meta text-ink-muted">
						off the record — nothing here joins the conversation
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					type="button"
					aria-label="Close the aside"
					onClick={() => {
						closeAside(sessionId);
						// The panel unmounts this control, so focus would fall to `<body>`:
						// the same U6 return the panel's Escape makes.
						onReturnFocus?.();
					}}
				>
					<X aria-hidden="true" />
				</Button>
			</div>

			{/*
			 * THE ONE LIVE REGION THIS PANEL OWNS, and it is the phase, not the text:
			 * see `announcement` above for why a per-chunk announcement would be worse
			 * than none. `sr-only` rather than painted, so the visual surface keeps § 7's
			 * one-element-per-turn rule (the thinking line).
			 */}
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>

			{/*
			 * The exchange, bounded HERE rather than by an ancestor: the composer band
			 * must carry no `max-height` and no `overflow` (the slash popup is an
			 * unportaled `absolute bottom-full` child of it), so the rule is that each
			 * growable part of the band caps itself — the shape the composer's own
			 * attachment strip and textarea already use. The value is `asideExchangeCap`,
			 * a whole number of the answer's own line boxes rather than a round height.
			 */}
			<div
				ref={exchangeRef}
				/*
				 * FOCUSABLE, AND NAMED (UX round 1, U7). The region is the thing that
				 * scrolls whenever an exchange outgrows its ceiling, and it was not in the
				 * Tab walk at all: a keyboard user could not reach the overflow they could
				 * see, and the arrow and PageUp keys had nowhere to scroll. `tabIndex={0}`
				 * puts it in the walk; the label is what a reader hears on landing there —
				 * a named scroller rather than an anonymous box inside the panel's region.
				 */
				/*
				 * THE TAB STOP IS THE FIX (UX round 1, U7): a labelled scroll container with
				 * no focusable content of its own has to be focusable itself, or a keyboard
				 * user cannot reach the exchange past the ceiling at all. Same reading as the
				 * goal body in `composer-status-row.tsx`.
				 */
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the stop IS the remedy - the region scrolls and nothing inside it is focusable.
				tabIndex={0}
				aria-label="The aside exchange"
				/*
				 * `scrollbar-gutter: stable` is the measured cap's own constraint, and it is here
				 * rather than at the cap: the cap grows with a box INSIDE the region, so the width
				 * the question wraps at must not change when the exchange starts to overflow -
				 * where the platform's scrollbar takes layout width (not macOS), a gutter that
				 * appeared with the overflow would re-wrap the question a line taller and grow the
				 * cap by that same line, leaving the pair to toggle on the boundary. Reserving it
				 * always makes the measurement the cap is built on independent of the cap.
				 * See `asideExchangeCap`.
				 */
				className="flex flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable]"
				style={{
					maxHeight: asideExchangeCap(isSmallView, newestQuestionBox),
				}}
			>
				{attachment.turns.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						Type a question in the composer below — the answer lands here.
					</p>
				) : (
					attachment.turns.map((turn) => (
						<div
							key={turn.asideId}
							ref={turn.asideId === lastTurnId ? newestTurnRef : undefined}
							className="flex flex-col gap-1"
						>
							{/*
							 * The question is quieter than the answer on purpose, and the
							 * label is `sr-only` because the ink step already says it to a
							 * sighted reader: § 7 keeps the hierarchy in the type, not in
							 * extra chrome.
							 *
							 * The ref is the NEWEST turn's only: the cap above the region is a
							 * promise about the block directly above the answer its edge is
							 * measured from, and an older turn's paragraph is not that block.
							 */}
							<p
								ref={
									turn.asideId === lastTurnId ? newestQuestionRef : undefined
								}
								className="text-body-sm text-ink-muted"
							>
								<AsideQuestion question={turn.question} />
							</p>
							<AsideAnswer
								stream={streams[turn.asideId]}
								isSmallView={isSmallView}
							/>
						</div>
					))
				)}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					{/*
					 * `secondary`, matching the composer's own secondary controls: the
					 * adopt is a deliberate, occasional act beside a surface the user is
					 * typing in, not this panel's primary action.
					 *
					 * `aria-describedby` POINTS AT THE REASON (UX round 1, U9). The control is
					 * reachable while it is disabled, and the reason was a sibling paragraph
					 * associated with it by nothing: a reader landed on it and heard "dimmed"
					 * with no explanation, which is the same silence the blocked control's own
					 * doc argues against on screen. The association exists only while the reason
					 * line does, because an id that resolves to nothing is worse than none.
					 */}
					<Button
						variant="secondary"
						size="sm"
						type="button"
						disabled={!ready}
						aria-describedby={blocked !== null ? blockedId : undefined}
						onClick={() => {
							void adoptAside(sessionId)
								.catch(() => {
									// The refusal is already on the panel (`adoptAside` writes it
									// through `setAsideNotice`), and this call site has nothing to add
									// to it — a second catch that reported anything would be the toast
									// this design deliberately does not use.
								})
								/*
								 * AFTER THE ADOPT, WHETHER IT SUCCEEDED OR WAS REFUSED (UX round 1,
								 * U6). A successful adopt detaches the panel, unmounting this control
								 * and dropping focus to `<body>`; a refused one leaves the panel up with
								 * its refusal on it, and the composer is where the user can still act.
								 * Both outcomes leave the caret in the box, which is where Escape from
								 * the box already leaves it.
								 */
								.finally(() => onReturnFocus?.());
						}}
					>
						Add to conversation
					</Button>
					{/*
					 * The chord, advertised rather than hidden: a keyboard-only user must
					 * be able to find it, and the cap is the same `KeyboardShortcut` idiom
					 * the inline editor's footer and the sidebar's New chat row use.
					 *
					 * AND NAMED, because `⌘+F` means FIND everywhere else — including this
					 * app's own canvas editor — while here it adds the exchange (UX round 1,
					 * U8). The CHORD is kept rather than moved: it is the TUI's own key for
					 * this gesture (`^f` folds an open aside into the chat, which is where
					 * `asideAdoptChord` and its comment come from), and one verb with two
					 * keys across the two hosts is better than two. What was missing was the
					 * verb, and the label is where a cap can carry it.
					 */}
					<Tooltip content="Add the aside to the conversation">
						<span>
							<KeyboardShortcut shortcut={asideAdoptCap(isMac)} />
						</span>
					</Tooltip>
				</div>
				{/*
				 * The refusals, on the panel rather than in a toast: the TUI's own rule
				 * for this gesture is that the surface that refuses says so. The blocked
				 * reason explains a disabled control (this app's `cwdReadOnlyReason`
				 * shape), and the notice is what a failed adopt or close reported.
				 */}
				{blocked !== null && (
					<p id={blockedId} className="text-body-sm text-ink-muted">
						{blocked}
					</p>
				)}
				{attachment.notice !== null && (
					<p role="alert" className="text-body-sm text-warning">
						{attachment.notice}
					</p>
				)}
			</div>
		</section>
	);
};
