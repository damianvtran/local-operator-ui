/**
 * Aida's first-run greeting as her conversation opens on it (first-run
 * onboarding, A4/U1).
 *
 * WHAT THIS PHOTOGRAPHS. Setup's "Meet <name>" arms a wake whose prompt is a
 * factual line addressed to HER (`[first-run] surface=desktop; ...`), and the
 * backend marks that delivery `details.hidden: true`. The operator's rule is
 * that her conversation opens on her own message - so the trigger may paint
 * neither a wake receipt nor a user row. Both stories feed the SAME history
 * page through the real reducer and the real transcript; the only difference
 * is the marker, so the pair shows exactly what `wakeIsHidden` removes.
 *
 * The rows are the wire's own shape (`custom` / `wake_prompt` /
 * `attribution: "user"`), the one `scripts/transcript-reducer.test.mjs` pins.
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

type Entry = DesktopHistoryPage["entries"][number];

/** A fixed instant, so the row's timestamp is the same pixels on every capture. */
const BASE_TS = Date.UTC(2026, 9, 8, 9, 0, 0) / 1000;

const trigger = (hidden: boolean) => ({
	kind: "custom",
	custom_type: "wake_prompt",
	attribution: "user",
	details: {
		wake_id: "aida-greeting",
		...(hidden ? { hidden: true } : {}),
		text: "[first-run] surface=desktop; signed_in_with=radient; identity=Jane Doe <jane@example.com>",
	},
});

const GREETING =
	"Hi Jane, I'm Aida, your chief of staff. I'll keep track of what you're working on, nudge you when something needs you, and set up agents for the jobs you'd rather not do yourself.\n\nYou're signed in with Radient as jane@example.com, so I already have your name and email. Is Jane what you'd like me to call you? And what's one thing on your plate this week I could help with?";

const page = (hidden: boolean): DesktopHistoryPage => ({
	entries: [
		{
			id: "wake-greeting",
			ts: BASE_TS,
			type: "message",
			payload: trigger(hidden),
		} as unknown as Entry,
		{
			id: "aida-hello",
			ts: BASE_TS + 4,
			type: "message",
			payload: {
				role: "assistant",
				content: [{ type: "text", text: GREETING }],
			},
		} as unknown as Entry,
	],
	has_more: false,
	cursor_missing: false,
});

const Frame = ({ transcript }: { transcript: TranscriptState }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex h-screen flex-col bg-canvas p-6">
			<div className="flex min-h-0 flex-1 flex-col" ref={containerRef}>
				<CanonicalTranscript
					transcript={transcript}
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
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Hidden greeting",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** The shipped case: the trigger is hidden, and her message is the first row. */
export const HiddenTrigger: Story = {
	render: () => (
		<Frame transcript={applyHistoryPage(EMPTY_TRANSCRIPT, page(true))} />
	),
};

/**
 * The same page without the marker: the receipt a wake has always painted.
 * This is what an older backend (no `hidden`) still shows, and what the
 * marker exists to remove.
 */
export const UnmarkedTrigger: Story = {
	render: () => (
		<Frame transcript={applyHistoryPage(EMPTY_TRANSCRIPT, page(false))} />
	),
};
