/**
 * The queued-ask surfaces: the minimized bar, and the panel it expands into.
 *
 * These render the PRODUCTION components from real `PendingAsk` fixtures — the
 * shape the backend publishes on the frontend state — so what is judged is what
 * ships. A live queue is worse than slow to photograph: the states that matter
 * most here are the ones a session produces least often. A queue of three with
 * one timed out, a multi-select question, a secret question, a truncated list
 * and an answered-late row are all ordinary in the backend's fold and rare on
 * anyone's screen at the moment a camera is pointed at it.
 *
 * What to look for, since these frames are the design review (design
 * `docs/design/ask-nonblocking.md` §5.0, §5.2):
 *
 * - **The bar reads as a chip, not a banner.** One line, the composer status
 *   chip's own triple (`surface` fill, `border-control` edge, `ink` copy), one
 *   persistent accent on the mark. Nothing animates: a pulse would be the
 *   focus-steal this whole design exists to avoid, expressed in colour.
 * - **The accent is spent exactly once per surface.** On the bar it is the
 *   mark; inside the panel it is the status glyph and the primary control, and
 *   nowhere else — § 2's budget is about three accent spends a screen.
 * - **QUEUED and TIMED-OUT do not look alike.** The copy contract's sentences
 *   are the difference, and the timeout keeps its answer controls live: a
 *   timed-out ask is still answerable (that is the `late` path), so it must not
 *   be drawn as a closed state. On the BAR the same distinction is the count:
 *   `MinimizedMixed` and `MinimizedMovedOnOnly` state how many asks are still
 *   WAITING on the user and how many the agent has moved on from, rather than
 *   folding the two into one "waiting" number.
 * - **Urgency is painted.** An ask the backend derived a short window for
 *   (`timeout <= 900`) takes warning ink on the row's mark and on the bar's
 *   glyph - `MinimizedUrgent`, `ExpandedUrgent` - where it used to look
 *   identical to one with an hour left.
 * - **The deadline is on the COLLAPSED bar.** `expires in 30m` beside the
 *   sentence, from the soonest deadline across the waiting asks, so the reader
 *   can triage without expanding anything.
 * - **Disabled changes colour, never opacity.** An incomplete draft's Submit is
 *   a colour step on its own ground, not a wash toward it.
 * - **The secret question is a masked field**, and it is the only place a
 *   credential is ever typed. Its value never reaches a draft that drives a
 *   render.
 * - **Zero asks draws nothing at all**, and a backend that does not publish
 *   `asks` draws nothing either — those are different states with the same
 *   frame, which is why both are stories.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../shared/desktop-session-contract";
import "../../../../styles/index.css";
import { EMPTY_DRAFTS, askQueueView } from "../../ask-queue";
import { AskPanel } from "./ask-panel";
import { AskSurfaces } from "./ask-surfaces";

const TS = 1_760_000_000_000;
const MINUTE = 60_000;

/** The clock every frame is pinned to, so the countdown reads the same twice. */
const NOW = TS + 12 * MINUTE;

const ask = (over: Partial<PendingAsk> & { ask_id: string }): PendingAsk => ({
	created_at: TS,
	expires_at: TS + 60 * MINUTE,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	...over,
});

const ONE: PendingAsk = ask({
	ask_id: "a-7f3c",
	questions: [
		{
			id: "target",
			question: "Which environment should I deploy this to?",
			options: [
				{
					label: "staging",
					description: "The shared pre-prod cluster",
					recommended: true,
				},
				{ label: "production", description: "Live traffic" },
			],
			multi: false,
		},
	],
});

/**
 * THE ASK WHOSE DEADLINE PASSED: the agent moved on, and a late answer still
 * lands. Named rather than inlined because the split the bar now prints - and
 * the moved-on-only state below - are both about this one row, and a fixture
 * copied twice is a state that can drift from the sentence written about it.
 */
const MOVED_ON: PendingAsk = ask({
	ask_id: "a-91be",
	timeout_s: 900,
	urgent: true,
	expires_at: TS - MINUTE,
	status: "timed_out",
	questions: [
		{
			id: "files",
			question: "Which files should the cleanup script touch?",
			options: [
				{ label: "logs only" },
				{ label: "logs and caches" },
				{ label: "everything under tmp" },
			],
			multi: true,
		},
	],
});

/**
 * THE TWO-WINDOW QUEUE (design round 1, D2). Two asks are WAITING and their
 * windows differ, which is the one shape that makes the bar's two readings
 * diverge: `head` is the OLDEST waiting ask (here `Deploy the staging release?`,
 * 2h out) while the deadline it prints is the SOONEST across the waiting set
 * (here `Rotate the API keys now?`, 12m out). Before this round's fix the bar
 * named one ask beside the other's countdown, which is what this frame is for.
 *
 * The older ask is listed first because `head` is oldest-first, and the same
 * fixture is deliberately NOT urgent on either side so the deadline is the only
 * fact the frame carries. The windows are stated from the story clock (`NOW` is
 * 12 minutes after `TS`), so the SOONER ask is `NOW + 12m` - not `TS + 12m`,
 * which is already due and photographs `soonest expiring now`.
 */
const TWO_WINDOWS: PendingAsk[] = [
	ask({
		ask_id: "a-depl",
		timeout_s: 7200,
		expires_at: TS + 120 * MINUTE,
		questions: [
			{
				id: "target",
				question: "Deploy the staging release?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
	}),
	ask({
		ask_id: "a-keys",
		timeout_s: 720,
		expires_at: TS + 24 * MINUTE,
		created_at: TS + MINUTE,
		questions: [
			{
				id: "rotate",
				question: "Rotate the API keys now?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
	}),
];

/**
 * THE SHORT-WINDOW ASK. The backend derives `urgent` from the timeout itself
 * (`timeout <= 900`), so the fixture marks it the same way the wire does rather
 * than inventing a second rule a frame could photograph.
 */ const URGENT: PendingAsk = ask({
	ask_id: "a-ur01",
	timeout_s: 600,
	urgent: true,
	expires_at: TS + 30 * MINUTE,
	questions: [
		{
			id: "rollback",
			question: "Should I roll the staging cluster back to the previous build?",
			options: [{ label: "yes" }, { label: "no" }],
		},
	],
});

const THREE: PendingAsk[] = [
	ONE,
	MOVED_ON,
	ask({
		ask_id: "a-c204",
		status: "late",
		answered_at: TS + 8 * MINUTE,
		delivered: true,
		answers: { target: ["staging"] },
		answered_by: { surface: "phone" },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	}),
];

const SECRET: PendingAsk = ask({
	ask_id: "a-sec1",
	questions: [
		{
			id: "DEPLOY_TOKEN",
			question: "Paste the deploy token for the staging cluster.",
			options: [],
			secret: true,
			persist: true,
		},
	],
});

const frontend = (
	asks: PendingAsk[] | null,
): Pick<CanonicalFrontendState, "asks" | "asks_open" | "asks_truncated"> => ({
	asks: asks,
	/*
	 * THE TALLY IS THE BACKEND'S OUTSTANDING SET - `open` OR `timed_out` (a
	 * timed-out ask is still answerable, so `asks/store.py`'s
	 * `OUTSTANDING_STATUSES` counts it). This helper used to count `open` alone,
	 * which made every fixture carrying a timed-out ask disagree with the backend
	 * it stands in for: `asks_open` is what the bar's settled branch and the
	 * carrier's clock read, so the miscount photographed a moved-on-only queue as
	 * "1 settled" - a state that wire cannot produce.
	 */
	asks_open: asks
		? asks.filter((row) => row.status === "open" || row.status === "timed_out")
				.length
		: null,
});

const meta = {
	title: "Chat/Asks/Queued asks",
	component: AskSurfaces,
	parameters: {
		layout: "padded",
	},
	decorators: [
		/*
		 * THE PANE MEASURE IS A PARAMETER, not a constant (design round 1's D3).
		 * The chat column is a fraction of the app's window and the app's own
		 * minimum (800x600) leaves about 300px for it, so "the bar still reads at
		 * the pane floor" is a claim this set has to be able to PHOTOGRAPH rather
		 * than argue from arithmetic. A story states `parameters.paneWidth`; every
		 * story that does not gets the default 617px the set was built at, so no
		 * existing frame moves.
		 */
		(Story, context) => (
			<div
				className="bg-canvas p-4"
				style={{ width: (context.parameters.paneWidth as number) ?? 617 }}
			>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AskSurfaces>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** The default a fresh ask lands in: one line, collapsed, nothing stolen. */
export const MinimizedOne: Story = {
	args: {
		frontend: frontend([ONE]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** Three asks, one already timed out: the bar states both halves of the queue. */
export const MinimizedSeveral: Story = {
	args: {
		frontend: frontend(THREE),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE SPLIT (audit). One ask is still inside its window and one has passed its
 * deadline with the agent walking on, and the bar says BOTH rather than calling
 * them all "waiting": `1 waiting · 1 moved on`.
 *
 * The moved-on row is the same `a-91be` fixture the timeout row uses, so the
 * bar's sentence and the panel's status line can be read against one ask.
 */
export const MinimizedMixed: Story = {
	args: {
		frontend: frontend([ONE, MOVED_ON]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * NOTHING IS WAITING ON THE USER. Every ask has passed its deadline and the agent
 * moved on; a late answer still lands. The bar used to read "1 question waiting"
 * here, which is the one claim this state contradicts.
 */
export const MinimizedMovedOnOnly: Story = {
	args: {
		frontend: frontend([MOVED_ON]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * URGENT, which the wire carried and no desktop surface painted until the bar
 * took a warning arm for it. The window is short (`timeout <= 900`), so the glyph
 * takes `warning` instead of the accent - and the deadline beside the sentence is
 * the reading that says why it matters.
 */
export const MinimizedUrgent: Story = {
	args: {
		frontend: frontend([URGENT]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/*
 * The three expanded stories render the PANEL directly rather than trying to
 * drive the bar's own chevron: the expand flag is client-local state inside
 * `AskSurfaces`, and a story that reached in to flip it would be testing its own
 * harness instead of the component. The rows still come from production code —
 * `askQueueView`, the same fold every mount reads — so the classification, the
 * ordering and the counts under review are the shipped ones.
 */
const panelView = (asks: PendingAsk[]) => askQueueView(frontend(asks));

const Expanded = ({ asks }: { asks: PendingAsk[] }) => (
	<AskPanel
		view={panelView(asks)}
		nowMs={NOW}
		// The story owns no draft: a frame is a still, and a still with a
		// half-filled form would photograph a transient rather than a state.
		drafts={EMPTY_DRAFTS}
		onDraftChange={noop}
		onAnswer={noop}
		onDecline={noop}
	/>
);

/** One open ask, expanded: the form that answers it whole. */
export const ExpandedSingle: Story = {
	render: () => <Expanded asks={[ONE]} />,
	args: {
		frontend: frontend([ONE]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * The queue at its honest worst: an open ask, a timed-out one that is still
 * answerable, and a late answer already delivered by another surface.
 */
export const ExpandedSeveral: Story = {
	render: () => <Expanded asks={THREE} />,
	args: {
		frontend: frontend(THREE),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A credential question: the masked field is the whole answer path. */
export const SecretQuestion: Story = {
	render: () => <Expanded asks={[SECRET]} />,
	args: {
		frontend: frontend([SECRET]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE URGENT ROW, expanded. The mark beside the status line takes the warning ink
 * an urgent ask earns, so the row a reader should triage FIRST is the one that
 * looks different - and the sentence beside it still says when it expires.
 */
export const ExpandedUrgent: Story = {
	render: () => <Expanded asks={[URGENT]} />,
	args: {
		frontend: frontend([URGENT]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A truncated frame. The wire caps the list, so the bar says what it is showing
 * rather than letting a prefix pass for the whole queue.
 */
export const Truncated: Story = {
	args: {
		frontend: { asks: [ONE], asks_open: 12, asks_truncated: true },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A published queue with nothing in it: the affordance is absent at zero. */
export const Empty: Story = {
	args: {
		frontend: { asks: [], asks_open: 0, asks_truncated: false },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A backend that predates queued asks. This frame is IDENTICAL to `Empty`'s by
 * design — the capability is field presence, and absence means "not supported"
 * rather than "none right now" — which is exactly why it is worth a frame of its
 * own: a reader comparing them is checking that the app does not invent an
 * affordance it cannot satisfy.
 */
export const UnsupportedBackend: Story = {
	args: {
		frontend: { asks: null, asks_open: null, asks_truncated: null },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** The refusal a settled ask comes back with, on the row that was pressed. */
export const Refused: Story = {
	args: {
		frontend: frontend([ONE]),
		/*
		 * EXPANDED, or the story photographs the wrong surface: without it the panel
		 * never mounts and the refusal sentence it exists for is not painted at all
		 * - which is why the design round could not review the refused row from any
		 * frame in the set (design round 2, D15). The state is "the row that was
		 * pressed shows the backend's refusal", and the row is in the panel.
		 */
		expanded: true,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		outcomes: {
			"a-7f3c": {
				sending: false,
				refused:
					"That question was already settled, so your answer was not sent.",
			},
		},
	},
};

/**
 * THE ANSWERABLE STATE (design round 2, D15): a complete draft, so the primary
 * action is ENABLED.
 *
 * The designer could not reach it from any story - `Expanded` deliberately owns no
 * draft - and an enabled control is exactly the state a disabled-state frame cannot
 * vouch for: the two differ by ground AND, since D7, by edge, so a reader comparing
 * the pair is checking a real difference rather than one frame twice.
 */
export const AnswerReady: Story = {
	args: {
		frontend: frontend([ONE]),
		/* The panel opens on the same door the app uses. */
		expanded: true,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		/*
		 * A COMPLETE draft for the ask's only question: `askAnswerMap` returns a body
		 * for exactly this shape, which is the condition `Send answer` enables on.
		 */
		drafts: { "a-7f3c": { target: ["staging"] } },
	},
};

/**
 * TWO WINDOWS, ONE BAR (design round 1, D2). The bar names the oldest waiting ask
 * and prints the soonest deadline across the waiting set; with two windows those
 * are different asks, so the deadline carries the `soonest ` scope word and the
 * sentence keeps the noun its mixed form used to drop (UX round 1, U4).
 */
export const MinimizedTwoWindows: Story = {
	args: {
		frontend: frontend(TWO_WINDOWS),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A MOVED-ON ASK, EXPANDED (design round 1, D5). The urgency arm steps the ink
 * and KEEPS the status glyph, so a timed-out urgent row still wears its Clock -
 * the state the first cut turned into a second `?` and which no frame could show,
 * because the set expanded `URGENT` (status `open`) and never `MOVED_ON`.
 */
export const ExpandedMovedOn: Story = {
	render: () => <Expanded asks={[MOVED_ON]} />,
	args: {
		frontend: frontend([MOVED_ON]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE NARROW PANE (design round 1's D3, UX round 1's U5): 393px, the width the
 * design round asked for by name. The question keeps its room and the deadline is
 * still rendered at this width - the pane the app's own 800px minimum window
 * leaves is the next story.
 */
export const MinimizedMixedNarrow: Story = {
	parameters: { paneWidth: 393 },
	args: {
		frontend: frontend([ONE, MOVED_ON]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE PANE FLOOR (about 300px of chat column, which is what the app's own
 * 800x600 minimum window leaves for the pane). Here the deadline YIELDS entirely
 * rather than squeezing the question - the rule `ask-bar.tsx` states and this
 * frame exists to falsify: below 20rem of BAR width it is not rendered, and the
 * question is the thing that keeps its room.
 */
export const MinimizedPaneFloor: Story = {
	parameters: { paneWidth: 300 },
	args: {
		frontend: frontend([ONE, MOVED_ON]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};
