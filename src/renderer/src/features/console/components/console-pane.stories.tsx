import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useEffect } from "react";
import { ConsolePane } from "./console-pane";

/**
 * The console pane, in every state a review has to judge.
 * Design: `docs/design/ui-console-tab.md` 6.1 (the pane, its header and its list),
 * 6.2/6.5 (recall, and the provenance marker), 7.3 (the ended state over recorded
 * history), 9 (the twelve-theme grid), 12.2 (the blip's two states), 19.2 (the
 * story set this file is), 19.5 (the states the frames must cover).
 *
 * WHY THESE STORIES STUB THE BRIDGE. The pane's input is main's projection — it
 * reads `window.api.console.state()` and subscribes for bytes — so a story that
 * does not answer that bridge renders the unavailable state for every state it
 * means to show. The alternatives are worse in the way the browser pane's own
 * stories argue: a prop path that exists only for stories would be a second way to
 * feed a component whose one input is deliberately the projection, and the pane
 * cannot be captured from the live app alone at first paint because a surface has
 * to exist before there is anything to look at.
 *
 * So the fixture below IS a projection — the same object main publishes, of the
 * same shape the desktop tests drive — installed before the story renders, and the
 * mirror paints the bytes the fixture's `subscribe` replays. What that buys: the
 * real `useConsoleSession`, the real `ConsoleMirror` (a real xterm, the real
 * theme resolution, the real `ResizeObserver` cell measurement), the real header,
 * list, blip and states. What it does NOT buy: a real pty. Nothing here proves a
 * program runs; that is the live-app rig's job and the PR carries its transcript.
 */

/**
 * UTF-8-safe base64, because `btoa` throws on anything outside Latin-1 and the
 * sample below is deliberately full of characters outside it: a box-drawing frame,
 * CJK text and an emoji. The first sweep of this set died here — `btoa` threw, the
 * story rendered Storybook's own error display, the theme never settled, and the
 * rig reported a theme timeout rather than the real cause.
 */
const toBase64 = (text: string): string => {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

const NOW = Math.floor(Date.now() / 1000);

/** The conversation the pane is scoped to, and one it is not. */
const THIS_CONVERSATION = "session-1f4c";
const OTHER_CONVERSATION = "session-9ab2";

interface SurfaceFixture {
	surface: string;
	session_id: string;
	origin: "user" | "agent";
	command: string;
	argv_tail: string;
	cwd: string;
	cols: number;
	rows: number;
	running: boolean;
	exit_code: number | null;
	last_activity: number;
	live: boolean;
	agent_owned: boolean;
	secure: boolean;
	retain: boolean;
	displayed: boolean;
	last_mark: { kind: string; exitCode: number | null; offset: number } | null;
}

const surface = (
	overrides: Partial<SurfaceFixture> & { surface: string },
): SurfaceFixture => ({
	session_id: THIS_CONVERSATION,
	origin: "user",
	command: "zsh",
	argv_tail: "",
	cwd: "~/workspace",
	cols: 100,
	rows: 30,
	running: true,
	exit_code: null,
	last_activity: NOW,
	live: true,
	agent_owned: false,
	secure: false,
	retain: true,
	displayed: false,
	last_mark: null,
	...overrides,
});

/**
 * A sample of the things a terminal grid is worst at, so a frame is worth looking
 * at: the sixteen ANSI colours, bold/dim/underline, a box-drawing frame (whose
 * joins are a design-round check, §6.6), a wide-character sample, an emoji, and a
 * 24-bit gradient - all of which the design asks the theme sweep to show (§9.3's
 * torture stream, sampled rather than complete: the full stream is the live rig's).
 */
const SAMPLE = [
	"\u001b[1mLocal Operator console\u001b[0m — a real terminal, per conversation.",
	"",
	"\u001b[31mred\u001b[0m \u001b[32mgreen\u001b[0m \u001b[33myellow\u001b[0m \u001b[34mblue\u001b[0m \u001b[35mmagenta\u001b[0m \u001b[36mcyan\u001b[0m \u001b[37mwhite\u001b[0m",
	"\u001b[90mbright black\u001b[0m \u001b[91mred\u001b[0m \u001b[92mgreen\u001b[0m \u001b[93myellow\u001b[0m \u001b[94mblue\u001b[0m \u001b[95mmagenta\u001b[0m \u001b[96mcyan\u001b[0m",
	"\u001b[2mdim\u001b[0m \u001b[1mbold\u001b[0m \u001b[4munderline\u001b[0m \u001b[7mreverse\u001b[0m",
	"",
	"┌──────────────┬──────────────┐",
	"│ box drawing  │ 当 CJK 幅      │",
	"└──────────────┴──────────────┘",
	"",
	"$ npm run build",
	"built in 4.2s → dist/",
	"\u001b[38;2;120;180;255m24-bit truecolor passes through untouched\u001b[0m",
	"🛠 emoji width is two cells under Unicode 11",
].join("\r\n");

/**
 * The bridge this document had BEFORE any story installed a fixture, captured once
 * at module scope.
 *
 * A LATER INSTALL MUST NOT CAPTURE THE PREVIOUS STORY'S STUB as "the real thing":
 * a fixture installed from a previous story would be restored on top of the next
 * one, and the pane would answer from the wrong projection — the sort of bug that
 * shows up as one story rendering another's state.
 */
const REAL_API = window.api;

/**
 * Install one projection, and record what the pane sends back. The recorder is
 * left on `window` so a story (or a rig) can read the reports the real components
 * produced rather than a number typed here.
 *
 * CALLED DURING RENDER, NOT FROM AN EFFECT, and the difference is the whole state
 * matrix. The pane reads the projection ONCE at mount; a fixture installed in an
 * effect lands one commit too late, so every story would photograph the
 * "console is not available" state no matter which fixture it declares — which is
 * exactly what the first sweep of this set produced.
 */
const installFixture = (options: {
	surfaces: SurfaceFixture[];
	/** Never answers, for the loading state. */
	hang?: boolean;
	/** Refuses every call, for the unavailable state. */
	fail?: boolean;
	bytes?: string;
}): (() => void) => {
	const previous = REAL_API;
	const calls: Array<{ op: string; args: unknown[] }> = [];
	(window as unknown as { consoleFixtureCalls?: unknown }).consoleFixtureCalls =
		calls;
	const state = () => ({
		available: true,
		total: options.surfaces.length,
		agent: options.surfaces.filter((s) => s.agent_owned).length,
		displayed_surface: null,
		surfaces: options.surfaces,
	});
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			calls.push({ op, args });
			if (options.fail) return Promise.reject(new Error("console unavailable"));
			if (options.hang) return new Promise(() => {});
			if (op === "state") return Promise.resolve(state());
			if (op === "subscribe")
				return Promise.resolve({
					surface: args[0],
					replay_base64: toBase64(options.bytes ?? SAMPLE),
					from_byte: 0,
					to_byte: 0,
					truncated: false,
				});
			return Promise.resolve(state());
		};
	const stub = {
		state: record("state"),
		createSurface: record("createSurface"),
		openPane: record("openPane"),
		closePane: record("closePane"),
		selectSurface: record("selectSurface"),
		input: record("input"),
		keys: record("keys"),
		setContentRect: record("setContentRect"),
		setSecure: record("setSecure"),
		subscribe: record("subscribe"),
		unsubscribe: record("unsubscribe"),
		onOutput: () => () => {},
		onExit: () => () => {},
		onReveal: () => () => {},
		onStateChanged: () => () => {},
	};
	window.api = { ...previous, console: stub } as unknown as typeof window.api;
	return () => {
		window.api = previous;
	};
};

/** The pane, on a draft or in a conversation. */
const Frame: FC<{
	surfaces: SurfaceFixture[];
	sessionId?: string | null;
	hang?: boolean;
	fail?: boolean;
	unseen?: string[];
	/** How old the marks are, so the blip's two states are the RULE rather than two
	 * hand-picked colours: `0` pulses, a minute rests (§12.2). */
	unseenAgeMs?: number;
	/** The session the marks belong to, for the frame that shows a mark from
	 * ANOTHER conversation not appearing here. */
	unseenSession?: string;
}> = ({
	surfaces,
	sessionId = THIS_CONVERSATION,
	hang,
	fail,
	unseen,
	unseenAgeMs = 0,
	unseenSession,
}) => {
	// Installed during render: see `installFixture` for why an effect is one commit
	// too late for a component whose input is the projection.
	installFixture({ surfaces, hang, fail });
	useEffect(() => {
		useUiPreferencesStore.setState({
			consoleUnseen: (unseen ?? []).map((surface) => ({
				sessionId: unseenSession ?? sessionId ?? "",
				surface,
				at: Date.now() - unseenAgeMs,
			})),
		});
		return () => useUiPreferencesStore.setState({ consoleUnseen: [] });
	}, [unseen, sessionId, unseenAgeMs, unseenSession]);
	return (
		<div className="h-[520px] w-[843px] bg-surface p-0">
			<ConsolePane sessionId={sessionId} onClose={() => {}} />
		</div>
	);
};

const meta = {
	title: "Console/Pane",
	component: ConsolePane,
	parameters: { layout: "fullscreen" },
	/*
	 * `args` at the META level rather than per story: every story below renders its
	 * own fixture (`render`), so the component's two required props are never the
	 * story's subject - but Storybook's types require them to be stated once, and
	 * stating them here is what keeps fourteen stories from repeating the same line.
	 */
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
} satisfies Meta<typeof ConsolePane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One running surface: the pane's populated state, at the design's 100x30. */
export const Populated: Story = {
	render: () => <Frame surfaces={[surface({ surface: "con:1:7f3a" })]} />,
};

/** The lens with more than one surface, one of them opened by an agent: the
 * provenance marker (§6.5) and the recall case (§6.2) in one frame. */
export const TwoSurfaces: Story = {
	render: () => (
		<Frame
			surfaces={[
				surface({ surface: "con:1:7f3a" }),
				surface({
					surface: "con:2:91bc",
					origin: "agent",
					agent_owned: true,
					command: "npm",
					argv_tail: "run dev",
					cols: 100,
					rows: 30,
				}),
			]}
		/>
	),
};

/** No surface in this conversation yet: the `+` control is here as well as in the
 * header, because this is the state a first-run user meets (§6.1). */
export const Empty: Story = { render: () => <Frame surfaces={[]} /> };

/** A draft: a console runs in a conversation's own directory, so there is nowhere
 * to put one yet. */
export const DraftConversation: Story = {
	render: () => <Frame surfaces={[]} sessionId={null} />,
};

/** Before the first read answers. */
export const Loading: Story = {
	render: () => <Frame surfaces={[]} hang />,
};

/** The console off, or its native module absent: §15's copy, including the
 * machine line a bug report would quote. */
export const Unavailable: Story = {
	render: () => <Frame surfaces={[]} fail />,
};

/** Ended over recorded history (§7.3), with the exit code it was observed to
 * carry. */
export const Ended: Story = {
	render: () => (
		<Frame
			surfaces={[
				surface({
					surface: "con:1:7f3a",
					running: false,
					exit_code: 0,
					live: true,
				}),
			]}
		/>
	),
};

/** A surface restored after a relaunch: nothing is running and nothing will be,
 * so the sentence says so rather than implying a dead terminal. */
export const Restored: Story = {
	render: () => (
		<Frame
			surfaces={[
				surface({
					surface: "con:1:7f3a",
					running: false,
					exit_code: null,
					live: false,
				}),
			]}
		/>
	),
};

/** Secure input: the surface still paints, nothing is recorded, and an agent's
 * read is refused with `secure_input_active` (§11.4). */
export const Secure: Story = {
	render: () => (
		<Frame surfaces={[surface({ surface: "con:1:7f3a", secure: true })]} />
	),
};

/** The blip, fresh: the surface's row pulses in the accent because something
 * finished and nobody has looked at it (§12.2). */
export const BlipPulsing: Story = {
	render: () => (
		<Frame
			surfaces={[surface({ surface: "con:1:7f3a" })]}
			unseen={["con:1:7f3a"]}
		/>
	),
};

/** The same mark after its pulse: the dot rests in `inkMuted`, which is the other
 * of §12.2's two states. */
export const BlipResting: Story = {
	// The mark is AGED past the pulse window rather than styled differently: the two
	// states are a function of the clock, so a story that picked a colour by hand
	// would not be evidence about the rule.
	render: () => (
		<Frame
			surfaces={[surface({ surface: "con:1:7f3a" })]}
			unseen={["con:1:7f3a"]}
			unseenAgeMs={60_000}
		/>
	),
};

/** A second conversation's mark must not appear on this pane's rows, which is the
 * filter the header's dot depends on too. */
export const OtherConversationMark: Story = {
	render: () => (
		<Frame
			surfaces={[surface({ surface: "con:1:7f3a" })]}
			unseen={["con:9:2222"]}
			unseenSession={OTHER_CONVERSATION}
		/>
	),
};
