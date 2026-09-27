/**
 * The action group's states, on the component that ships them, with every
 * number in the header DERIVED from the rows underneath it.
 *
 * §E2's fold, after the operator's 2026-09-26 report: a collapsed run has to
 * answer "what has it done, and what is it doing NOW" on its own line. These
 * stories are that line in the states a reader meets it in - live, mid-run with
 * a failure among the counts, finished, a settled run whose summary is
 * kinds-only, restored from history with no stamps to date a span from, a
 * long-name in-flight fall, and one opened by the reader's own press - so the
 * design round judges the header the way it renders rather than from a
 * description of it.
 *
 * THE FIXTURES ARE DERIVED, NOT TYPED (`foldProps` below), because typed ones
 * drifted: a story once showed `Running wait 3600000` while the shipped
 * composition for that call is `Calling wait 3600000` (`wait` is not in the
 * verb table), and headers whose counts did not match their own children - the
 * frame and the PR body then quoted strings the app cannot produce (agent
 * review R2, design D2). `foldSummary` and `toolRowLabel` are the same pure
 * functions the transcript calls, so a story cannot state what the app would
 * not.
 *
 * WHAT A STILL CANNOT SAY, and where that lives instead: the auto-condense rule
 * ("finished sections condense; the live section and anything the reader opened
 * obey the reader") is a TRANSITION with two guards, and `Expanded` shows only
 * its resting state. `scripts/trace-fold-behaviour.test.mjs` drives the
 * transitions through this same component: arrival condensed, the press opens,
 * a live section never closes the reader's fold, a run with an unsettled call
 * does not condense, the settle fires once, and a fold opened after its section
 * ended stays open.
 *
 * THE STAMPS ARE FIXED, not `Date.now()`-relative: a live span computes against
 * the clock, but a frame that changes its own number on every re-capture is a
 * frame no two rounds can compare. A still is an instant, and each of these is
 * the honest instant it names - "10s" is what the header read ten seconds into
 * a run that is still going.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect } from "react";
import "../../../../styles/index.css";
import { CanonicalImage } from "../../canonical/canonical-image";
import { FoldMedia } from "../../canonical/fold-media";
import { foldSummary } from "../../canonical/trace-fold-model";
import type { TranscriptImage } from "../../canonical/transcript-reducer";
import { ToolRow } from "./tool-row";
import { toolRowLabel } from "./tool-row-model";
import { TraceFold } from "./trace-fold";

/**
 * The padded sheet the transcript surfaces are read on (as `trace.stories`
 * uses): the fold's own margin is supplied by the transcript, so a story gives
 * it the column width and the neighbouring type and nothing else.
 *
 * The sentence above the fold is CONTEXT, not the subject: the fold renders one
 * line, and a frame of one line inside an empty 1280x130 sheet is refused by the
 * harness's own paint guard (`assertFramePaints`: 98.67% one colour, measured on
 * the `restored` state before this line existed). It is also the truer frame -
 * a condensed group is read under a message, not floating on a sheet.
 */
const Sheet = ({ children }: { children: ReactNode }) => (
	<div className="max-w-[760px] p-8">
		<p className="mb-2 text-body-sm text-ink-muted">
			Ran the suite, fixed the two failures, and pushed the branch.
		</p>
		{children}
	</div>
);

/**
 * One row's facts, as the transcript would hold them.
 *
 * `executing` is the row's own `phase === "running"`: the call is in flight and
 * its name is known, which is what the header's live clause paints.
 */
type RowSpec = {
	name: string;
	object: string;
	/**
	 * The pictures THIS action produced, as the record would carry them. On the
	 * spec rather than on the fold because that is where they belong: the strip
	 * is the run's concatenation of its rows' images, so a fixture that hung
	 * them off the group would not be modelling anything the app can produce.
	 */
	images?: TranscriptImage[];
	durationS: number | null;
	failed?: boolean;
	executing?: boolean;
};

/**
 * The fold's props, derived exactly as `canonical-transcript.tsx` derives them:
 * the summary from the actions' own names (`foldSummary`), the counts from the
 * rows, and the live clause from the executing row's own label composition
 * (`toolRowLabel`). Nothing here is typed twice.
 */
const foldProps = (specs: RowSpec[]) => {
	const actions = specs.map((spec) => ({
		name: spec.name,
		failed: spec.failed === true,
	}));
	const executing = specs.find((spec) => spec.executing === true);
	const label = executing
		? toolRowLabel(executing.name, executing.object, null, true)
		: null;
	return {
		summary: foldSummary(actions),
		actionCount: specs.length,
		failedCount: actions.filter((action) => action.failed).length,
		live: label ? { verb: label.verb, object: label.object } : null,
	};
};

/** The rows the fold's children render, from the same specs. */
const FoldRows = ({ specs }: { specs: RowSpec[] }) => (
	<>
		{specs.map((spec) => (
			<ToolRow
				key={`${spec.name}:${spec.object}`}
				toolName={spec.name}
				summary={spec.object}
				outcome={spec.executing ? "running" : spec.failed ? "error" : "success"}
				media={spec.images ? <RowPictures images={spec.images} /> : undefined}
				durationS={spec.durationS}
				// A running row's clock is cleared rather than stamped: a still
				// taken at a fixed instant cannot carry a ticking number.
				startedAt={null}
			/>
		))}
	</>
);

/**
 * Hold the capture shutter until the story's pictures have DECODED.
 *
 * A picture is `opacity-0` until its own `onLoad` fires (`ImageAttachment`'s
 * no-flash rule), so a shutter that fires once the story's own elements are up
 * photographs the reserved box and nothing in it. The first pass of these
 * frames did exactly that: the strip came back as an empty dark tile in both
 * themes, and the file is 15,257 bytes of frame nobody can judge. The latch is
 * the repository's own convention for it (`image-expand.stories.tsx`,
 * `run-details.stories.tsx`): set `data-capture-pending` on mount, clear it
 * only when every picture on the page reports `complete` with real dimensions,
 * and leave it SET if that never happens - an exhausted latch fails the capture
 * rather than shipping the empty box.
 *
 * TWO ARMING RULES, because the two states arrive differently. A condensed
 * group has its strip at mount, so the latch arms at once. A frame of the
 * PRESSED-OPEN group has no strip at all - the rig presses before this probe,
 * and pressing unmounts it - so that story arms on the fold being OPEN and then
 * waits for the row's own full-size picture. Arming on "an image exists" for
 * both would race the press: the loop could see the strip's picture decoded in
 * the window between the press and the row's picture mounting.
 *
 * It renders nothing, and it is inert on a story with no pictures: the
 * attribute is only ever set once the arm condition holds, so the six
 * image-less stories take the frames they took before this existed.
 */
const PicturesLatch = ({ whenOpen = false }: { whenOpen?: boolean }) => {
	useEffect(() => {
		let frame = 0;
		let cancelled = false;
		let armed = false;
		let decoding = false;
		const tick = () => {
			if (cancelled) return;
			if (!armed) {
				/*
				 * Arm on THIS story's own state, and not on anything weaker: a
				 * condensed group arms when its strip is in the DOM, the pressed-open
				 * one arms when the fold is open. A story with neither - every
				 * image-less state in this set - never arms, never sets the attribute,
				 * and takes the frame it took before this existed.
				 */
				const state = whenOpen
					? '[data-fold-ids] button[aria-expanded="true"]'
					: "[data-fold-media] img";
				if (!document.querySelector(state)) {
					if (frame++ < 600) requestAnimationFrame(tick);
					return;
				}
				armed = true;
			}
			document.documentElement.dataset.capturePending = "1";
			const pictures = [...document.images];
			if (pictures.length === 0 || decoding) {
				if (frame++ < 600) requestAnimationFrame(tick);
				return;
			}
			/*
			 * `decode()` rather than `complete`: this latch is also the assertion
			 * that the fixture is a real picture, and `complete` does NOT answer
			 * that. A TRUNCATED base64 literal reported `complete` with the right
			 * `naturalWidth` - the IHDR parses, the data does not - and every
			 * picture in this set photographed as an empty reserved box for two
			 * passes because of it. `decode()` resolves only when the bytes are
			 * decodable and ready to paint, and it REJECTS for a broken one; the
			 * rejection leaves the attribute set, so the capture FAILS loudly
			 * instead of shipping the empty box.
			 */
			if (
				pictures.every(
					(picture) => picture.complete && picture.naturalWidth > 0,
				)
			) {
				decoding = true;
				Promise.all(
					pictures.map((picture) =>
						picture.decode().then(
							() => true,
							() => false,
						),
					),
				).then((decoded) => {
					if (cancelled) return;
					if (decoded.every(Boolean)) {
						document.documentElement.removeAttribute("data-capture-pending");
						return;
					}
					console.error(
						"[trace-fold stories] a picture in this story will not decode; leaving the shutter latched so the capture fails rather than photographing an empty box",
					);
				});
				return;
			}
			/* 600 frames is ten seconds; exhaustion leaves the attribute set,
			   which fails the run rather than shipping a blank tile. */
			if (frame++ < 600) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [whenOpen]);
	return null;
};

const meta = {
	title: "chat/trace-fold",
	component: TraceFold,
	parameters: { layout: "fullscreen" },
	render: (args, context) => (
		<Sheet>
			<TraceFold {...args} />
			<PicturesLatch whenOpen={context?.parameters?.picturesLatch === "open"} />
		</Sheet>
	),
} satisfies Meta<typeof TraceFold>;

export default meta;
type Story = StoryObj<typeof meta>;

const LIVE_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git status --short", durationS: 0.1 },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{
		name: "bash",
		object: "pnpm vitest run --coverage",
		durationS: null,
		executing: true,
	},
];

/** The section is live and its last call has not settled. */
export const Live: Story = {
	args: {
		...foldProps(LIVE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 11_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={LIVE_ROWS} />,
	},
};

/**
 * The fall D1 named: a realistic long command in flight. The name is the only
 * element that truncates and the counts survive it - the frame exists so that
 * claim is judged from a render, not from the flex arithmetic.
 */
export const LongName: Story = {
	args: {
		...(() => {
			const specs = LIVE_ROWS.map((spec, index) =>
				index === LIVE_ROWS.length - 1
					? {
							...spec,
							object:
								"node scripts/capture-evidence.mjs --only=chat-trace-fold-- --themes=localOperatorDark,localOperatorLight",
						}
					: spec,
			);
			return { ...foldProps(specs), children: <FoldRows specs={specs} /> };
		})(),
		span: { startedAtMs: 1_000, endedAtMs: 13_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
	},
};

const MID_RUN_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git push origin fix", durationS: 9.1, failed: true },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{ name: "wait", object: "3600000", durationS: null, executing: true },
];

/** Mid-run: the counts have moved and one call in the group failed. */
export const MidRun: Story = {
	args: {
		...foldProps(MID_RUN_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 34_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={MID_RUN_ROWS} />,
	},
};

const FINISHED_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git push origin fix", durationS: 9.1, failed: true },
	{ name: "bash", object: "pnpm storybook", durationS: 4.2 },
	{ name: "bash", object: "node scripts/capture-evidence.mjs", durationS: 3.3 },
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

/** The section has ended: condensed, and the header names what ran. */
export const Finished: Story = {
	args: {
		...foldProps(FINISHED_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4", "s5"],
		children: <FoldRows specs={FINISHED_ROWS} />,
	},
};

const KINDS_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "node scripts/capture-evidence.mjs", durationS: 3.3 },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{ name: "bash", object: "pnpm storybook", durationS: 4.2 },
];

/**
 * A settled run whose summary is kinds-only (`3 shell · 1 python`, no lead
 * verb) - the finished form of any run containing an `eval`, which design round
 * 1's D3 asked the sweep to carry. Opened by the reader's own press: the press
 * is the HARNESS's (`press:` on this story's sweep row), not a `play` that sets
 * state, because the question the frame answers is whether the fold's own
 * control is what opens it. A visitor to Storybook can click the trigger
 * themselves and see the same thing.
 */
export const Expanded: Story = {
	args: {
		...foldProps(KINDS_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={KINDS_ROWS} />,
	},
};

const RESTORED_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm install", durationS: 12.5 },
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "eval", object: "backfill.py --day 2026-09-24", durationS: 40.2 },
];

/** A group restored from history: durations, but no stamps to date a span. */
export const Restored: Story = {
	args: {
		...foldProps(RESTORED_ROWS),
		span: null,
		live: null,
		sectionLive: false,
		recordIds: ["h1"],
		children: <FoldRows specs={RESTORED_ROWS} />,
	},
};

/* ------------------------- the run's own pictures ------------------------- */

/*
 * THE IMAGE-BEARING GROUP, added for the operator's 2026-09-26 report: a group
 * that condenses itself while the screenshot its run produced goes behind the
 * disclosure is the one artifact the fold was not allowed to hide. Five frames,
 * because the states are five: the BEFORE shape (an image-bearing run condensed
 * with nothing shown - which is today's render, spelled out so the pair is a
 * difference rather than two descriptions of it), the same run with the strip,
 * three pictures in one run, the live window where the picture has landed and a
 * later call is still going, and the pressed-open state where the rows draw the
 * pictures at full size instead.
 *
 * THE PICTURES ARE REAL BYTES, not a grey box: a reader has to be able to tell
 * "the picture rendered" from "the frame rendered", which is the same reason
 * `image-expand.stories.tsx` carries a literal. Four of them, because the strip
 * has to show that three pictures cost what one costs and that a portrait
 * capture (the phone-aspect case `image-attachment.tsx` names) is a narrow tile
 * rather than a stretched one. Flat bands only, so the literals stay small
 * enough to sit in a source file - a few hundred bytes of PNG each.
 */
const FOLD_SHOT_ONE =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAC/0lEQVR42u3UsQnAIBRFUacJVs6RgTKLjbUOaRo3CPwiksCBM8HjcdORC0BIMgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcwAfCUVsHCBEOQDiADeGY8wYIEQ5AOADhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4rAMIBCAcgHIBwAMIB8KdwnNcAngmHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcIBwCIdwgHAIBwiHcIBwCAcIh3CAcAiHT4BwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAQiHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHCIdwCAcIh3CAcAgHCIdwgHAIBwiHcAgHCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADCASAcwCsWE+1fusL0MMsAAAAASUVORK5CYII=";
("gTKLjbUOaRo3CPwiksCBM8HjcdORC0BIMgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEI");
("ByAcAMIBCAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcwAfCUVsHCBEOQDiADeGY8wYIEQ5AOADh");
("AIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4rAMIBCAcgHIBwAMIB");
("8KdwnNcAngmHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzC");
("AcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcIBwCIdwgHAIBwiHcIBwCAcIh3CAcAiHT4BwCAcIh3CA");
("cAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAQiHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdw");
("gHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEc");
("IBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIh");
("HCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHC");
("IRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHCIdwCAcIh3CAcAgHCIdwgHAIBwiHcAgHCIdwgHAI");
("BwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAACAcgHIBwAMIBCAeAcADCAQgH");
("IByAcAAIByAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBw");
("AMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADC");
("ASAcwCsWE+1fusL0MMsAAAAASUVORK5CYII=");
const FOLD_SHOT_TWO =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAADAElEQVR42u3UsQnAIBRFUacJVk6USTKIjY2NS5rGDQK/iCRw4EzweNx05AIQkkwACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIB4BwAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIB/CBcNQ2AEKEAxAOYEM45rwBQoQDEA5AOADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQDgDhAIQDEA5AOADhAITDCoBwAMIBCAcgHIBwAPwpHNfZgWfCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRwgHMIhHCAcwgHCIRwgHMIBwiEcIBzC4RMgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcwgHCIRwgHMIBwiEcwgHCIRwgHMIBwiEcIBzCAcIhHIBwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAcIhHMIBwiEcIBzCAcIhHCAcwgHCIRzCAcIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEIB4BwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcAAIB/CKBeLQJSwAty3/AAAAAElFTkSuQmCC";
("STKIjY2NS5rGDQK/iCRw4EzweNx05AIQkkwACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAA");
("wgEIB4BwAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIB/CBcNQ2AEKEAxAOYEM45rwBQoQDEA5A");
("OADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQDgDhAIQDEA5AOADhAITDCoBwAMIBCAcgHIBw");
("APwpHNfZgWfCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiH");
("cIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRwgHMIhHCAcwgHCIRwgHMIBwiEcIBzC4RMgHMIBwiEc");
("IBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIh");
("HCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAI");
("BwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBw");
("CAcIh3CAcAgHIBzCAcIhHCAcwgHCIRwgHMIBwiEcwgHCIRwgHMIBwiEcIBzCAcIhHIBwCAcIh3CA");
("cAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAcIhHMIBwiEcIBzCAcIhHCAcwgHCIRzCAcIhHCAc");
("wgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcAMIBCAcgHIBwAMIBIByAcADC");
("AQgHIBwAwgEIByAcgHAAwgEIB4BwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcg");
("HIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByA");
("cAAIB/CKBeLQJSwAty3/AAAAAElFTkSuQmCC");
const FOLD_SHOT_THREE =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAADAElEQVR42u3UsQnAIBRFUacJVo6RcTKJtY21S5rGDQK/iCRw4EzweNx05AIQkkwACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIB4BwAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIB/CBcLQ+AEKEAxAOYEM45rwBQoQDEA5AOADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQDgDhAIQDEA5AOADhAITDCoBwAMIBCAcgHIBwAPwpHGe9gGfCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRwgHMIhHCAcwgHCIRwgHMIBwiEcIBzC4RMgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcwgHCIRwgHMIBwiEcwgHCIRwgHMIBwiEcIBzCAcIhHIBwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAcIhHMIBwiEcIBzCAcIhHCAcwgHCIRzCAcIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEIB4BwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByAcAAIB/CKBX8yw0V7YSOJAAAAAElFTkSuQmCC";
("cTKJtY21S5rGDQK/iCRw4EzweNx05AIQkkwACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAA");
("wgEIB4BwAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIB/CBcLQ+AEKEAxAOYEM45rwBQoQDEA5A");
("OADhAIQDEA4A4QCEAxAOQDgA4QAQDkA4AOEAhAMQDgDhAIQDEA5AOADhAITDCoBwAMIBCAcgHIBw");
("APwpHGe9gGfCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiH");
("cIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRwgHMIhHCAcwgHCIRwgHMIBwiEcIBzC4RMgHMIBwiEc");
("IBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIh");
("HCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAI");
("BwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBw");
("CAcIh3CAcAgHIBzCAcIhHCAcwgHCIRwgHMIBwiEcwgHCIRwgHMIBwiEcIBzCAcIhHIBwCAcIh3CA");
("cAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAcIhHMIBwiEcIBzCAcIhHCAcwgHCIRzCAcIhHCAc");
("wgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHIBzCAcIhHCAcAMIBCAcgHIBwAMIBIByAcADC");
("AQgHIBwAwgEIByAcgHAAwgEIB4BwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcg");
("HIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIByA");
("cAAIB/CKBX8yw0V7YSOJAAAAAElFTkSuQmCC");
const FOLD_SHOT_TALL =
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAAFoCAIAAACdUSOTAAADD0lEQVR42u3SsQ2AIBRFUaYxVszhNIxjYy1DfhpXoPgJkpzkTvDeKcdZpfSKCQSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYGk1rPt5pfTAEljaCFbEkNIDS2AJLIFlBYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsATWVL1d2jewBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwPINWGAJLIElsMASWAJLYIElsASWwAJLYAksgQWWwBJYAgssgSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAElnvAAktgCSyBBZbAElgCCyyBJbAEFlgCS2AJLLAElsASWGCBBZbAElhggQWWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElsAygcASWAJLAktgCSwJLIElsCSwBJbAksASWAJLAktgCSwJLP20D2a4hLjaytrlAAAAAElFTkSuQmCC";
("NIxjYy1DfhpXoPgJkpzkTvDeKcdZpfSKCQSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJ");
("YAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYGk1rPt5pfTAEljaCFbE");
("kNIDS2AJLIFlBYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsASW");
("BJbAElgSWAJLYElgCSyBJYElsATWVL1d2jewBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASW");
("wAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbA");
("AgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsAC");
("CyywBJbAAgsssASWwPINWGAJLIElsMASWAJLYIElsASWwAJLYAksgQWWwBJYAgssgSWwBBZYYIEl");
("sAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWw");
("BBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAE");
("FlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAElnvAAktgCSyBBZbAElgC");
("CyyBJbAEFlgCS2AJLLAElsASWGCBBZbAElhggQWWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgC");
("S2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSW");
("wBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElsAygcASWAJLAktgCSwJLIEl");
("sCSwBJbAksASWAJLAktgCSwJLP20D2a4hLjaytrlAAAAAElFTkSuQmCC");

const SHOT_BYTES = {
	one: FOLD_SHOT_ONE,
	two: FOLD_SHOT_TWO,
	three: FOLD_SHOT_THREE,
	tall: FOLD_SHOT_TALL,
} as const;

/**
 * One picture as the reducer hands it over: inline bytes, so nothing here
 * reaches a backend, a port or a store on disk.
 */
const shot = (
	name: keyof typeof SHOT_BYTES,
	index: number,
): TranscriptImage => ({
	id: `s${index}:${name}`,
	data: SHOT_BYTES[name],
	attachment: null,
	mimeType: "image/png",
});

/**
 * The row's own media, composed the way `canonical-transcript.tsx` composes it
 * (`mt-1 ml-5`, the full ceiling, a position as the name).
 *
 * Mirrored rather than imported because the transcript's composition is a
 * private branch of a 2,600-line module; the sheet above mirrors the
 * transcript's column for the same reason, and the frame exists to show what
 * EXPANDING costs beside what the strip costs. The strip itself is the real
 * component in every frame, because that is what is being judged.
 */
const RowPictures = ({ images }: { images: TranscriptImage[] }) => (
	<div className="mt-1 ml-5 flex flex-col gap-2">
		{images.map((image, index) => (
			<CanonicalImage
				key={image.id}
				image={image}
				scope={null}
				label={images.length === 1 ? "Screenshot" : `Screenshot ${index + 1}`}
			/>
		))}
	</div>
);

/** The run's pictures as the fold carries them while condensed. */
const foldPictures = (images: TranscriptImage[]) => (
	<FoldMedia images={images} scope={null} />
);

const IMAGE_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "python3 scripts/plot.py --out out/network_f0w.png",
		durationS: 2.4,
	},
	{
		name: "read",
		object: "out/network_f0w.png",
		durationS: 0.3,
		images: [shot("one", 0)],
	},
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

const IMAGE_ACTIONS = IMAGE_ROWS.map((spec) => spec.images?.[0]).filter(
	(image): image is TranscriptImage => image !== undefined,
);

/**
 * THE BEFORE FRAME, and the reason it is a story rather than a claim: condensing
 * is new, and the state it left behind is "the artifact is not on screen". This
 * renders the same run as `ImageShown` with the strip withheld, which is exactly
 * what the shipped component does when no `condensedMedia` is passed - so the
 * pair differs in the picture and nothing else.
 */
export const ImageHidden: Story = {
	args: {
		...foldProps(IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3"],
		children: <FoldRows specs={IMAGE_ROWS} />,
	},
};

/** The same finished run AFTER: the picture it produced is on screen. */
export const ImageShown: Story = {
	args: {
		...foldProps(IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(IMAGE_ACTIONS),
		children: <FoldRows specs={IMAGE_ROWS} />,
	},
};

const THREE_IMAGE_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "python3 scripts/plot.py --all --out out/",
		durationS: 4.8,
	},
	{
		name: "read",
		object: "out/network_f0w.png out/latency.png out/phone.png",
		durationS: 0.4,
		images: [shot("one", 1), shot("two", 1), shot("tall", 1)],
	},
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

/** Three pictures, one of them a portrait capture: the cost the wrap is about. */
export const ImagesThree: Story = {
	args: {
		...foldProps(THREE_IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 7_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(THREE_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		children: <FoldRows specs={THREE_IMAGE_ROWS} />,
	},
};

const LIVE_IMAGE_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "python3 scripts/plot.py --out out/network_f0w.png",
		durationS: 2.4,
	},
	{
		name: "read",
		object: "out/network_f0w.png",
		durationS: 0.3,
		images: [shot("one", 0)],
	},
	{
		name: "bash",
		object: "git push origin feat/condensed-group-images",
		durationS: null,
		executing: true,
	},
];

/**
 * THE LIVE WINDOW: the picture has landed, the run has not finished, and the
 * group is condensed (it arrives that way; only the reader opens it). The strip
 * is the same element it will be once the section ends - `trace-fold-behaviour`
 * asserts that identity across the settle - so this frame and `ImageShown` are
 * the two things a reader sees around that transition.
 */
export const ImageLive: Story = {
	args: {
		...foldProps(LIVE_IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 9_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(LIVE_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		children: <FoldRows specs={LIVE_IMAGE_ROWS} />,
	},
};

/**
 * The reader's own press, on the run that produced a picture: the rows are back
 * and the picture is drawn by the row that produced it, at the transcript's own
 * ceiling - and the strip is NOT rendered beside them, which is what keeps one
 * picture from being on screen twice. The pair against `ImageShown` is the
 * whole height argument in two frames.
 */
export const ImageExpanded: Story = {
	parameters: { picturesLatch: "open" },
	args: {
		...foldProps(IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(IMAGE_ACTIONS),
		children: <FoldRows specs={IMAGE_ROWS} />,
	},
};

const MANY_IMAGE_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "node scripts/capture-evidence.mjs --only=chat- --themes=all",
		durationS: 41.6,
	},
	{
		name: "read",
		object: "out/*.webp (8 frames)",
		durationS: 1.2,
		images: [
			shot("one", 2),
			shot("two", 2),
			shot("three", 2),
			shot("tall", 2),
			shot("one", 3),
			shot("two", 3),
			shot("three", 3),
			shot("tall", 3),
		],
	},
	{ name: "bash", object: "git add docs/evidence", durationS: 0.2 },
];

/**
 * THE PATHOLOGICAL CASE, framed rather than argued: eight pictures in one run.
 *
 * Three pictures and one cost the same row; eight are the count at which the
 * column genuinely cannot hold another 64px tile, so the strip wraps and the
 * group grows by a second and third row. It is a real cost and it is the one
 * this design accepts - a scroller would hold the height constant and hide the
 * count, which is the operator's complaint about hidden artifacts wearing a
 * different hat. The frame is here so the design round judges the trade from a
 * render, and the geometry rig reports the height it actually takes.
 */
export const ImagesMany: Story = {
	args: {
		...foldProps(MANY_IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 43_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(MANY_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		children: <FoldRows specs={MANY_IMAGE_ROWS} />,
	},
};
