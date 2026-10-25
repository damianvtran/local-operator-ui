/**
 * The turn-supplement block ("Highlights"), every state the design names, ON
 * THE PRODUCTION TRANSCRIPT — the convention `image-gen-card.stories.tsx` sets:
 * what is judged is what ships, so the reducer, the placement and the row all
 * run, and the story only supplies records.
 *
 * THE FRAMES' DOCUMENTS ARE REAL. `supplement-document-fixtures.ts` holds core's
 * own assembled documents (populated/error), and a scripted `desktop.media`
 * bridge — installed by `installSupplementMedia()` before a story's records
 * mount — serves them exactly as the media route would (`{html}` JSON). So the
 * sandboxed frame in a frame here is the shipped component rendering the shipped
 * prelude's document: the bar chart is drawn by the document's own script, and
 * `frame-error` is the document's own `{t:"error"}` beat painting the
 * frame-level fallback line.
 *
 * WHAT TO LOOK FOR, since these frames are part of the review:
 *
 * - NO header, label or title: the block starts directly with its content under
 *   the answer's last line (the binding amendment);
 * - the files-only finish with ≤ 2 files is compact REAL file actions — rows,
 *   or the thumbnail grid when the files are image-kind — never the bare word
 *   "Highlights" and never an inert count clause (operator decision
 *   2026-10-16; these states re-shot with it);
 * - a done block with frames reads files first, then the components, each with
 *   exactly one `Source: …` line under it;
 * - the 40vh/480px aggregate budget, accrued from each frame's RENDERED
 *   height (D5): the first frame mounts and the walk holds at the next until
 *   the first has reported, so a second frame of the real ~380px document
 *   waits behind `Show all 1 graphic` — and the `-expanded` states show what
 *   the disclosure opens, as a TOGGLE (`Show fewer`);
 * - `cancelled` and `failed` are the TUI's own copy bytes, each with `· Retry`;
 * - `live` rows paint the shimmer line with `Adjust… · Cancel` as a pair, and a
 *   cold reader of the same rows paints the cancelled arm with `Retry` instead
 *   (the stale-row rule);
 * - the FOLDED states (`folded-condensed-*`): while the block's own turn
 *   renders condensed it shows the SAME files section as its expanded self —
 *   the actionable rows and the image grid — and a graphics-bearing finish
 *   shows its graphic BY DEFAULT through the local Hide disclosure (2026-10-19
 *   operator request, superseding the plain count clause), aligned to the
 *   answer column; the not-settled arms keep their state line under the files;
 * - a supplement-free turn and the `superseded`/`empty` arms render NOTHING
 *   under the answer — the before/after pair for the fold lane.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import CLOSEOUT_GENERATED_DOCUMENT from "./supplement-closeout.generated.html?raw";
import {
	SUPPLEMENT_STORY_ERROR_DOCUMENT,
	SUPPLEMENT_STORY_POPULATED_DOCUMENT,
	SUPPLEMENT_STORY_SESSION,
} from "./supplement-document-fixtures";
import type { SupplementRecord, SupplementSound } from "./supplement-model";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;
const ANCHOR = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const JOB = "3f9c1a7e5b20";

/** A digest that is not sha256-of-anything: only the key matters to the bridge. */
const digest = (seed: string): string => {
	let out = "";
	for (let i = 0; out.length < 32; i += 1) {
		const code = seed.charCodeAt(i % seed.length);
		out += ((code * 31 + i * 7) % 256).toString(16).padStart(2, "0");
	}
	return out.slice(0, 32);
};

/**
 * The scripted media bridge: `{op:"sessions.supplementDocument"}` answers the
 * two fixture documents by digest and, for the reserved-box story, a promise
 * that never settles.
 */
const HOLD_FOREVER = digest("hold-forever");
function installSupplementMedia(): void {
	const w = window as unknown as {
		api?: { desktop?: { media?: unknown } };
	};
	if (!w.api) w.api = {};
	const api = w.api;
	if (!api.desktop) api.desktop = {};
	const desktop = api.desktop;
	desktop.media = async (request: {
		op?: string;
		digest?: string;
	}): Promise<{
		status: number;
		kind: string;
		body?: unknown;
		detail?: string;
	}> => {
		if (request?.op !== "sessions.supplementDocument") {
			return { status: 404, kind: "error", detail: "not this story" };
		}
		if (request.digest === HOLD_FOREVER) {
			return await new Promise(() => {});
		}
		return {
			status: 200,
			kind: "json",
			body: { html: SUPPLEMENT_STORY_POPULATED_DOCUMENT },
		};
	};
	/*
	 * The ERROR document answers its own digest, and the frame tears down on the
	 * `{t:"error"}` beat it posts after the theme push.
	 */
	const errorDigest = digest("error-document");
	desktop.media = (async (request: { op?: string; digest?: string }) => {
		/*
		 * Sound bytes and peaks, so the collage stories mount the shipped player
		 * with a real envelope (the two reads `useAttachmentSource` and
		 * `useWaveform` issue through this same bridge).
		 */
		if (request?.op === "sessions.attachment")
			return {
				status: 200,
				kind: "bytes",
				mimeType: "audio/wav",
				data: storyWav(),
			};
		if (request?.op === "sessions.attachment.waveform")
			return {
				status: 200,
				kind: "json",
				body: { version: 1, bars: STORY_PEAKS.length, peaks: STORY_PEAKS },
			};
		if (request?.digest === digest("closeout-generated-table")) {
			return {
				status: 200,
				kind: "json",
				body: { html: CLOSEOUT_GENERATED_DOCUMENT },
			};
		}
		if (request?.digest === errorDigest) {
			return {
				status: 200,
				kind: "json",
				body: { html: SUPPLEMENT_STORY_ERROR_DOCUMENT },
			};
		}
		if (request.digest === HOLD_FOREVER) return await new Promise(() => {});
		return {
			status: 200,
			kind: "json",
			body: { html: SUPPLEMENT_STORY_POPULATED_DOCUMENT },
		};
	}) as never;
}

/**
 * THE FILE-READ BRIDGE for the image-kind tile grid: the same scripted
 * convention as the media bridge above, one level down.
 *
 * `probeFiles` resolves the fixtures' portable paths against a synthetic home
 * (the resolution shape `CloseoutReplay` already uses), and `readFileBytes`
 * answers DECODABLE PNG bytes drawn here — deterministically, from a hash of
 * the path — so the shipped tile pipeline (decode → 640px downscale → blob
 * ledger) really runs against bytes in these frames. A non-PNG path is refused
 * the way the pipeline's own unavailable arm is, which is the glyph-fallback
 * state. Installed beside the media bridge from every `Frame` render, so no
 * stub outlives a story.
 */
const syntheticPngs = new Map<string, Promise<Uint8Array>>();
function pngFor(path: string): Promise<Uint8Array> {
	const hit = syntheticPngs.get(path);
	if (hit) return hit;
	const run = (async () => {
		const canvas = new OffscreenCanvas(360, 240);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no 2d context");
		let seed = 0;
		for (const char of path) seed = (seed * 31 + char.charCodeAt(0)) % 997;
		context.fillStyle = "#f2f2ef";
		context.fillRect(0, 0, 360, 240);
		for (let bar = 0; bar < 6; bar += 1) {
			const height = 40 + ((seed * (bar + 3)) % 140);
			context.fillStyle = bar % 2 ? "#6f8f7a" : "#42525c";
			context.fillRect(24 + bar * 54, 210 - height, 36, height);
		}
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		return bytes;
	})();
	syntheticPngs.set(path, run);
	return run;
}

function installSupplementFileReads(): void {
	const w = window as unknown as {
		api?: {
			probeFiles?: unknown;
			readFileBytes?: unknown;
		};
	};
	if (!w.api) w.api = {};
	Object.assign(w.api, {
		probeFiles: async (paths: string[], cwd?: string) =>
			paths.map((path) => ({
				input: path,
				resolved: path.startsWith("/")
					? path
					: path.startsWith("~/")
						? `/synthetic-home/${path.slice(2)}`
						: `${cwd?.startsWith("~") ? `/synthetic-home${cwd.slice(1)}` : (cwd ?? "")}/${path}`,
				exists: true,
				isFile: true,
				isDirectory: false,
				sizeBytes: 240_100,
				mtimeMs: TS,
				outsideWorkspace: false,
			})),
		readFileBytes: async (filePath: string) => {
			if (!filePath.endsWith(".png")) {
				return {
					success: false as const,
					code: "unreadable" as const,
					error: "This rig serves PNG bytes only.",
				};
			}
			const data = await pngFor(filePath);
			return { success: true as const, data, sizeBytes: data.byteLength };
		},
	});
}

const file = (
	path: string,
	name: string,
	sizeBytes: number,
	kind = "markdown",
) => ({
	path,
	name,
	kind,
	sizeBytes,
	mtime: 1790999940,
	why: "written by write",
});

const component = (seed: string, title: string, heightHint: number) => ({
	attachment: digest(seed),
	title,
	source: "bench.csv rows 1-4 (tool result of bash at 10:41)",
	mime: "text/html",
	heightHint,
});

/**
 * THE SOUNDS SECTION'S REAL INPUT (2026-10-23): fourteen distinct digests on
 * one row, which is what the uncapped producer now sends. The bridge below
 * answers both the bytes and the peaks sidecar, so the collage stories draw the
 * shipped player with a real envelope instead of the reserved line a digest
 * alone would leave.
 */
const sound = (
	seed: string,
	title: string,
	durationS: number,
): SupplementSound => ({
	attachment: digest(seed),
	mime: "audio/wav",
	title,
	durationS,
});

const COLLAGE_SOUNDS: SupplementSound[] = Array.from(
	{ length: 14 },
	(_, index) =>
		sound(`collage-${index}`, `Storm swell ${index + 1}`, 6 + index),
);

/** The one envelope every story sound draws: deterministic, 240 bars. */
const STORY_PEAKS = Array.from({ length: 240 }, (_, index) =>
	Math.min(1, 0.12 + Math.abs(Math.sin(index / 8)) * 0.82),
);

/** A short valid WAV, so the blob the resolver builds decodes like a sound. */
const storyWav = (() => {
	let cached: Uint8Array | null = null;
	return () => {
		if (cached) return cached;
		const rate = 8000;
		const samples = rate / 5;
		const wav = new Uint8Array(44 + samples * 2);
		const view = new DataView(wav.buffer);
		const ascii = (offset: number, text: string) => {
			for (let index = 0; index < text.length; index += 1)
				view.setUint8(offset + index, text.charCodeAt(index));
		};
		ascii(0, "RIFF");
		view.setUint32(4, wav.length - 8, true);
		ascii(8, "WAVEfmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, 1, true);
		view.setUint32(24, rate, true);
		view.setUint32(28, rate * 2, true);
		view.setUint16(32, 2, true);
		view.setUint16(34, 16, true);
		ascii(36, "data");
		view.setUint32(40, samples * 2, true);
		for (let index = 0; index < samples; index += 1)
			view.setInt16(
				44 + index * 2,
				Math.round(6000 * Math.sin((2 * Math.PI * 220 * index) / rate)),
				true,
			);
		cached = wav;
		return wav;
	};
})();

const supplement = (
	over: Partial<SupplementRecord> & { id: string },
): SupplementRecord => ({
	kind: "supplement",
	ts: TS,
	anchor: ANCHOR,
	job: JOB,
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	// Empty unless a story overrides it: a story about the sounds section sets
	// `sounds` itself, and every other story renders the section's absence
	// (which is what the absent-on-older-rows path looks like).
	sounds: [],
	error: "",
	cause: "",
	dismissed: false,
	live: false,
	...over,
});

const answer = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS,
	text,
	streaming: false,
	settledAt: TS,
	stopReason: null,
	error: false,
});

/*
 * The turn a CONDENSED block belongs to (design round 1, D1/U3): a completed
 * run whose bar renders closed, so the transcript hands the block
 * `condensed={true}` through its own collapse plan — the fixtures below are the
 * same planted shapes the plan is driven by everywhere else, and the block's
 * one-line form is read off the real component, never simulated here.
 */
const prompt = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS - 90_000,
	text,
	images: [],
});

/** One settled `bash` call the run's bar hides, in the reducer's own shape. */
const turnCall = (id: string): TranscriptRecord => ({
	kind: "tool",
	id,
	ts: TS - 60_000,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "pnpm test:desktop" },
	phase: "done",
	argumentBytes: 0,
	output: null,
	isError: false,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	durationS: 3,
	startedAt: TS - 60_000,
	endedAt: TS - 57_000,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	details: null,
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

/** A one-shot click on the first matching control, after mount. */
function ClickOnMount({ selector }: { selector: string }) {
	const done = useRef(false);
	useEffect(() => {
		if (done.current) return;
		done.current = true;
		const timer = window.setTimeout(() => {
			document.querySelector<HTMLElement>(selector)?.click();
		}, 60);
		return () => window.clearTimeout(timer);
	}, [selector]);
	return null;
}

const Frame = ({
	records,
	height = 340,
	width = "100%",
	click,
	cwd,
}: {
	records: TranscriptRecord[];
	height?: number;
	width?: string;
	click?: string;
	cwd?: string;
}) => {
	installSupplementMedia();
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="overflow-y-auto p-6"
			data-supplement-story-frame=""
			ref={containerRef}
			style={{ width, height }}
		>
			{click !== undefined && <ClickOnMount selector={click} />}
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				frontend={
					cwd
						? ({
								session_id: SUPPLEMENT_STORY_SESSION,
								cwd,
								streaming: false,
							} as CanonicalFrontendState)
						: null
				}
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
				stopping={false}
				onInterruptTurn={() => {}}
				attachmentScope={{ sessionId: SUPPLEMENT_STORY_SESSION, childId: null }}
			/>
		</div>
	);
};

const FILES = [
	file("reports/latency.md", "latency.md", 4120),
	file("data/bench.csv", "bench.csv", 913, "csv"),
];
const MORE_FILES = [
	file("reports/latency.md", "latency.md", 4120),
	file("data/bench.csv", "bench.csv", 913, "csv"),
	file("reports/q3.md", "q3.md", 812),
	file("reports/q4.md", "q4.md", 799),
];

/*
 * The image-kind fixtures (operator decision 2026-10-16): paths stay portable
 * in the record — the journal's spelling — and only the scripted file-read
 * bridge below knows the synthetic home they resolve into.
 */
const IMAGES = [
	file(
		"renders/latency-by-region.png",
		"latency-by-region.png",
		240_100,
		"image",
	),
	file(
		"renders/throughput-per-shard.png",
		"throughput-per-shard.png",
		180_000,
		"image",
	),
	file("renders/errors-by-class.png", "errors-by-class.png", 96_500, "image"),
];

/**
 * The same Frame with the FILE-READ bridge installed for its render — the one
 * thing an image state needs beyond the shared frame: its tiles probe and read
 * at mount, while every other state resolves nothing until a menu press no
 * still makes. Installed before `Frame` renders, so the bridge is on
 * `window.api` before the tiles' first effects.
 */
function ImagesFrame(props: {
	records: TranscriptRecord[];
	height?: number;
	width?: string;
	click?: string;
	cwd?: string;
}) {
	installSupplementFileReads();
	return <Frame {...props} />;
}

const meta: Meta = {
	title: "Chat/Turn supplements",
	parameters: { layout: "fullscreen" },
};
export default meta;

/** The live line, no files yet: the shimmer, then `Adjust… · Cancel`. */
export const Preparing: StoryObj = {
	render: () => (
		<Frame
			height={237}
			records={[
				answer("m1", "All four regions cleared the latency budget this week."),
				supplement({ id: "s1", state: "queued", live: true }),
			]}
		/>
	),
};

/** The live line WITH the callouts that do not wait for the generator. */
export const PreparingFiles: StoryObj = {
	render: () => (
		<Frame
			height={263}
			records={[
				answer("m1", "All four regions cleared the latency budget this week."),
				supplement({
					id: "s1",
					state: "queued",
					live: true,
					files: FILES,
				}),
			]}
		/>
	),
};

/** Small file set: compact real file actions, no header of any kind. */
export const FilesSummary: StoryObj = {
	render: () => (
		<Frame
			height={237}
			records={[
				answer("m1", "Two artifacts came out of this run."),
				supplement({ id: "s1", files: FILES }),
			]}
		/>
	),
};

/** Four rows, the featured cap's disclosure collapsed. */
export const FilesMore: StoryObj = {
	render: () => (
		<Frame
			height={323}
			records={[
				answer("m1", "Seven reports were refreshed."),
				supplement({
					id: "s1",
					files: MORE_FILES,
					filesMore: 3,
					more: ["reports/q1.md", "reports/q2.md", "data/raw.csv"],
				}),
			]}
		/>
	),
};

/** The same row, its disclosure open (the stored ≤ 20 paths, one per line). */
export const FilesMoreExpanded: StoryObj = {
	render: () => (
		<Frame
			height={366}
			click="[data-supplement-more]"
			records={[
				answer("m1", "Seven reports were refreshed."),
				supplement({
					id: "s1",
					files: MORE_FILES,
					filesMore: 3,
					more: ["reports/q1.md", "reports/q2.md", "data/raw.csv"],
				}),
			]}
		/>
	),
};

/**
 * The image-kind grid (operator decision 2026-10-16): three decodable PNGs
 * behind the scripted file bridge, so the tiles are REAL pictures through the
 * shipped thumbnail pipeline — decode, 640px downscale, shared ledger.
 */
export const Images: StoryObj = {
	render: () => (
		<ImagesFrame
			cwd="~/workspace/project"
			height={300}
			records={[
				answer("m1", "Three renders came out of this run."),
				supplement({ id: "s1", files: IMAGES }),
			]}
		/>
	),
};

/** Mixed: the grid first, then the non-image rows — one coherent section. */
export const ImagesMixed: StoryObj = {
	render: () => (
		<ImagesFrame
			cwd="~/workspace/project"
			height={330}
			records={[
				answer("m1", "The renders, plus the table behind them."),
				supplement({
					id: "s1",
					files: [IMAGES[0], ...FILES.slice(0, 1), IMAGES[1]],
				}),
			]}
		/>
	),
};

/**
 * The glyph fallback: a HEIC path the rig refuses the way Chromium refuses to
 * decode one, so the tile keeps its slot as the file-kind receipt instead of
 * painting damage.
 */
export const ImagesUnavailable: StoryObj = {
	render: () => (
		<ImagesFrame
			cwd="~/workspace/project"
			height={300}
			records={[
				answer("m1", "One capture came out of this run."),
				supplement({
					id: "s1",
					files: [
						file("renders/scatter.heic", "scatter.heic", 96_500, "image"),
					],
				}),
			]}
		/>
	),
};

/** One frame inside the budget: the chart, then exactly one `Source:` line. */
export const ComponentsOne: StoryObj = {
	render: () => (
		<Frame
			height={642}
			records={[
				answer("m1", "Latency by region, as the bench measured it."),
				supplement({
					id: "s1",
					files: FILES.slice(0, 1),
					components: [component("chart-a", "Latency by region (ms)", 260)],
				}),
			]}
		/>
	),
};

/**
 * Two frames of the REAL document against the measured budget. The accrual
 * counts RENDERED heights (D5): the first frame renders ~380px and the walk
 * holds at the second until the first has reported, so one mounts and the
 * second sits behind the singular arm — `Show all 1 graphic`.
 */
export const ComponentsTwo: StoryObj = {
	render: () => (
		<Frame
			height={1021}
			records={[
				answer("m1", "Two cuts of the same bench."),
				supplement({
					id: "s1",
					components: [
						component("chart-a", "Latency by region (ms)", 120),
						component("chart-b", "Latency by region (table)", 120),
					],
				}),
			]}
		/>
	),
};

/** Three frames against the budget: one mounts, the rest are behind ONE disclosure. */
export const BudgetDisclosure: StoryObj = {
	render: () => (
		<Frame
			height={642}
			records={[
				answer("m1", "Three views of the run."),
				supplement({
					id: "s1",
					components: [
						component("chart-a", "Latency by region (ms)", 320),
						component("chart-b", "Throughput per shard (ms)", 320),
						component("chart-c", "Errors by class", 320),
					],
				}),
			]}
		/>
	),
};

/** The disclosure opened: every frame mounts. */
export const BudgetDisclosureExpanded: StoryObj = {
	render: () => (
		<Frame
			click="[data-supplement-show-all]"
			height={1366}
			records={[
				answer("m1", "Three views of the run."),
				supplement({
					id: "s1",
					components: [
						component("chart-a", "Latency by region (ms)", 320),
						component("chart-b", "Throughput per shard (ms)", 320),
						component("chart-c", "Errors by class", 320),
					],
				}),
			]}
		/>
	),
};

/** The cancelled arm, live-seen: the copy byte, `· Retry` beside it. */
export const Cancelled: StoryObj = {
	render: () => (
		<Frame
			height={237}
			records={[
				answer("m1", "The charts were cancelled part-way."),
				supplement({ id: "s1", state: "cancelled" }),
			]}
		/>
	),
};

/** The SAME cancelled row read COLD (no live beat in this view) — same line, Retry. */
export const CancelledCold: StoryObj = {
	render: () => (
		<Frame
			height={237}
			records={[
				answer("m1", "The charts were cancelled part-way."),
				supplement({ id: "s1", state: "queued" }),
			]}
		/>
	),
};

/** The failure arm: the generator's own failure sentence, `· Retry`. */
export const Failed: StoryObj = {
	render: () => (
		<Frame
			height={360}
			records={[
				answer("m1", "The graphics did not make it."),
				supplement({
					id: "s1",
					state: "failed",
					error: "generator:ProviderError",
					model: "openrouter/openai/gpt-6.1-sol",
					attempts: [
						"anthropic/claude-sonnet-5-5",
						"openrouter/openai/gpt-6.1-sol",
					],
					detail: [
						"turn 1: ProviderError status=None kind=quota",
						"turn 2: ProviderError status=503 kind=transient",
					],
				}),
			]}
		/>
	),
};

/**
 * The failed line's typed-cause arm (core #2557; operator ask 2026-10-17): a row
 * carrying `cause` names the wall the Retry would meet, in the one word list
 * every surface transcribes (`CAUSE_PHRASES`). The bare `Failed` story above is
 * the absent/unknown control — its line's bytes are unchanged by this arm.
 */
export const FailedCauseQuota: StoryObj = {
	render: () => (
		<Frame
			height={360}
			records={[
				answer("m1", "The graphics did not make it."),
				supplement({
					id: "s1",
					state: "failed",
					cause: "provider_quota",
					error: "generator:ProviderError",
					model: "openrouter/openai/gpt-6.1-sol",
					attempts: [
						"anthropic/claude-sonnet-5-5",
						"openrouter/openai/gpt-6.1-sol",
					],
					detail: [
						"turn 1: ProviderError status=None kind=quota",
						"turn 2: ProviderError status=429 kind=quota",
					],
				}),
			]}
		/>
	),
};

/** Unsupported standalone profile: honest reason, real file controls, no blank iframe. */
export const PreparedUnsupported: StoryObj = {
	render: () => (
		<Frame
			height={360}
			records={[
				answer("m1", "Prepared the HTML document."),
				supplement({
					id: "s1",
					files: [
						{
							...FILES[0],
							path: "unsupported.html",
							name: "unsupported.html",
							kind: "html",
						},
					],
					detail: ["prepared:unsupported"],
				}),
			]}
		/>
	),
};

/** A settled row with nothing to show: NOTHING renders (no empty block). */
export const DoneEmpty: StoryObj = {
	render: () => (
		<Frame
			height={220}
			records={[
				answer("m1", "Nothing was worth calling out this turn."),
				supplement({ id: "s1" }),
			]}
		/>
	),
};

/** A superseded row renders NOTHING, exactly as a dismissed one does. */
export const Superseded: StoryObj = {
	render: () => (
		<Frame
			height={220}
			records={[
				answer("m1", "The next turn cut this one's highlights."),
				supplement({ id: "s1", state: "cancelled", error: "superseded" }),
			]}
		/>
	),
};

/**
 * The frame-level fallback: the document posts `{t:"error"}` (its own digest
 * answers the error fixture) and the frame is replaced by ONE quiet line —
 * never a rewrite of the row.
 */
export const FrameError: StoryObj = {
	render: () => (
		<Frame
			height={237}
			records={[
				answer("m1", "This chart could not load its data."),
				supplement({
					id: "s1",
					components: [component("error-document", "Missing dataset", 200)],
				}),
			]}
		/>
	),
};

/** The reserved box while the document is still loading (it draws no title). */
export const FrameLoading: StoryObj = {
	render: () => (
		<Frame
			height={437}
			records={[
				answer("m1", "The document is still arriving."),
				supplement({
					id: "s1",
					components: [component("hold-forever", "Still loading", 200)],
				}),
			]}
		/>
	),
};

/**
 * A SUPPLEMENT-FREE turn: the before half of the fold pair. Nothing about this
 * story changes with the feature — it is the proof that a turn without a
 * supplement renders exactly as it did.
 */
export const SupplementFree: StoryObj = {
	render: () => (
		<Frame
			height={314}
			records={[
				{
					kind: "user",
					id: "u1",
					ts: TS - 4000,
					text: "Summarise the run.",
					images: [],
				},
				answer(
					"m1",
					"All four regions cleared the latency budget; no follow-ups were needed.",
				),
			]}
		/>
	),
};

/**
 * The mobile-ish width (560px, the shell's narrow column): the block must not
 * wrap the state row or push the source line out of the frame.
 */
export const Narrow: StoryObj = {
	render: () => (
		<Frame
			height={514}
			width="560px"
			records={[
				answer("m1", "The run finished clean; two files and one chart."),
				supplement({
					id: "s1",
					files: FILES,
					components: [component("chart-a", "Latency by region (ms)", 200)],
				}),
			]}
		/>
	),
};

/*
 * THE CONDENSED FORM (design round 1, D1/U3/R2; reworked by the operator
 * decisions of 2026-10-16 and 2026-10-19): while the block's own turn renders
 * condensed — one closed bar over its run — the block shows the SAME files
 * section as its expanded self (the actionable rows and the image grid), a
 * graphics-bearing settle shows its budgeted graphic BY DEFAULT through a local
 * Hide disclosure (2026-10-19, superseding the plain count clause), and the
 * not-settled arms keep their state line under the files. Each state below
 * mounts the SAME shipped component through the SAME transcript walk the app
 * runs (`prompt` + `turnCall` + `answer` + the block, so the plan really
 * collapses the call and really hands the block `condensed={true}`); no
 * story-only prop is invented here.
 */

/** Files only, ≤ 2: the actionable rows, identical to the expanded form. */
export const FoldedCondensedFiles: StoryObj = {
	render: () => (
		<Frame
			height={400}
			records={[
				prompt("u0", "Check the latency budget across regions."),
				turnCall("c1"),
				answer("m1", "All four regions cleared the latency budget this week."),
				supplement({ id: "s1", files: FILES }),
			]}
		/>
	),
};

/**
 * Files only, > 2: the featured rows plus the `N more files` disclosure.
 *
 * 540px, not 400 (agent review round 1's R3, the designer's D1): at the original
 * height the disclosure the state is named for sat below the crop.
 */
export const FoldedCondensedCounts: StoryObj = {
	render: () => (
		<Frame
			height={540}
			records={[
				prompt("u0", "Refresh the weekly reports."),
				turnCall("c1"),
				answer("m1", "Seven reports were refreshed."),
				supplement({
					id: "s1",
					files: MORE_FILES,
					filesMore: 3,
					more: ["reports/q1.md", "reports/q2.md", "data/raw.csv"],
				}),
			]}
		/>
	),
};

/** Components only: the graphic is visible by default; the work bar stays folded. */
export const FoldedCondensedComponents: StoryObj = {
	render: () => (
		<Frame
			height={720}
			records={[
				prompt("u0", "Chart the bench results."),
				turnCall("c1"),
				answer(ANCHOR, "Both views are drawn from the same bench."),
				supplement({
					id: "s1",
					components: [
						component("chart-a", "Latency by region (ms)", 320),
						component("chart-b", "Throughput by region", 320),
					],
				}),
			]}
		/>
	),
};

/**
 * Replay of the four-deliverable closeout shape. Paths stay portable in the
 * record; only the mocked preload boundary knows this synthetic home. The
 * graphic is the actual assembled table generated for an EXPLICIT table request
 * in core PR #2418. Automatic classification was below its threshold, so this
 * fixture proves renderer replay, not automatic graphic selection. Counts use
 * distinct entity units, never a misleading common completion denominator.
 */
function CloseoutReplay() {
	const api = window.api;
	const previous = useRef({
		probeFiles: api.probeFiles,
		readFile: api.readFile,
		openFile: api.openFile,
		showItemInFolder: api.showItemInFolder,
	});
	useEffect(
		() => () => {
			Object.assign(api, previous.current);
		},
		[api],
	);
	api.probeFiles = async (paths, cwd) =>
		paths.map((path) => ({
			input: path,
			resolved: path.startsWith("/")
				? path
				: path.startsWith("~/")
					? `/synthetic-home/${path.slice(2)}`
					: `${cwd?.startsWith("~") ? `/synthetic-home${cwd.slice(1)}` : cwd}/${path}`,
			exists: true,
			isFile: true,
			isDirectory: false,
			sizeBytes: 30,
			mtimeMs: TS,
			outsideWorkspace: false,
		}));
	api.readFile = async () => ({
		success: true,
		data: "# Synthetic closeout deliverable\n\nReplay fixture only.",
	});
	api.openFile = async (path) => ({ ok: true, resolved: path });
	api.showItemInFolder = async (path) => ({ ok: true, resolved: path });
	return (
		<Frame
			cwd="~/workspace/project"
			height={820}
			records={[
				answer(
					"m1",
					"The closeout produced four deliverables. RUN-RECORD.md records the run; the files below retain their session-relative paths.",
				),
				supplement({
					id: "s1",
					files: [
						file(
							"workspace/acme-closeout/RUN-RECORD.md",
							"RUN-RECORD.md",
							4120,
						),
						file(
							"workspace/acme-closeout/closed-records.csv",
							"closed-records.csv",
							913,
							"csv",
						),
						file(
							"workspace/acme-closeout/exceptions.csv",
							"exceptions.csv",
							812,
							"csv",
						),
						file("workspace/acme-closeout/summary.md", "summary.md", 799),
					],
					components: [
						{
							...component(
								"closeout-generated-table",
								"Operational counts — distinct entity units",
								380,
							),
							source:
								"Actual explicit-request generated table from core PR #2418; not automatic classification",
						},
					],
				}),
			]}
		/>
	);
}

export const CloseoutFourDeliverables: StoryObj = {
	render: () => <CloseoutReplay />,
};

/** Mixed: the files stay actionable and no graphics clause sits beside them. */
export const FoldedCondensedMixed: StoryObj = {
	render: () => (
		<Frame
			height={720}
			records={[
				prompt("u0", "Summarise with the chart."),
				turnCall("c1"),
				answer("m1", "Two files and one chart came out of this run."),
				supplement({
					id: "s1",
					files: FILES,
					components: [component("chart-a", "Latency by region (ms)", 320)],
				}),
			]}
		/>
	),
};

/**
 * The operator's own screenshot shape (2026-10-16): ONE finished file, whose
 * block used to be a passive `1 file: …` clause — now the actionable row.
 */
export const FoldedCondensedOneFile: StoryObj = {
	render: () => (
		<Frame
			height={400}
			records={[
				prompt("u0", "Latest brand kit for the client."),
				turnCall("c1"),
				answer("m1", "The kit is ready to send."),
				supplement({
					id: "s1",
					files: [
						file(
							"workspace/acme-closeout/Brand-Design-Kit.pdf",
							"Brand-Design-Kit.pdf",
							482_000,
							"pdf",
						),
					],
				}),
			]}
		/>
	),
};

/** Folded with images: the grid survives the fold, with the rows and no frames. */
export const FoldedCondensedImages: StoryObj = {
	render: () => (
		<ImagesFrame
			cwd="~/workspace/project"
			height={400}
			records={[
				prompt("u0", "Render the three cuts."),
				turnCall("c1"),
				answer("m1", "Three renders came out of this run."),
				supplement({ id: "s1", files: IMAGES }),
			]}
		/>
	),
};

/**
 * Folded while the job still runs: the files are known before the generator
 * finishes, so the rows lead and the live line (with `Adjust… · Cancel`) sits
 * under them — the same wiring the expanded preparing arms have.
 */
export const FoldedCondensedPreparingFiles: StoryObj = {
	render: () => (
		<Frame
			height={540}
			records={[
				prompt("u0", "Refresh the weekly reports and chart them."),
				turnCall("c1"),
				answer("m1", "Seven reports were refreshed; charting now."),
				supplement({
					id: "s1",
					state: "queued",
					live: true,
					files: MORE_FILES,
					filesMore: 3,
					more: ["reports/q1.md", "reports/q2.md", "data/raw.csv"],
				}),
			]}
		/>
	),
};

/**
 * Answer-local graphics (2026-10-19 amendment; default flipped by the operator
 * request of the same day). Use the real transcript fold and shared Disclosure,
 * not a visual imitation or an initial-open prop. Visible fixtures are the
 * DEFAULT; the `*Closed` fixtures press the same button the reader does to Hide
 * after mount.
 */
const localGraphicsRecords = (
	seeds: string[],
	files: SupplementRecord["files"] = [],
): TranscriptRecord[] => [
	prompt("u0", "Chart the bench results."),
	turnCall("c1"),
	answer(ANCHOR, "Both views are drawn from the same bench."),
	supplement({
		id: "s1",
		files,
		components: seeds.map((seed, index) =>
			component(
				seed,
				index === 0 ? "Latency by region (ms)" : "Throughput by region",
				320,
			),
		),
	}),
];
const localReveal = "[data-supplement-graphics-reveal]";
export const LocalGraphicClosed: StoryObj = {
	render: () => (
		<Frame
			height={720}
			click={localReveal}
			records={localGraphicsRecords(["chart-a"])}
		/>
	),
};
export const LocalGraphicOpen: StoryObj = {
	render: () => (
		<Frame height={720} records={localGraphicsRecords(["chart-a"])} />
	),
};
export const LocalGraphicsClosed: StoryObj = {
	render: () => (
		<Frame
			height={720}
			click={localReveal}
			records={localGraphicsRecords(["chart-a", "chart-b"])}
		/>
	),
};
export const LocalGraphicsOpen: StoryObj = {
	render: () => (
		<Frame
			height={720}
			records={localGraphicsRecords(["chart-a", "chart-b"])}
		/>
	),
};
export const LocalGraphicsNarrow: StoryObj = {
	render: () => (
		<Frame
			height={720}
			width="360px"
			records={localGraphicsRecords(["chart-a", "chart-b"])}
		/>
	),
};
export const LocalGraphicRefused: StoryObj = {
	render: () => (
		<Frame height={720} records={localGraphicsRecords(["error-document"])} />
	),
};
export const LocalGraphicLoading: StoryObj = {
	render: () => (
		<Frame height={720} records={localGraphicsRecords(["hold-forever"])} />
	),
};

/** Files remain actionable above the same budget-aware graphics disclosure, open by default. */
export const LocalGraphicsMixed: StoryObj = {
	render: () => (
		<Frame
			height={720}
			records={localGraphicsRecords(["chart-a", "chart-b"], FILES)}
		/>
	),
};

/** The mixed block after its own Hide press. */
export const LocalGraphicsMixedHidden: StoryObj = {
	render: () => (
		<Frame
			height={720}
			click={localReveal}
			records={localGraphicsRecords(["chart-a", "chart-b"], FILES)}
		/>
	),
};

/*
 * THE SOUNDS COLLAGE (operator report, 2026-10-23). The producer sends every
 * generated sound, so fourteen arrived as fourteen stacked rows. These two
 * stories are the pair the fix is judged on: the EXPANDED answer and the
 * CONDENSED run paint the same fourteen cells - collapsing changes frame
 * mounting, never media - and the grid answers to the block's own width
 * (`auto-fit` over 15rem), so a narrow pane falls back to one column without a
 * viewport query.
 */
export const SoundsCollage: StoryObj = {
	name: "Sounds collage (expanded)",
	render: () => (
		<Frame
			height={760}
			records={[
				answer("m1", "Fourteen takes came out of this run."),
				supplement({ id: "s1", sounds: COLLAGE_SOUNDS }),
			]}
		/>
	),
};

export const FoldedCondensedSoundsCollage: StoryObj = {
	name: "Sounds collage (condensed)",
	render: () => (
		<Frame
			height={760}
			records={[
				prompt("u0", "Send fourteen storm variations."),
				turnCall("c1"),
				answer("m1", "Fourteen takes came out of this run."),
				supplement({ id: "s1", sounds: COLLAGE_SOUNDS }),
			]}
		/>
	),
};
