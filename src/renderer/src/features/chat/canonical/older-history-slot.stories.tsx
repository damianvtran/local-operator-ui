/**
 * The top slot of the transcript, in every state it can be in.
 *
 * These stories exist to make ONE claim visible: the slot does not change
 * height. It sits directly above the oldest rendered row, so any height it
 * gains or loses is height the whole conversation below it moves by — and the
 * states swap while the reader is looking at the top of the screen, which is
 * the worst possible moment for content to jump. Under click-driven paging that
 * never mattered, because the reader had just clicked and expected something to
 * happen; under scroll-driven paging the swap happens on its own.
 *
 * So the states are rendered stacked against a ruled background rather than one
 * per story. The claim is a COMPARISON, and a comparison split across four
 * frames is one a reader has to take on trust. Here the baselines either line
 * up or they do not.
 *
 * The last story renders the slot inside the production `CanonicalTranscript`,
 * because the fixed height is only worth anything in the place it is claimed
 * for: above real rows, in the real column measure, with the real gap below it.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import { OlderHistorySlot, type OlderHistoryState } from "./older-history-slot";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const meta: Meta<typeof OlderHistorySlot> = {
	title: "Chat/Older history slot",
	component: OlderHistorySlot,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof OlderHistorySlot>;

const STATES: { state: OlderHistoryState; caption: string }[] = [
	{ state: "idle", caption: "idle, more history on the backend" },
	{ state: "loading", caption: "a durable page is in flight" },
	{ state: "failed", caption: "the page failed; the action still works" },
	{ state: "windowed", caption: "rows held back by the render window only" },
	{ state: "exhausted", caption: "every row this conversation has" },
];

/**
 * One state, with a rule drawn at the box's top and bottom edge.
 *
 * `border-hairline` is the decorative role, which is what these are: they mark
 * a measurement rather than bounding a control. The caption is `text-ink-muted`
 * so it reads as apparatus and not as part of the surface under test.
 */
const Ruled = ({
	state,
	caption,
	width = "32rem",
}: { state: OlderHistoryState; caption: string; width?: string }) => (
	<div className="flex items-start gap-4">
		<span className="w-64 shrink-0 pt-1 text-ink-muted text-meta">
			{caption}
		</span>
		<div className="border-hairline border-y" style={{ width }}>
			<OlderHistorySlot
				state={state}
				hiddenRows={137}
				onLoadOlder={() => undefined}
			/>
		</div>
	</div>
);

/**
 * The fixed-height claim, falsifiable at a glance: five states between two
 * rules. Any state that is taller than the others pushes its lower rule down.
 */
export const EveryState: Story = {
	render: () => (
		<div className="flex flex-col gap-6 bg-canvas p-8">
			{STATES.map(({ state, caption }) => (
				<Ruled key={state} state={state} caption={caption} />
			))}
		</div>
	),
};

/**
 * The same five states at the app's OWN minimum content width.
 *
 * This board exists because `EveryState` renders at a single 32rem column, and
 * that is why a wrapping failure state shipped: the failure copy has an
 * intrinsic width of ~258px, so it fit at 512px and wrapped to two lines at
 * 252px, measuring 34.78px inside a 28px box and crossing the row's own bottom
 * rule.
 *
 * 252px is not a hypothetical. It is what the transcript's content box measures
 * at the window's 800px minimum: 800 minus the 220px app rail, minus the chat
 * list pane's 280px default, minus the transcript's `p-4` (32px) and the 16px
 * its `scrollbar-gutter: stable both-edges` reserves. The chat column itself
 * floors lower still (220px), and opening the canvas panel reaches these widths
 * at any window size — so this is a width the app routinely has, not an edge.
 *
 * A reviewer should be able to SEE the invariant hold at the narrow measure
 * rather than derive it from three constants, which is the difference between
 * evidence and an assertion.
 */
export const AppMinimumWidth: Story = {
	render: () => (
		<div className="flex flex-col gap-6 bg-canvas p-8">
			<p className="max-w-[46rem] text-ink-muted text-meta">
				Rendered at 252px, the transcript's content box at the app's 800px
				minimum window. Every state must keep its lower rule on the same
				baseline as the others.
			</p>
			{STATES.map(({ state, caption }) => (
				<Ruled
					key={state}
					state={state}
					caption={caption}
					width="252px"
				/>
			))}
			<p className="max-w-[46rem] pt-2 text-ink-muted text-meta">
				And at 220px, the chat column's own floor.
			</p>
			{STATES.filter((entry) => entry.state === "failed" || entry.state === "loading").map(
				({ state, caption }) => (
					<Ruled
						key={`narrow-${state}`}
						state={state}
						caption={caption}
						width="220px"
					/>
				),
			)}
		</div>
	),
};

/** The singular, which is its own copy branch and its own chance to be wrong. */
export const OneHiddenRow: Story = {
	render: () => (
		<div className="flex flex-col gap-6 bg-canvas p-8">
			<Ruled state="windowed" caption="one row, singular copy" />
			<div className="flex items-start gap-4">
				<span className="w-64 shrink-0 pt-1 text-ink-muted text-meta">
					rendered with hiddenRows=1
				</span>
				<div className="w-[32rem] border-hairline border-y">
					<OlderHistorySlot
						state="windowed"
						hiddenRows={1}
						onLoadOlder={() => undefined}
					/>
				</div>
			</div>
		</div>
	),
};

// -------------------------------------------------- in the real transcript

const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: 1_760_000_000_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

const transcriptOf = (
	records: TranscriptRecord[],
	hasMore: boolean,
): TranscriptState =>
	({
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		hasMore,
		oldestId: records[0]?.id ?? null,
	}) as unknown as TranscriptState;

const InTranscript = ({
	hasMore,
	loadingOlder,
}: { hasMore: boolean; loadingOlder: boolean }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex h-[520px] flex-col bg-canvas" ref={containerRef}>
			<CanonicalTranscript
				transcript={transcriptOf(
					[
						assistant("a1", "The oldest rendered row sits directly below."),
						assistant(
							"a2",
							"A slot that changed height would move this row, and every row after it, at the exact moment the reader is looking at the top of the conversation.",
						),
						assistant("a3", "The newest row."),
					],
					hasMore,
				)}
				gate={null}
				waiting={false}
				loadingOlder={loadingOlder}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				error={null}
			/>
		</div>
	);
};

/** The affordance above real rows, in the real column measure. */
export const InTranscriptIdle: Story = {
	render: () => <InTranscript hasMore loadingOlder={false} />,
};

/**
 * The same frame mid-load. Compared against the one above, the first row below
 * the slot must not have moved.
 */
export const InTranscriptLoading: Story = {
	render: () => <InTranscript hasMore loadingOlder />,
};
