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
 *    answered, where the app says so instead of claiming an outcome.
 *
 * WHAT THESE FRAMES DO NOT CLAIM: that anything about the STORED message
 * changed. It did not — the citation is still what the model receives and what
 * the transcript holds, and the chip is a presentation of it
 * (`credential-citation.tsx` states that constraint in full).
 *
 * The rig is `user-card-measure.stories.tsx`'s: the real `CanonicalTranscript`
 * at a pinned 1024x620 pane, so these frames read beside that file's and the
 * citation can be compared with the card widths it measures.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
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
 * THE THREE SENTENCES ARE THE APP'S OWN, character for character, so the frames
 * photograph what the renderer is actually handed rather than a paraphrase of
 * it. The stored form is `credentialCitation`'s output for a 73-character value
 * named `LOP_SECRET_4CE3Y48G`; the not-stored form is `describeUnstored("lost")`.
 * The value itself is nowhere, which is the point of the whole feature: the
 * transcript never held it.
 */
const SENT_KEY = "LOP_SECRET_4CE3Y48G";
const STORED_CITATION = `[credential ${SENT_KEY} (73 chars) — available to bash and eval as $${SENT_KEY}; its value cannot be read]`;
const NOT_STORED_CITATION =
	"[credential NOT stored — its value did not survive; ask the operator to paste it again]";
/*
 * The third sentence, built from the SAME constant the two above use, so the
 * frames cannot photograph a key the app would not have written. It is
 * `describeUnstored("unconfirmed", …)`'s output, and it exists because the
 * operator's own session was handed the sentence above while its store held the
 * key (report, 2026-09-19).
 */
const UNCONFIRMED_CITATION = `[credential unconfirmed — it may be held as $${SENT_KEY}, so check list_variables before assuming it is missing]`;

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
 * The transcript pane in a fixed 1024x620 frame, as `user-card-measure` pins it:
 * a wider or narrower preview pane would photograph a different line-breaking
 * case than the one written down here, and the citation's own requirement is
 * exactly about where a line breaks.
 */
const Frame = ({ records }: { records: TranscriptRecord[] }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="flex flex-col bg-canvas"
			style={{ width: 1024, height: 620 }}
		>
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

/** The citation quoted inside a fenced block, left exactly as the text. */
export const CitationInCodeFence: Story = {
	render: () => <Frame records={[SENT_IN_FENCE]} />,
};
