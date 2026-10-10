import { DEFAULT_RIGHT_SLOT_WIDTH } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
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
	viaRows,
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

const Frame: FC<{ height: number; width?: number; children: ReactNode }> = ({
	height,
	width = DEFAULT_RIGHT_SLOT_WIDTH,
	children,
}) => (
	<div className="h-full bg-surface" style={{ width, height }}>
		{children}
	</div>
);

/**
 * THE SCAN GATE (UX round 1, U2): the backend says the transcript scan for
 * this journal has not settled (`scan_state: "refreshing"`) and the answer is
 * empty - the pane keeps its LOADING state rather than claiming the session
 * has no code requests. The empty copy only appears on a `ready` answer.
 */
export const Scanning: Story = {
	render: () => (
		<Frame height={300}>
			<CodeReviewPaneBody
				phase="loading"
				data={list([], { scan_state: "refreshing" })}
				refreshing={false}
				scanning={true}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/**
 * The narrow floor (320px, the slot's minimum): design D3 / UX U8's re-shoot.
 * The merged rows and the worst-case `via subagent coder › reviewer` tag - the
 * two shapes that rendered as `damianvtran/local-operator #2…` and `d.` before
 * the identity split - so the frame proves the `#N` survives truncation.
 */
export const Narrow: Story = {
	render: () => (
		<Frame height={460} width={320}>
			<CodeReviewPaneBody
				phase="ready"
				data={list([...viaRows(), ...populatedRows().slice(0, 2)])}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/**
 * The quiet failure cue over painted rows (UX round 1, U3's third arm): a
 * refresh that failed after the POST left the rows up and says so in the
 * notice slot, exactly as QA's bad-token cell found it.
 */
export const RefreshFailed: Story = {
	render: () => (
		<Frame height={420}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows())}
				refreshing={false}
				checked={false}
				refreshFailed={
					"Couldn't refresh: credential rejected — sign in again with gh/glab, then refresh."
				}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

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

/**
 * The refresh-failed caption at the 320px floor (design round 2, N1): the
 * sentence wraps to more lines than the desktop frame shows, and this is the
 * frame that says what the wrap is.
 */
export const NarrowRefreshFailed: Story = {
	render: () => (
		<Frame height={420} width={320}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows().slice(0, 2))}
				refreshing={false}
				refreshFailed={
					"Couldn't refresh: credential rejected — sign in again with gh/glab, then refresh."
				}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
		</Frame>
	),
};

/**
 * The row's hover paint, FORCED (design round 2, N3): the headless capture
 * cannot synthesise a hover, so the story applies the SAME classes the hover
 * state applies (`bg-surface`, the arrow's `opacity-100` reveal) to the first
 * row after mount. The frame is the hover's paint, and this comment is the
 * disclosure that no pointer was involved.
 */
const ForceRowHover: FC<{ rowKey: string }> = ({ rowKey }) => {
	useEffect(() => {
		const button = document.querySelector<HTMLElement>(
			`[data-code-request-row="${rowKey}"] button`,
		);
		button?.classList.add("bg-surface");
		button?.querySelector("[data-row-arrow]")?.classList.remove("opacity-0");
	}, [rowKey]);
	return null;
};

export const RowHover: Story = {
	render: () => (
		<Frame height={260}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows().slice(0, 2))}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
			<ForceRowHover rowKey="gh:1904" />
		</Frame>
	),
};

/**
 * The row's keyboard focus ring (design round 2, N3): `focusVisible: true` is
 * what makes `:focus-visible` match for a script-focused control (Chromium's
 * heuristic treats an unheralded `.focus()` as pointer focus), the same
 * spelling `panel-rail.stories.tsx` uses for its roving stop.
 */
const FocusRow: FC<{ rowKey: string }> = ({ rowKey }) => {
	useEffect(() => {
		document
			.querySelector<HTMLElement>(`[data-code-request-row="${rowKey}"] button`)
			?.focus({ focusVisible: true } as FocusOptions);
	}, [rowKey]);
	return null;
};

export const RowFocus: Story = {
	render: () => (
		<Frame height={260}>
			<CodeReviewPaneBody
				phase="ready"
				data={list(populatedRows().slice(0, 2))}
				refreshing={false}
				onRefresh={() => undefined}
				onClose={() => undefined}
				nowMs={FIXTURE_NOW_MS}
			/>
			<FocusRow rowKey="gh:1904" />
		</Frame>
	),
};
