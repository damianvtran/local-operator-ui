/**
 * The model's reasoning, streaming — the fifth and least prominent tier of § 7,
 * shown for exactly as long as there is nothing else to read.
 *
 * This is the dead air the operator reported, made visible. The runtime has
 * always received the model's reasoning (`StreamReasoningDelta` on the wire) and
 * until now it reached no front end at all: the desktop waited for the first
 * TEXT token, measured at p50 3,067 ms from submit with 10 ms of local work in
 * front of it. `AgentReasoning` could not fill that gap — it is the ARCHIVAL
 * surface for a durable `thinking` field, gated on `showAgentReasoning` and
 * closed by default, so it renders nothing at all until the row has settled, and
 * even then it is a chevron the reader has to open.
 *
 * WHAT MAKES IT A DIFFERENT COMPONENT RATHER THAN A MODE OF THAT ONE. The two
 * answer opposite questions about the same words. `AgentReasoning` shows
 * something the transcript will KEEP, so it is quiet by default and opt-in. This
 * shows something the transcript CANNOT keep — reasoning is display-only by
 * contract and never persisted, on any channel — so it is a claim about the
 * moment, it retires the instant the answer starts, and it does not answer to the
 * preference whose subject is the durable field. How a reader turns it OFF is
 * `showLiveReasoning`, a preference of its own that defaults ON (see
 * `ui-preferences-store.ts`); the two preferences are deliberately separate
 * because gating this one on an archival field's switch would leave the operator
 * with the still screen the ticket is about.
 *
 * THE LABEL IS `Reasoning`, CAPITALISED, and that convention is shared with the
 * archival row (review D5). Both are the same kind of thing on the same rail —
 * a `Disclosure` whose label names a KIND of content, not an action — and the
 * archival one reads `Reasoning` / `Thinking` because its label names the field
 * it came from. The two rows differ in their words and in their position (live
 * above the answer, archival where the transcript holds it), which is what the
 * reader needs; making one of them lowercase would have been a third convention
 * for the same control. The lowercase `thinking` a reader also sees belongs to a
 * DIFFERENT element — the working line at the foot of the transcript, where every
 * label is the state of the call in the machine's voice. The TUI's flow review
 * measured what two rows saying one word does: "the two rows answer different
 * questions — here is what the model is producing vs here is the state of the
 * model call — and the copy gives the reader no way to tell which is which". The
 * two rows here state the two facts in two words, in the two registers.
 *
 * WHY IT IS NOT A THIRD DISCLOSURE IDIOM. It IS `Disclosure` — the same one,
 * with the same row geometry (`[chevron][glyph][label]`) and the same open body
 * as the reasoning row beside it. The reader may close it; that is a real
 * affordance here rather than chrome, because the block is transient and there
 * is nothing else it can be.
 *
 * Read at body-sm on muted ink, the same register as every other expanded row on
 * this rail, so the quietest tier of the hierarchy stays the quietest thing a
 * click can reveal — and so the answer, which arrives directly beneath it, is
 * never competing with it.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { REASONING_VISIBLE_ROWS, reasoningTail } from "../../canonical/transcript-rows";
import { TraceGlyph } from "./trace-rail";

export type LiveReasoningProps = {
	/** The reasoning this viewer holds, verbatim from the wire. */
	text: string;
	/**
	 * Whether the call this block belongs to is still writing it.
	 *
	 * The block outlives the call in exactly one case — an interrupted turn keeps
	 * its thinking, because nothing replaces it — so the two states are real and
	 * the hook says which one a reader is looking at rather than asserting
	 * liveness for both. It is what the evidence rigs and the DOM assertions read
	 * the state through.
	 */
	state: "streaming" | "frozen";
};

/**
 * How tall the painted window may get, in ROWS of the body-sm line box.
 *
 * THE CHARACTER CAP IS NOT A HEIGHT BOUND, and the design round measured the
 * consequence (D1): `pre-wrap` wraps, so a 2,000-character tail with no newline
 * in it paints **15 rows / 326px at a 900px column, 39 rows / 794px at 420px and
 * 106 rows / 2,101px at 220px** — the floor `chat-measure.ts` documents with the
 * canvas open. Nine thousand characters painted the same 326px at 900px, which is
 * the tell: the CHARACTER cap binds and the row rule does not, so the window's
 * height was whatever the column width decided. At the floor the newest reasoning
 * sat 1,854px below the fold, which is the exact failure the module's own
 * docblock names.
 *
 * So the height is bounded here, in the only place that knows how wide the column
 * actually is: the layout engine. `lh` is the paragraph's OWN line box, so the
 * bound follows the type scale rather than restating it, and it is a unit rather
 * than `6 * var(--text-body-sm--line-height)` for a reason that cost an hour: the
 * theme variable is emitted only where Tailwind decides the utility needs it, and
 * where it is absent the whole `calc()` is INVALID AND SILENTLY DROPPED. The
 * first version of this clamp measured 21 rows in the rig because of exactly
 * that, and a bound that disappears with no error is worse than no bound.
 *
 * THE VISIBLE SLICE IS THE TAIL, NOT THE HEAD. A block box clips its overflowing
 * content from the BOTTOM, which would hide the newest reasoning behind the
 * part the reader has already read — worse than clipping nothing. `flex-col`
 * with `justify-end` moves the start edge of an over-tall item above the box, so
 * `overflow-hidden` takes the OLDEST rows and the newest line stays on screen.
 * `min-height: auto` (the default for a flex item) is what keeps the paragraph
 * from being shrunk to fit instead of overflowing.
 *
 * The character cap in `reasoningTail` stays, and is now what it should always
 * have been: a DOM-COST bound, so a call that reasons for ten thousand characters
 * is not re-laying-out all of them sixty times a second.
 */
const WINDOW_STYLE = {
	maxHeight: `${REASONING_VISIBLE_ROWS}lh`,
} as const;

export const LiveReasoning = ({ text, state }: LiveReasoningProps) => {
	const { text: tail, elided, droppedChars } = reasoningTail(text);
	/*
	 * A fragment that is all whitespace paints nothing. Without this the block
	 * would mount an empty body for a stream that has only emitted a newline so
	 * far, which reads as a rendering fault rather than as the model pausing.
	 */
	if (!tail) return null;
	return (
		<div data-lo-reasoning={state} className="text-ink-muted">
			<Disclosure
				defaultOpen
				summary={
					<span className="flex min-w-0 items-center gap-2">
						<TraceGlyph />
						{/* Same two-span shape as a trace row: the outer span inherits
						 * the 14px body strut so this row is the same height as the
						 * action rows beside it, the inner one carries the type step. */}
						<span className="truncate">
							<span className="text-ink-dim text-meta">Reasoning</span>
						</span>
					</span>
				}
			>
				{/*
				 * HOW MUCH IS NOT SHOWN, above the window rather than inside it
				 * (design N2), because inside it the mark is the first thing the
				 * height clamp clips. `droppedChars` is the characters this block
				 * was handed and does not paint; the height clamp can crop further
				 * at a narrow column, so the copy says "earlier characters" rather
				 * than claiming to count everything above - a floor, which is what a
				 * mark about a cut can honestly be.
				 */}
				{elided ? (
					<p className="text-ink-dim text-meta">
						{`\u2026 ${droppedChars.toLocaleString()} earlier characters`}
					</p>
				) : null}
				{/* The clamp's own geometry hook: the rig and the tests measure the
				 * window against the text it holds, and neither fact has a class
				 * name that could survive a restyle. */}
				<div
					data-lo-reasoning-window=""
					className={cn("flex flex-col justify-end overflow-hidden")}
					style={WINDOW_STYLE}
				>
					<p
						data-lo-reasoning-text=""
						// `pre-wrap` because a model's reasoning carries its own line
						// breaks and they are part of what it thought — collapsing them
						// turns a structured derivation into one paragraph. `break-words`
						// because the other half of that is a token run with no space in
						// it, which `pre-wrap` alone leaves unbreakable.
						className={cn(
							"whitespace-pre-wrap break-words text-body-sm text-ink-muted",
						)}
					>
						{tail}
					</p>
				</div>
			</Disclosure>
		</div>
	);
};
