/**
 * The in-thread search overlay, one frame per state.
 *
 * WHY THIS SET EXISTS. `⌘F` over a conversation is a new surface, and the
 * states are the whole of what a reviewer has to judge: the resting box, a
 * query in flight, the ranked list with its match marks and its two tiers, the
 * three degraded answers the wire can return (`building`, `unsupported`,
 * `error`) and the empty one. Each story below is one of those states as the
 * shipped component renders it, on the transcript's own `canvas` ground at the
 * corner the panel occupies in the app.
 *
 * WHAT THIS SET DOES NOT SHOW, so a reader does not read absence as coverage:
 * the panel composed OVER a live transcript (the integration phase's subject —
 * the overlay mounts with the transcript wiring, and its frames land there),
 * and the chord itself, which is keyboard state rather than a resting render
 * (`scripts/thread-search-overlay.test.mjs` drives the real key events). The
 * component's own layout is what these frames judge, and every state here is a
 * resting one, so there is no `play` function: the evidence rig takes them.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import "../../../styles/index.css";
import type { ThreadFindHit } from "../../../../../shared/desktop-contract";
import { ThreadSearchPanel } from "./thread-search-overlay";

const TS = 1_760_000_000;

/** Where a query's own occurrences sit inside a snippet (the wire's ranges). */
const rangesOf = (snippet: string, query: string): [number, number][] => {
	const ranges: [number, number][] = [];
	const haystack = snippet.toLowerCase();
	const needle = query.toLowerCase();
	let at = haystack.indexOf(needle);
	while (at >= 0 && ranges.length < 5) {
		ranges.push([at, at + needle.length]);
		at = haystack.indexOf(needle, at + needle.length);
	}
	return ranges;
};

const hit = (over: Partial<ThreadFindHit> & { id: string }): ThreadFindHit => ({
	role: "user",
	ts: TS,
	snippet: "",
	ranges: [],
	tier: "exact",
	...over,
});

const noop = () => {};

/**
 * The transcript's own ground at the pane's shipped width, with the panel at
 * the corner it floats over. The ground is `canvas` because that is what the
 * panel covers in the app — a panel photographed on a blank page would answer
 * the wrong question about its step against the surface behind it.
 */
const Frame: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="relative h-[560px] w-[900px] overflow-hidden bg-canvas">
		<div className="absolute top-3 right-3 max-w-[calc(100%-1.5rem)]">
			{children}
		</div>
	</div>
);

const meta: Meta<typeof ThreadSearchPanel> = {
	title: "Chat / In-thread search",
	component: ThreadSearchPanel,
	decorators: [
		(Story) => (
			<Frame>
				<Story />
			</Frame>
		),
	],
	args: {
		query: "",
		onQueryChange: noop,
		state: "idle",
		hits: [],
		cursor: -1,
		truncated: false,
		partial: false,
		onMoveCursor: noop,
		onNavigate: noop,
		onRetry: noop,
		onClose: noop,
		isMac: true,
	},
};

export default meta;

type Story = StoryObj<typeof ThreadSearchPanel>;

/** The box at rest, one keystroke after `⌘F`. */
export const Rest: Story = {};

/** A query past the debounce whose first answer has not landed. */
export const Searching: Story = {
	args: { query: "ledger", state: "loading" },
};

/**
 * The ranked answer. One row per tier and role, and the multi-occurrence row
 * carries two marks so a frame shows the segments between them rather than a
 * single contiguous highlight.
 */
export const Results: Story = {
	args: {
		query: "ledger",
		state: "ready",
		cursor: 0,
		hits: [
			hit({
				id: "m1",
				role: "user",
				snippet:
					"Can you check whether the billing ledger export still rounds every amount to two decimals?",
				ranges: rangesOf(
					"Can you check whether the billing ledger export still rounds every amount to two decimals?",
					"ledger",
				),
			}),
			hit({
				id: "m2",
				role: "agent",
				snippet:
					"The reconciliation job reads the ledger in 500-row pages, so rounding happens before the comparison.",
				ranges: rangesOf(
					"The reconciliation job reads the ledger in 500-row pages, so rounding happens before the comparison.",
					"ledger",
				),
			}),
			hit({
				id: "m3",
				role: "agent",
				tier: "soft",
				snippet:
					"I normalized the exported currency amounts and added a regression test for half-up rounding.",
			}),
			hit({
				id: "m4",
				role: "user",
				snippet:
					"The ledger root moved last week, so anything that still writes the ledger path needs an update.",
				ranges: rangesOf(
					"The ledger root moved last week, so anything that still writes the ledger path needs an update.",
					"ledger",
				),
			}),
		],
	},
};

/** A settled answer with no hits: the empty state, which is the box's own. */
export const Empty: Story = {
	args: { query: "quarterly projections", state: "ready", hits: [] },
};

/**
 * The cold index, which is the first answer a reader of a long conversation
 * meets: nothing to show yet, and the state says which wait this is.
 */
export const Building: Story = {
	args: { query: "ledger", state: "building", hits: [] },
};

/** The partial arm: hits from the previous scan, and the sentence that says so. */
export const BuildingPartial: Story = {
	args: {
		query: "ledger",
		state: "building",
		partial: true,
		cursor: 0,
		hits: [
			hit({
				id: "m1",
				role: "user",
				snippet:
					"Can you check whether the billing ledger export still rounds?",
				ranges: rangesOf(
					"Can you check whether the billing ledger export still rounds?",
					"ledger",
				),
			}),
		],
	},
};

/** A peer conversation: the bytes are elsewhere, and no amount of asking moves them. */
export const Unsupported: Story = {
	args: { query: "ledger", state: "unsupported" },
};

/** A failed read, with the reader's own retry beside it. */
export const ErrorState: Story = {
	name: "Error",
	args: { query: "ledger", state: "error" },
};
