import { MessageInput } from "@shared/components/composer/message-input";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import type { Message } from "../chat/types/message";
import "../chat/components/story-electron-shim";
import { useVoiceSwitchStore } from "./use-voice-switch";
import { useVoiceStore } from "./voice-store";

/*
 * THE VOICE BAND INSIDE THE REAL COMPOSER CARD.
 *
 * `MessageInput` itself, with its working-directory shelf above the editor, because
 * the defects this guards were all about the band's relationship to that card: a
 * strip wider than the card, History opening over the shelf, and a tall empty
 * field under it. A frame of the band alone cannot show any of them. The store is
 * seeded through its own actions (`noteTake`, `setLastSpoken`), the same calls the
 * controller makes, so a reply's `full_text` takes the production path into the row.
 *
 * The URL carries the theme (`?args=theme:localOperatorDark`), as every story does.
 */

const meta = {
	title: "Voice/Composer band",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<{ theme?: string }>;

const SESSION = "a1a1a1a1a1a1";
const CWD = "/Users/you/Projects/invoices";
const messages: Message[] = [
	{ id: "story-voice-message", role: "system", timestamp: new Date(0) },
];

/* What the server would send as `text`: the cleaned reply cut at its cap. */
const SPOKEN =
	"Here is how the two hook types compare. Hook When it runs What it does " +
	"PreToolUse Before an action Adds a note, or refuses the action with a reason " +
	"SessionStart At the start or after a memory reset Puts text at the top of the " +
	"next turn PostToolUse After an action Adds a note Two things to know: The " +
	"record is in context before the first action. It is also re-read after a " +
	"reset. That's where I'll stop, the rest is on screen.";

/* And `full_text`: the same reply, never cut, one row or bullet per line. */
const FULL = [
	"Here is how the two hook types compare.",
	"Hook · When it runs · What it does",
	"PreToolUse · Before an action · Adds a note, or refuses the action with a reason",
	"SessionStart · At the start or after a memory reset · Puts text at the top of the next turn",
	"PostToolUse · After an action · Adds a note",
	"Two things to know:",
	"- The record is in context before the first action.",
	"- It is also re-read after a reset.",
	"(code block omitted)",
	"Nothing else changes: the rest of the session runs as before, and the notes stay in the transcript for the next person to read.",
].join("\n");

/*
 * THE SERVER'S REAL `full_text` SHAPE, not this file's own: the output of
 * `display_text` from local-operator PR #4491 (`local_operator/voice/speakable.py`)
 * run on a markdown reply with a table, a nested bullet list, a fenced block and a
 * closing sentence. Cells join with " · ", rows and bullets keep one line each,
 * paragraphs are separated by a blank line, a fence is the placeholder line.
 */
const SERVER_FULL =
	"Here is how the two hook types compare.\n\nName \u00b7 Qty \u00b7 Note\nPreToolUse \u00b7 2 \u00b7 Before an action\nSessionStart \u00b7 1 \u00b7 At the start or after a memory reset\n\nTwo things to know:\n\n- The record is in context before the first action.\n- It is also re-read after a reset.\n  * even in a nested list\n\n(code block omitted)\n\nNothing else changes: the rest of the session runs as before, and the notes stay in the transcript for the next person to read.";

type Scenario = "working" | "cut" | "server";

function seed(scenario: Scenario) {
	const store = useVoiceStore.getState();
	const t0 = new Date(2026, 10, 23, 11, 2).getTime();
	store.setActive({ session_id: SESSION, enabled_at: t0 });
	store.setRig({
		rig: "ready",
		webui_url: null,
		clients: 1,
		paused: false,
		muted: false,
	});
	store.noteTake(
		SESSION,
		"Hey, so I'm not sure I understand. What is the difference between the two hooks, and does a memory reset skip either of them?",
		t0,
	);
	store.setLastSpoken({
		sessionId: SESSION,
		text: SPOKEN,
		fullText: scenario === "server" ? SERVER_FULL : FULL,
		truncated: true,
		source: "reply",
		at: t0 + 20_000,
	});
	if (scenario === "working") {
		const t1 = t0 + 60_000;
		store.noteTake(
			SESSION,
			"Can you create a handoff, pass it over to Rotom, and that way Rotom can do a prototype in HTML as well as a deeper dive session?",
			t1,
		);
		store.setExchange("working", SESSION);
	}
}

function VoiceBand({
	width,
	scenario,
	history,
}: {
	width: number;
	scenario: Scenario;
	history: boolean;
}) {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		/*
		 * The composer's capability gate reads `capabilities`; the transport the
		 * preview installs refuses everything, so this story answers the one read
		 * the gate makes. Restored on the way out: the preview's window is shared
		 * by every story in a Storybook session.
		 */
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
					: { status: 200, body: { result: {} } }) as never;
		}
		useVoiceSwitchStore.setState({ enabled: true });
		useVoiceStore.setState({ story: [], lastSpoken: null, lastTake: null });
		seed(scenario);
		setReady(true);
		return () => {
			if (window.api?.desktop && previous)
				window.api.desktop.request = previous;
			useVoiceStore.setState({
				active: undefined,
				rig: undefined,
				exchange: null,
				story: [],
				lastSpoken: null,
				lastTake: null,
			});
			useVoiceSwitchStore.setState({ enabled: false });
		};
	}, [scenario]);
	return (
		<div className="flex items-start bg-canvas p-6" data-story-ready={ready}>
			<div className="@container/chatcol min-w-0" style={{ width }}>
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
			<HistoryDriver open={history} />
		</div>
	);
}

/* Press History once the strip has mounted, or make sure it is shut. */
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

/*
 * THE GEOMETRY THE OPERATOR'S REPORT WAS ABOUT, measured: the band sits inside the
 * editor's own box, below the working-directory shelf, and an open History is
 * bounded and scrolls rather than growing past the card.
 */
async function expectBandInsideCard(canvasElement: HTMLElement, open: boolean) {
	await waitFor(() => {
		const toggle = canvasElement.querySelector("[data-voice-history-toggle]");
		if (!toggle) throw new Error("the strip has not mounted");
		if ((toggle.getAttribute("aria-expanded") === "true") !== open)
			throw new Error("History is not in the asked state");
	});
	const band = canvasElement.querySelector("[data-voice-band]");
	const editor = canvasElement.querySelector(".composer-dock-editor");
	const shelf = canvasElement.querySelector("[data-lo-composer-shelf]");
	if (!band || !editor || !shelf) throw new Error("composer parts missing");
	const b = band.getBoundingClientRect();
	const e = editor.getBoundingClientRect();
	const h = shelf.getBoundingClientRect();
	await expect(b.left).toBeGreaterThanOrEqual(e.left);
	await expect(b.right).toBeLessThanOrEqual(e.right);
	await expect(b.top).toBeGreaterThanOrEqual(e.top);
	await expect(b.top).toBeGreaterThanOrEqual(h.bottom);
	if (!open) return;
	const panel = canvasElement.querySelector("[data-voice-history]");
	if (!panel) throw new Error("History panel missing");
	await expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
}

/*
 * THE STRIP'S CONTROLS INSIDE THE BAND: with the cut chip up at the narrow dock the
 * status chip, cut chip, Pause, Silence and History toggle together outgrew the
 * band, and `overflow-hidden` clipped the toggle away - the person could not open
 * or close History. Every control's right edge must be inside the band's.
 */
async function expectStripControlsInsideBand(canvasElement: HTMLElement) {
	await expectBandInsideCard(canvasElement, true);
	await waitFor(() => {
		if (!canvasElement.querySelector("[data-voice-cut]"))
			throw new Error("the cut chip is not up");
	});
	const band = canvasElement.querySelector("[data-voice-band]");
	if (!band) throw new Error("band missing");
	const right = band.getBoundingClientRect().right;
	for (const selector of [
		"[data-voice-cut]",
		"[data-voice-action]",
		"[data-voice-history-toggle]",
	]) {
		for (const control of canvasElement.querySelectorAll(selector)) {
			await expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(
				right,
			);
		}
	}
	const toggle = canvasElement.querySelector("[data-voice-history-toggle]");
	await expect(toggle?.getBoundingClientRect().width).toBeGreaterThan(0);
}

/*
 * THE REPLY AS THE SERVER SENDS IT: one line per table row and bullet, a blank line
 * between paragraphs, the fence as a placeholder line. `pre-line` is what turns
 * those newlines into lines; read back as `innerText`, which follows layout.
 */
async function expectServerShapeLines(canvasElement: HTMLElement) {
	await expectBandInsideCard(canvasElement, true);
	const reply = canvasElement.querySelector<HTMLElement>(
		"[data-voice-story=exchange] .whitespace-pre-line",
	);
	if (!reply) throw new Error("the reply is missing");
	await expect(getComputedStyle(reply).whiteSpace).toBe("pre-line");
	const lines = reply.innerText.split("\n");
	await expect(lines).toContain("Name \u00b7 Qty \u00b7 Note");
	await expect(lines).toContain("PreToolUse \u00b7 2 \u00b7 Before an action");
	await expect(lines).toContain("(code block omitted)");
	await expect(
		lines.filter((line) => line === "").length,
	).toBeGreaterThanOrEqual(4);
}

export const Closed: Story = {
	render: () => <VoiceBand width={900} scenario="working" history={false} />,
	play: ({ canvasElement }) => expectBandInsideCard(canvasElement, false),
};
export const HistoryOpen: Story = {
	render: () => <VoiceBand width={900} scenario="working" history />,
	play: ({ canvasElement }) => expectBandInsideCard(canvasElement, true),
};
export const CutClosed: Story = {
	render: () => <VoiceBand width={900} scenario="cut" history={false} />,
};
export const CutHistoryOpen: Story = {
	render: () => <VoiceBand width={900} scenario="cut" history />,
};
export const NarrowClosed: Story = {
	render: () => <VoiceBand width={393} scenario="working" history={false} />,
};
export const NarrowHistoryOpen: Story = {
	render: () => <VoiceBand width={393} scenario="working" history />,
	play: ({ canvasElement }) => expectBandInsideCard(canvasElement, true),
};
export const NarrowCutHistoryOpen: Story = {
	render: () => <VoiceBand width={393} scenario="cut" history />,
	play: ({ canvasElement }) => expectStripControlsInsideBand(canvasElement),
};
export const ServerShapeHistoryOpen: Story = {
	render: () => <VoiceBand width={900} scenario="server" history />,
	play: ({ canvasElement }) => expectServerShapeLines(canvasElement),
};
export const NarrowServerShapeHistoryOpen: Story = {
	render: () => <VoiceBand width={393} scenario="server" history />,
	play: ({ canvasElement }) => expectServerShapeLines(canvasElement),
};
