/**
 * The citation a SENT message carries, as the chip the composer showed before
 * the send.
 *
 * THE OPERATOR'S REPORT, 2026-09-17. A message sent with a pasted secret read, in
 * the transcript, as a wall of technical text:
 *
 *   Here's a new QA key to use, can you update the QA secrets with it
 *   [credential LOP_SECRET_4CE3Y48G (73 chars) — available to bash and eval as
 *   $LOP_SECRET_4CE3Y48G; its value cannot be read]
 *
 * Two seconds earlier the same reference had been a chip in the composer, and
 * the transcript is where the reader meets it again — so the three stories here
 * are the three shapes that claim has to hold for:
 *
 *  - `CitationMidSentence`, the reported frame: one citation inside a sentence,
 *    which must stay INSIDE its paragraph rather than breaking the line;
 *  - `CitationNotStored`, the same shape in the warning register, for a value
 *    that did not survive to the store (`describeUnstored`);
 *  - `CitationInCodeFence`, the state that must NOT be chipped: the citation's
 *    own text inside a fenced block is source the operator is quoting, not a
 *    reference this app wrote, and the plugin is required to leave it alone. It
 *    is here because "it stays prose" is a claim about pixels too.
 *
 *  - `CitationUnconfirmed`, the third register: a store the session never
 *    answered, where the app says so instead of claiming an outcome, and its
 *    NARROW rung (`CitationUnconfirmedNarrow`), where a long label has to clamp
 *    rather than run out of its own bubble.
 *
 * WHAT THESE FRAMES DO NOT CLAIM: that anything about the STORED message
 * changed. It did not — the citation is still what the model receives and what
 * the transcript holds, and the chip is a presentation of it
 * (`credential-citation.tsx` states that constraint in full).
 *
 * The rig is `user-card-measure.stories.tsx`'s: the real `CanonicalTranscript`
 * at a pinned 1024x620 pane, so these frames read beside that file's and the
 * citation can be compared with the card widths it measures. The narrow story
 * pins 440x620 instead, with the app's own small-view treatment.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import {
	type CredentialPayload,
	credentialCitation,
	describeUnstored,
} from "../components/credential-capture";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

const record = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

/** A transcript state holding one row, as `chat-content.tsx` hands one over. */
const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/*
 * THE THREE SENTENCES ARE THE APP'S OWN OUTPUT, CALLED rather than copied (code
 * review round 1, NIT-1). They used to be hand-typed copies of what
 * `credentialCitation` and `describeUnstored` write, which left the frames
 * photographing words this app no longer writes the moment a copy changed, with
 * nothing failing: the functions are exported and the frames are a Storybook
 * fixture, so calling them costs nothing and makes the frame and the copy one
 * authority.
 *
 * The stored form is built from a PAYLOAD rather than a literal key, so the key
 * and the length the frames show are ones the composer could have minted. The
 * value itself is nowhere, which is the point of the whole feature: the
 * transcript never held it.
 */
const SENT_KEY = "LOP_SECRET_4CE3Y48G";
const SENT_PAYLOAD: CredentialPayload = {
	index: 1,
	key: SENT_KEY,
	value: "v".repeat(73),
	marker: "[Credential #1, 73 chars]",
};
const STORED_CITATION = credentialCitation(SENT_PAYLOAD);
const NOT_STORED_CITATION = describeUnstored("lost");
/*
 * The third sentence, and the one the operator's own session never got: the store
 * held the key while the model was handed the sentence above (report,
 * 2026-09-19). Its chip names the key too, which is design round 1's D1.
 */
const UNCONFIRMED_CITATION = describeUnstored("unconfirmed", SENT_KEY);

const SENT_MID_SENTENCE = record(
	"u1",
	`Here's a new QA key to use, can you update the QA secrets with it ${STORED_CITATION}`,
);

const SENT_NOT_STORED = record(
	"u1",
	`Use this one for the deploy: ${NOT_STORED_CITATION} — I pasted it but the app said it did not survive.`,
);

/*
 * The unresolved register, and the reason it is a frame rather than a unit test
 * alone: its chip is the WARNING chip with different words, so what a reader has
 * to be able to see is that the two states are told apart by their words (and by
 * the full sentence in the title) rather than by a hue a monochrome reading
 * cannot carry.
 */
const SENT_UNCONFIRMED = record(
	"u1",
	`Try this key for the deploy: ${UNCONFIRMED_CITATION} — the app never told me whether it landed.`,
);

/*
 * The citation's own text INSIDE a fence. A user quoting a citation back at the
 * agent is a supported thing to do (it is how somebody asks "why did you get
 * this instead of the key?"), and the chip must not appear there: the text is
 * inside a code block, where markdown's own rule is that nothing is interpreted.
 */
const SENT_IN_FENCE = record(
	"u1",
	[
		"Here is what you said you received:",
		"",
		"```text",
		STORED_CITATION,
		"```",
		"",
		"Where did the key name come from?",
	].join("\n"),
);

/**
 * The transcript pane in a fixed frame.
 *
 * The default 1024x620 is `user-card-measure`'s, because a wider or narrower
 * preview pane photographs a different line-breaking case than the one written
 * down there — and the citation's own requirement is exactly about where a line
 * breaks. `width`/`small` exist for the NARROW rung (design round 2, D1): the
 * unresolved chip's label is long enough to pass a narrow line box, so the pane
 * that proves what happens there has to be framable.
 *
 * `small` IS THE APP'S OWN RULE, not a story choice: the pane switches the card to
 * `max-w-[92%] px-3` under 550px (`chat-content.tsx`'s ResizeObserver), so a frame
 * that pinned the wide treatment at 440 would photograph a state this app never
 * paints.
 */
const Frame = ({
	records,
	width = 1024,
	small = width < 550,
}: {
	records: TranscriptRecord[];
	width?: number;
	small?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width, height: 620 }}>
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
					isSmallView={small}
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
	title: "Chat/Canonical credential citation",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The reported frame: a stored credential cited mid-sentence. */
export const CitationMidSentence: Story = {
	render: () => <Frame records={[SENT_MID_SENTENCE]} />,
};

/** The warning register: a citation whose value did not survive. */
export const CitationNotStored: Story = {
	render: () => <Frame records={[SENT_NOT_STORED]} />,
};

/**
 * The unresolved register: the store never said whether the write landed.
 *
 * The operator's own case was this state reported as the one above — the value
 * was in the session's store while the model was told it was not — so the pair of
 * frames beside each other is the claim this change makes: one dash and one glyph
 * apart in the chip, with the words doing the separating.
 */
export const CitationUnconfirmed: Story = {
	render: () => <Frame records={[SENT_UNCONFIRMED]} />,
};

/**
 * THE SAME CITATION AT THE 440 RUNG, and it exists because its absence is what let
 * a defect through (design round 2, D1).
 *
 * The citation set was 1024-only, so the cost of a key-bearing label was never
 * photographed: measured live at 440, the round-1 label made the chip refuse to
 * narrow at all (405.78px through a 248px line box, `+157.78` past the bubble, cut
 * mid-key with no ellipsis and the card's content horizontally scrollable). The
 * frame beside this one is what a reviewer reads to see that the label now CLAMPS
 * and that the reference — not the words — is what survives the ellipsis.
 *
 * 440 is the rung the notice frames use; the card's small-view treatment comes from
 * the pane width, as the app's own rule does.
 */
export const CitationUnconfirmedNarrow: Story = {
	render: () => <Frame records={[SENT_UNCONFIRMED]} width={440} />,
};

/** The citation quoted inside a fenced block, left exactly as the text. */
export const CitationInCodeFence: Story = {
	render: () => <Frame records={[SENT_IN_FENCE]} />,
};
