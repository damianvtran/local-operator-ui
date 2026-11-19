import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { renderSkillBlock } from "../components/skill-invocation";
import "../components/story-electron-shim";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/*
 * `$skill` tokens in a sent turn, on the production transcript.
 *
 * WHAT THE FRAMES ARE FOR. The claim is visual - a skill the turn invoked reads as
 * a different colour AND a heavier weight than the prose around it, from the
 * `tokenCommand` role - and a green DOM test cannot carry a colour. The same story
 * is captured on `origin/main` (no ink) and on the branch, in a light, a dark and
 * the monochrome palette, so each pair differs only by the change
 * (`docs/pr-evidence/skill-token-ink/README.md`).
 *
 * THE FIXTURE IS THE WIRE SHAPE, not a hand-painted row: the user text is the
 * typed line, then the `<operator-skills>` block `renderSkillBlock` writes, so
 * the row is read through `displayTextOf` exactly as a persisted turn is and the
 * block cannot drift from what the composer sends.
 */

const TS = 1_760_000_000_000;

const BODY = (name: string) =>
	`# ${name}\n\nFollow this skill for the request above.`;

/** The payload the host stores: the typed line, a blank line, the block. */
const invoked = (typed: string, names: string[]) =>
	`${typed}\n\n${renderSkillBlock(names.map((name) => ({ name, body: BODY(name) })))}`;

const user = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1,
	text,
	streaming: false,
	stopReason: "stop",
	error: false,
	complete: true,
});

const tool = (id: string): TranscriptRecord => ({
	kind: "tool",
	id,
	ts: TS + 2,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "rg --files docs | head" },
	phase: "done",
	argumentBytes: 24,
	output: "docs/branding.md\ndocs/hooks.md\n",
	isError: false,
	durationS: 0.3,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	neverSent: false,
	notRunReason: null,
	notRunKind: null,
});

/**
 * The reported shape plus its traps, one per row:
 *  - row 1: two skills, money, an escaped `\$`, and a code span, in one line;
 *  - row 2: a fenced block beside prose, both holding `$research`;
 *  - row 3: money only, no skill attached - nothing may ink.
 */
const RECORDS: TranscriptRecord[] = [
	user(
		"u1",
		invoked(
			"use $research then $code-review to check $5 and \\$escaped, and run `$research` in code",
			["research", "code-review"],
		),
	),
	tool("t1"),
	assistant(
		"a1",
		"Reviewed it. The agent's own `$research` and $code-review mentions are plain prose.",
	),
	user(
		"u2",
		invoked(
			"ask $research about this:\n\n```\n$research --help\n```\n\nand then summarise.",
			["research"],
		),
	),
	assistant("a2", "Done."),
	user("u3", "the plan costs $5 a month, or $1,200.50 a year, plus $PATH"),
];

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	} as TranscriptState;
}

const Frame = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="flex flex-col bg-canvas"
			style={{ width: 760, height: 960 }}
		>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(RECORDS)}
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
					conversationId="story"
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Canonical skill token ink",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * `loaders` run before the first render, so the transcript reads the mode it is
 * photographed in rather than flipping after paint. The store is `persist`ed, and
 * the story states its mode every time so a neighbour's choice cannot leak in.
 */
const inMode = (mode: "by-turn" | "by-response") => async () => {
	useUiPreferencesStore.setState({ transcriptDisplayMode: mode });
	return {};
};

export const ByTurn: Story = {
	loaders: [inMode("by-turn")],
	render: () => <Frame />,
};

export const ByResponse: Story = {
	loaders: [inMode("by-response")],
	render: () => <Frame />,
};
