import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import { MessageInput } from "../components/message-input";
import type { Message } from "../types/message";
import "../components/story-electron-shim";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/*
 * The quote affordance, on the production transcript and beside the production
 * composer.
 *
 * WHY A STORY AND NOT ONLY A LIVE RUN. The two claims here are about the
 * wiring between three shipped pieces - the row's toolkit, the conversation
 * input store, and the composer's own `ReplyPreview` above it - and that wiring
 * is a property of the components rather than of one session's data. A live run
 * proves it too, but only on whatever transcript that run happened to open; a
 * story holds the same claim still, in every palette, from the diff alone.
 *
 * WHAT IS DELIBERATELY NOT SIMULATED. The toolkit's reveal is the parent row's
 * `group-hover`, and no story can hover: `userEvent.hover` dispatches synthetic
 * pointer events, which do not set CSS `:hover`. So the frames these stories
 * produce show the toolkit HIDDEN at its resting `opacity-0` - which is the
 * correct resting state and the half a design review can judge - and the
 * revealed state is the one the live run photographs. Stated here rather than
 * left to be inferred from an empty corner of a frame.
 *
 * The keyboard reveal (`group-focus-within`) is the other half of that and is
 * equally unreachable from a still: what a frame CAN show is the resting strip
 * in the tab order, and what it cannot is the ring appearing on it.
 */

const conversationId = "story";

const reply = (text: string) => `<reply-to>${text}</reply-to>`;

const record = (
	id: string,
	kind: "user" | "assistant",
	text: string,
): TranscriptRecord =>
	kind === "user"
		? { kind, id, ts: 1_760_000_000_000, text, images: [] }
		: {
				kind,
				id,
				ts: 1_760_000_000_001,
				text,
				streaming: false,
				stopReason: null,
				error: false,
				complete: true,
			};

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	} as TranscriptState;
}

/** The pane's own sentinel, as `chat-content.tsx` hands it one. */
const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

/**
 * A conversation that already contains a quoted turn and an answer to it.
 *
 * The user row's `text` is the payload `buildSendPayload` assembles at the send
 * boundary - `<reply-to>` markup and the words, one string - because that is
 * what the transcript is handed and what the row has to render as a quote.
 */
const CONVERSATION: TranscriptRecord[] = [
	record(
		"u1",
		"user",
		`${reply("The migration failed on the second row.")}\nWhy did it fail there?`,
	),
	record(
		"a1",
		"assistant",
		"Because that row's `tenant_id` was null, and the new column is `not null`. The other four hundred rows were fine.",
	),
];

/**
 * Clear the staged chips before every story.
 *
 * The conversation input store is `persist`ed, so a story that left chips
 * behind would hand the next one a composer with a quote already in it, and the
 * frame would show a state the story did not produce.
 */
function useCleanReplies() {
	useEffect(() => {
		useConversationInputStore.getState().clearReplies(conversationId);
	}, []);
}

const Frame = ({ records }: { records: TranscriptRecord[] }) => {
	useCleanReplies();
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width: 1024 }}>
			<div
				className="overflow-y-auto p-6"
				style={{ height: 420 }}
				ref={containerRef}
			>
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
					/*
					 * The same identity the composer below reads its replies by. The two
					 * are one value in the app (`chat-content.tsx` passes `agentId` to
					 * both), and a story that gave them different ones would photograph a
					 * Quote press that goes nowhere.
					 */
					conversationId={conversationId}
					onReconnect={() => {}}
				/>
			</div>
			<div className="p-6 pt-0">
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId={conversationId}
					onSendMessage={async () => true}
				/>
			</div>
		</div>
	);
};

/**
 * Press the row's own Quote control, the way a reader does.
 *
 * The button rather than the store action, for the reason `canonical-notice`
 * clicks its disclosure trigger: a story that wrote `addReply` directly would
 * keep passing after the toolkit stopped reaching the store, which is the one
 * thing these frames exist to check.
 */
function pressQuote(rowId: string) {
	return () => {
		useConversationInputStore.getState().clearReplies(conversationId);
		const row = document.querySelector(
			`[data-record-id="${rowId}"] [data-lo-quote-toolkit] button`,
		);
		if (!row) {
			throw new Error(`no quote control on row ${rowId}`);
		}
		(row as HTMLButtonElement).click();
	};
}

const meta: Meta = {
	title: "Chat/Canonical quote",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * A turn that was SENT as a reply, rendered from its own payload.
 *
 * This is the frame the raw-markup defect fails: `<reply-to>…</reply-to>` is
 * transport, and before the canonical row split it out, this turn painted the
 * tags as literal text above the question at reading weight.
 */
export const SentTurnQuote: Story = {
	render: () => <Frame records={CONVERSATION} />,
};

/**
 * The same conversation with the assistant row quoted.
 *
 * `play` presses that row's Quote control, so the frame shows what the reader
 * sees next: the turn's own words staged above the composer, with the remove
 * affordance beside them.
 */
export const StagedQuote: Story = {
	render: () => <Frame records={CONVERSATION} />,
	play: async () => pressQuote("a1")(),
};

/**
 * Two quotes staged from two rows: the list stacks, and each is its own chip.
 *
 * Driven through the row controls as well, so the second press is proven to
 * append rather than replace.
 */
export const TwoQuotesStaged: Story = {
	render: () => <Frame records={CONVERSATION} />,
	play: async () => {
		pressQuote("a1")();
		pressQuote("u1")();
	},
};
