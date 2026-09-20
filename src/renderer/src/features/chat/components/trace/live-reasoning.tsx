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
 * moment, it retires the instant the answer starts, and it is not gated on a
 * preference whose subject is the durable field. Hiding a transient block behind
 * a preference would leave the reader looking at the same still screen the
 * ticket is about, while a durable-display preference turned on would still show
 * nothing until the turn ended.
 *
 * WHY IT IS NOT A THIRD DISCLOSURE IDIOM. It IS `Disclosure` — the same one,
 * with the same row geometry (`[chevron][glyph][label]`) and the same open body
 * as the reasoning row beside it. The reader may close it; that is a real
 * affordance here rather than chrome, because the block is transient and there
 * is nothing else it can be.
 *
 * `reasoning` is the label rather than `thinking`, deliberately, and the choice
 * is not cosmetic. The working line at the foot of the transcript already says
 * `thinking` for the whole of a model call, and the TUI's flow review measured
 * what two rows saying one word does to a reader: "the two rows answer different
 * questions — here is what the model is producing vs here is the state of the
 * model call — and the copy gives the reader no way to tell which is which". The
 * two rows here state the two different facts in two different words.
 *
 * Read at body-sm on muted ink, the same register as every other expanded row on
 * this rail, so the quietest tier of the hierarchy stays the quietest thing a
 * click can reveal — and so the answer, which arrives directly beneath it, is
 * never competing with it.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { reasoningTail } from "../../canonical/transcript-rows";
import { TraceGlyph } from "./trace-rail";

export type LiveReasoningProps = {
	/** The reasoning this viewer holds, verbatim from the wire. */
	text: string;
};

export const LiveReasoning = ({ text }: LiveReasoningProps) => {
	const { text: tail, elided } = reasoningTail(text);
	/*
	 * A fragment that is all whitespace paints nothing. Without this the block
	 * would mount an empty body for a stream that has only emitted a newline so
	 * far, which reads as a rendering fault rather than as the model pausing.
	 */
	if (!tail) return null;
	return (
		<div
			// The state the harness's own contract gives this block, and the hook
			// the evidence rigs and the DOM assertions read it through: reasoning is
			// live exactly while the call it belongs to is writing one.
			data-lo-reasoning="live"
			className="text-ink-muted"
		>
			<Disclosure
				defaultOpen
				summary={
					<span className="flex min-w-0 items-center gap-2">
						<TraceGlyph />
						{/* Same two-span shape as a trace row: the outer span inherits
						 * the 14px body strut so this row is the same height as the
						 * action rows beside it, the inner one carries the type step. */}
						<span className="truncate">
							<span className="text-ink-dim text-meta">reasoning</span>
						</span>
					</span>
				}
			>
				<p
					// `pre-wrap` because a model's reasoning carries its own line
					// breaks and they are part of what it thought — collapsing them
					// turns a structured derivation into one paragraph. `break-words`
					// because the other half of that is a token run with no space in
					// it, which `pre-wrap` alone leaves unbreakable.
					className={cn(
						"whitespace-pre-wrap break-words text-body-sm text-ink-muted",
					)}
				>
					{/*
					 * The elision mark, and it is not decoration: without it the
					 * painted window's first line begins mid-sentence with no way
					 * to tell a cut from the model's own opening. A text marker
					 * rather than a fade or a border, because it has to survive
					 * being copied out of the window with the text it belongs to.
					 */}
					{elided ? "… " : null}
					{tail}
				</p>
			</Disclosure>
		</div>
	);
};
