import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import type { TranscriptRecord } from "@features/chat/canonical/transcript-reducer";
import type { TranscriptState } from "@features/chat/canonical/transcript-reducer";
import { MessageInput } from "@shared/components/composer/message-input";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../chat/types/message";
import "../chat/components/story-electron-shim";
import { useVoiceSwitchStore } from "./use-voice-switch";
import { useVoiceStore } from "./voice-store";

/*
 * THE SPOKEN SUMMARY IN THE REAL TRANSCRIPT ROW, ABOVE THE REAL COMPOSER.
 *
 * `CanonicalTranscript` renders the agent's reply and `MessageInput` renders the
 * voice band, both unmodified, so the block is seen where the operator will see
 * it: at the end of the answer, with the strip and History directly beneath. The
 * store is seeded through its own actions (`noteTake`, `setLastSpoken`,
 * `notePlayback`), the calls the controller makes, so a state is the one
 * production reaches rather than a hand-built prop.
 *
 * Frames are the design's numbers (4a, 5, 6, 7, 8, 9, 10, 11, 13). The theme is
 * the URL's (`?args=theme:localOperatorDark`), as every story.
 */

const meta = {
	title: "Voice/Spoken summary",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<{ theme?: string }>;

const SESSION = "a1a1a1a1a1a1";
const MESSAGE = "a1";
const CWD = "/Users/you/Projects/invoices";
const TS = 1_760_000_000_000;
const messages: Message[] = [
	{ id: "story-voice-message", role: "system", timestamp: new Date(0) },
];

const HEARD =
	"Compare the three hook types and tell me which one reloads the memory.";

const SUMMARY =
	"Use SessionStart: it runs at the start and after every memory reset, so the record is back before the first action. PreToolUse is for blocking risky actions, and PostToolUse only adds a note afterwards.";

/* Six sentences: longer than the spoken cap, so the audio stops part way. */
const SUMMARY_LONG = `${SUMMARY} A fourth hook, Stop, runs when the agent finishes a turn and can ask it to continue. A fifth, UserPromptSubmit, runs before your message reaches the model. A sixth, Notification, fires when the agent needs your attention. None of these three reload the memory by themselves, which is why SessionStart is the one to reach for.`;

const REPLY = [
	"Here are the three hook types side by side:",
	"",
	"| Hook | When it runs | What it does |",
	"| --- | --- | --- |",
	"| PreToolUse | Before an action | Adds a note, or refuses the action |",
	"| SessionStart | At start or after a memory reset | Puts text at the top of the next turn |",
	"| PostToolUse | After an action | Adds a note |",
	"",
	"SessionStart is the one that reloads the memory:",
	"",
	"- The record is in context before the first action.",
	"- It is re-read after a reset.",
	"",
	"Nothing else changes: the rest of the session runs as before, and the notes stay in the transcript for the next person to read.",
].join("\n");

export type Frame =
	| "upcoming"
	| "speaking"
	| "spoken"
	| "stopped"
	| "muted"
	| "fallback"
	| "cut"
	| "static";

/* `full_text` as the server flattens REPLY: a row per line, cells joined by " · ". */
const FALLBACK_FULL = [
	"Here are the three hook types side by side:",
	"",
	"Hook · When it runs · What it does",
	"PreToolUse · Before an action · Adds a note, or refuses the action",
	"SessionStart · At start or after a memory reset · Puts text at the top of the next turn",
	"PostToolUse · After an action · Adds a note",
	"",
	"SessionStart is the one that reloads the memory:",
	"",
	"- The record is in context before the first action.",
	"- It is re-read after a reset.",
	"",
	"Nothing else changes: the rest of the session runs as before, and the notes stay in the transcript for the next person to read.",
].join("\n");

/* The reply of frame 16: a fenced JSON block between the prose and the summary. */
const CODE_REPLY = [
	"The hook config is one JSON object per event:",
	"",
	"```json",
	"{",
	'  "hooks": {',
	'    "SessionStart": [',
	'      { "command": "reload-memory --quiet" }',
	"    ],",
	'    "PreToolUse": [',
	'      { "matcher": "shell", "command": "deny-risky" }',
	"    ]",
	"  }",
	"}",
	"```",
	"",
	"Put it in the project settings file and restart the session.",
].join("\n");

const record = (frame: Frame, code = false): TranscriptRecord => {
	const text =
		frame === "fallback"
			? REPLY
			: `${code ? CODE_REPLY : REPLY}\n\nSpoken: ${frame === "cut" ? SUMMARY_LONG : frame === "upcoming" ? SUMMARY.split(" ").slice(0, 14).join(" ") : SUMMARY}`;
	return {
		kind: "assistant",
		id: MESSAGE,
		ts: TS,
		text,
		streaming: frame === "upcoming",
		complete: frame !== "upcoming",
		stopReason: null,
		error: false,
	};
};

const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/** What the server would send as `text` for each frame's audio. */
function seed(frame: Frame) {
	const store = useVoiceStore.getState();
	const t0 = new Date(2026, 10, 23, 11, 7).getTime();
	if (frame === "static") return;
	store.setActive({ session_id: SESSION, enabled_at: t0 - 60_000 });
	store.setRig({
		rig: "ready",
		webui_url: null,
		clients: 1,
		paused: false,
		muted: frame === "muted",
	});
	store.noteTake(SESSION, HEARD, t0);
	if (frame === "upcoming") {
		store.setExchange("working", SESSION);
		return;
	}
	const fallback = frame === "fallback";
	store.setLastSpoken({
		sessionId: SESSION,
		text: fallback
			? "Here are the three hook types side by side: PreToolUse Before an action Adds a note, or refuses the action SessionStart At start or after a memory reset Puts text at the top of the next turn. That's where I'll stop, the rest is on screen."
			: frame === "cut"
				? `${SUMMARY_LONG.slice(0, 330)}. That's where I'll stop, the rest is on screen.`
				: SUMMARY,
		fullText: fallback ? FALLBACK_FULL : undefined,
		truncated: fallback || frame === "cut",
		messageId: MESSAGE,
		source: fallback ? "reply" : "summary",
		muted: frame === "muted",
		at: t0 + 8_000,
	});
	if (frame === "speaking") {
		store.notePlayback("started", SESSION, t0 + 8_000);
		store.setActivity("speaking");
	}
	if (frame === "stopped") {
		store.notePlayback("started", SESSION, t0 + 8_000);
		store.notePlayback("cancelled", SESSION, t0 + 12_000);
	}
}

function Scene({
	width,
	frame,
	history,
	code = false,
}: {
	width: number;
	frame: Frame;
	history: boolean;
	code?: boolean;
}) {
	const [ready, setReady] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const previous = window.api?.desktop?.request;
		if (window.api?.desktop) {
			window.api.desktop.request = (async (request: { op?: string }) =>
				request?.op === "capabilities"
					? {
							status: 200,
							body: {
								result: { desktop_available: true, features: { voice: 2 } },
							},
						}
					: previous
						? previous(request as never)
						: { status: 200, body: { result: {} } }) as never;
		}
		useVoiceSwitchStore.setState({ enabled: true });
		useVoiceStore.setState({
			story: [],
			spoken: {},
			lastSpoken: null,
			lastTake: null,
			active: undefined,
			exchange: null,
			activity: null,
			speakRequest: null,
		});
		seed(frame);
		setReady(true);
		return () => {
			if (window.api?.desktop && previous)
				window.api.desktop.request = previous;
			useVoiceStore.setState({
				active: undefined,
				rig: undefined,
				exchange: null,
				activity: null,
				speakRequest: null,
				story: [],
				spoken: {},
				lastSpoken: null,
				lastTake: null,
			});
			useVoiceSwitchStore.setState({ enabled: false });
		};
	}, [frame]);
	return (
		<div className="flex items-start bg-canvas p-6" data-story-ready={ready}>
			<div className="@container/chatcol min-w-0" style={{ width }}>
				<div
					className="flex flex-col"
					style={{ height: width < 550 ? 560 : 520 }}
				>
					{ready && (
						<CanonicalTranscript
							transcript={transcriptOf([record(frame, code)])}
							frontend={null}
							gate={null}
							waiting={false}
							starting={false}
							loadingOlder={false}
							onLoadOlder={async () => true}
							containerRef={containerRef}
							isSmallView={width < 550}
							status="live"
							failure={null}
							awaitingHydration={false}
							onReconnect={() => {}}
							conversationId={SESSION}
						/>
					)}
				</div>
				<div className="mt-3">
					{ready && (
						<MessageInput
							isLoading={false}
							isSmallView={width < 550}
							messages={messages}
							conversationId={SESSION}
							cwd={CWD}
							recordingProbe={{
								canUseRadientSpeech: true,
								speechBlock: "checking",
							}}
							onSendMessage={async () => false}
						/>
					)}
				</div>
			</div>
			<HistoryDriver open={history} />
		</div>
	);
}

function HistoryDriver({ open }: { open: boolean }) {
	useLayoutEffect(() => {
		let tries = 0;
		const timer = window.setInterval(() => {
			const toggle = document.querySelector<HTMLButtonElement>(
				"[data-voice-history-toggle]",
			);
			tries += 1;
			if (!toggle && tries < 100) return;
			window.clearInterval(timer);
			if (toggle && (toggle.getAttribute("aria-expanded") === "true") !== open)
				toggle.click();
		}, 50);
		return () => window.clearInterval(timer);
	}, [open]);
	return null;
}

/** The block exists in the transcript and says what the audio did. */
async function expectBlock(
	canvasElement: HTMLElement,
	tone: string,
	replay: boolean,
) {
	await waitFor(() => {
		const block = canvasElement.querySelector(
			`[data-spoken-summary="${tone}"]`,
		);
		if (!block) throw new Error(`no ${tone} block`);
	});
	const block = canvasElement.querySelector("[data-spoken-summary]");
	await expect(
		Boolean(block?.querySelector('[data-spoken-control="replay"]')),
	).toBe(replay);
	// The raw label never reaches the screen as prose.
	await expect(canvasElement.textContent?.includes("Spoken: ")).toBe(false);
}

export const Upcoming: Story = {
	render: () => <Scene width={900} frame="upcoming" history={false} />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "upcoming", false),
};
export const Speaking: Story = {
	render: () => <Scene width={900} frame="speaking" history={false} />,
	// Replay stays drawn (so a press keeps its focus) but waits, aria-disabled.
	play: async ({ canvasElement }) => {
		await expectBlock(canvasElement, "speaking", true);
		await expect(
			canvasElement
				.querySelector('[data-spoken-control="replay"]')
				?.getAttribute("aria-disabled"),
		).toBe("true");
	},
};
export const Spoken: Story = {
	render: () => <Scene width={900} frame="spoken" history={false} />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "spoken", true),
};
export const SpokenHistoryOpen: Story = {
	render: () => <Scene width={900} frame="spoken" history />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "spoken", true),
};
export const Stopped: Story = {
	render: () => <Scene width={900} frame="stopped" history={false} />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "stopped", true),
};
export const Muted: Story = {
	render: () => <Scene width={900} frame="muted" history={false} />,
	play: async ({ canvasElement }) => {
		await waitFor(() => {
			if (!canvasElement.querySelector('[data-spoken-summary="muted"]'))
				throw new Error("no muted block");
		});
		await expect(
			canvasElement.querySelector('[data-spoken-control="play"]'),
		).not.toBeNull();
	},
};
export const FallbackHistoryOpen: Story = {
	render: () => <Scene width={900} frame="fallback" history />,
	play: async ({ canvasElement }) => {
		await waitFor(() => {
			if (!canvasElement.querySelector("[data-spoken-reply-note]"))
				throw new Error("no fallback note");
		});
		await expect(
			canvasElement.querySelector("[data-spoken-summary]"),
		).toBeNull();
	},
};
export const CutHistoryOpen: Story = {
	render: () => <Scene width={900} frame="cut" history />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "cut", true),
};
export const StaticVoiceOff: Story = {
	render: () => <Scene width={900} frame="static" history={false} />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "static", false),
};

/** Frame 16: the block under a reply that ends in a code block. */
export const SpokenAfterCodeBlock: Story = {
	render: () => <Scene width={900} frame="spoken" history={false} code />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "spoken", true),
};

export const NarrowUpcoming: Story = {
	render: () => <Scene width={393} frame="upcoming" history={false} />,
};
export const NarrowSpoken: Story = {
	render: () => <Scene width={393} frame="spoken" history={false} />,
	play: ({ canvasElement }) => expectBlock(canvasElement, "spoken", true),
};
export const NarrowSpokenHistoryOpen: Story = {
	render: () => <Scene width={393} frame="spoken" history />,
};
export const NarrowFallbackHistoryOpen: Story = {
	render: () => <Scene width={393} frame="fallback" history />,
};
export const NarrowCutHistoryOpen: Story = {
	render: () => <Scene width={393} frame="cut" history />,
};
export const NarrowStatic: Story = {
	render: () => <Scene width={393} frame="static" history={false} />,
};
