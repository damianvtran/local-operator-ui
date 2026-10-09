import { DEFAULT_RIGHT_SLOT_WIDTH } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import {
	FIXTURE_NOW_MS,
	couldNotRefreshList,
	emptyList,
	linkOnlyList,
	list,
	populatedRows,
	rateLimitedList,
	staleList,
} from "./code-review-fixtures";
import { CodeReviewPaneBody } from "./components/code-review-pane";

/**
 * The code review pane, in every state a review has to judge.
 * Design: `DESIGN-UI.md` §1 (row anatomy), §2 (the round strip), §3 (states and
 * freshness), §4 (groups), §5 (markers), §6 (the four states and the mixed
 * partial failure), §9 (the rail and the slot), §12 (the contrast rows these
 * frames accompany).
 *
 * WHY THESE STORIES RENDER THE BODY. The pane's container reads the ledger
 * query; the body takes the phase and the list as PROPS, and that is the seam
 * a story needs: the same chrome, the same rows, the same derivations, with the
 * data pinned. The alternative - stubbing the desktop bridge - would prove less
 * (it would exercise the query's plumbing, which the pane's own tests already
 * drive) and would make every frame depend on transport behaviour a screenshot
 * cannot see.
 *
 * THE FRAMES ARE THE PANE, at the slot's own default width: an evidence frame of
 * a pane is the pane, the console's rule, because the row's truncation behaviour
 * is a function of this width and a 1280-wide frame would photograph a layout
 * nobody gets. Heights are per state and tight to content where the state is
 * mostly ground (§12's own note on the `check-evidence` ceiling).
 *
 * The clock is pinned (`FIXTURE_NOW_MS`): `updated 12 min ago` is a reading that
 * would otherwise differ on every capture, and a frame whose text depends on the
 * capture's own instant cannot be compared with the next one.
 */
const meta: Meta = {
	/*
	 * THE SINGLE TITLE, not `Code review/Code review pane`: the id becomes both the
	 * story's handle and the frame SET's name (`docs/evidence/<set>/<state>/`), and
	 * a grouped title would spell it `code-review-code-review-pane` - the console's
	 * set is `console-pane`, and one component is one set.
	 */
	title: "Code review pane",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

const Frame: FC<{ height: number; children: ReactNode }> = ({
	height,
	children,
}) => (
	<div
		className="h-full bg-surface"
		style={{ width: DEFAULT_RIGHT_SLOT_WIDTH, height }}
	>
		{children}
	</div>
);

/** The populated ledger: mixed lanes and states (§6's "every rung once"). */
export const Populated: Story = {
	render: () => (
		<Frame height={960}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows())}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Empty: nothing opened, nothing mentioned - the pane's own sentence. */
export const Empty: Story = {
	render: () => (
		<Frame height={300}>
			<CodeReviewPaneBody
				phase="ready"
				data={emptyList()}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Loading: the cold read - three skeleton rows and one sentence. */
export const Loading: Story = {
	render: () => (
		<Frame height={300}>
			<CodeReviewPaneBody
				phase="loading"
				data={undefined}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Error: the read itself failed - one notice, one Retry, no row failure. */
export const ErrorState: Story = {
	render: () => (
		<Frame height={300}>
			<CodeReviewPaneBody
				phase="error"
				data={undefined}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Link-only: two lines and a caption, no pill and no strip. */
export const LinkOnly: Story = {
	render: () => (
		<Frame height={340}>
			<CodeReviewPaneBody
				phase="ready"
				data={linkOnlyList()}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Rate-limited: the pane-level cooling line, once, under the bar. */
export const RateLimited: Story = {
	render: () => (
		<Frame height={340}>
			<CodeReviewPaneBody
				phase="ready"
				data={rateLimitedList()}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Stale: the reviewed head is behind the row's own - both SHAs named. */
export const Stale: Story = {
	render: () => (
		<Frame height={340}>
			<CodeReviewPaneBody
				phase="ready"
				data={staleList()}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Mixed partial failure: rows stay, each carrying its own caption. */
export const CouldNotRefresh: Story = {
	render: () => (
		<Frame height={520}>
			<CodeReviewPaneBody
				phase="ready"
				data={couldNotRefreshList()}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/** Refreshing: the bar's control disabled while the POST is in flight. */
export const Refreshing: Story = {
	render: () => (
		<Frame height={340}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows().slice(0, 2))}
				refreshing={true}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};
