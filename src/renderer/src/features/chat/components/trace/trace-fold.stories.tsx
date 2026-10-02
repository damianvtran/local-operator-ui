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
import {
	type ComponentProps,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import "../../../../styles/index.css";
import { CanonicalImage } from "../../canonical/canonical-image";
import { FoldMedia } from "../../canonical/fold-media";
import { foldSummarySpec } from "../../canonical/trace-fold-model";
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
 * its name is known, which is what the header's live clause paints. `op` is the
 * call's operation token (`toolOp`), which the row's verb composition reads for
 * the meta tools - passed through here so the story cannot show a label the
 * app would not (`AgentOps` below is the operator's own shape).
 */
type RowSpec = {
	name: string;
	object: string;
	op?: string;
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
 * the summary from the actions' own names (`foldSummarySpec`), the counts from the
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
		? toolRowLabel(executing.name, executing.object, null, true, executing.op)
		: null;
	return {
		summary: foldSummarySpec(actions),
		actionCount: specs.length,
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
				op={spec.op}
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

/*
 * THE CALLER'S HALF OF THE CONTRACT, for every story (fold rounds,
 * 2026-09-27): the transcript owns the fold's open state (`fold-open.ts`, so an
 * explicit open survives the remounts a windowed run causes) and hands it back
 * as `open`. A story that rendered the fold bare would be imaging a caller that
 * does not exist - and the press, which several sweeps rely on, is this host's
 * `setOpen` exactly as it is the registry's. Hoisted to module scope, not
 * defined inside `render`: a component constructed per render is a new TYPE,
 * and React would remount the fold (and drop the state this exists to hold).
 */
const FoldHost = (props: ComponentProps<typeof TraceFold>) => {
	const [open, setOpen] = useState(false);
	// The spread's `open`/`onOpenChange` (the inert story defaults) are
	// deliberately overridden: the host plays the registry, and the press must
	// land in its state for the sweeps that click the trigger.
	return <TraceFold {...props} open={open} onOpenChange={setOpen} />;
};

const meta = {
	title: "chat/trace-fold",
	component: TraceFold,
	parameters: { layout: "fullscreen" },
	/*
	 * Completeness aid, not behaviour: `open`/`onOpenChange` are required props
	 * (the transcript's registry owns them), so every story declares them - but
	 * the HOST below is what actually drives them, exactly as the registry does.
	 * These defaults are inert.
	 */
	args: { open: false, onOpenChange: () => {} },
	render: (args, context) => (
		<Sheet>
			<FoldHost {...args} />
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

/*
 * 360x240 PNG, two similar text-bearing plots (D1):
 * generated off-repo by the pass's fixture rig and inlined here, like the four
 * above, so a frame needs no backend, port or store.
 */
const FOLD_PLOT_A =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAJSUlEQVR42u3dTW7bOhSG4SylnWQtXU0GQUdZUHdToIO7mt7JDRDA0LVsiv8iqQd4EbSuI+srz3lNSrL18vfvvwCQxIv/AgDEAYA4ABAHAOIAQBwAQBwAiAMAcQAgDgDEAQDF4vj2/fXhg1/c/fX24MNH9tvcbyf8undbjt+fmO1EvnpGisOdAdYXx7MGCzfevrUeNlhG64YficnV7tXjtwwQx9Pf2v8MPK2kdQ/f4Z/NHaq8OnGAOF4Dk/yAOJ5N4B8uXg4XR5FLlbDmDreT9OpJ4rBUAXHkzzhi3tgPWzd7b1NT1J1xsAaIo7I48lq37tGK1uLgDlxLHDHnRwJLlfizKtkzjsPzLBWXKjEpMs7XAK7jAEAcAEAcAIgDAHEAmF0cb+8fN/YP7p+zfVr8xm9/3T/h8Lf2O/lwf2JS3L1uOHtSUuBy4ti3U+CRVPZbOxRHxm9FpriTSN2kAHEcvzMPK45wrv1P4gAqL1XiW72dOMJLp4w5yHbJs3++dQqII62xY/71FHEczguyFy8VkwKXFkdqg40mjnhNEAdQc8ZxeIYi+6xKxvmRwBOqn1VxSgXEAQDEAYA4ABAHAOIAQBwAUEccTj0CSBNHyWVdAIiDOACMsVT59v31959/AHRm7hnH2jcKKBke6aQbMx1xKD7ppJt2qWJ4pJNuQXE0hTikk444iEPxSUccxKH4pJOOOBSfdNIRh+KTTjriMDzSSUccxKH4pCMO4lB80klHHIpPOumIQ/FJJx1xKD7ppCMO4pBOOuIgDsUnHXEQh+KTTjriUHzSSUccik866YiDOKSTjjiIQ/FJRxzEofikk444FJ900hGH4pNOOuIwPNJJRxzEofikIw7iUHzSSUccik866YhD8UknHXEYHumkIw7ikE464iAOxScdcRCH4pNOOuJQfNJJRxyKTzrpiIM4pJOOOIhD8UlHHMSh+KSTbh5xfGYYkB8/f90Ycw+BEsw4KrNVxg3vWtJJRxxRvrh7XPFJJx1xHCtj/wTFJ510VxdH0nokzx2KTzriOL97z33RjD1UfNIRR78jkY0kUr791F9UfNIRR4+lSiOJVNxa0hYUn3TE0fsYR/lkpNEUJn5rik864jjz4GiqRLqtehSfdMQxzVmVsEf6HGqNeQnFJx1xDHo6tr8y4t2h+KQjjgmu4+imjEh3KD7piOMqn1Wp6A7FJx1xEEeyOxSfdMRBHMnuUHzSEQdxJLtD8UlHHMSR7A7FJx1xEEeyOxSfdMRBHMnuUHzSEQdx1L8mXWtJRxzE0ckdp1wmq7WkI4753HHWR3K0lnTEccLwlH9pUNgUJ7pDaxEHcTQcnvjezptWnOUOrUUcxNF2eA6/P71wAXKKO7QWcRBH8+Fp/QUi/d2htYiDOHoMT+vjmsQhHXGsOTxNe7vzpENrEQdxLFJ8Pd2htYiDONYpvm7u0FrEQRxLFV8fd2gt4iCO1Yqvgzu0FnEQx4LFRxzSEYfiG27SobWIgzjWLL6m7tBaxHHM2/sHccxYfO3cobWI49gaxDFv8TVyh9YijuO5BnFMXXzEIV1Xcdx80U4cnxnQmu3XoAI9xLHFjGPed63qCxbvyWYcDo5eovjqukNrEQdxXKX4KrpDaxGH6zguVHy13KG1iIM4rlV8xCEdcSi+cyYdWos4iONyxVfujnC6QW7+QhzEQRxjueNhugFvHEUcxEEcA7ljf/OHgCamcwdxEIfia3KgdJYbRxEHcRDH+ZOOkjXIRO4gDuJQfKX9XPGYxSzuIA7iUHyZ/Rz2RXa6KdxBHMSh+IqOWTxr8pJ047uDOIhD8eW7o126wd1BHMSh+JqcZClPN7I7iIM4FN+46YZ1h7EjDsU3dLox3WHsiEPxjZ7urMvSAwd0jB1xEMcE6Tq74/DkkbEjDuKYJl0HdzwzRa2rVIiDOIjjhHTt3HF4pnn7T8aOOIhjsnTV3RF/ccr2PhLGjjiIY7J0tdyR8eGaSb95iDgMj3QVGrjk83jLu4M4iGPldIVtX8U7xo44iGO+dHmrjCpfxbywO4hDa62fLumgZt3bTa3qDuLQWpdIF3MOtdGdcZd0B3ForaukC1yy1aKxt+nOdUdTLRKH1lo/Xc+7LtylO+XTNO3CEofWula6bjdq2afr6Y6HMSvuAHForcul69O6z9K1dkfYjBXPGRGH1pKua7pG7si4Lp44tJZ0M6Wr646S6+IL78LXUBxv7x9fEIfWkq6uO6pcF5+xD83FsfVFC3cQh3TzpqtyY6pC++RtoetShTi0lnTlfVv9xFDG1vqJo91S5TMDMC/br/CIfGbk8zP2IX6zPcTRyBpmHNKtkS715rsnfqin68FRZ1W0lnR5TdvtirWkZUuPg6NbiENrSRfpjs7KSHKH6zi0lnQDpev2UZrCZQtxaC3pxkp3ujJi9oQ4tJZ0w6Ub5/s7Wtynjji0lnSXSFf3PnXEofiku0q6u6kHcSg+6aRLdgdxKD7ppGv+2RbiUHzSXT1doTuIQ/FJd9F0xKH4pJOuazriUHzSSUccik866YhD8UknHXEQh3TSEQdxKD7piIM4FJ900hGH4pNOOuJQfNJJRxzEIZ10xEEcik864iAOxSeddMSh+KSTjjgUn3TSEYfhkU464iAOxScdcRCH4pNOOuJQfNJJRxyKTzrpiMPwSCcdcRCHdNIRB3EoPumIgzgUn3TStRHH2/vHF8Sh+KST7iXSGg//TByKTzriOBZHo0kHcUgn3bLi2P6sLg4Anekhju2kY2EHA5jmGAeABcXR+qwKgDXFAQDEAWA2cdyO6wYemZeVssScPl8s78LpnmXJSPdy7sB8/Xn/yBplt6Q79sZfKe/C6QK5JhPHbY/3jywwPAtPOp7lWuZtefm3gW2VTjbjCP+cfUjWyJIkDkuVSa0xkzj2wivJMOxc9zriWLKvlpxxPDywmGFGxzgc46jwnrxquvWO4NRaYzqr4qxKUbqSd60pxm69aPs404gDgOs4ABAHABAHAOIAQBwAiAMAcSSf1Q+cPQ5cVLP8J0oB4oi6BjT+OtErXG0JEAdxAMTxf378/BUgfBFr5FJl/1srXbYMEMeBOJJmHPFzEADEQRwAcQQVELN4IQ7guuIAQBwAQBwAiAMAcQAgDgDEAQDEAYA4ABAHAOIAQBwAQBwAiAMAcQAgDgDEAeDq/AdwazGRL3nyPgAAAABJRU5ErkJggg==";
/*
 * 360x240 PNG, the second of the similar pair (D1):
 * generated off-repo by the pass's fixture rig and inlined here, like the four
 * above, so a frame needs no backend, port or store.
 */
const FOLD_PLOT_B =
	"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";
/*
 * 360x240 PNG, a canvas at the LIGHT page tone (D2):
 * generated off-repo by the pass's fixture rig and inlined here, like the four
 * above, so a frame needs no backend, port or store.
 */
const FOLD_LIGHT_CANVAS =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAFhUlEQVR42u3aTW7qQBAAYc6FWHH/ddaRwjabnCALpMjy/Lg9NhmP+aRSpEfAVLpDPRty+fn+AoBVXIwAgHAAEA4AwgFAOAAIBwAIBwDhACAcAIQDgHAAgHAAEA4AwgFAOAAIRwPX2z1745PSLbNvTe8we+AuR05tK8epPDsgHC8MR+nlWn8xV44WP04akeCj/JYAxw1HJCvx5yolIP0qHMCo4fg7HShdmDSEY3ac7HNFLotcpwDnv1RZdfESfPaIAyAc53yPI3umk/5TOICe4Yic9i9+9hF80bZ9hhIJmUsVwN9xABAOAMIBQDgACAcACAcA4QAgHACEA4BwABAOABAOAMIBQDgACAcA4QAA4QAwRDgenx8A+jJkOA5YSlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcLBixUo4LJgVK+EwSlashMMoWbFiJRysWLESDlasWAmHBbNiJRxGyYqVcBglK1ashIMVK1bCwYoVK+GwYFashMOCWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRz7SwPoizMOVqxYuVSxYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbFiJRysWLESDlasWAmHBbNiJRwWzIqVcBglK1ashIMVK1ZHDQeAvjjjYMWKlUsVC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYcFs2IlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwGCUrVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUrVsLBihUr4WDFipVwWDArVsJhwaxYCYdRsmLFSjhYsWJ11HAA6IszDlasWLlUsWBWrITDKFmxEg6jZMWKlXCwYsVKOFixYiUcFsyKlXBYMCtWwmGUrFixEg5WrFgJBytWrITDglmxEg4LZsVKOIySFSvhMEpWrFgJBytWrISDFStWwmHBrFgJh1GyYiUcRsmKFSvhYMWKlXCwYsVKOCyYFSvhsGBWrITDKFmxYiUcrFixEg5WrFgJhwWzYiUcFsyKlXAYJStWrISDFStWRw0HgL4442DFipVLFQtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHBbNiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcBglK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcFgwK1bCYcGsWAmHUbJixUo4WLFidchwADgrwgFAOAAIBwDhACAcAIQDAIQDgHAAEA4AwpHhers/Kd0y+1b2lvpxpjfGn730qOkdSj7pferHWTWNBsPgVCMTA/qHIxKF9Nc9+Khmhy2Pij/72p9ir58rMlVgmHDUX07p13cLxysMS1MFxgtH6UJg7aVB8Kx7doeGR2Wd41dJlcuQ7M/eZlhKUsORgWHOONbeEv9fuvJOwb+dcWw5B9lu6IwD53yPI/tWaPpP4RAOvOmnKvGzicibf4sn3pWLhe1vPS5+9hE5ZsOnKpFLMJ+qwN9xABAOAMIBQDgAQDgACAcA4QAgHACEAwCEA4BwABAOAMIBQDgAQDgACAcA4QAgHACEA4BwAIBwABAOAMIBYHB+AV0DxL6OCvCsAAAAAElFTkSuQmCC";
/*
 * 360x240 PNG, a canvas at the DARK page tone (D2):
 * generated off-repo by the pass's fixture rig and inlined here, like the four
 * above, so a frame needs no backend, port or store.
 */
const FOLD_DARK_CANVAS =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAFfElEQVR42u3aTU7jQBBA4VyEBTkAG7j/KbKMchYWSMhy/7i6bXB38klPaCYkzqNq8sZOuFzf3wCgiYsRABAOAMIBQDgACAcA4QAA4QAgHACEA4BwABAOABAOAMIBQDgACAcA4ejgcb/9kt5YuU/TwStHXn4re0v9OK1KgHAcE47Nl272xXzUkVcRafUB8LThqD9X+lU4gPnCsboQ6LsuyIYjPfLyW0Gf7MULgBHPODre4Djk7KZ+vqMdwOiXKt1nHE1RqDypcACDfqpy1Hsc3Z+hbP7ZRyqA3+MAIBwAhAOAcAAQDgAQDgDCAUA4AAgHAOEAAOEAIBwAhAOAcAAQDgDCYQoAhAPAvOH4+vwAcC5ThmPAUrJixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+EwSlashMMoWbFiJRysWLESDlasWAmHBbNiJRwWzIqVcBglK1ashIMVK1bCwYoVK+GwYFashMOCWbESDqNkxYqVcLBixUo4WLFiJRysWLESDgtmxUo4jJIVK+E4XhrAuTjjYMWKlUsVC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYcFs2IlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwGCUrVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUrVsLBihUr4WDFipVwWDArVsJhwaxYCYdRsmLFSjhYsWI1ajgAnIszDlasWLlUsWBWrITDKFmxEg6jZMWKlXCwYsVKOFixYiUcFsyKlXBYMCtWwmGUrFixEg5WrFgJBytWrITDglmxEg4LZsVKOIySFSvhMEpWrFgJBytWrISDFStWwmHBrFgJh1GyYiUcRsmKFSvhYMWKlXCwYsVKOCyYFSvhsGBWrITDKFmxYiUcrFixEg5WrFgJhwWzYiUcFsyKlXAYJStWrISDFStWo4YDwLk442DFipVLFQtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHBbNiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcBglK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcFgwK1bCYcGsWAmHUbJixUo4WLFiNWo4AJyLMw5WrFi5VLFgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwWDArVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYdRsmIlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsWIlHKxYsRIOVqxYCYcFs2IlHBbMipVwGCUrVqyEgxUrVkOGA8CzIhwAhAOAcAAQDgDCAUA4AEA4AAgHAOEAIBwZHvfbD6VbVt/K3lI/zvLG+LOXHrW8Q8knvU/9OE3T6DAMTjUyMeD8cESikP5zDz6q22HPo+LP3vpTHPVzRaYKTBOO+ssp/fpq4fgLw9JUgfnCUboQaL00CJ51r+7Q8aisc/wqqXIZkv3Z+wxLSeo4MjDNGUfrLfH/pSvvFPzbGceec5D9hs448JzvcWTfCk3/KhzCgRf9VCV+NhF582/zxLtysbD/rcfNzz4ix+z4VCVyCeZTFfg9DgDCAUA4AAgHAAgHAOEAIBwAhAOAcACAcAAQDgDCAUA4AAgHAAgHAOEAIBwAhAOAcAAQDgAQDgDCAUA4AEzON0GadY1EDvHVAAAAAElFTkSuQmCC";
/*
 * 360x235 PNG, a real screenshot, downscaled from this lane's live capture (D1):
 * generated off-repo by the pass's fixture rig and inlined here, like the four
 * above, so a frame needs no backend, port or store.
 */
const FOLD_SCREENSHOT =
	"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";
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
	plotA: FOLD_PLOT_A,
	plotB: FOLD_PLOT_B,
	lightCanvas: FOLD_LIGHT_CANVAS,
	darkCanvas: FOLD_DARK_CANVAS,
	screenshot: FOLD_SCREENSHOT,
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
				label={images.length === 1 ? "Image" : `Image ${index + 1}`}
			/>
		))}
	</div>
);

/**
 * The run's pictures as the fold carries them while condensed - as the render
 * function `TraceFold` takes, so the story's strip carries a real
 * `+N more images` action (which opens the fold in the app; the sweep never
 * presses it, and the real callers pass their own toggles).
 */
const foldPictures = (images: TranscriptImage[]) => (expand: () => void) => (
	<FoldMedia images={images} scope={null} onRevealMore={expand} />
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
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(IMAGE_ACTIONS),
		mediaCount: IMAGE_ACTIONS.length,
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
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(THREE_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (THREE_IMAGE_ROWS[1].images ?? []).length,
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
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(LIVE_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (LIVE_IMAGE_ROWS[1].images ?? []).length,
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
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(IMAGE_ACTIONS),
		mediaCount: IMAGE_ACTIONS.length,
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

/** The similar pair: two plots, same palette, different data (D1's deciding frame). */
const SIMILAR_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "python3 scripts/plot.py --metric latency --metric throughput",
		durationS: 3.1,
	},
	{
		name: "read",
		object: "out/latency-p95.png out/throughput.png",
		durationS: 0.4,
		images: [shot("plotA", 4), shot("plotB", 4)],
	},
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

/**
 * D1's deciding frame: the pair a reader most needs to tell apart, and the pair a
 * 64px tile cannot. Both pictures are the same size, the same palette and the same
 * layout, with different labels and different curves; at the tile the labels are
 * gone and the curves are a smudge, which is what makes this surface a PRESENCE
 * cue rather than a reader of the pictures.
 */
export const ImageSimilar: Story = {
	args: {
		...foldProps(SIMILAR_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 4_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(SIMILAR_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (SIMILAR_ROWS[1].images ?? []).length,
		children: <FoldRows specs={SIMILAR_ROWS} />,
	},
};

const SCREENSHOT_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "screencapture -x -l $(window_id) out/window.png",
		durationS: 1.6,
	},
	{
		name: "read",
		object: "out/window.png",
		durationS: 0.2,
		images: [shot("screenshot", 5)],
	},
	{ name: "bash", object: "git add docs/evidence", durationS: 0.2 },
];

/**
 * D1's other half: a REAL screenshot, downscaled from this lane's live capture of
 * the app. Text-heavy chrome at 0.27 scale is a field of grey bands - the state
 * that decides what this strip may claim, and the state a flat colour fixture
 * cannot reach.
 */
export const ImageScreenshot: Story = {
	args: {
		...foldProps(SCREENSHOT_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(SCREENSHOT_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (SCREENSHOT_ROWS[1].images ?? []).length,
		children: <FoldRows specs={SCREENSHOT_ROWS} />,
	},
};

const TONE_ROWS: RowSpec[] = [
	{
		name: "bash",
		object: "python3 scripts/render.py --theme light --theme dark",
		durationS: 2.2,
	},
	{
		name: "read",
		object: "out/light-canvas.png out/dark-canvas.png",
		durationS: 0.3,
		images: [shot("lightCanvas", 6), shot("darkCanvas", 6)],
	},
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

/**
 * D2's defect case, in BOTH palettes at once: each tile holds a picture whose own
 * canvas is the page's own ground. In the light frame the first tile is the case
 * that failed (a light-canvas picture on a light page, with only the tile's edge
 * to give it an extent); in the dark frame the second one is. THIS IS THE FRAME THAT
 * SHOWS THE TRADE the borderless tile makes: at rest the tile has no edge, so a
 * picture whose canvas is the page's own tone has ~1.0:1 against the page and only
 * the well (~1.07:1) behind it. The edge (`border-control`, >=3:1 on every ground)
 * returns on hover and focus; the resting extent is a tracked follow-up (a fill
 * role authored to branding section 2's findability floor).
 */
export const ImageTones: Story = {
	args: {
		...foldProps(TONE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(TONE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (TONE_ROWS[1].images ?? []).length,
		children: <FoldRows specs={TONE_ROWS} />,
	},
};

/**
 * The tile that has no bytes: a digest with no scope to ask for them, which is the
 * store's own "nothing to show" state and reaches the compact receipt without a
 * request. It is in the set because a receipt is the one tile state whose SHAPE is
 * new - prose would blow the strip's 78px - and because it is the state a broken
 * picture would need a visible extent in, which is why it keeps its edge at rest
 * while a working tile does not (the state is the information).
 */
export const ImageUnavailable: Story = {
	args: {
		...foldProps(IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures([
			{
				id: "s9:missing",
				data: null,
				attachment: "9f2c41ab73de5086c1b7a4e2d39f6a08",
				mimeType: "image/png",
			},
		]),
		mediaCount: 1,
		children: <FoldRows specs={IMAGE_ROWS} />,
	},
};

/**
 * THE COUNT THAT USED TO BE PATHOLOGICAL, framed rather than argued: eight
 * pictures in one run, and the CAP answering it (design review round 1, D3).
 *
 * The first cut let the strip wrap, so eight pictures cost a second row (166px at the old tile)
 * and 25-30 cost ~391px - past the ~338.7px an EXPANDED group costs, which is the
 * one case where condensing is the taller choice. The strip is now one row for any
 * count: four tiles and `+4`, 106px, flat. What the reader gives up is the
 * fifth slot - the fifth picture's tile, since the count takes it - not the
 * information: the count is in this header (`· 8 images`) and
 * in the strip's own name, and the rows behind the disclosure still hold all eight.
 * The frame is here so the design round judges that trade from a render.
 */
export const ImagesMany: Story = {
	args: {
		...foldProps(MANY_IMAGE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 43_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3"],
		condensedMedia: foldPictures(
			(MANY_IMAGE_ROWS[1].images ?? []) as TranscriptImage[],
		),
		mediaCount: (MANY_IMAGE_ROWS[1].images ?? []).length,
		children: <FoldRows specs={MANY_IMAGE_ROWS} />,
	},
};

const AGENT_OPS_ROWS: RowSpec[] = [
	{ name: "grep", object: "delegated", durationS: 0.2 },
	{
		name: "read",
		object: "src/renderer/src/features/chat/components/trace/tool-row-model.ts",
		durationS: 0.1,
	},
	{
		name: "read",
		object: "src/renderer/src/features/chat/canonical/trace-fold-model.ts",
		durationS: 0.1,
	},
	{ name: "glob", object: "src/renderer/src/features/**/*.ts", durationS: 0.1 },
	// The empty object is the DERIVED text, not a gap: `summaryFromArgs` drops
	// the operation selector once the verb says it (`toolOp`), and a listing
	// with nothing else in its arguments resolves to nothing to add.
	{ name: "agent", object: "", op: "list", durationS: 0.31 },
	{ name: "agent", object: "designer", op: "show", durationS: 0.12 },
	{ name: "agent", object: "ux-reviewer", op: "show", durationS: 0.11 },
];

/**
 * The operator's own shape, and the header it must not claim (2026-09-27).
 *
 * Four file reads and three agent-profile READS used to fold as `Explored 4
 * files, delegated 3 tasks` - the word for a hand-off spent on calls that
 * delegated nothing - while each row above it read `Delegated`. With the op
 * tier the same seven actions fold by kind under the profile calls' own noun
 * (`4 files · 3 agents`), and the rows carry the operation's verb (`Listed
 * agents`, `Viewed agent designer`). The rows behind the trigger are the same
 * composition the transcript paints (`FoldRows` renders the shipped `ToolRow`),
 * so a frame cannot claim a label the app would not produce.
 */
export const AgentOps: Story = {
	args: {
		...foldProps(AGENT_OPS_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 6_000, running: false },
		live: null,
		recordIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
		children: <FoldRows specs={AGENT_OPS_ROWS} />,
	},
};

/**
 * THE OPERATOR'S OWN LINE (2026-10-01, relayed by Aida), pinned as a state.
 *
 * A long run's header read `6 searches · 1 task · 2 browser actions · 1
 * ai_search · 1 get_tool_access · 1 query_data_sources · 1 todo update · 1
 * wait · 1 workspace_get_gmail_thread_content` - nine unique action types,
 * wider than the column at any realistic window - and the operator's ask was a
 * cap: keep the majority classes and summarise the tail as `and N other
 * actions`. This fixture IS that run (six fetches for the `searches` class,
 * one task, two browser calls, then the six singleton kinds), derived through
 * `foldProps` so the header states exactly what the shipped composition
 * produces - the cap's frames cannot photograph a string the app would not
 * paint, and the pre-cap tree renders this same fixture as the overflowing
 * line the report quotes (the `chat-trace-fold-before/` half).
 */
const MANY_TYPES_ROWS: RowSpec[] = [
	...Array.from(
		{ length: 6 },
		(_, index): RowSpec => ({
			name: "web_fetch",
			object: `https://docs.example.com/page-${index + 1}`,
			durationS: 1.2 + index * 0.4,
		}),
	),
	{
		name: "task",
		object: "audit the invoice journal",
		op: "list",
		durationS: 22.4,
	},
	{ name: "browser", object: "invoice tracker", op: "click", durationS: 3.1 },
	{
		name: "browser",
		object: "invoice tracker",
		op: "screenshot",
		durationS: 2.2,
	},
	{ name: "ai_search", object: "late invoices pattern", durationS: 8.7 },
	{ name: "get_tool_access", object: "linear", durationS: 0.3 },
	{ name: "query_data_sources", object: "warehouse.invoices", durationS: 6.9 },
	{ name: "todo", object: "add follow-up", op: "add", durationS: 0.2 },
	{ name: "wait", object: "3600", durationS: 3_600 },
	{
		name: "workspace_get_gmail_thread_content",
		object: "thread 18c2",
		durationS: 1.8,
	},
];

/** The nine-type run, capped by `foldCounts` to five segments and a tail. */
export const ManyTypes: Story = {
	args: {
		...foldProps(MANY_TYPES_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 3_659_000, running: false },
		live: null,
		recordIds: MANY_TYPES_ROWS.map((_, index) => `s${index + 1}`),
		children: <FoldRows specs={MANY_TYPES_ROWS} />,
	},
};

/**
 * THE RUN THAT KEEPS THE LONG KIND (design round 1's D1 ask, shot in round 2's
 * D3, with the same gap QA bounded as Q-r2-3): FIVE types, so the cap keeps every
 * segment, and the last of them is `workspace_get_gmail_thread_content` - the
 * 36-character snake_case kind that is the longest unit this header can compose.
 *
 * WHY THIS STATE NEEDED ITS OWN FIXTURE. `ManyTypes` above is the operator's nine
 * kinds, and the cap pushes this very kind into `and 4 other actions`; no other
 * fold story has it at all. So every committed frame until this one capped the
 * token into the tail, and the units' "never wraps, never overflows" guarantee - a
 * nowrap unit that stays inside the column because the column is wider than the
 * longest unit - rested on a class assertion rather than a picture.
 */
const MANY_TYPES_KEPT_ROWS: RowSpec[] = [
	{ name: "read", object: "src/invoices/query.ts", durationS: 0.4 },
	{ name: "web_fetch", object: "stripe.com/docs/invoices", durationS: 1.2 },
	{ name: "search_the_web", object: "late invoice rules", durationS: 3.4 },
	{ name: "bash", object: "pnpm vitest run", durationS: 12.5 },
	{
		name: "workspace_get_gmail_thread_content",
		object: "thread 18c2",
		durationS: 1.8,
	},
];

/** Five kinds, the long one KEPT: the widest unit the count line can paint. */
export const ManyTypesKept: Story = {
	args: {
		...foldProps(MANY_TYPES_KEPT_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 19_300, running: false },
		live: null,
		recordIds: MANY_TYPES_KEPT_ROWS.map((_, index) => `k${index + 1}`),
		children: <FoldRows specs={MANY_TYPES_KEPT_ROWS} />,
	},
};
