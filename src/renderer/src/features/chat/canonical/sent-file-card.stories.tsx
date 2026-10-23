/**
 * The SENT file card: three states that differ by what this machine can claim.
 *
 * WHY A STORY OF ITS OWN. The card's shape is the contract §5 claim a reviewer
 * has to accept on pixels: a flat row (no remove control), the type line, the
 * origin path, and - when the path is gone - the missing verdict with the
 * retained copy named. The two existence states cannot both be photographed from
 * the live app in one run, and a storybook frame has no preload bridge to probe
 * with, so the card takes `existence` as the story's answer and the live path
 * probes (`sent-file-card.tsx` states the seam).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { SentFileCard } from "./sent-file-card";
import type { TranscriptDocument } from "./transcript-reducer";

const DIGEST = "0123456789abcdef0123456789abcdef";

const DOCUMENT: TranscriptDocument = {
	id: "story:doc:0",
	attachment: DIGEST,
	filename: "Complete_With_Docusign.pdf",
	mimeType: "application/pdf",
	path: "/Users/you/Documents/Complete_With_Docusign.pdf",
	bytes: 2_411_520,
	injection: "native",
};

const meta: Meta<typeof SentFileCard> = {
	title: "Chat/Sent file card",
	component: SentFileCard,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof SentFileCard>;

/** The ordinary sent state: path present, nothing to warn about. */
export const SentFile: Story = {
	render: () => <SentFileCard document={DOCUMENT} existence={true} />,
};

/**
 * The origin path is gone on this machine. The row still says which file it was
 * and names the retained copy, so it is never a dead chip (contract §5).
 */
export const MovedOrDeleted: Story = {
	render: () => <SentFileCard document={DOCUMENT} existence={false} />,
};

/**
 * A remote conversation: the file never lived on this machine, so the card makes
 * NO existence claim - not "present", not "moved" (contract §5).
 */
export const RemoteNoClaim: Story = {
	render: () => <SentFileCard document={DOCUMENT} remote={true} />,
};
