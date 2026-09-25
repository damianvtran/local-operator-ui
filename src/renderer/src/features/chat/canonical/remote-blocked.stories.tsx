/**
 * A conversation that lives on another device and cannot be opened from here: the
 * one arm of `CanonicalTranscript` that no frame has ever shown (design round 3,
 * D23).
 *
 * WHY IT EXISTS. The arm's copy changed twice across this PR's rounds - once for
 * the review that found a JSX comment painting its own reasoning, once for the
 * finding that "or bring it here" names a route this window does not offer - and
 * neither change had a pixel behind it. No story file referenced `remoteBlocked`,
 * and the three story entries the sidebar/picker/network frames come from never
 * render the transcript pane, so the rounds were grading prose. This file is the
 * missing half: the production component, with `remoteBlocked` set exactly as the
 * hook sets it.
 *
 * THE TWO STATES ARE THE TWO PRODUCERS, and they are the two branches of the
 * pane's own logic: a refusal that carried the backend's sentence (the live
 * `PeerSessionUnreachable` 409) and one that carried none (the hook's empty string,
 * which draws only the pane's line - the duplicate-caption case D24 removed).
 *
 * WHAT THESE FRAMES ARE FOR: read the pair. Line 1 is the pane's statement, line 2
 * is the backend's ("`<id>` is on `<device>`, which is unreachable (`<reason>`)"),
 * and together they must read as one instruction rather than a promise followed by
 * a refusal - which is exactly what the round-3 finding said they did.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant, so both frames are byte-reproducible. */
const TS = 1_760_000_000_000;

type Entry = DesktopHistoryPage["entries"][number];

/**
 * The cached rows a reader sees while the conversation is refused: two turns, so
 * the notice is judged against the pane it interrupts rather than against an empty
 * column.
 */
const PAGE: Entry[] = [
	{
		id: "u1",
		ts: TS,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			content: [{ text: "Roll the standby host forward to 0.30.31." }],
		},
	},
	{
		id: "a1",
		ts: TS + 1_000,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			content: [
				{
					text: "Rolled forward on `damians-mac-studio`: the service restarted clean and the health check is green.",
				},
			],
			stop_reason: "stop",
		},
	},
];

function transcriptOf(entries: Entry[]): TranscriptState {
	const page: DesktopHistoryPage = { entries, has_more: false, cursor: null };
	return applyHistoryPage(EMPTY_TRANSCRIPT, page);
}

/**
 * The backend's sentence verbatim, as `PeerSessionUnreachable` composes it: the
 * device, the reason in the backend's own words, and the diagnosis command. The
 * copy above it is judged against THIS string, so it is written out rather than
 * paraphrased.
 */
const SENTENCE =
	"`6f708192a3b4` is on `damians-mac-studio-in-the-back-office-rack-2`, which is unreachable (no address of it answered). /network doctor `damians-mac-studio-in-the-back-office-rack-2` diagnoses the link.";

const Frame = ({ remoteBlocked }: { remoteBlocked: string }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="overflow-y-auto p-6"
			style={{ height: 620 }}
			ref={containerRef}
		>
			<CanonicalTranscript
				transcript={transcriptOf(PAGE)}
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
				remoteBlocked={remoteBlocked}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Canonical remote blocked",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The live producer: a refusal that carried the backend's own sentence. */
export const WithBackendSentence: Story = {
	render: () => <Frame remoteBlocked={SENTENCE} />,
	play: async () => {
		const arm = document.querySelector("[data-lo-session-remote]");
		if (!arm) throw new Error("the remote-blocked arm did not render");
		const text = arm.textContent ?? "";
		/*
		 * The pane's own line, asserted as ONE sentence rather than as a prefix: the
		 * finding was about what the second clause promises, and a prefix assertion
		 * would pass on the wording it replaced.
		 */
		if (
			!text.includes(
				"Open it there — this window can show it once that device answers.",
			)
		)
			throw new Error(`the pane line is not the shipped one: "${text}"`);
		/* And the backend's sentence is the one under it, not a stand-in. */
		if (!text.includes("is unreachable (no address of it answered)"))
			throw new Error(`the backend's sentence is missing: "${text}"`);
	},
};

/**
 * The producer with nothing to say: the hook's empty string. The pane's line must
 * appear ONCE - the round-3 finding was that a stand-in printed it a second time
 * with a different verb, so counting occurrences is the assertion, not reading it.
 */
export const WithoutBackendSentence: Story = {
	render: () => <Frame remoteBlocked="" />,
	play: async () => {
		const arm = document.querySelector("[data-lo-session-remote]");
		if (!arm) throw new Error("the remote-blocked arm did not render");
		const text = arm.textContent ?? "";
		const appearances =
			text.split("This conversation is on another device").length - 1;
		if (appearances !== 1)
			throw new Error(
				`the pane's line appears ${appearances} times with no backend sentence (D24)`,
			);
		if (text.includes("lives on another device"))
			throw new Error("the deleted stand-in sentence is still rendered");
	},
};
