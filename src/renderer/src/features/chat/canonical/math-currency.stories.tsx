/**
 * CURRENCY AND MATH IN ONE MESSAGE, as the reader receives it (operator
 * report, 2026-09-27).
 *
 * WHAT THE OPERATOR SAW. Cost reports rendered as mangled italics and raw
 * LaTeX fragments — `$0.30/M` and the bold markers around a price pulled into
 * an `inlineMath` span — instead of the clean prices the agent wrote. The
 * cause is at parse time: `remark-math`'s single-dollar syntax has no
 * adjacency rules, so once the math pipeline is on for a message, the `$` of
 * one price and the `$` of a later one become an inline formula and everything
 * between them is typeset by KaTeX.
 *
 * WHY EACH MESSAGE CARRIES A FORMULA. The pipeline is per message — the
 * renderer asks `containsRenderableMath` for the whole document
 * (`markdown-math.ts`) — and a cost report's own dollar signs are not what
 * turns it on: every `$` in `$0.30/M` is followed by a digit, which that
 * module's `\$…\$` heuristic deliberately refuses. The defect needs the
 * pipeline ON with a currency pair in the same message, so each fixture here
 * is the reported text beside one genuine formula — exactly the state the
 * operator's message was in.
 *
 * The four states are the four claims the change has to hold at once:
 *
 *  - `CostReport`: the screenshot's two bullets — bold intact, every amount
 *    literal — with the trailing formula still typeset;
 *  - `PandocClassic`: pandoc's own documented example (`$20,000 and $30,000`),
 *    which the guarded tokenizer's closer rules exist for;
 *  - `PriceThenFormula`: a price that must stay literal while a LATER formula
 *    still parses — the case the old tokenizer renders as one open-ended span;
 *  - `GenuineMath`: formulas only, the control that must NOT move between the
 *    two trees, because the guards may not perturb non-currency behaviour.
 *
 * The rig is `message-surface.stories.tsx`'s: the real `CanonicalTranscript`
 * over agent answers (`credentialCitations` off — this is the agent-facing
 * render that cost reports arrive through) at the same 1024x620 pane as
 * `credential-citation.stories.tsx`, so the frames read beside their siblings.
 * The evidence pair is `docs/evidence/chat-math-currency/` against
 * `../chat-math-currency-before/` (the pre-change pipeline, same fixtures).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

/** A settled, complete agent answer with no stop reason - the ordinary case. */
const answer = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

/** A transcript state holding one row, as `chat-content.tsx` hands one over. */
const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/**
 * The screenshot's two bullets, verbatim, with one formula sentence beside
 * them so the pipeline is on - which is the precondition of the defect (see
 * this file's header). The amounts themselves are the operator's own figures.
 */
const COST_REPORT = answer(
	"a1",
	[
		"**Cost report** — an 11-call review at the published rates.",
		"",
		"- Exact: an **11-call review = $0.0146 * ($291k input, 264k cached, 4k output)** — matches the published rates ($0.30/M fresh-in, $0.006/M cached-in, $1.20/M out).",
		"- Typical: **light review $0.015-0.03** . typical $0.03-0.05 . heavy ~$0.07-0.09 . verdict $0.01-0.03 -> blended ~ $0.03-0.05/engagement. **(My earlier estimate of $0.09 was conservatively high by 2-3x.)**",
		"",
		"Spend scales with the square of the review size, so the envelope is $c = a n^2$ rather than linear in calls.",
	].join("\n"),
);

/**
 * Pandoc's own example sentence, which its manual uses to say these are NOT
 * math ("$20,000 and $30,000 won't parse as math"), plus one formula so the
 * document reaches the pipeline at all.
 */
const PANDOC_CLASSIC = answer(
	"a1",
	"It cost $20,000 and $30,000 in total; the published ratio is $x/y$.",
);

/**
 * A price ahead of a genuine span. The old tokenizer pairs the price's `$`
 * with the formula's opening `$` and typesets the prose between them; the
 * guarded one leaves `$5` alone and still renders `x^2`.
 */
const PRICE_THEN_FORMULA = answer(
	"a1",
	"The invoice logic is simple: pay $5 now, where $x^2$ holds, and nothing later.",
);

/** Formulas only - the control whose before and after frames must match. */
const GENUINE_MATH = answer(
	"a1",
	"Where $x^2 + y^2 = z^2$ holds, and $a$ differs from $b$, the identity $c^2 = a^2 + b^2$ follows.",
);

/**
 * The transcript pane in a fixed 1024-wide frame, on `bg-canvas` - the width
 * `credential-citation.stories.tsx` and `user-card-measure` use, so these
 * frames read beside theirs. Pinned in pixels for the same reason those are:
 * the claim is about the glyph runs in one message, at the width this app
 * reads messages at.
 *
 * THE HEIGHT IS PER STORY, and short on purpose. The claim is one message's
 * glyph runs; a taller pane only adds ground below them, and the rig's own
 * paint assertion (`assertFramePaints`) fails a story whose ink is under
 * 1.5% of its frame - measured here: a single-sentence answer at 620px of
 * height is 1.4%, and at 300px it is 3%+. The heights are per story rather
 * than one constant so each frame ends just under its own content.
 */
const Frame = ({
	records,
	height,
}: {
	records: TranscriptRecord[];
	height: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width: 1024, height }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(records)}
					frontend={null}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Math currency",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The reported frame: a cost report, its bold intact, its amounts literal. */
export const CostReport: Story = {
	render: () => <Frame records={[COST_REPORT]} height={380} />,
};

/** The documented pandoc pair, which must not parse as math. */
export const PandocClassic: Story = {
	render: () => <Frame records={[PANDOC_CLASSIC]} height={300} />,
};

/** A price ahead of a genuine span: literal `$5`, typeset `x^2`. */
export const PriceThenFormula: Story = {
	render: () => <Frame records={[PRICE_THEN_FORMULA]} height={300} />,
};

/** Formulas only - the control that must not move between the two trees. */
export const GenuineMath: Story = {
	render: () => <Frame records={[GENUINE_MATH]} height={300} />,
};
