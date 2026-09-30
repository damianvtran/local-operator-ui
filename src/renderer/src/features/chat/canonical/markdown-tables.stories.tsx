/**
 * The markdown table, on the production transcript, at the widths the chat
 * column actually gives it.
 *
 * WHY THIS SET EXISTS (operator report, 2026-09-30). A table the agent wrote
 * into an answer rendered with its narrow columns squeezed to a few pixels: the
 * reported cells were `#684 (1a)` and `MERGED f11952f1d2` wrapping mid-token
 * while the prose column beside them took the width. This story is the repro
 * surface for that report, and its BEFORE frames live in
 * `docs/evidence/chat-markdown-tables-before/` - captured from this same file
 * with the title temporarily suffixed `before` (see that set's README for the
 * exact command).
 *
 * WHAT EACH STATE IS FOR. One export per fixture shape, because the claim is
 * about what the table algorithm does to a CONTENT shape and each shape is a
 * different question:
 *
 *  - `OperatorShape`: the reported table itself - three columns, two of them
 *    short, the third a long prose column - over real pull requests from this
 *    repository. This is the reproduction the lane rests on.
 *  - `LongProse`: one 400+ character cell, the shape that wins the width fight
 *    and squeezes its neighbours.
 *  - `LongTokens`: a full 40-character SHA, a long URL and a long path, the
 *    values that cannot wrap at word boundaries at all.
 *  - `ManyColumns`: seven columns of mixed widths, where every column is
 *    competing for the same measure.
 *  - `FewRows`: two rows only, the control that must not regress while the
 *    wider tables are fixed.
 *
 * WHY THE TRANSCRIPT AND NOT A BARE TABLE. `.lo-markdown` is styled by
 * descendant selectors against react-markdown's output (`markdown.css`), and
 * the row around the answer carries the width the table is actually laid out
 * in. A table mounted in a bare story box would photograph a box the product
 * never renders; this frame gives the answer the same 810px `CHAT_MEASURE`
 * column the app gives it, at the two viewport widths the rig captures.
 *
 * No `play` function: every state is a settling-free resting frame, and the
 * evidence rig takes them.
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

/*
 * The reported shape, in the report's own cells.
 *
 * Row 1 is the operator's exact reproduction (`#684 (1a)` / `MERGED
 * f11952f1d2` / the loader-continuity title); the rows under it are real
 * neighbours from this repository's own history (pull 706 and pull 708, states
 * and merge shas read from the GitHub API on 2026-09-30), because a fixture
 * that invents its shas measures a string shape the product never carries.
 *
 * PULL 708'S CELL CARRIES THE CHANGE'S OWN DESCRIPTION rather than only its
 * title, and that is load-bearing rather than decorative: the squeeze this set
 * reproduces is a function of the LONGEST cell in column three - the auto
 * layout hands the prose column a share of the width in proportion to that
 * column's content - and the reported table's third column is the one the
 * operator saw "wrapping heavily". Measured on this fixture: at a
 * title-length maximum (113 characters) the short columns stayed word-whole at
 * 75.8px / 140.0px; at a 271-character maximum they broke mid-token at 53.9px
 * / 85.5px. The description below sits past that crossover, and
 * `MEASUREMENTS.md` in `docs/evidence/chat-markdown-tables-before/` carries
 * the sweep.
 */
const OPERATOR_SHAPE = [
	"| PR | State | What it fixes |",
	"| --- | --- | --- |",
	"| #684 (1a) | MERGED f11952f1d2 | fix(chat): no dead zone or false failure when paging history (loader continuity 1a) |",
	"| #706 | MERGED 643b5270a8 | feat(trace): sessions tool glyph + label |",
	"| #708 (2) | OPEN | feat(chat): a turn's condensed span is segments, and the answer row is elected (loader continuity 2, closes #665) - the condensed span is rebuilt as segments so expanding one no longer depends on the turn around it, and the answer row is elected from painted rows rather than from the position the reducer held when the turn settled, which is the fix for the blank answer row that reopened after 1b. |",
].join("\n");

/*
 * One cell of 400+ characters against two short ones.
 *
 * The prose is the register the surface carries - an agent explaining a
 * decision - so the character count this state exists to prove is a count of
 * the text the product renders, not lorem ipsum with different word lengths.
 */
const LONG_PROSE = [
	"| Change | Why it matters |",
	"| --- | --- |",
	"| Loader continuity 1a | Loader continuity 1a closes the gap where paging older history in a live conversation could reach a page boundary with nothing to paint: the loader stayed up over an empty stretch and then reported a failure the release had not actually produced. The fix holds the loader to the same continuity rule the join path uses, so a page that arrives empty is treated as a page that has not arrived yet, and the failure notice is reserved for a release that genuinely answered with an error. This is the half that reopened after the first attempt, because the durable replay of an in-flight turn rendered one row fewer than the live path had painted, which made an ordinary settle read as a missed frame. |",
	"| Table widths | Short cells must not wrap mid-token. |",
].join("\n");

/*
 * The values that have no word boundaries: a full commit sha, a comment deep
 * link, and an absolute path. Each is a single unbreakable token, so whatever
 * the fix does about wrapping has to do it here or show a horizontal scroll.
 */
const LONG_TOKENS = [
	"| Artifact | Kind | Reference |",
	"| --- | --- | --- |",
	"| Merge commit | sha | f11952f1d2e7d20c38f8ae9b7cd8d7deecce3f24 |",
	"| Review thread | url | https://github.com/damianvtran/local-operator-ui/pull/684#issuecomment-3358190433 |",
	"| Evidence | path | ~/local-operator-ui-worktrees/table-widths-0930-3020/docs/evidence/chat-markdown-tables-before/MEASUREMENTS.md |",
	"| Base merge | sha | 29703750960af219a1a9aa07ba8f10cf8806a536 |",
].join("\n");

/* Seven columns, mixed widths: every column competes for the same measure. */
const MANY_COLUMNS = [
	"| PR | State | Author | Branch | Files | Delta | CI |",
	"| --- | --- | --- | --- | --- | --- | --- |",
	"| #708 (2) | OPEN | damian | feat/loader-2 | 14 | +402 -96 | pending |",
	"| #705 | OPEN | damian | feat/mini-restyle | 9 | +221 -140 | running |",
	"| #706 | MERGED 643b5270a8 | damian | feat/trace-sessions | 6 | +118 -12 | green |",
].join("\n");

/* The control: the smallest table the surface has to keep looking right. */
const FEW_ROWS = [
	"| Check | Result | Detail |",
	"| --- | --- | --- |",
	"| History paging | PASS | no dead zone, 12 of 12 runs |",
	"| Loader continuity | PASS | 1a merged in f11952f1d2 |",
].join("\n");

/**
 * The transcript pane, filling the rig's viewport.
 *
 * The 810px `CHAT_MEASURE` column comes from `CanonicalTranscript` itself, so
 * the frame only has to give the pane the capture's own width and the same
 * `px-4 pt-4` inset the chat page wraps it in (`message-surface.stories.tsx`
 * carries the same frame at a pinned 1024; this one is unpinned because the
 * rig captures it at two widths).
 */
const Frame = ({
	records,
	height = 900,
}: {
	records: TranscriptRecord[];
	height?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width: "100%", height }}>
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
	title: "Chat/Markdown tables",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The reported shape: two short columns beside one long prose column. */
export const OperatorShape: Story = {
	render: () => <Frame records={[answer("a1", OPERATOR_SHAPE)]} />,
};

/** One 400+ character cell against short neighbours. */
export const LongProse: Story = {
	render: () => <Frame records={[answer("a1", LONG_PROSE)]} />,
};

/** A full sha, a deep link and a long path: tokens with no word boundaries. */
export const LongTokens: Story = {
	render: () => <Frame records={[answer("a1", LONG_TOKENS)]} />,
};

/** Seven mixed-width columns in one measure. */
export const ManyColumns: Story = {
	render: () => <Frame records={[answer("a1", MANY_COLUMNS)]} />,
};

/** Two rows only: the control. */
export const FewRows: Story = {
	render: () => <Frame records={[answer("a1", FEW_ROWS)]} />,
};
