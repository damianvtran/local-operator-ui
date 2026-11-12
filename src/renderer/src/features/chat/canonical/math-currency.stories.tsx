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
// `extra` overrides the assistant fields (the streaming story), as in
// message-actions.stories.tsx: spreading the returned TranscriptRecord union
// would not typecheck, since the user kind has no `streaming` field.
const answer = (
	id: string,
	text: string,
	extra: Partial<Extract<TranscriptRecord, { kind: "assistant" }>> = {},
): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
	...extra,
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
	width = 1024,
}: {
	records: TranscriptRecord[];
	height: number;
	/** Only the narrow display story overrides it (D1). */
	width?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width, height }}>
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

/*
 * MONEY VERSUS MATH AND LATEX'S OWN DELIMITERS (operator report, 2026-11-10:
 * "latex sequences are not properly parsed and rendered inline" and
 * "differentiate between dollar values ... and latex components"). The rules
 * live in `markdown-math-guarded.ts` (guard (d)) and
 * `markdown-math-backslash.ts`; these frames are the pixels for them.
 */

/**
 * The reported paragraph: digit-led spans carrying `\text`, `\mu`, `^` and
 * `\times` used to stay raw source beside `$Re \ll 1$` and `$k_BT$`, which
 * rendered. All seven must typeset.
 */
const SCREENSHOT_PARAGRAPH = answer(
	"a1",
	"At the scale of tens of centimeters—$10^3\\text{–}10^5\\times$ larger than the robot—flow is inertial, but shrink a battery into $10\\text{ }\\mu\\text{m}^3$ to fight arterial blood flows exceeding $20\\text{ cm/s}$ and $Re \\ll 1$ takes over. The remarkable $200 \\times 300 \\times 50\\text{ }\\mu\\text{m}$ autonomous silicon robots are still wider than a capillary ($8\\text{ }\\mu\\text{m}$), and thermal noise $k_BT$ dominates.",
);

/** Prices and formulas in one paragraph: every amount literal, every formula typeset. */
const MONEY_AND_MATH = answer(
	"a1",
	"The prototype cost $20,000 and $30,000 across two runs ($5M/$1.2B is the market's range, and parts run between $3–$4 per unit). Its drag scales as $10^{-3}\\,\\text{N}$ at $2^n - 1$ cycles, and the budget of $5.00 per test is unchanged.",
);

/**
 * A degree-30 polynomial: about twice the 778px content box of the 1024px
 * frame's display panel, so the panel's `overflow-x: auto` has something to
 * scroll. Design review round 1, D1: the degree-14 version measured 750.5px
 * and fit, so no frame proved the scroll.
 */
const WIDE_POLYNOMIAL = `f(x) = a_0 + a_1 x + ${Array.from(
	{ length: 29 },
	(_, i) => `a_{${i + 2}} x^{${i + 2}}`,
).join(" + ")}`;

/** One display equation per delimiter: `$$`, `\[...\]`, ```math, and `\[` mid-paragraph. */
const DISPLAY_BLOCKS = answer(
	"a1",
	[
		"Dollar display:",
		"",
		"$$",
		"E = mc^2",
		"$$",
		"",
		"Bracket display:",
		"",
		"\\[",
		"\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
		"\\]",
		"",
		"Fenced display:",
		"",
		"```math",
		"\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}",
		"```",
		"",
		"Inline \\(a^2 + b^2 = c^2\\) and a mid-sentence display \\[ \\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0} \\] in prose. A wide one scrolls inside its panel:",
		"",
		"\\[",
		WIDE_POLYNOMIAL,
		"\\]",
	].join("\n"),
);

/** Invalid TeX: KaTeX's error span in the theme's danger role, the message intact. */
const INVALID_TEX = answer(
	"a1",
	"A broken fraction \\(\\frac{1}{\\) and an unknown command $\\notacommand{x}$ render as error text, and the sentence after them still reads normally.",
);

/** A message still streaming: the unclosed `$` and `\[` stay literal until closed. */
const STREAMING_TRUNCATED = answer(
	"a1",
	"So far $x^2$ is settled, and the next term is $y^2 + \n\nThe energy is\n\n\\[\nE = mc",
	{ streaming: true, complete: false },
);

/** The operator's paragraph: seven formulas, no raw `$` left. */
export const ScreenshotParagraph: Story = {
	render: () => <Frame records={[SCREENSHOT_PARAGRAPH]} height={300} />,
};

/** Prices literal, digit-led TeX typeset, in one paragraph. */
export const MoneyAndMath: Story = {
	render: () => <Frame records={[MONEY_AND_MATH]} height={300} />,
};

/** Centred, tinted display panels for every delimiter, plus horizontal overflow. */
export const DisplayBlocks: Story = {
	render: () => <Frame records={[DISPLAY_BLOCKS]} height={760} />,
};

/**
 * The same blocks in a 600px pane (a narrow window or split view): every
 * panel stays inside the prose column and the wide one scrolls from its left
 * edge rather than clipping it (design review round 1, D1). Taller than the
 * 1024px story because the prose wraps.
 */
export const DisplayBlocksNarrow: Story = {
	render: () => <Frame records={[DISPLAY_BLOCKS]} height={900} width={600} />,
};

/** Invalid TeX never breaks the message. */
export const InvalidTex: Story = {
	render: () => <Frame records={[INVALID_TEX]} height={300} />,
};

/** Mid-stream: unclosed delimiters stay as text. */
export const StreamingTruncated: Story = {
	render: () => <Frame records={[STREAMING_TRUNCATED]} height={360} />,
};
