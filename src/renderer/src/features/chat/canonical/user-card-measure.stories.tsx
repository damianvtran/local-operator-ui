/**
 * The user card at the widest the column gets, on the two shapes that widen it.
 *
 * WHY THIS STORY EXISTS (operator report, 2026-09-16): "I noticed on some wider
 * attachments that the text in the user message component doesn't expand all
 * the way across ... the text should expand with the width of the user message
 * card if the card width is expanded instead of ending up center constrained."
 * The attachment was not the cause. The card is a flex item of the right-aligned
 * row, so its width is shrink-to-fit: a reply quote or an image can make it
 * wider than the prose, and the prose was a 62ch column centred inside it by
 * `margin-inline: auto`. Both rules lived in `markdown.css`; the measure comment
 * there now carries the report, the numbers, and why neither is coming back.
 *
 * WHY 1024, and what a frame at this width can prove. The column measure caps
 * at 900px and the transcript scroller insets it by its own `p-4`, so the row
 * content box is 868px and the card's `max-w-[75%]` resolves to 651px - the
 * widest a user card ever gets. Below a 750px column the cap never binds and
 * this defect has nothing to show, which is why the frames are taken where the
 * measure does bind rather than at whatever width the preview happens to have.
 *
 * WHAT TO LOOK FOR in both frames: the prose's left edge and the card's inner
 * left edge are the SAME line, and they hold at every paragraph and at the
 * attachment. The failure these stories exist to catch is the prose block
 * sitting inboard of that edge with equal slack on both sides - the centred
 * column - which is exactly what the reported frame showed.
 *
 * No `play` function: both are resting states, and the evidence rig takes them.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { CanonicalTranscript } from "./canonical-transcript";
import type {
	TranscriptImage,
	TranscriptRecord,
	TranscriptState,
} from "./transcript-reducer";

/*
 * A capture wide enough to widen the card on its own.
 *
 * SYNTHETIC, and deliberately: the claim under test is about the attachment's
 * WIDTH against the card's 619px content box, so what the fixture has to be is
 * precisely 900x200 with a normal aspect - a real screenshot would be a
 * megabyte of base64 in a story file for no extra evidence. It renders 619px
 * wide and 137.6px tall inside the card, under the 240px height ceiling the
 * ledger rule sets, so `object-contain` letterboxes nothing here.
 */
const WIDE_CAPTURE_BASE64 = "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";

const TS = 1_760_000_000_000;

const reply = (text: string) => `<reply-to>${text}</reply-to>`;

const record = (
	id: string,
	text: string,
	images: TranscriptImage[] = [],
): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images,
});

/** A transcript state holding one row, as `chat-content.tsx` hands one over. */
const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/**
 * The quoted turn, long enough to out-measure the prose on one truncated line.
 *
 * The chip is `flex-1 truncate`, so this is a single line however many
 * characters it holds, and its max-content is the whole quote: this is the
 * child that drove the reported card wider than the message inside it.
 */
const QUOTE = [
	"Because that row's `tenant_id` was null, and the new column is `not null`.",
	"The other four hundred rows were fine, so it is the one row rather than the file, and the import stopped on the first violation instead of reporting the rest.",
].join(" ");

/** The reported shape: a quoted send with several paragraphs under it. */
const REPORTED: TranscriptRecord[] = [
	record(
		"u1",
		`${reply(QUOTE)}\n${[
			"Right - so what should the import do with a row like that?",
			"",
			"Two things to flag before you answer: the failure is on the second row of the file rather than at the end, and the run left the table half written.",
			"",
			"If the answer is `skip`, say so plainly, because I will have to check the numbers by hand afterwards.",
		].join("\n")}`,
	),
];

/** The other route to a wide card: an attachment wider than the prose. */
const ATTACHED: TranscriptRecord[] = [
	record(
		"u1",
		[
			"Here is the dashboard capture after the change.",
			"",
			"Does the spacing between the two panels look right to you, or is the left column still crowded against the header?",
		].join("\n"),
		[
			{
				id: "u1:0",
				data: WIDE_CAPTURE_BASE64,
				attachment: null,
				mimeType: "image/png",
			},
		],
	),
];

/**
 * The transcript pane in a fixed 1024x`height` frame.
 *
 * Pinned in PIXELS rather than left to the preview's own viewport: the claim is
 * about what the column measure does when it is at its 900px cap, and a story
 * rendered in a wider or narrower preview pane would be photographing a
 * different case than the one written down here.
 */
const Frame = ({
	records,
	height = 620,
}: {
	records: TranscriptRecord[];
	height?: number;
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
	title: "Chat/Canonical user card measure",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The reported frame: a quoted send whose card is widened by the quote. */
export const ReportedShape: Story = {
	render: () => <Frame records={REPORTED} />,
};

/** The same card widened by an attachment instead of a quote. */
export const WideAttachment: Story = {
	render: () => <Frame records={ATTACHED} />,
};
