/**
 * The transcript region while a conversation hydrates (design D22, re-homed by
 * R1/design D1 and D2).
 *
 * `isHydrating` correctly stops the app asserting "What I can help you with
 * today?" over a conversation that may turn out to have messages - but nothing
 * replaced it, so the pane was simply blank. Local hydration is too fast to see
 * that; a slow or remote backend makes it the first impression.
 *
 * These two stories are the region in its two states, so the placeholder can be
 * judged against the rows it stands in for. What changed from the first version
 * of this file, and why the region is drawn rather than the greeting slot:
 *
 * - The placeholder used to render inside the COMPOSER band, in the greeting's
 *   own slot - a slot that only exists in the empty-chat layout, which centres
 *   the composer. Photographed on the switch this replaced, the composer's top
 *   edge moved 468px -> 736px the moment the transcript landed. It now renders
 *   in the transcript region, at the same inset and bottom anchor the rows
 *   arrive at, and the composer keeps its settled geometry underneath it.
 * - The bar is `bg-elevated`, not the `Skeleton` default `sunken`: on `canvas`
 *   the default is the system's weakest adjacent pair (deltaE00 1.89 in the
 *   dark brand palette), and a placeholder whose job is to be seen cannot stand
 *   on it. The caption is visible for the same reason - the only words used to
 *   be `sr-only`.
 *
 * The stories mount the SHIPPED component rather than a copy of its markup: a
 * stand-in is how the first version drifted from the app it was documenting.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { TranscriptPlaceholder } from "../canonical/transcript-placeholder";
import { CHAT_MEASURE } from "../chat-measure";

/** The chat column's ground and the transcript region's own box. */
const Region = ({ children }: { children: React.ReactNode }) => (
	<div className="flex h-[560px] w-full flex-col bg-canvas">
		<div className="min-h-0 grow overflow-auto p-4">
			<div className={`flex flex-col ${CHAT_MEASURE}`}>{children}</div>
		</div>
		{/* The composer band at its settled height, so the placeholder is judged
		    against the box that is actually below it. */}
		<div className="shrink-0 px-4 pb-4 pt-2">
			<div
				className={`h-[148px] rounded-md border border-control bg-surface ${CHAT_MEASURE}`}
			/>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Hydration placeholder",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * Settled, with rows: what the region looks like once the stream has spoken.
 *
 * Named `Settled` and not `SettledEmpty`, which is what it was called when the
 * empty-chat layout was what this region held. The content moved to the rows a
 * transcript actually arrives as in the D1/D2 pass, and the export kept the old
 * name - so a story whose job is to be the comparison for the placeholder was
 * labelled with a state it does not show (reviewer round 2, N3). The settled
 * EMPTY state is the greeting layout in the composer band, which is not this
 * region and is not what the placeholder stands in for.
 */
export const Settled: Story = {
	render: () => (
		<Region>
			<p className="text-body text-ink">
				Turn 0: check the workspace and report what changed since yesterday.
			</p>
			<p className="mt-4 text-body text-ink-muted">
				Reading the workspace now. Three files are newer than the last run; I am
				checking each one before saying anything about them.
			</p>
		</Region>
	),
};

/** Hydrating: the same region, holding the shipped placeholder. */
export const Hydrating: Story = {
	render: () => (
		<Region>
			<TranscriptPlaceholder />
		</Region>
	),
};

/**
 * The wait, with the reason the read is slow — the operator's second complaint.
 *
 * ALL FOUR CODES ON ONE FRAME rather than four stories, because the mapping is
 * the claim and a reader can check it in one look: no pid holds the session's
 * lease, one holds it and did not deliver canonical state (the operator's quiet
 * owner), the record is finishing a turn first, and a retained dial whose state
 * has not landed. The tokens are the wire's (`DesktopColdReason`); every sentence
 * below is authored on the surface, which is the division the contract states.
 *
 * The DEFAULT case is `Hydrating` above and is deliberately not repeated here:
 * with nothing known the words are the ones this region already shipped, and the
 * point of this pair of stories is that the unknown case did not move.
 *
 * NOT THE `Region` WRAPPER, and that is measured rather than preferred. `Region`
 * is the transcript region at its real height with the composer band under it,
 * which is what makes `Hydrating` a picture of the box a click lands in; four
 * stacked placeholders do not fit inside that box, so a `Region` here would clip
 * the fourth sentence out of the frame — a legend with one of its four entries
 * missing. This frame is about the WORDS, so it is drawn at the height its own
 * content needs, on the same ground the region uses. The component is the
 * shipped one either way: the bars, the pulse and the ink are the region's.
 */
export const Reasons: Story = {
	render: () => (
		<div className="flex w-full flex-col bg-canvas p-4">
			<div className={`flex flex-col gap-8 ${CHAT_MEASURE}`}>
				<TranscriptPlaceholder coldReason="no-runtime" />
				<TranscriptPlaceholder coldReason="owner-silent" />
				<TranscriptPlaceholder coldReason="owner-leaving" />
				<TranscriptPlaceholder attaching />
			</div>
		</div>
	),
};
