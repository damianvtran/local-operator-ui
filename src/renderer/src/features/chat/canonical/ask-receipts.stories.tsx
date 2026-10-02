/**
 * The queued-ask receipts, in a real transcript.
 *
 * These render the PRODUCTION `CanonicalTranscript` from real
 * `ask_response` / `ask_timeout` records — the two rows the backend appends when
 * a queued ask is answered or when its deadline passes (design
 * `docs/design/ask-nonblocking.md` §2.3/§2.5). A live one is the worst kind of
 * subject for a photograph: a timeout needs a deadline to pass, and a late answer
 * needs someone to answer after one, so the pair that matters most — the timeout
 * row FOLLOWED by the response row, which is what a late answer actually writes
 * — is the one a live session produces least often.
 *
 * What to look for, since these frames are the design review:
 *
 * - **Both rows are RECEIPTS, not cards.** They take the ledger's neutral
 *   register, which is what `peer` and `wake` take here and what the TUI's own
 *   response/timeout blocks take: an event row must not wear a tool's identity
 *   ink it did not earn, and a settled screen must not have one loud row in it.
 * - **The late pair reads as a pair.** `ask_timeout` then `ask_response`, same
 *   `ask_id`, one above the other — the durable record of "the agent moved on,
 *   and here is what I said anyway".
 * - **The response row EXPANDS into the Q&A**, because a receipt's whole job is
 *   that the question and its answer can be found again after the ask itself is
 *   gone from the live queue.
 * - **A secret answer shows the KEY, never a value.** The value only ever
 *   existed in the session's memory store.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

function transcriptWith(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const asked: TranscriptRecord = {
	kind: "user",
	id: "user:1",
	ts: TS,
	text: "Deploy the staging build when the tests pass.",
	images: [],
};

const timeoutRow: TranscriptRecord = {
	kind: "ask_timeout",
	id: "ask-timeout-a-91be",
	ts: TS + 15 * 60_000,
	askId: "a-91be",
	waitedS: 15 * 60,
	urgent: true,
};

const lateResponse: TranscriptRecord = {
	kind: "ask_response",
	id: "ask-response-a-91be",
	ts: TS + 22 * 60_000,
	askId: "a-91be",
	status: "late",
	questions: [
		{ id: "files", question: "Which files should the cleanup script touch?" },
	],
	answers: { files: ["logs and caches"] },
	secretLost: false,
};

const answeredResponse: TranscriptRecord = {
	kind: "ask_response",
	id: "ask-response-a-7f3c",
	ts: TS + 3 * 60_000,
	askId: "a-7f3c",
	status: "answered",
	questions: [
		{ id: "target", question: "Which environment should I deploy this to?" },
		{ id: "window", question: "When should the rollout start?" },
	],
	answers: { target: ["staging"], window: [] },
	secretLost: false,
};

const declinedResponse: TranscriptRecord = {
	kind: "ask_response",
	id: "ask-response-a-c204",
	ts: TS + 4 * 60_000,
	askId: "a-c204",
	status: "declined",
	questions: [{ id: "target", question: "Which environment?" }],
	answers: {},
	secretLost: false,
};

const secretResponse: TranscriptRecord = {
	kind: "ask_response",
	id: "ask-response-a-sec1",
	ts: TS + 5 * 60_000,
	askId: "a-sec1",
	status: "answered",
	questions: [
		{ id: "DEPLOY_TOKEN", question: "Paste the deploy token.", secret: true },
	],
	answers: { DEPLOY_TOKEN: ["DEPLOY_TOKEN"] },
	// The reported state where the session no longer holds the key it announced.
	secretLost: true,
};

const frame = (records: TranscriptRecord[]) => {
	const Story = () => {
		const containerRef = useRef<HTMLDivElement>(null);
		return (
			<div ref={containerRef} className="h-[420px] w-full">
				<CanonicalTranscript
					transcript={transcriptWith(records)}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					onReconnect={() => {}}
					failure={null}
					awaitingHydration={false}
				/>
			</div>
		);
	};
	return Story;
};

const meta = {
	title: "Chat/Asks/Receipts",
	parameters: {
		layout: "padded",
	},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The late pair: the deadline passed, then the answer landed anyway. */
export const TimeoutThenLateAnswer: Story = {
	render: frame([asked, timeoutRow, lateResponse]),
};

/** An answer that landed in time, expanded into two questions. */
export const AnsweredWithQuestionAndAnswer: Story = {
	render: frame([asked, answeredResponse]),
};

/** A decline: one response-shaped fact, with no answer to show. */
export const Declined: Story = { render: frame([asked, declinedResponse]) };

/** A secret answer: the key, and the notice that the session no longer holds it. */
export const SecretAnswer: Story = { render: frame([asked, secretResponse]) };
