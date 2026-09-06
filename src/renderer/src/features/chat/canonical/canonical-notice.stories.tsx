/**
 * Error notices in the canonical transcript, at the lengths the backend
 * actually produces.
 *
 * QA Q6: a notice shorter than the "long" threshold is rendered as a
 * `verbOverride` inside `TraceRow`'s `truncate` span with no disclosure to
 * open, so it was clipped to an ellipsis and the rest was reachable only
 * through devtools. The three actionable cold-start reasons land exactly in
 * that dead zone once the renderer prefixes "The message was not sent: "
 * (115-146 chars), and the clipped half is the INSTRUCTION rather than the
 * symptom.
 *
 * These stories render the production `CanonicalTranscript`, so they judge what
 * ships rather than a hand-built row. Read them at a narrow width too: the
 * point is that no width silently eats the second half of the sentence.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/** The exact sentences `launch._ACTIONABLE_STARTUP_REASONS` ships, prefixed as the renderer prefixes them. */
const PREFIX = "The message was not sent: ";

const REASONS = [
	// 128 chars rendered.
	"No model provider is configured yet. Connect one in Settings > Providers, then send the message again.",
	// 146 chars rendered — the longest, and the one that lost the most.
	"This session's model provider is not recognised. Choose a provider in Settings > Providers, then send the message again.",
	// 115 chars rendered.
	"No model is selected for this session. Pick one with /model, then send the message again.",
];

const notice = (
	id: string,
	text: string,
	level: "info" | "warning" | "error",
): TranscriptRecord => ({
	kind: "notice",
	id,
	ts: 1_760_000_000_000,
	text,
	level,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
	} as TranscriptState;
}

const Frame = ({ records }: { records: TranscriptRecord[] }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="h-[600px] overflow-y-auto p-6" ref={containerRef}>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				gate={null}
				waiting={false}
				loadingOlder={false}
				onLoadOlder={() => undefined}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				error={null}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Canonical notices",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The regression. Every one of these must be readable to its final word --
 * "then send the message again" is the actionable half.
 */
export const ActionableColdStartReasons: Story = {
	render: () => (
		<Frame
			records={REASONS.map((reason, index) =>
				notice(`reason-${index}`, PREFIX + reason, "error"),
			)}
		/>
	),
};

/** The boundary either side of the threshold, plus the cases that already worked. */
export const NoticeLengths: Story = {
	render: () => (
		<Frame
			records={[
				notice("short", "Session resumed.", "info"),
				notice("at-72", `${"x".repeat(64)} ends here`, "warning"),
				notice(
					"just-over",
					`${"y".repeat(70)} and then some more text`,
					"warning",
				),
				notice(
					"multiline",
					"Two lines of notice.\nThe second line must not be swallowed either.",
					"error",
				),
				notice("long", `${"z".repeat(400)} END`, "error"),
			]}
		/>
	),
};
