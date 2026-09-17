/**
 * The user card at the widest the column gets, on the three shapes that set its
 * width.
 *
 * WHY THIS SET EXISTS (operator report, 2026-09-16): "I noticed on some wider
 * attachments that the text in the user message component doesn't expand all
 * the way across ... the text should expand with the width of the user message
 * card if the card width is expanded instead of ending up center constrained."
 * The attachment was not the cause. The card is a flex item of the right-aligned
 * row, so its width is shrink-to-fit: a reply quote or an image can make it
 * wider than the prose, and the prose was a 62ch column centred inside it by
 * `margin-inline: auto`. Both rules lived in `markdown.css`; the measure comment
 * there now carries the report, the numbers, and why neither is coming back.
 *
 * WHY 1024x620, AND WHAT THAT NUMBER IS. 1024x620 is the PANE, not the window:
 * these frames are the pane's own box, and every number below is read from the
 * live DOM at that pane in localOperatorDark on
 * `chat-canonical-user-card-measure--reported-shape`. At that pane the measure
 * is 900px (62..962) - `CHAT_MEASURE` caps the CONTENT div and the scroller's
 * `p-4` sits outside it, so the 900 is the row content box itself rather than
 * 900 minus that padding. `max-w-[75%]` then puts the card at 675px, with a
 * 641px content box inside its `px-4` and its 1px border, and the agent's
 * answer resolves against 860px of the same measure because it loses the 40px
 * avatar gutter. 675 against 860 is the aside the hierarchy asks for, and both
 * halves come from the box rather than from a cap on prose.
 *
 * THE BEFORE HALF, from the same read: with the retired cap in place the prose
 * was 351.1..897.9, i.e. 546.738px = 62ch, with `margin-inline` 47.125 and
 * 47.1406 - 47.1px of slack on EACH side of the card's 641px content box (a
 * border-inclusive rig read of the same pair gives 48.1). After it, the prose is
 * 304..945: the whole 641px content box, `max-width: none`, margins 0, slack 0.
 * That pair is the claim, and the frames are its pixels.
 *
 * THE THRESHOLD, stated correctly because the first draft got it wrong: the
 * 62ch cap bound whenever the card's content box exceeded 546.738px, which is a
 * column above roughly 806px - NOT `CHAT_MEASURE`'s own 750px breakpoint, which
 * governs whether the column takes a percentage or the full width and is a
 * different quantity. 1024 is comfortably above the 806 at which the cap binds,
 * which is what makes these frames able to show the defect at all.
 *
 * LINE LENGTH, in the two different quantities the repo now keeps apart: the
 * user's own longest rendered line in the reported fixture is ~99-101 characters
 * on 627.6px, against the agent answer's 131 characters on 832.6px
 * (`chat-older-history-slot--in-transcript-idle`, 1024). The `ch` figure this
 * repository has carried (98.1) is `ch` units, not characters - see the measure
 * comment in `markdown.css`, which states both.
 *
 * WHAT TO LOOK FOR in all three frames: the prose's left edge and the card's
 * inner left edge are the SAME line, and they hold at every paragraph and at the
 * attachment. The failure these stories exist to catch is the prose block
 * sitting inboard of that edge with equal slack on both sides - the centred
 * column - which is exactly what the reported frame showed.
 *
 * THE THREE FIXTURES are the three routes to a wide card, one story each: a
 * reply quote (the reported shape), an attachment wider than the prose, and a
 * long text-only turn. The third is here because it is the MAJORITY shape and
 * the round that fixed this photographed only the first two - and because its
 * width is what the retirement MOVES. The card is `0.75 ×` the row content box
 * and CLIMBS with it, so the retired cap's onset - a row content box of 774px,
 * i.e. a column of about 806px - is where the widening BEGINS rather than where
 * it stops. Measured on the live DOM: box 774 → card 580.5 (the onset), 806 →
 * 604.5, 836 → 627, 900 → 675. The 675 is therefore the value at the CAPPED
 * measure, a column of 932px or more, which is the widest a user card ever
 * gets; the pre-fix card was pinned at 580.7 wherever the prose was longer than
 * the 62ch cap. It is a change a reviewer should accept or reject on pixels
 * rather than on the contract's word.
 *
 * No `play` function: all three are resting states, and the evidence rig takes
 * them.
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
 * WIDTH against the card's 641px content box, so what the fixture has to be is
 * a wide, normal-aspect capture - a real screenshot would be a megabyte of
 * base64 in a story file for no extra evidence. It is 900x200 and MEASURED in
 * the frame at 639x142 (so it sits just inside the content box rather than
 * filling it edge to edge), under the 240px height ceiling the ledger rule sets,
 * which is why `object-contain` letterboxes nothing here. The prose beside it is
 * deliberately SHORT: this story exists to show the image SETTING the card's
 * width, so a message long enough to reach the cap on its own would leave the
 * frame unable to fail for the route it names.
 */
const WIDE_CAPTURE_BASE64 =
	"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";

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
			"Dashboard capture after the change.",
			"",
			"Does the left column still look crowded to you?",
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
 * The majority shape, and the one the first round did not photograph.
 *
 * No quote and no attachment: nothing here is wider than a 62ch column, so this
 * card's width is decided by the prose alone - which is exactly the case whose
 * width the retirement CHANGES, from 580.7px to 675px at this 1024 pane (the
 * card climbs with the row content box; see the header's ladder). A reviewer's
 * question on this frame is not "does the fix hold?" but "is the wider card the
 * right card?", and it can only be answered from a picture.
 */
const LONG_TEXT: TranscriptRecord[] = [
	record(
		"u1",
		[
			"Morning - here is where the import stands before you pick it up.",
			"",
			"The March file loaded cleanly except for one row, which is failing on a `not null` column that the source system still writes as empty rather than absent. I left the table half written so you can see the row that stopped it, and I did not retry, because a retry would have appended the four hundred rows behind it a second time.",
			"",
			"If you would rather have a clean run than a readable failure, delete the table and re-run with `--skip-invalid` and I will follow the count. Otherwise the question I need answered is what the import should DO with a row like that one: skip it and report, or refuse the file.",
		].join("\n"),
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

/** A long turn with nothing but text: the card's width from the prose alone. */
export const LongTextOnly: Story = {
	render: () => <Frame records={LONG_TEXT} />,
};
