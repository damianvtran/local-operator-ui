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
	storedPath:
		"/Users/you/.local-operator/attachments/0123456789abcdef0123456789abcdef.bin",
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
 * The origin path is gone but the row names the retained copy. The original path
 * stays as the record of where the file was (dimmed, no control); the saved copy
 * has its own labelled row with its own copy control, and the digest is tooltip
 * detail on that label (design round 2, D2).
 */
export const MovedOrDeleted: Story = {
	render: () => <SentFileCard document={DOCUMENT} existence={false} />,
};

/**
 * An OLDER row (or a remote one) that carries no store path: nothing here can
 * name or copy a saved copy, so the card makes no such promise - only the verdict
 * and the truthful line that the file is no longer at this path, with no copy
 * control at all (design round 2, D2).
 */
export const MovedOrDeletedNoStoredPath: Story = {
	render: () => (
		<SentFileCard
			document={{ ...DOCUMENT, storedPath: null }}
			existence={false}
		/>
	),
	play: async ({ canvasElement }) => {
		if (canvasElement.querySelector("button"))
			throw new Error("the no-store-path state rendered a copy control");
		if (canvasElement.textContent?.includes("Saved copy"))
			throw new Error("the no-store-path state promised a saved copy");
		if (
			!canvasElement.textContent?.includes(
				"The file is no longer at this path.",
			)
		)
			throw new Error("the no-store-path state lost its truthful line");
	},
};

/**
 * The missing state's copy proof: the control must copy the STORE path, not the
 * origin path that no longer exists, and its feedback must say so. Kept out of
 * the captured set for the same reason as the long-path proof.
 */
export const MovedOrDeletedCopyProof: Story = {
	render: () => <SentFileCard document={DOCUMENT} existence={false} />,
	play: async ({ canvasElement }) => {
		const controlCount = canvasElement.querySelectorAll("button").length;
		if (controlCount !== 1)
			throw new Error(
				`the missing state should own exactly one control (the saved copy), found ${controlCount}`,
			);
		const button = canvasElement.querySelector<HTMLButtonElement>(
			'button[aria-label="Copy saved copy path"]',
		);
		if (!button)
			throw new Error("the saved-copy copy control is not in this story");
		if (!canvasElement.textContent?.includes("Saved copy"))
			throw new Error("the saved-copy row is not labelled");
		let copied = null;
		const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					copied = value;
				},
			},
		});
		try {
			button.click();
			await new Promise((resolve) => setTimeout(resolve, 50));
		} finally {
			if (original) Object.defineProperty(navigator, "clipboard", original);
			else Reflect.deleteProperty(navigator, "clipboard");
		}
		if (copied !== DOCUMENT.storedPath)
			throw new Error(
				`the missing state copied ${JSON.stringify(copied)}, not the stored path`,
			);
		if (copied === DOCUMENT.path)
			throw new Error("the missing state still copies the dead origin path");
		if (!canvasElement.textContent?.includes("Saved copy path copied"))
			throw new Error("the saved-copy confirmation is not announced");
	},
};

/**
 * The placement is not known yet: "not remote" is not "local", so the card makes
 * no existence claim even though a probe would answer here (agent review round 1,
 * n3). This is the story for a peer conversation whose catalogue row has not
 * arrived.
 */
/*
 * No `existence` answer is passed: with placement unknown the card must not
 * probe, and exactly that absence is what the frame has to show.
 */
export const PlacementUnknownNoClaim: Story = {
	render: () => <SentFileCard document={DOCUMENT} placementKnown={false} />,
};

/**
 * A LONG path: the visible line is middle-truncated and the unfiltered record
 * value is what the copy control copies (the proof is the story below, which is
 * not in the captured set because its feedback icon would land in this frame).
 */
const LONG_PATH =
	"/Users/you/Documents/Contracts/2026/Q4/Enterprise Agreements/Complete_With_Docusign_and_Exhibits_Final_Signed_Copy.pdf";

export const SentFileLongPath: Story = {
	render: () => (
		<SentFileCard
			document={{ ...DOCUMENT, path: LONG_PATH }}
			existence={true}
		/>
	),
};

/**
 * The copy proof for the long path: the play stubs the clipboard write and
 * asserts the control handed it the FULL record value. Kept out of the evidence
 * STORIES set so its temporary check-icon feedback cannot land in a frame; the
 * frame beside it is `SentFileLongPath`, which shows the quiet copy affordance.
 */
export const SentFileLongPathCopyProof: Story = {
	render: () => (
		<SentFileCard
			document={{ ...DOCUMENT, path: LONG_PATH }}
			existence={true}
		/>
	),
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector<HTMLButtonElement>(
			'button[aria-label="Copy path"]',
		);
		if (!button) throw new Error("the copy control is not in this story");
		const visible = button.parentElement?.querySelector("span");
		if (!visible) throw new Error("the path span is not in this story");
		if (!visible.textContent?.includes("…"))
			throw new Error(
				`the displayed path is not truncated: ${visible.textContent}`,
			);
		if (visible.textContent.length >= LONG_PATH.length)
			throw new Error("the displayed path is not shorter than the record's");
		let copied = null;
		const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					copied = value;
				},
			},
		});
		try {
			button.click();
			await new Promise((resolve) => setTimeout(resolve, 50));
		} finally {
			if (original) Object.defineProperty(navigator, "clipboard", original);
			else Reflect.deleteProperty(navigator, "clipboard");
		}
		if (copied !== LONG_PATH)
			throw new Error(
				`the copy control did not copy the full path: ${JSON.stringify(copied)}`,
			);
		/*
		 * Let the control's two-second "copied" feedback lapse before the shutter:
		 * the frame's subject is the quiet copy affordance beside a truncated path,
		 * not the transient check that follows a press this play made.
		 */
		await new Promise((resolve) => setTimeout(resolve, 2100));
	},
};

/**
 * A remote conversation: the file never lived on this machine, so the card makes
 * NO existence claim - not "present", not "moved" (contract §5).
 */
export const RemoteNoClaim: Story = {
	render: () => <SentFileCard document={DOCUMENT} remote={true} />,
};

/**
 * The third state: the original is gone AND the saved copy is gone too - a
 * pruned store. The card says both, offers no saved-copy row, and its menu keeps
 * only "Copy file path" (the record of where the file was).
 */
export const MissingAndCopyGone: Story = {
	render: () => (
		<SentFileCard
			document={DOCUMENT}
			existence={false}
			storedExistence={false}
		/>
	),
};
