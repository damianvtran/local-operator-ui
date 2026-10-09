/**
 * The generating-image card, every state, and the affordance matrix.
 *
 * MOST STORIES RENDER THE PRODUCTION TRANSCRIPT from real `TranscriptRecord`s
 * (the convention `tool-row.stories.tsx` sets), so what is judged is what
 * ships: the detection predicate, the adapter and the row placement all run.
 * Two shapes deliberately mount `ImageGenCard` directly, and the reason is in
 * each story: the live-progress fields ARE frozen now (harness PR #2089) and
 * flow through the record's `details` carrier, but `progress_fraction` stays
 * `null` until a provider reports one - by the wire's own rule, never
 * synthesized - so the determinate-bar branch has no producer and a
 * hand-built view is the only place it renders; and the restart/steer slots,
 * which integration deliberately does not wire yet, are demonstrated with
 * stub handlers for the design round.
 *
 * WHAT TO LOOK FOR, since these frames are part of the review:
 *
 * - the card sits where the ledger row would have: same left edge, same row
 *   gap, `MessageContainer` around it;
 * - a queued card has NO generating tile (nothing is generating yet);
 * - the running tile's shimmer sweeps — one crossing per loop — and under
 *   reduced motion it parks as the BARE `sunken` well (the band off the
 *   tile), the state the `reduced-motion` cell in the evidence set
 *   photographs;
 * - a fraction-less card draws no bar: the sweep is the card's one
 *   indefinite element, and the determinate fill appears only when a
 *   fraction is carried (design round 1, D2);
 * - the done receipt is ONE line, with the picture under it through the
 *   existing image path (click to expand it, as any image in the transcript);
 * - a failed card IS the error sentence, verbatim: the frozen platform
 *   `error` is authored to be read as-is, so no sentence of this app's sits
 *   above it;
 * - and the controls are exactly the ones the story provided - a state the
 *   story did not wire renders nothing rather than a dead button.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import { ImageGenCard } from "./image-gen-card";
import type {
	ImageGenCardView,
	ImageGenProgress,
} from "./image-gen-card-model";
import type {
	TranscriptImage,
	TranscriptRecord,
	TranscriptState,
} from "./transcript-reducer";

const TS = 1_760_000_000_000;

/**
 * One generated picture, as INLINE base64 — the live wire shape
 * (`TranscriptImage.data`), which `useAttachmentUrl` turns into a `data:` URI
 * with no relay request, exactly as `tool-row.stories.tsx` fixtures its
 * screenshots. 240x160, 3:2, three flat bands: small enough for the literal to
 * stay in this file, flat enough to compress to a few hundred bytes.
 */
const PICTURE_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAABT0lEQVR42u3SMQ0AMAwEsfAMqEANhTLo1C4vS0ZwuupZiFESYGgwNBgaDI2hwdBgaDA0GBpDg6HB0GBoMDSGBkODocHQYGgMDYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GBkNjaDA0GBoMjaHB0GBoMDQYGkODocHQYGgwNIYGQ4OhwdBwHXqnIYahMTQYGgwNhsbQYGgwNBgaDI2hwdBgaDA0GBpDg6HB0GBoMDSGBkODocHQYGgMDYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GxtAqYGgwNBgaDI2hwdBgaDA0GBpDg6HB0PBh6NmGGIbG0GBoMDQYGkODocHQYGgwNIYGQ4OhwdBgaAwNhgZDg6HB0BgaDA2GBkODoTE0GBoMDYYGQ2NoMDQYGgwNhsbQYGgwNBgaQ6uAocHQYGgwNIYGQ4OhwdBgaAwNhgZDw3sH6cg2PBU6QNkAAAAASUVORK5CYII=";

const image = (id: string): TranscriptImage => ({
	id,
	data: PICTURE_B64,
	attachment: null,
	mimeType: "image/png",
});

type ToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

/** One `generate_image` call, in every state below. */
const genTool = (over: Partial<ToolRecord> & { id: string }): ToolRecord => ({
	kind: "tool",
	ts: TS,
	toolCallId: over.id,
	toolName: "generate_image",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: null,
	isError: false,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	durationS: null,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	details: null,
	...over,
});

/**
 * The canonical progress payload as the wire emits it (harness PR #2089):
 * EVERY key present on every frame, `null` where no producer supplied one - so
 * a fixture that omits a key is not a canonical shape. `over` supplies the
 * facts a given frame states.
 */
const canonical = (
	over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
	tool_name: "generate_image",
	stage: null,
	queue_position: null,
	progress_fraction: null,
	log_lines: null,
	error: null,
	error_type: null,
	...over,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

/**
 * The production transcript, sized to the rows it holds — the transcript pins
 * its content to the bottom, so a tall frame photographs the rows adrift in
 * empty ground (the reasoning `tool-row.stories.tsx`'s Frame carries).
 */
const Frame = ({
	records,
	height = 300,
	width = "100%",
	stopping = false,
	onInterruptTurn,
}: {
	records: TranscriptRecord[];
	height?: number;
	width?: string;
	stopping?: boolean;
	onInterruptTurn?: () => void;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="overflow-y-auto p-6"
			ref={containerRef}
			style={{ width, height }}
		>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				frontend={null}
				gate={null}
				waiting={false}
				starting={false}
				startingAfterId={null}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				failure={null}
				awaitingHydration={false}
				onReconnect={() => {}}
				stopping={stopping}
				onInterruptTurn={onInterruptTurn}
			/>
		</div>
	);
};

/** A frame for the direct mounts, at the transcript's own content width. */
const CardFrame = ({ children }: { children: ReactNode }) => (
	<div className="flex flex-col gap-6 p-6" style={{ width: 560 }}>
		{children}
	</div>
);

const noop = () => {};

/**
 * A hand-built running view for the branches the wire cannot produce: the
 * determinate bar (no provider reports a fraction - `progress_fraction` stays
 * `null`, deliberately) and the log tail's full range. THE FIXTURE IS THE
 * POINT: the adapter reads real canonical frames elsewhere in this file, and
 * these mounts exercise the view type's own branches directly. The clock is
 * anchored to NOW minus 12s so the state line reads its natural `12s`, not a
 * year of fixture skew: `Date.now()` runs once at module load, and the card's
 * own tick continues from there.
 */
const runningView = (progress: ImageGenProgress): ImageGenCardView => ({
	state: "running",
	startedAtMs: Date.now() - 12_000,
	progress,
});

const meta: Meta = {
	title: "Chat/Image generation",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Both halves of the wait before a call executes: being dictated, then queued. */
export const Queued: Story = {
	render: () => (
		<Frame
			height={220}
			records={[
				genTool({ id: "tool:q1", phase: "composing", argumentBytes: 2480 }),
				genTool({
					id: "tool:q2",
					phase: "queued",
					argumentBytes: 2480,
					details: canonical({ stage: "queued", queue_position: 2 }),
				}),
			]}
		/>
	),
};

/**
 * The running card, with and without a clock: the second row's call stated no
 * start, so the line keeps its words and drops the number rather than
 * inventing one. The first carries the canonical frame's `log_lines` - the
 * tail renders the LAST line, its one-line slot - while the second states
 * none and draws none.
 */
export const Running: Story = {
	render: () => (
		<Frame
			height={420}
			records={[
				genTool({
					id: "tool:r1",
					phase: "running",
					startedAt: Date.now() - 42_000,
					details: canonical({
						stage: "in_progress",
						log_lines: [
							{
								message: "provider: request accepted",
								timestamp: 1_760_000_000,
							},
							{
								message: "provider: rendering 1024x1024, step 14/28",
								timestamp: 1_760_000_006,
							},
						],
					}),
				}),
				genTool({ id: "tool:r2", phase: "running", startedAt: null }),
			]}
		/>
	),
};

/**
 * The progress branches, hand-built: no lines, a log tail, a known fraction
 * drawing the bar - the determinate fill is the bar's one mode (design round
 * 1, D2: a fraction-less card draws no bar; the tile's sweep is the surface's
 * one indefinite element) - and the queue position, which renders on the
 * QUEUED state, the wait it describes (a running line's one datum slot is the
 * clock, and its position slot is carried but not drawn). The wire carries
 * logs and positions now (the Running/Queued cells read them from canonical
 * frames); the FRACTION cell stays hand-built because `progress_fraction`
 * remains `null` until a provider reports one - the wire's own rule, never
 * synthesized. Mounted directly; see the file header.
 */
export const ProgressFields: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				view={runningView({ fraction: null, logs: [], queuePosition: null })}
				scope={null}
			/>
			<ImageGenCard
				view={runningView({
					fraction: null,
					logs: [
						"provider: request accepted",
						"provider: rendering 1024x1024, step 14/28",
					],
					queuePosition: null,
				})}
				scope={null}
			/>
			<ImageGenCard
				view={runningView({
					fraction: 0.42,
					logs: ["provider: rendering 1024x1024, step 12/28"],
					queuePosition: null,
				})}
				scope={null}
			/>
			<ImageGenCard
				view={{
					state: "queued",
					composing: false,
					argumentBytes: 1900,
					queuePosition: 2,
				}}
				scope={null}
			/>
		</CardFrame>
	),
};

/**
 * After Cancel, until the interrupt settles: the running call keeps its tile
 * while the work is still in flight (no bar — it carries no fraction; design
 * round 1, D2), the queued one grows neither — a call that never generated
 * must not wear the generating body (round-1 F3) — and the control is
 * drawn-but-held. `stopping` is the pane's own stop fact — the same one the
 * composer's Stop reads.
 */
export const Cancelling: Story = {
	render: () => (
		<Frame
			height={420}
			stopping={true}
			onInterruptTurn={noop}
			records={[
				genTool({
					id: "tool:c1",
					phase: "running",
					startedAt: Date.now() - 8_000,
					// The wire's own cancelling frame: the stage stated, every other key
					// null - the overlay's progress facts are all-absence by construction.
					details: canonical({ stage: "cancelling" }),
				}),
				genTool({ id: "tool:c2", phase: "queued", argumentBytes: 1900 }),
			]}
		/>
	),
};

/** The receipt and the artifact: one quiet line, then the picture(s). */
export const Done: Story = {
	render: () => (
		<Frame
			height={560}
			records={[
				genTool({
					id: "tool:d1",
					durationS: 8.6,
					images: [image("tool:d1:0")],
				}),
				genTool({
					id: "tool:d2",
					durationS: 12.4,
					images: [image("tool:d2:0"), image("tool:d2:1")],
				}),
			]}
		/>
	),
};

/**
 * The frozen failure shape in both arms, both verbatim: the platform's own
 * sentence for a failed generation (authored to be read as-is — no vendor
 * text is expected, and no sentence of this app's is layered over it), the
 * harness's verdict for a call that never reached a provider, and the
 * canonical settled failure a walked-out cascade returns - `error` +
 * `error_type` with NO `stage`, that shape's own signature (the wire's rule:
 * no canonical stage names a walk's failure).
 */
export const Failed: Story = {
	render: () => (
		<Frame
			height={460}
			records={[
				genTool({
					id: "tool:f1",
					isError: true,
					durationS: 1.2,
					output: "This generation failed before producing output.",
				}),
				genTool({
					id: "tool:f2",
					phase: "queued",
					notRunReason:
						"invalid arguments for generate_image: 'prompt' is required",
					notRunKind: "invalid_arguments",
					neverSent: true,
				}),
				genTool({
					id: "tool:f3",
					isError: true,
					durationS: 9.1,
					output: "Radient: out of credits · FAL: rate limited",
					details: canonical({
						error: "Radient: out of credits · FAL: rate limited",
						error_type: "insufficient_credits",
					}),
				}),
			]}
		/>
	),
};

/**
 * The MID-WALK failure: the wire's `stage: null` frame - a rung failed and the
 * walk continues - whose semantics ride the `error`/`error_type` pair ("the
 * pair the surfaces branch on", harness PR #2089). The card states the
 * failure's text verbatim in the failed presentation, and the next frame (the
 * next rung's `queued`, or the terminal result) replaces it. RECORDED, NOT
 * RULED: the design round reviewed the settled failure's copy, not this live
 * arm's.
 */
export const MidWalkFailure: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				genTool({
					id: "tool:m1",
					phase: "running",
					startedAt: Date.now() - 21_000,
					details: canonical({
						error: "out of credits",
						error_type: "insufficient_credits",
					}),
				}),
			]}
		/>
	),
};

/**
 * The conflict receipt: a cancel that lost its race with the finish comes back
 * as an error-shaped result whose `error_type` is `media_already_completed`
 * (the platform's sentence beside it) - a FINISH, never a failure - so the
 * card states "Already finished." and withholds the duration (that number
 * belongs to the receipt that watched the run). The record carries the
 * canonical pair exactly as the wire writes it.
 */
export const AlreadyFinished: Story = {
	render: () => (
		<Frame
			height={260}
			records={[
				genTool({
					id: "tool:a1",
					isError: true,
					output: "not cancelled — it had already completed",
					details: canonical({
						stage: "cancelled",
						error:
							"The generation had already completed when the cancel arrived; its result was discarded.",
						error_type: "media_already_completed",
					}),
				}),
			]}
		/>
	),
};

/** A stop mid-run and a steering skip: terminal, no image, restart is the way back. */
export const Cancelled: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				genTool({ id: "tool:x1", stopped: true, durationS: 3.4 }),
				genTool({
					id: "tool:x2",
					phase: "queued",
					notRunReason: "steering redirected before the call ran",
					notRunKind: "skipped",
					neverSent: true,
				}),
			]}
		/>
	),
};

/**
 * The affordance matrix, mounted directly because the restart/steer slots are
 * intentionally unwired in the product: integration provides Cancel alone
 * (the transcript stories above show it), and these stubs exist so the design
 * round can review the affordances before the named op lands.
 *
 * Reading order: cancel only, then everything provided — which still draws
 * only what each state can act on — then nothing provided, which draws
 * nothing. An absent handler is an absent control, never a dead button.
 */
export const Affordances: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				view={runningView({ fraction: null, logs: [], queuePosition: null })}
				scope={null}
				actions={{ onCancel: noop }}
			/>
			<ImageGenCard
				view={{
					state: "failed",
					message: "This generation failed before producing output.",
					errorType: null,
				}}
				scope={null}
				actions={{ onCancel: noop, onRestart: noop, onEditRestart: noop }}
			/>
			{/* The frozen `media_already_completed` receipt (a cancel that lost its
			 * race with the finish): the record-driven shape has its own story now
			 * (`AlreadyFinished`); this direct mount stays for the matrix's reading
			 * order — it must read as a finish, never an error, and the adapter's
			 * done state owns it either way. */}
			<ImageGenCard
				view={{
					state: "done",
					images: [],
					durationS: null,
					receipt: "already-finished",
				}}
				scope={null}
			/>
			<ImageGenCard
				view={{ state: "cancelled" }}
				scope={null}
				actions={{ onCancel: noop, onRestart: noop, onEditRestart: noop }}
			/>
			<ImageGenCard view={{ state: "cancelled" }} scope={null} />
		</CardFrame>
	),
};
