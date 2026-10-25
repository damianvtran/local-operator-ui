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

import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { CHAT_COLUMN_CONTAINER, CHAT_MEASURE } from "../chat-measure";
import { useInterruptOnEscape } from "../hooks/use-interrupt-on-escape";
import { useSoundStopGate } from "./sound-stop-confirmation";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import { ImageGenCard } from "./image-gen-card";
import { imageGenCardView } from "./image-gen-card-model";
import type {
	ImageGenCardView,
	ImageGenMaterial,
	ImageGenProgress,
} from "./image-gen-card-model";
import { EMPTY_TRANSCRIPT, applyHistoryPage } from "./transcript-reducer";
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
	attachmentScope,
}: {
	records: TranscriptRecord[];
	height?: number;
	width?: string;
	stopping?: boolean;
	onInterruptTurn?: () => void;
	/**
	 * The conversation scope digest-backed refs resolve through, when a story
	 * carries one (the video player states do; every other story's refs are
	 * inline or absent, and `null` is the transcript's own default).
	 */
	attachmentScope?: { sessionId: string; childId: string | null } | null;
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
				attachmentScope={attachmentScope}
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
const runningView = (
	progress: ImageGenProgress,
	/** The material noun the line names; image unless a story says otherwise. */
	material: ImageGenMaterial = "image",
	/** A batch's live count/note, for the many-sounds stories. */
	batchProgress?: { total: number; note: string | null },
): ImageGenCardView => ({
	state: "running",
	material,
	startedAtMs: Date.now() - 12_000,
	progress,
	...(batchProgress ? { batchProgress } : {}),
	// The interim's account slot: the `MidWalkFailure` story below carries the
	// live note through the real record path; these mounts exercise the
	// progress slots, where no frame states one.
	note: null,
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
					material: "image",
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
 * The frozen failure shape in all three arms, verbatim: the platform's own
 * sentence for a failed generation (authored to be read as-is — no vendor
 * text is expected, and no sentence of this app's is layered over it), the
 * harness's verdict for a call that never reached a provider, and the
 * canonical settled failure a walked-out cascade returns - `error` +
 * `error_type` with NO `stage`, that shape's own signature (the wire's rule:
 * no canonical stage names a walk's failure).
 *
 * ONE FRAME PER ARM, deliberately (design round 1, D3): three consecutive tool
 * records in one frame trip the transcript's aggregation, so the default frame
 * rendered the fold (`› 3 generate_image`) with none of the arms' text visible
 * until a press; split, every arm renders by default, which is what this cell
 * exists to show.
 */
export const Failed: Story = {
	render: () => (
		<div className="flex flex-col gap-4">
			<Frame
				height={140}
				records={[
					genTool({
						id: "tool:f1",
						isError: true,
						durationS: 1.2,
						output: "This generation failed before producing output.",
					}),
				]}
			/>
			<Frame
				height={140}
				records={[
					genTool({
						id: "tool:f2",
						phase: "queued",
						notRunReason:
							"invalid arguments for generate_image: 'prompt' is required",
						notRunKind: "invalid_arguments",
						neverSent: true,
					}),
				]}
			/>
			<Frame
				height={140}
				records={[
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
		</div>
	),
};

/**
 * The MID-WALK failure: the wire's `stage: null` frame - a rung failed and the
 * walk continues - whose semantics ride the `error`/`error_type` pair ("the
 * pair the surfaces branch on", harness PR #2089). RULED by design round 1
 * (D1): the call keeps its LIVE presentation (tile, state line, clock,
 * Cancel) and the pair's sentence rides as the interim's note under the body,
 * verbatim; the next frame (the next rung's `queued`, or the terminal result)
 * replaces the note with no state-level change and no control flicker - a
 * note, never a failure latch.
 */
export const MidWalkFailure: Story = {
	render: () => (
		<Frame
			// 360, not 300: the interim note line and the Cancel row both sit under
			// the tile at this width, and the shorter frame cropped the control
			// (measured on the first recapture of this cell).
			height={360}
			// The acceptance (design round 1, D1) names Cancel as part of the live
			// presentation this cell must show, so the story wires the interrupt
			// the way integration does (the composer's own Stop path).
			onInterruptTurn={noop}
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
					material: "image",
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
					material: "image",
					durationS: null,
					receipt: "already-finished",
				}}
				scope={null}
			/>
			{/*
			 * Two settled stops, side by side, because the security round (2026-10-17)
			 * made them DIFFERENT sentences: a queued stop may claim no charge, and an
			 * in-flight one may only say the request was made and settlement is being
			 * checked. `message` is null in both: these frames show the fallbacks, and
			 * a record that states the tool's own detail prefers that instead.
			 */}
			<ImageGenCard
				view={{ state: "cancelled", generating: false, message: null }}
				scope={null}
				actions={{ onCancel: noop, onRestart: noop, onEditRestart: noop }}
			/>
			<ImageGenCard
				view={{ state: "cancelled", generating: true, message: null }}
				scope={null}
			/>
		</CardFrame>
	),
};

/*
 * ---------------------------------------------------------------------------
 * THE VIDEO STORIES (the video phase's desktop card, V2/V3/V4).
 *
 * The card rides its whole six-state machine unchanged; these frames are the
 * video variants a design round reads beside the image set, plus the three
 * player states the digest-fed seam adds. What each frame is here to show:
 *
 * - `VideoRunning` wires `onInterruptTurn` and mounts an IMAGE call beside the
 *   video one: the image card draws Cancel, the video card draws NOTHING —
 *   the mount withholds the handler (R4, contract §4.2: an in-turn press
 *   cannot cancel a detached job; its rail is the run-details Jobs row). The
 *   affirmative is the point of the pair, not the absence alone.
 * - `VideoDone` carries both arms of completion: a row with the artifact
 *   (through the player, over the real relay seam — the bytes are answered by
 *   `installVideoRelay`, the story-level stub whose sibling stubs the child
 *   image relay, so what is proven is the RENDERER's half: the digest, the op,
 *   the mime and the painted player) and a row WITHOUT one (the receipt-only
 *   floor, which must render whether or not the bytes ever arrive).
 * - `VideoPlayerResolving` holds the fetch open so the reserved box is a
 *   state rather than a race; `VideoPlayerMissing` answers 404 so the receipt
 *   copy (`could not be played. Its stored copy is not available to this
 *   reader.`) is the other state a still can carry. The two mount the same
 *   row and differ only in the relay's answer.
 */

/** One `generate_video` call, in every state below. */
const videoTool = (over: Partial<ToolRecord> & { id: string }): ToolRecord =>
	genTool({ ...over, toolName: "generate_video" });

/**
 * A real, tiny MP4 — 160x120, 1.0 s, 6 frames, H.264, 1716 bytes — encoded
 * once with AVFoundation and spelled as a literal because it has to live in
 * this file (the PICTURE_B64 precedent: the story imports no asset loader for
 * video). Small enough that the literal costs a couple of kilobytes.
 */
const TINY_MP4_B64 =
	"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";

const TINY_MP4_BYTES = Uint8Array.from(atob(TINY_MP4_B64), (character) =>
	character.charCodeAt(0),
);

/** The one digest the video relay answers, as a durable artifact carries it. */
const VIDEO_DIGEST = "a1b2c3d4e5f6071829a4b5c6d7e8f901";

/** A video artifact as the durable transcript carries it: digest, no bytes. */
const VIDEO_REF: TranscriptImage = {
	id: "tool:vd1:0",
	data: null,
	attachment: VIDEO_DIGEST,
	mimeType: "video/mp4",
	kind: "video",
	durationS: 6.5,
	width: 160,
	height: 120,
};

/**
 * Answer the card's digest fetch out of the story, the `installChildImageRelay`
 * pattern one canonical section over: a Storybook frame has no backend, so a
 * durable digest can only ever render the unavailable note unless the renderer's
 * own seam — `desktopMedia` — is answered. The three modes are the three player
 * states a still can carry: `bytes` (the player paints), `pending` (the fetch
 * never lands, so the reserved box holds) and `missing` (a 404, so the receipt
 * paints). ONLY the fixture's digest and the parent-scoped op are answered;
 * anything else gets a 404, so a scope or op regression shows up as the
 * unavailable note in the frame rather than as a player borrowed from a stub
 * that answered everything.
 *
 * Installed during the decorator's RENDER rather than in an effect, and that is
 * load-bearing: React runs a child's effects before its parent's, so an effect
 * here would land after the reader's own fetch had already gone out. Each
 * captured frame is a fresh document, so the stub does not outlive it.
 */
const installVideoRelay = (mode: "bytes" | "pending" | "missing") => {
	const answer = () => {
		if (mode === "pending") return new Promise(() => {});
		if (mode === "missing")
			return Promise.resolve({
				status: 404,
				kind: "error",
				detail: "Not in this story.",
			});
		return Promise.resolve({
			status: 200,
			kind: "bytes",
			mimeType: "video/mp4",
			data: TINY_MP4_BYTES,
		});
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; digest?: string }) =>
			request.op === "sessions.attachment" && request.digest === VIDEO_DIGEST
				? answer()
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};

/**
 * Hold the shutter until the player is really playing: the same protocol as
 * `useWaitForPaintedImage` one element over — a blob-backed `<video>` that has
 * decoded at least its first frame (`readyState >= HAVE_CURRENT_DATA`), not
 * merely mounted.
 */
const useWaitForPaintedVideo = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const poll = window.setInterval(() => {
			const video = [
				...document.querySelectorAll<HTMLVideoElement>("video"),
			].find((element) => element.src.startsWith("blob:"));
			if (!video || video.readyState < 2) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
};

/** Both halves of the wait before a video call executes. */
export const VideoQueued: Story = {
	render: () => (
		<Frame
			height={220}
			records={[
				videoTool({ id: "tool:vq1", phase: "composing", argumentBytes: 3120 }),
				videoTool({
					id: "tool:vq2",
					phase: "queued",
					argumentBytes: 3120,
					details: canonical({
						tool_name: "generate_video",
						stage: "queued",
						queue_position: 1,
					}),
				}),
			]}
		/>
	),
};

/**
 * The running video card beside a running image card, both mounts offered the
 * pane's interrupt: the image row draws its Cancel, the video row draws
 * nothing. That pair IS the R4 affirmative (see the section note).
 */
export const VideoRunning: Story = {
	render: () => (
		<Frame
			height={540}
			onInterruptTurn={noop}
			records={[
				videoTool({
					id: "tool:vr1",
					phase: "running",
					startedAt: Date.now() - 42_000,
					details: canonical({
						tool_name: "generate_video",
						stage: "in_progress",
						log_lines: [
							{
								message: "provider: encoding segment 4/8",
								timestamp: 1_760_000_006,
							},
						],
					}),
				}),
				genTool({
					id: "tool:vr2",
					phase: "running",
					startedAt: Date.now() - 20_000,
				}),
			]}
		/>
	),
};

/** The stop in flight: the line swaps to `Cancelling…` and no control exists. */
export const VideoCancelling: Story = {
	render: () => (
		<Frame
			height={300}
			stopping={true}
			onInterruptTurn={noop}
			records={[
				videoTool({
					id: "tool:vc1",
					phase: "running",
					startedAt: Date.now() - 12_000,
				}),
			]}
		/>
	),
};

/**
 * The completion pair: the artifact through the player (real bytes over the
 * stubbed relay seam) and the receipt-only floor with no artifact at all.
 */
export const VideoDone: Story = {
	render: () => (
		<Frame
			height={480}
			attachmentScope={{ sessionId: "video-story", childId: null }}
			records={[
				videoTool({
					id: "tool:vd1",
					phase: "done",
					durationS: 6.5,
					images: [VIDEO_REF],
				}),
				videoTool({ id: "tool:vd2", phase: "done", durationS: 8 }),
			]}
		/>
	),
	decorators: [
		(Story) => {
			installVideoRelay("bytes");
			useWaitForPaintedVideo();
			return <Story />;
		},
	],
};

/** The bytes are on their way: the reserved box holds the slot, no spinner. */
export const VideoPlayerResolving: Story = {
	render: () => (
		<Frame
			height={300}
			attachmentScope={{ sessionId: "video-story", childId: null }}
			records={[
				videoTool({
					id: "tool:vpr",
					phase: "done",
					durationS: 6.5,
					images: [VIDEO_REF],
				}),
			]}
		/>
	),
	decorators: [
		(Story) => {
			installVideoRelay("pending");
			return <Story />;
		},
	],
};

/** The bytes never arrive: the receipt copy, in the player's own verb. */
export const VideoPlayerMissing: Story = {
	render: () => (
		<Frame
			height={300}
			attachmentScope={{ sessionId: "video-story", childId: null }}
			records={[
				videoTool({
					id: "tool:vpm",
					phase: "done",
					durationS: 6.5,
					images: [VIDEO_REF],
				}),
			]}
		/>
	),
	decorators: [
		(Story) => {
			installVideoRelay("missing");
			return <Story />;
		},
	],
};

/** The provider's absence sentence for a video call (V4's fallback). */
export const VideoFailed: Story = {
	render: () => (
		<Frame
			height={220}
			records={[videoTool({ id: "tool:vf1", isError: true, output: null })]}
		/>
	),
};

/** A stop mid-run: terminal, no artifact, the receipt line only. */
export const VideoCancelled: Story = {
	render: () => (
		<Frame
			height={220}
			records={[videoTool({ id: "tool:vx1", stopped: true, durationS: 3.4 })]}
		/>
	),
};

/** The cancel conflict, material-free words: `Already finished.` */
export const VideoConflict: Story = {
	render: () => (
		<Frame
			height={220}
			records={[
				videoTool({
					id: "tool:vcf",
					isError: true,
					output: "not cancelled — it had already completed",
					details: canonical({
						tool_name: "generate_video",
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

/** The production stop control, with its pre-action warning. This is a
 * presentation/interaction fixture, not a provider cancellation receipt. */
export const SoundStopWarning: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				view={runningView(
					{ fraction: null, logs: [], queuePosition: null },
					"voiceover",
				)}
				scope={null}
				actions={{ onCancel: noop }}
			/>
		</CardFrame>
	),
};

/*
 * THE SOUND LOADER'S FOUR STATES (operator requirement, 2026-10-23). A sound
 * generation waits on a WAVEFORM made of the player's own bars, not the image
 * card's 3:2 rectangle. The states differ by construction: queued is at rest at
 * disabled ink, running pulses (one indefinite element), failed collapses to
 * the base line, stopped rests at muted ink with the honest billing sentence
 * under the line. None of them draws a fraction: no vendor exposes one.
 */
export const SoundLoaderQueued: Story = {
	name: "Sound loader / queued",
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound-q",
						toolName: "generate_sound_effect",
						phase: "queued",
					}),
				)}
			/>
		</CardFrame>
	),
};

export const SoundLoaderRunning: Story = {
	name: "Sound loader / running",
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={runningView(
					{ fraction: null, logs: [], queuePosition: null },
					"voiceover",
				)}
			/>
		</CardFrame>
	),
};

/** A fourteen-item batch: the card names the latest item, never a completion
 * count it cannot know; the loader stays indeterminate. */
export const SoundLoaderBatch: Story = {
	name: "Sound loader / batch of 14",
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={runningView(
					{ fraction: null, logs: [], queuePosition: null },
					"sound-effect",
					{
						total: 14,
						note: "Latest update: Storm swell 3 (item 3 of 14).",
					},
				)}
			/>
		</CardFrame>
	),
};

export const SoundLoaderFailed: Story = {
	name: "Sound loader / failed",
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound-f",
						toolName: "generate_sound_effect",
						isError: true,
						output: "The sound effect could not be generated.",
						details: canonical({
							stage: "failed",
							error: "The sound effect could not be generated.",
						}),
					}),
				)}
			/>
		</CardFrame>
	),
};

export const SoundLoaderStopped: Story = {
	name: "Sound loader / stopped, may be billed",
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={{
					state: "cancelled",
					material: "sound-effect",
					generating: true,
					message: "Stopped by the operator.",
				}}
			/>
		</CardFrame>
	),
};

/** Receipt-only replays: real caption fields, no fabricated player/artifact. */
export const SoundReceipts: Story = {
	render: () => (
		<CardFrame>
			<p className="text-meta text-ink-muted">Voiceover receipt</p>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound",
						toolName: "generate_voiceover",
						output: "Generated voiceover. Cost $0.002 (billed).",
					}),
				)}
			/>
			<p className="text-meta text-ink-muted">BYOK sound-effect receipt</p>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound",
						toolName: "generate_sound_effect",
						details: { cost_usd: 0.001, billing_basis: "estimated" },
					}),
				)}
			/>
		</CardFrame>
	),
};

/** Contract fixture from harness #2588, 5e684700: explicit forwarded unknowns.
 * This is not a claim of a fresh provider cancellation or integrated capture. */
export const SoundPendingSettlement: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound",
						toolName: "generate_voiceover",
						stopped: true,
						startedAt: TS,
						output: "Stop requested. Checking for settlement.",
						details: {
							stage: "cancelled",
							settling: true,
							vendor_stopped: false,
							settled: null,
							cost_usd: null,
							cost: {
								v: 1,
								amount_usd: 0.0216,
								basis: "quote",
								units: 540,
								unit: "char",
								unit_price_usd: 4e-5,
								provider: "radient",
								model: "radient/voiceover-flash",
								tool_type: "speech_generation",
								usage_record_id: "fixture-audio-usage",
								price_version: "audio-rates@2026-10-17",
							},
							cancellation: {
								requested: true,
								vendor_stopped: false,
								reason: "provider_has_no_cancel_api",
								detail:
									"The provider has no cancellation endpoint. The generation continues and will be charged if it produces audio.",
							},
							note: "Cancellation is best-effort: the request settles at its terminal outcome. A completed generation is charged normally.",
						},
					}),
				)}
			/>
		</CardFrame>
	),
};

export const SoundSettledCancellation: Story = {
	render: () => (
		<Frame
			records={[
				genTool({
					id: "story-sound",
					toolName: "generate_voiceover",
					stopped: true,
					startedAt: TS,
					output: "Stop requested. Checking for settlement.",
				}),
				...applyHistoryPage(EMPTY_TRANSCRIPT, {
					entries: [
						{
							id: "sound-settlement",
							ts: TS / 1000 + 2,
							type: "message",
							payload: {
								kind: "custom",
								custom_type: "audio_settle_v1",
								details: {
									version: 1,
									tool: "generate_voiceover",
									request_id: "story-audio-request",
									status: "completed",
									terminal: true,
									settlement_observed: true,
									cost_usd: 0.0021,
									billing_basis: "billed",
									recorded: true,
									detail: "",
								},
							},
						},
					],
					has_more: false,
					cursor_missing: false,
				}).records,
			]}
			height={240}
		/>
	),
};

export const SoundPlanningRefusal: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-sound",
						toolName: "generate_sound_effect",
						notRunKind: "invalid_arguments",
						notRunReason:
							'{"code":"audio_rejected","error":"This audio request could not be accepted."}',
					}),
				)}
			/>
		</CardFrame>
	),
};

const PaneStopFixture = () => {
	const restore = useCallback(
		() =>
			document
				.querySelector<HTMLTextAreaElement>("[data-story-sound-composer]")
				?.focus(),
		[],
	);
	const { paneRef, stop, confirmation } = useSoundStopGate({
		sessionId: "story-sound-pane",
		runningSound: true,
		available: true,
		onInterrupt: noop,
		onRestoreFocus: restore,
	});
	useInterruptOnEscape({
		sessionId: "story-sound-pane",
		turnAlive: true,
		available: true,
		onInterrupt: stop,
	});
	return (
		<div
			ref={paneRef}
			data-chat-pane=""
			/*
			 * The column the composer's measure resolves against. Production names
			 * it once, on the element that owns the column's width; without it the
			 * band's `CHAT_MEASURE` rows would resolve against the viewport and the
			 * fixture would be a composition the app never paints.
			 */
			className={cn(CHAT_COLUMN_CONTAINER, "flex h-full min-h-0 flex-col")}
		>
			<div className="min-h-0 flex-1">
				{/*
				 * THE TRANSCRIPT SIDE OF THE SAME COLUMN: the card sits on the
				 * composer's measure, so the fixture's two halves share one left
				 * edge exactly as the transcript and composer do in production.
				 */}
				<div className={CHAT_MEASURE}>
					<CardFrame>
						<ImageGenCard
							scope={null}
							view={runningView(
								{ fraction: null, logs: [], queuePosition: null },
								"voiceover",
							)}
							actions={{ onCancel: noop }}
						/>
					</CardFrame>
				</div>
			</div>
			{/*
			 * PRODUCTION ORDER, MIRRORED (design D6, UX U7): the question is a row of
			 * the composer's BAND, the last row before the box, exactly where
			 * `MessageInput` mounts it - not between the transcript and a bare
			 * textarea, and never above the transcript. The composer yields no
			 * layout in the fixture; the band wrapper carries the same padding steps
			 * the composer's own rows use, so the measured composition is the one
			 * production paints.
			 */}
			<div className="w-full shrink-0 p-2">
				{confirmation ? (
					<div className={cn(CHAT_MEASURE, "px-4 pb-2")}>{confirmation}</div>
				) : null}
				<div className={cn(CHAT_MEASURE, "relative flex items-end gap-2")}>
					<textarea
						data-story-sound-composer=""
						aria-label="Message"
						className="min-w-0 flex-1 border border-control bg-surface text-ink"
					/>
					<Button variant="secondary" size="sm" onClick={stop}>
						Pane stop
					</Button>
				</div>
			</div>
		</div>
	);
};

/** Uses the same admission and Escape hooks as SessionPanel, with no RPC. */
export const SoundPaneStopWarning: Story = {
	render: () => <PaneStopFixture />,
};

export const SoundVoiceoverReceipt: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-voiceover-receipt",
						toolName: "generate_voiceover",
						output: "Generated voiceover. Cost $0.002 (billed).",
					}),
				)}
			/>
		</CardFrame>
	),
};
export const SoundByokReceipt: Story = {
	render: () => (
		<CardFrame>
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "story-byok-receipt",
						toolName: "generate_sound_effect",
						details: { cost_usd: 0.001, billing_basis: "estimated" },
					}),
				)}
			/>
		</CardFrame>
	),
};

/**
 * Contract-only batch fixtures while the harness PR is in flight. The silent
 * PCM bytes are valid audio (so the real player can decode and seek) but cannot
 * put generated sound in the operator's room. No provider/live billing proof.
 */
function batchSoundFixture(count: number, failed = -1) {
	const samples = 24_000;
	const buffer = new ArrayBuffer(44 + samples * 2);
	const view = new DataView(buffer);
	const word = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++)
			view.setUint8(offset + i, value.charCodeAt(i));
	};
	word(0, "RIFF");
	view.setUint32(4, 36 + samples * 2, true);
	word(8, "WAVE");
	word(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8_000, true);
	view.setUint32(28, 16_000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	word(36, "data");
	view.setUint32(40, samples * 2, true);
	const data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
	const artifacts = Array.from({ length: count }, (_, index) => ({
		name:
			index < 2
				? "Rain on glass"
				: index === 2
					? "An exceptionally long backend-defaulted sound name that wraps without hiding the waveform, duration, or cost — café / 雨 / rain"
					: `Sound ${index + 1}`,
		digest: `fixture-sound-${index}`,
		path: `/fixture/sound-${index}.wav`,
		duration_s: 3,
		format: "wav",
		cost_usd: index === failed || failed === -2 ? 0 : 0.001 * (index + 1),
		cost: {
			amount_usd: index === failed || failed === -2 ? 0 : 0.001 * (index + 1),
			basis: index % 2 ? "estimated" : "billed",
		},
		status: index === failed || failed === -2 ? "failed" : "completed",
		request_id: `fixture-request-${index}`,
		error:
			index === failed || failed === -2
				? "audio_rejected: server returned 400 — invalid duration"
				: null,
	}));
	return genTool({
		id: `batch-fixture-${count}-${failed}`,
		isError: failed === -2,
		toolName: "generate_sound_effect",
		details: {
			artifacts,
			cost_usd: artifacts.reduce((sum, item) => sum + item.cost_usd, 0),
			cost: {
				basis: artifacts.every((item) => item.cost.basis === "billed")
					? "billed"
					: "estimated",
			},
			cost_complete: true,
			cancelled: 0,
			completed: artifacts.filter((item) => !item.error).length,
			failed: artifacts.filter((item) => item.error).length,
		},
		images: artifacts.flatMap((item) =>
			item.error
				? []
				: [
						{
							id: item.digest,
							attachment: item.digest,
							data,
							kind: "audio" as const,
							mimeType: "audio/wav",
							durationS: item.duration_s,
							name: item.name,
						},
					],
		),
	});
}

const BatchSoundStory = ({
	count,
	failed = -1,
}: { count: number; failed?: number }) => (
	<div className="h-screen overflow-y-auto">
		<div className="flex w-full max-w-[560px] flex-col gap-6 p-6">
			<ImageGenCard
				scope={null}
				view={imageGenCardView(batchSoundFixture(count, failed))}
			/>
		</div>
	</div>
);

/** A legacy single-form result, NOT a one-item sounds batch. */
export const SoundBatchSingleUnchanged: Story = {
	render: () => {
		const single = batchSoundFixture(1);
		single.details = {
			artifacts: single.details?.artifacts,
			cost_usd: 0.001,
			billing_basis: "estimated",
		};
		return (
			<div className="h-screen overflow-y-auto">
				<div className="flex w-full max-w-[560px] flex-col gap-6 p-6">
					<ImageGenCard scope={null} view={imageGenCardView(single)} />
				</div>
			</div>
		);
	},
};
export const SoundBatchOne: Story = {
	render: () => <BatchSoundStory count={1} />,
};
export const SoundBatchFour: Story = {
	render: () => <BatchSoundStory count={4} />,
};
export const SoundBatchFive: Story = {
	render: () => <BatchSoundStory count={5} />,
};
export const SoundBatchTen: Story = {
	render: () => <BatchSoundStory count={10} />,
};
export const SoundBatchPartialFailure: Story = {
	render: () => <BatchSoundStory count={4} failed={1} />,
};

export const SoundBatchAllFailed: Story = {
	render: () => <BatchSoundStory count={4} failed={-2} />,
};
export const SoundBatchLoading: Story = {
	render: () => (
		<div className="flex w-full max-w-[560px] flex-col gap-6 p-6">
			<ImageGenCard
				scope={null}
				view={imageGenCardView(
					genTool({
						id: "batch-loading",
						toolName: "generate_sound_effect",
						phase: "running",
						args: {
							sounds: Array.from({ length: 10 }, (_, index) => ({
								name: `Sound ${index + 1}`,
								prompt: "Fixture",
							})),
						},
						startedAt: Date.now() - 12_000,
						details: canonical({
							tool_name: "generate_sound_effect",
							stage: "running",
							item: 3,
							total: 10,
							name: "Sound 3",
						}),
					}),
				)}
			/>
		</div>
	),
};

/** Contract negative states, not live provider outcomes. */
function BatchReceiptEdge({
	kind,
}: { kind: "cancelled" | "unavailable" | "shared" }) {
	const record = batchSoundFixture(
		kind === "shared" ? 2 : 4,
		kind === "shared" ? -1 : 1,
	);
	const details = record.details;
	if (!details) return null;
	const artifacts = details.artifacts as Record<string, unknown>[];
	if (kind === "shared") {
		artifacts[1].digest = artifacts[0].digest;
		record.images = record.images?.filter(
			(image) => image.attachment === artifacts[0].digest,
		);
	} else {
		details.cost_complete = false;
		artifacts[1].cost_usd = null;
		artifacts[1].cost = { amount_usd: null, basis: "quote" };
		if (kind === "cancelled") {
			record.stopped = true;
			artifacts[1].status = "cancelled";
			artifacts[1].error = "Stop requested; provider outcome unknown";
			details.failed = 0;
			details.cancelled = 1;
			record.output =
				"Sound effects: 3 completed, 0 failed, 1 cancelled/stopped. Known total $0.008 (estimated); unknown or late charges are not included. Batch stop requested. In-flight stop is best-effort, not a guaranteed vendor cancellation.";
		} else {
			artifacts[0].digest = "fixture-attachment-unavailable";
			artifacts[0].cost_usd = null;
			artifacts[0].cost = { amount_usd: null, basis: "quote" };
			details.cost_usd = 0.007;
		}
	}
	return (
		<div className="h-screen overflow-y-auto">
			<div className="flex w-full max-w-[560px] flex-col gap-6 p-6">
				<ImageGenCard scope={null} view={imageGenCardView(record)} />
			</div>
		</div>
	);
}

export const SoundBatchCancelled: Story = {
	render: () => <BatchReceiptEdge kind="cancelled" />,
};
export const SoundBatchUnavailable: Story = {
	render: () => <BatchReceiptEdge kind="unavailable" />,
};
export const SoundBatchSharedDigest: Story = {
	render: () => <BatchReceiptEdge kind="shared" />,
};

export const SoundBatchLoadingNarrow: Story = {
	render: () => (
		<div style={{ width: 390 }} className="max-w-full">
			<div className="flex w-full flex-col gap-6 p-6">
				<ImageGenCard
					scope={null}
					view={imageGenCardView(
						genTool({
							id: "batch-loading-narrow",
							toolName: "generate_sound_effect",
							phase: "running",
							args: {
								sounds: Array.from({ length: 10 }, () => ({
									prompt: "Fixture",
								})),
							},
							details: { item: 3, total: 10, name: "Rain on glass" },
						}),
					)}
				/>
			</div>
		</div>
	),
};
export const SoundBatchPartialNarrow: Story = {
	render: () => (
		<div style={{ width: 390 }} className="max-w-full">
			<BatchSoundStory count={4} failed={1} />
		</div>
	),
};
