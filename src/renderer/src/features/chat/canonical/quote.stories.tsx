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
 * WHAT IS DELIBERATELY NOT SIMULATED HERE. The toolkit's reveal is the parent
 * row's `group-hover`, and a story's `play` cannot produce it: `userEvent.hover`
 * dispatches synthetic pointer events, which do not set CSS `:hover`. So the
 * frames these stories produce show the toolkit HIDDEN at its resting
 * `opacity-0`, which is the correct resting state and the half a design review
 * can judge from a still.
 *
 * THE REVEALED STATE IS PHOTOGRAPHED BY THE EVIDENCE RIG, NOT BY A STORY. The
 * round that judged this surface first read the reveal as unreachable from a
 * still; the UX round corrected that, and the correction is about the rig rather
 * than about these stories - a private headless Chrome driven over CDP with real
 * `Input.dispatchMouseEvent` drives the actual input pipeline, so `:hover` and
 * `group-hover` answer there and the revealed strip is both drivable and
 * photographable. `scripts/capture-evidence.mjs` takes those frames from this
 * same story set, in every theme.
 *
 * The keyboard reveal (`group-focus-within`) is reachable the same way, with
 * real `Input.dispatchKeyEvent` Tab presses rather than a `play` function; what
 * a resting still CAN show is the strip in the tab order, and what it cannot is
 * the ring appearing on it.
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
 * A multi-paragraph answer, as a turn body actually is.
 *
 * The SHAPE is the point of this fixture. `quoteText` deliberately does not
 * truncate, so a quoted turn is routinely several paragraphs, and the scan that
 * takes the markup back out has to cross a newline to find the block. A
 * single-line fixture exercises the one shape that worked while the scan was
 * broken, which is why the frames built on one could not fail on the defect.
 */
const ANSWER = [
	"Because that row's `tenant_id` was null, and the new column is `not null`.",
	"",
	"The other four hundred rows were fine.",
].join("\n");

/**
 * A conversation that already contains a quoted turn and an answer to it.
 *
 * The user row's `text` is the payload `buildSendPayload` assembles at the send
 * boundary - `<reply-to>` markup and the words, one string - because that is
 * what the transcript is handed and what the row has to render as a quote. The
 * quote it carries is `ANSWER`, so the frame is built from the multi-line case
 * rather than from the one-line case that used to stand in for it.
 */
const CONVERSATION: TranscriptRecord[] = [
	record("u1", "user", `${reply(ANSWER)}\nWhy did it fail there?`),
	record(
		"a1",
		"assistant",
		`${ANSWER}\n\nSo the answer is the same for the rest of them.`,
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
					 * are one value in the app (`chat-content.tsx` hands both of them its
					 * local `conversationId` const), and a story that gave them different
					 * ones would photograph a Quote press that goes nowhere.
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
 *
 * IT DELIBERATELY DOES NOT CLEAR FIRST (design round 1, D1; QA round 1, Q4).
 * It used to call `clearReplies` before every press, which meant the second
 * press wiped the first chip and `TwoQuotesStaged` rendered ONE chip reading
 * the second row's words - the exact opposite of what its docstring claimed to
 * prove, and a frame that would have stayed green through a regression making
 * the second press replace the first. The mount-time `useCleanReplies` on
 * `Frame` is what keeps story order from leaking; within a story, presses must
 * append the way the product does.
 */
function pressQuote(rowId: string) {
	return () => {
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
 * This is the frame the raw-markup defect fails, and the fixture is built to
 * earn that: the quoted turn below is multi-paragraph, so the scan has to cross
 * a newline to find the block. While the scan was not dotall, `parseReplies`
 * matched nothing here and this row painted `<reply-to>...</reply-to>` as
 * literal text at reading weight - the single-line quote this story used to
 * carry could not fail that way, which is exactly why it did not catch it.
 * After the fix the tags are transport again: the block above the question is
 * the same recessed `ReplyPreview` the composer stages.
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
 * append rather than replace - which is a claim this story could not previously
 * make, because its own `pressQuote` cleared the list before each press and the
 * frame showed the second row's words alone.
 */
export const TwoQuotesStaged: Story = {
	render: () => <Frame records={CONVERSATION} />,
	play: async () => {
		pressQuote("a1")();
		pressQuote("u1")();
	},
};
