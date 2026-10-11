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
 * - the files-only finish with ≤ 2 files is ONE line of contents, never the
 *   bare word "Highlights";
 * - a done block with frames reads files first, then the components, each with
 *   exactly one `Source: …` line under it;
 * - the 40vh/480px aggregate budget: at a 900px viewport the third 320px frame
 *   is behind `Show all 2 graphics`, and the `-expanded` states show what the
 *   disclosure opens;
 * - `cancelled` and `failed` are the TUI's own copy bytes, each with `· Retry`;
 * - `live` rows paint the shimmer line with `Adjust… · Cancel` as a pair, and a
 *   cold reader of the same rows paints the cancelled arm with `Retry` instead
 *   (the stale-row rule);
 * - a supplement-free turn and the `superseded`/`empty` arms render NOTHING
 *   under the answer — the before/after pair for the fold lane.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	SUPPLEMENT_STORY_ERROR_DOCUMENT,
	SUPPLEMENT_STORY_POPULATED_DOCUMENT,
	SUPPLEMENT_STORY_SESSION,
} from "./supplement-document-fixtures";
import type { SupplementRecord } from "./supplement-model";
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
	error: "",
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
}: {
	records: TranscriptRecord[];
	height?: number;
	width?: string;
	click?: string;
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

/** Files-only, ≤ 2 files: ONE line of contents, no header of any kind. */
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
				answer("m1", "Four reports were refreshed."),
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
				answer("m1", "Four reports were refreshed."),
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
 * Two frames, both under the 40vh/480px aggregate budget (240 cumulative at a
 * 900px viewport): both mount, no disclosure is owed.
 */
export const ComponentsTwo: StoryObj = {
	render: () => (
		<Frame
			height={1021}
			records={[
				answer("m1", "Two cuts of the same bench: the chart and the table."),
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

/** Three frames against a 360px budget: one mounts, the rest are behind ONE disclosure. */
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
			height={237}
			records={[
				answer("m1", "The graphics did not make it."),
				supplement({
					id: "s1",
					state: "failed",
					error: "provider quota exhausted",
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
