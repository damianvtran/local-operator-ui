/*
 * The aside panel, on the PRODUCTION composer band.
 *
 * WHY THESE FRAMES ARE ABOUT THE BAND AND NOT ONLY ABOUT THE PANEL. The panel's
 * whole reason to exist is where it sits: it replaces a Radix MODAL dialog with
 * an in-flow sibling ABOVE the composer box, so that the box keeps its focus and
 * the user can go on typing while an answer streams. A frame that rendered the
 * panel on its own would show the card and prove none of that, and the two things
 * a still CAN speak to — that the panel is in the band, above the box, and that
 * the box below it is the real one — need the real band. So every story here
 * mounts the shipped `MessageInput` inside the column the band's own container
 * queries resolve against, exactly as `composer-band.stories.tsx` does, and seeds
 * the aside store the way `askAside` does.
 *
 * WHAT A SEEDED STATE PROVES, AND WHAT IT DOES NOT. The store is the panel's
 * whole input contract (`aside-store.ts`): the panel reads `attached` and
 * `streams` and paints them, and it owns no socket of its own. So a seeded frame
 * is evidence about the panel's rendering of each state — thinking, streaming,
 * settled, refused, failed — and NOT evidence that the transport delivers those
 * states: the frames that carry a live `aside_delta` into the store are the
 * `aside_delta` semantics in `scripts/btw-aside.test.mjs` and the coordinator's
 * driven run, and this set does not claim them.
 *
 * WHY THE STATES ARE SEEDED RATHER THAN TYPED. A typed `/btw` reaches
 * `sessions.aside` through the desktop transport, which in Storybook answers
 * nothing — so the "reach every state by typing it" discipline the `@`-mention
 * stories follow has no honest route here, and a play function would photograph
 * whichever state the refusal happened to produce. Seeding the store keeps each
 * frame a stated state rather than a side effect of a failed request.
 *
 * THE ONE THING A STILL CANNOT SAY stands as it does for the composer's own
 * band: whether the box MOVED when the panel appeared. The panel is in flow
 * above the box in a bottom-anchored band, so the transcript above yields and the
 * box's own y does not move (the band's comment records the measurement); a
 * single frame shows the panel up and the box in place, and the numbers are the
 * live run's, not this file's.
 */

import {
	type AsideStream,
	beginAsideStream,
	useAsideStore,
} from "@shared/store/aside-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import type { Message } from "../types/message";
import { MessageInput } from "./message-input";
import "./story-electron-shim";

/** An empty transcript, so the band claims the column rather than a list. */
const EMPTY: Message[] = [];

/**
 * One seeded turn: the question the user asked, and the state its answer is in.
 *
 * The three streams are built by the store's OWN helpers (`beginAsideStream` and
 * siblings, via the literals below) rather than by hand, so a frame cannot show a
 * state the store would never hold — a `settled` stream with `streaming: true`
 * would be a picture of an impossible combination.
 */
type SeededTurn = {
	question: string;
	stream: AsideStream;
};

const settled = (text: string): AsideStream => ({
	text,
	streaming: false,
	settled: true,
	error: null,
});

const streaming = (text: string): AsideStream => ({
	text,
	streaming: true,
	settled: false,
	error: null,
});

const failed = (text: string, error: string): AsideStream => ({
	text,
	streaming: false,
	settled: false,
	error,
});

/** The store's own opening state, named rather than re-spelled. */
const thinking = (): AsideStream => beginAsideStream();

type Capture = {
	story: string;
	turns: SeededTurn[];
	notice?: string;
	/** The session is mid-turn: the adopt gate's second term. */
	sessionStreaming?: boolean;
};

/**
 * A session id per story, for the reason `composer-band.stories.tsx` records for
 * its conversation ids: every story in one capture run shares the run's Chrome
 * profile, so two stories writing the same key would show each other's state.
 * This store is not persisted, which removes the rehydration hazard but not the
 * one-frame leak between stories in a single load.
 */
const sessionFor = (story: string) => `aside-panel-story-${story}`;

/**
 * Write the store the way `askAside` writes it, BEFORE the band renders.
 *
 * Synchronous on purpose: an effect would paint one frame of the band with no
 * panel and then grow it, and that first frame is a reflow the story would be
 * photographing as if it were the state.
 */
const seedAside = (sessionId: string, capture: Capture) => {
	const turns = capture.turns.map((turn, index) => ({
		asideId: `${sessionId}-turn-${index}`,
		question: turn.question,
	}));
	useAsideStore.setState({
		streams: Object.fromEntries(
			capture.turns.map((turn, index) => [
				`${sessionId}-turn-${index}`,
				turn.stream,
			]),
		),
		attached: {
			[sessionId]: { turns, notice: capture.notice ?? null },
		},
	});
};

/**
 * The column the band is rendered in, copied in shape from
 * `composer-band.stories.tsx`: `h-screen` + `flex-col` so the band's own `grow`
 * resolves as it does in the app, `w-full` on the inner column so a centring
 * frame cannot shrink it to its content, and a labelled strip where the app has
 * its header so the band's top edge is not y=0.
 */
const Column = ({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) => (
	<div className="flex h-screen w-screen justify-center bg-canvas">
		<div className="flex h-full w-full flex-col">
			<span className="border-hairline border-b bg-canvas px-6 py-2 font-mono text-ink-dim text-mono-sm">
				{label}
			</span>
			{children}
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Aside panel",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const band = (capture: Capture) => {
	const sessionId = sessionFor(capture.story);
	seedAside(sessionId, capture);
	return (
		<MessageInput
			isLoading={false}
			messages={EMPTY}
			conversationId={sessionId}
			isSmallView={false}
			onSendMessage={async () => true}
			/*
			 * The two props the app hands the composer from `chat-content.tsx`: the
			 * session the panel is keyed by, and whether that session is mid-turn (the
			 * adopt gate's second term). Without them the panel could not render at all,
			 * which is why a harness that mounts the composer alone gets no panel.
			 */
			asideSessionId={sessionId}
			asideStreaming={capture.sessionStreaming ?? false}
		/>
	);
};

/** A bare `/btw`: the panel is up with nothing asked, and the box is where the question goes. */
export const EmptyPanel: Story = {
	render: () => (
		<Column label="bare /btw: panel up, empty, adopt disabled, the box is the question's home">
			{band({ story: "empty", turns: [] })}
		</Column>
	),
};

/** The state between the submit and the first chunk: the panel's only liveness line. */
export const Thinking: Story = {
	render: () => (
		<Column label="submitted, nothing arrived yet: one thinking line, no spinner">
			{band({
				story: "thinking",
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: thinking(),
					},
				],
			})}
		</Column>
	),
};

/** Mid-answer: what the reader sees while the deltas land. */
export const Streaming: Story = {
	render: () => (
		<Column label="streaming: the answer at reading weight, adopt still disabled">
			{band({
				story: "streaming",
				turns: [
					{
						question: "summarise the retry policy for me",
						stream: streaming(
							"The retry budget is per provider and counts\n\n- each transport failure\n- each 5xx from the owner",
						),
					},
				],
			})}
		</Column>
	),
};

/** The settled exchange: the adopt control is live and its chord is advertised beside it. */
export const Settled: Story = {
	render: () => (
		<Column label="settled: adopt live, chord advertised, nothing here joins the chat yet">
			{band({
				story: "settled",
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: settled(
							"Transport failures and owner 5xx responses, per provider, within a moving window. A 4xx never spends it.",
						),
					},
				],
			})}
		</Column>
	),
};

/**
 * The gate's other half: the answer is in hand, the CONVERSATION is working, and
 * the panel says why the control is not live rather than going quietly dead
 * (the TUI's `_aside_can_fork`, and its own rule that the refusing surface says
 * so).
 */
export const SessionWorking: Story = {
	render: () => (
		<Column label="settled, session mid-turn: adopt disabled, the reason is on the panel">
			{band({
				story: "session-working",
				sessionStreaming: true,
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: settled(
							"Transport failures and owner 5xx responses, per provider, within a moving window.",
						),
					},
				],
			})}
		</Column>
	),
};

/** A refusal the panel states itself — an adopt the backend declined. */
export const Refused: Story = {
	render: () => (
		<Column label="refused: the sentence is on the panel that refused, not in a toast">
			{band({
				story: "refused",
				notice: "This aside is no longer available",
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: settled("Transport failures and owner 5xx responses."),
					},
				],
			})}
		</Column>
	),
};

/** The ask itself failed: the error is inline, and the partial text stays visible. */
export const AskFailed: Story = {
	render: () => (
		<Column label="the ask failed: partial text kept, one error line, adopt disabled">
			{band({
				story: "ask-failed",
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: failed(
							"The retry budget is per prov",
							"The aside was not answered: the owner is not reachable.",
						),
					},
				],
			})}
		</Column>
	),
};

/**
 * A follow-up: the aside is a conversation, so the panel keeps the earlier turn
 * and the new one streams under it. The answers are read out of `streams` by the
 * turns' own ids — there is no copy of an answer on the attachment — which is why
 * this frame is also the evidence that the exchange survives a continuation.
 */
export const FollowUp: Story = {
	render: () => (
		<Column label="follow-up: the exchange is kept, the new turn streams under it">
			{band({
				story: "follow-up",
				turns: [
					{
						question: "what does the retry budget actually cap?",
						stream: settled("Transport failures and owner 5xx responses."),
					},
					{
						question: "and what resets it?",
						stream: streaming("A successful request to the same provider"),
					},
				],
			})}
		</Column>
	),
};
