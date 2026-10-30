import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { Meta, StoryObj } from "@storybook/react";
import { fireEvent, within } from "@storybook/test";
/*
 * WHY THIS SIDE-EFFECT IMPORT IS FIRST. The composer registers itself with the
 * speech manager, which reads `window.electron.ipcRenderer`; Storybook's
 * preview mocks `window.api` and not the preload's `electron` surface, so
 * without the shim the story dies at mount with "Cannot read properties of
 * undefined (reading 'ipcRenderer')" - the same trap `team-bridge-page.stories`
 * documents.
 */
import "../chat/components/story-electron-shim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TeamBridgeComposer } from "./team-bridge-composer";
import {
	type DictationTakeOutcome,
	installDictationFixture,
} from "./team-bridge-dictation.fixtures";

/*
 * Team Bridge's composer bar, as a surface of its own: the four dictation
 * states plus the draft states the auto-grow is judged on.
 *
 * THE FRAME IS A PANE, NOT A CARD. The bar is drawn at the foot of a column the
 * size of a conversation pane, because every geometry claim this story exists
 * for - the bar's resting height, its bottom edge against the pane's, the
 * strip occupying the control row - is a relationship to that pane. A story
 * that floated the bar in a bare viewport would answer none of them.
 *
 * THE TRANSCRIPT ABOVE IT IS FIXTURE PROSE and has no claims attached: it is
 * there so the frame shows a pane rather than an empty rectangle.
 */

const CONVERSATION = "composer-story-row";

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const seedDraft = (text: string) => {
	useConversationInputStore.getState().setComposerText(CONVERSATION, text);
};

/**
 * WHAT THE FRAME ACTUALLY MEASURES, printed into the page so a capture can read
 * it without a scripting channel.
 *
 * `getBoundingClientRect` on the bar, the field and the control row, and the
 * distance from the bar's bottom edge to the viewport's - the four numbers the
 * PR body quotes. It polls rather than observing only resizes, because the
 * field's height is set imperatively by the composer's own layout effect.
 */
const MeasureReadout = () => {
	const [line, setLine] = useState("");
	useEffect(() => {
		const read = () => {
			const bar = document.querySelector<HTMLElement>("[data-composer-bar]");
			const field = document.querySelector<HTMLTextAreaElement>(
				"[data-composer-bar] textarea",
			);
			const row = document.querySelector<HTMLElement>(
				"[data-composer-controls]",
			);
			if (!bar || !field || !row) return;
			const b = bar.getBoundingClientRect();
			const f = field.getBoundingClientRect();
			const r = row.getBoundingClientRect();
			setLine(
				`vw=${window.innerWidth} vh=${window.innerHeight} bar=${Math.round(b.width)}x${Math.round(b.height)} barBottomGap=${Math.round(window.innerHeight - b.bottom)} fieldH=${Math.round(f.height)} rowH=${Math.round(r.height)} fieldScrollH=${field.scrollHeight} overflowY=${getComputedStyle(field).overflowY}`,
			);
		};
		read();
		const timer = window.setInterval(read, 250);
		return () => window.clearInterval(timer);
	}, []);
	return (
		<output
			data-composer-measure=""
			className="pointer-events-none fixed bottom-1 left-2 z-50 font-mono text-[10px] text-ink-muted"
		>
			{line}
		</output>
	);
};

/**
 * The body of the bar's layout tests: a pane whose foot the bar sits on.
 */
const Pane = ({ children }: { children: React.ReactNode }) => (
	<div className="flex h-screen w-full flex-col bg-surface">
		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-5">
			<p className="text-[13px] text-ink-dim">A conversation, for scale.</p>
			<p className="text-[13px] text-ink">
				So the bar is measured against a pane.
			</p>
		</div>
		{/* THE HOST BAND, with the padding the page gives it: the bar's own
		    bottom inset is this, and nothing else renders below it. */}
		<div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 pt-1 pb-4">
			{children}
		</div>
	</div>
);

const meta = {
	title: "Team Bridge/Composer",
	component: TeamBridgeComposer,
	decorators: [
		(Story) => (
			<QueryClientProvider client={queryClient}>
				<Story />
				<MeasureReadout />
			</QueryClientProvider>
		),
	],
	parameters: { layout: "fullscreen" },
	args: {
		conversationId: CONVERSATION,
		placeholder: "Message",
		canAttach: true,
		recordingProbe: { canUseRadientSpeech: true, speechBlock: "checking" },
		onSendMessage: () => true,
	},
	render: (args) => (
		<Pane>
			<TeamBridgeComposer {...args} />
		</Pane>
	),
} satisfies Meta<typeof TeamBridgeComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Install a scripted take for the life of one story, then put it back. */
const withDictation =
	(outcome: DictationTakeOutcome) => (Story: () => React.ReactNode) => {
		const installed = useRef<(() => void) | null>(null);
		// biome-ignore lint/correctness/useExhaustiveDependencies: one install per story mount; re-running it would replace a live recorder mid-take.
		useLayoutEffect(() => {
			installed.current = installDictationFixture(outcome);
			return () => installed.current?.();
		}, []);
		return <Story />;
	};

/** The press a reader makes on the microphone: a tap, so the take stays live. */
const pressMic = async (canvasElement: HTMLElement) => {
	const mic = await within(canvasElement).findByLabelText("Start recording");
	fireEvent.pointerDown(mic, { button: 0, pointerId: 1 });
	fireEvent.pointerUp(mic, { button: 0, pointerId: 1 });
};

/** End the take the way the strip's own Confirm does, so transcription runs. */
const confirmTake = async (canvasElement: HTMLElement) => {
	const confirm =
		await within(canvasElement).findByLabelText("Confirm recording");
	/*
	 * THE WAIT IS THE COMPOSER'S OWN RULE, not a story convenience: a take
	 * shorter than `MIN_DICTATION_CLIP_MS` is the tail of a press that was never
	 * speech and is discarded, so a scripted confirm in the press's own
	 * millisecond would prove only the discard path.
	 */
	await new Promise((resolve) => setTimeout(resolve, 400));
	fireEvent.click(confirm);
};

export const Idle: Story = {
	decorators: [withDictation({ kind: "text", text: "" })],
};

export const TwoLines: Story = {
	decorators: [
		withDictation({ kind: "text", text: "" }),
		(Story) => {
			useEffect(() => {
				seedDraft(
					"The bar grows upward as this draft wraps,\nand both lines stay readable.",
				);
			}, []);
			return <Story />;
		},
	],
};

export const AtCap: Story = {
	decorators: [
		withDictation({ kind: "text", text: "" }),
		(Story) => {
			useEffect(() => {
				seedDraft(
					[
						"Line one of a draft that is past the field's cap,",
						"line two,",
						"line three,",
						"line four,",
						"line five,",
						"line six,",
						"line seven still being typed,",
						"line eight.",
					].join("\n"),
				);
			}, []);
			return <Story />;
		},
	],
};

export const Recording: Story = {
	decorators: [withDictation({ kind: "pending" })],
	play: async ({ canvasElement }) => {
		await pressMic(canvasElement);
	},
};

export const Transcribing: Story = {
	decorators: [withDictation({ kind: "pending" })],
	play: async ({ canvasElement }) => {
		await pressMic(canvasElement);
		await confirmTake(canvasElement);
	},
};

export const TranscribeFailed: Story = {
	decorators: [withDictation({ kind: "transient-failure" })],
	play: async ({ canvasElement }) => {
		await pressMic(canvasElement);
		await confirmTake(canvasElement);
	},
};

export const Transcribed: Story = {
	decorators: [
		withDictation({ kind: "text", text: "Ship it after the review." }),
	],
	play: async ({ canvasElement }) => {
		await pressMic(canvasElement);
		await confirmTake(canvasElement);
	},
};
