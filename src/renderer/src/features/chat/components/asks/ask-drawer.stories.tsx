/**
 * The asks DRAWER: the queue, its chrome bar, its scroller and its card bodies.
 *
 * These render the PRODUCTION component from real `PendingAsk` fixtures — the
 * shape the backend publishes on the frontend state — so what is judged is what
 * ships. A live queue is worse than slow to photograph: the states that matter
 * most here are the ones a session produces least often. A queue of three with
 * one timed out, a multi-select question, a secret question, a truncated list
 * and an answered-late row are all ordinary in the backend's fold and rare on
 * anyone's screen at the moment a camera is pointed at it.
 *
 * ## What this file is now, and what it was
 *
 * The component was a column mounted on the composer's band, and the stories were
 * accordingly a bare panel at 617px with no chrome around it. It is now a SIDE
 * CANVAS (the design note's §2 decision), so the frames carry what that decision
 * bought: a 40px chrome bar with a scope line and a dismiss, a scroller the queue
 * can actually overflow into, and the family's own width (560px is the dock cap the
 * decorator pins). The minimized bar's stories left this file long ago — the
 * affordance is an ITEM in the composer's status row, photographed beside the other
 * chips in `composer-status-row.stories.tsx`.
 *
 * What to look for, since these frames are the design review (design
 * `docs/design/ask-nonblocking.md` §5.0, §5.2; `~/workspace/ask-panel-design-1004/ask-panel-design-note.md`):
 *
 * - **The accent is spent exactly once per surface.** Inside the drawer it is the
 *   status glyph and the primary control, and nowhere else — § 2's budget is
 *   about three accent spends a screen.
 * - **QUEUED and TIMED-OUT do not look alike.** The copy contract's sentences
 *   are the difference, and the timeout keeps its answer controls live: a
 *   timed-out ask is still answerable (that is the `late` path), so it must not
 *   be drawn as a closed state. THAT IS WHY IT IS NOT IN THE SETTLED SECTION: the
 *   section is history, and a row whose answer still reaches the agent is not
 *   history - not even a one-line one. The section's own rows keep their
 *   distinction on the status WORD instead (`Answered` beside `Answered late`),
 *   which is the only half of the sentence a one-line row can hold.
 * - **Pending first, always complete; settled collapsed** (the note's §4.5/D3):
 *   history must not drive the drawer's length.
 * - **Disabled changes colour, never opacity.** An incomplete draft's Submit is
 *   a colour step on its own ground, not a wash toward it.
 * - **The secret question is a masked field**, and it is the only place a
 *   credential is ever typed. Its value never reaches a draft that drives a
 *   render.
 * - **Many overflows the LIST, never the page** (the note's D1): with twelve queued
 *   asks the chrome bar holds its place and the transcript beside it does not move.
 *   The two rows after them timed out and are STILL ANSWERABLE, so they are pending
 *   cards too: fourteen outstanding, and no settled section in that frame.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../shared/desktop-session-contract";
import "../../../../styles/index.css";
import { AskDrawer } from "./ask-drawer";

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

const THREE: PendingAsk[] = [
	ONE,
	ask({
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
	}),
	ask({
		ask_id: "a-late",
		status: "late",
		answered_at: TS + 4 * MINUTE,
		delivered: true,
		answers: { target: ["production"] },
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
	asks,
	/*
	 * The wire's OUTSTANDING tally — `open` OR `timed_out` — not "waiting", which
	 * is the split the rows carry. See `ask-queue.ts`'s `AskQueueView.open`.
	 */
	asks_open: asks
		? asks.filter((row) => row.status === "open" || row.status === "timed_out")
				.length
		: null,
});

const meta = {
	title: "Chat/Asks/Queued asks",
	component: AskDrawer,
	parameters: {
		layout: "padded",
	},
	/*
	 * THE DRAWER'S OWN BOX, and the sizes are the family's rather than decorative: a
	 * 560px column with a fixed height is what the pane docks at when the row can
	 * afford it (`CANVAS_PANE_MAX_PX`), and the height is what makes the middle
	 * region's scroller a fact a frame can show - the D1 defect was a panel with no
	 * scroll owner, so a frame that gave it unlimited height could not show the fix.
	 */
	decorators: [
		(Story) => (
			/*
			 * A COLUMN, so the drawer stretches to the box's width: the app mounts it in
			 * `PaneSlot`, which sets the width inline, and a row-flex decorator left it at
			 * its content width (measured 390px of a 560px box) - a frame that would have
			 * shown a narrower drawer than the family ever draws.
			 */
			<div className="flex h-[640px] w-[560px] flex-col bg-canvas">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AskDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** One open ask, expanded: the form that answers it whole. */
export const ExpandedSingle: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
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
	args: {
		frontend: frontend(THREE),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A credential question: the masked field is the whole answer path. */
export const SecretQuestion: Story = {
	args: {
		frontend: frontend([SECRET]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A truncated frame. The wire caps the list, so the panel states the backend's
 * own outstanding tally rather than letting a prefix pass for the whole queue —
 * the reading the status-row item's clause takes from the same field.
 */
export const Truncated: Story = {
	args: {
		frontend: { asks: [ONE], asks_open: 12, asks_truncated: true },
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A published queue with nothing in it, EXPANDED: the panel mounts and states the
 * empty reading (`No asks outstanding. The agent is not waiting on anything.`).
 *
 * WHAT THIS FRAME IS AND IS NOT (QA round 1, Q-2: the note here used to say the
 * panel "is not even mounted", which its own `expanded: true` contradicts). This
 * story is the PANEL's mount, so the zero-queue fact it carries is the empty
 * sentence the panel draws when a caller pins it open. It is NOT the evidence that
 * the affordance is absent at zero: that is the status-row ITEM's own gate
 * (`sessionAsks !== null && rows.length > 0`), which this file does not render and
 * `scripts/composer-tabs.test.mjs` pins on the row. `CollapsedDrawsNothing` beside
 * it is the third state - a collapsed mount draws nothing at all.
 */
export const Empty: Story = {
	args: {
		frontend: { asks: [], asks_open: 0, asks_truncated: false },
		scope: "session",
		onClose: noop,
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
		scope: "session",
		onClose: noop,
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
		 * The state is "the row that was pressed shows the backend's refusal", and
		 * the row is in the panel — which is why the design round could not review
		 * it from any frame that did not open one (design round 2, D15).
		 */
		scope: "session",
		onClose: noop,
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
		scope: "session",
		onClose: noop,
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
 * MANY: the queue long enough that the drawer's own scroller is the thing on
 * trial (the design note's D1).
 *
 * Twelve queued asks in a 640px-tall drawer cannot all fit, so this frame is the
 * evidence that the overflow is the LIST's (`min-h-0 flex-1 overflow-y-auto`) and
 * not the page's: the chrome bar stays pinned at the top, the drawer does not
 * grow, and no page-level scroller appears.
 *
 * FOURTEEN OUTSTANDING, NO SETTLED SECTION (agent review round 1, M1; the row's own
 * README says the same). The two `timedOutAsk` rows are the backend's outstanding
 * set again - a timed-out ask stays answerable - so they are the last two pending
 * CARDS, not two settled one-liners, and the queue in this frame holds nothing for
 * the disclosure to collapse. The earlier note here claimed the opposite and the
 * README's row followed it; both now state the state the frame actually holds.
 */
export const ManyOverflow: Story = {
	args: {
		frontend: frontend([
			...Array.from({ length: 12 }, (_, index) =>
				ask({
					ask_id: `a-many-${index}`,
					questions: [
						{
							id: "target",
							question: `Which environment should I deploy change ${index + 1} to?`,
							options: [
								{
									label: "staging",
									description: "The shared pre-prod cluster",
								},
								{ label: "production", description: "Live traffic" },
							],
						},
					],
				}),
			),
			timedOutAsk("a-settled-1"),
			timedOutAsk("a-settled-2"),
		]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE SETTLED SECTION, OPENED: the pending cards first and complete, then one
 * section header whose body is one line per settled ask.
 *
 * THE PAIR THAT HAD TO BE TOLD APART IS THE PAIR THE SECTION HOLDS (agent review
 * round 1, M1 = UX U1 = design D1). A `timed_out` ask cannot be in here at all - the
 * backend's outstanding set folds it in, so it stays a pending card with its answer
 * controls (see `timedOutAsk`) - and this note used to claim this frame photographed
 * that pair, which the frame itself contradicts. What the section DOES hold is the
 * shipped look-alike pair: `Answered` and `Answered late`, which differ only in the
 * word a one-line row can carry, and that is the pair this frame now photographs.
 */
export const SettledSection: Story = {
	args: {
		frontend: frontend([
			ONE,
			timedOutAsk("a-settled-1"),
			answeredAsk(),
			answeredLateAsk(),
			declinedAsk(),
		]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A `timed_out` ask: STILL ANSWERABLE through the `late` path, so it is a PENDING
 * card rather than a settled row.
 *
 * The name is the claim (agent review round 1, M1): this fixture used to be called
 * `optionallySettled`, which described a state the backend does not produce - the
 * outstanding set folds `timed_out` in, so `presentAsk` marks the row `open`.
 */
function timedOutAsk(id: string): PendingAsk {
	return ask({
		ask_id: id,
		expires_at: TS - MINUTE,
		status: "timed_out",
		questions: [
			{
				id: "files",
				question: "Which files should the cleanup script touch?",
				options: [{ label: "logs only" }, { label: "logs and caches" }],
			},
		],
	});
}

/** An answer that reached the model before the deadline: SETTLED, and quiet. */
function answeredAsk(): PendingAsk {
	return ask({
		ask_id: "a-answered",
		status: "answered",
		answered_at: TS + 4 * MINUTE,
		delivered: true,
		answers: { target: ["staging"] },
		answered_by: { surface: "desktop" },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	});
}

/** THE SECTION'S OTHER HALF OF THE PAIR: the same answer, delivered after the ask gave up. */
function answeredLateAsk(): PendingAsk {
	return ask({
		ask_id: "a-answered-late",
		status: "late",
		expires_at: TS - 30 * MINUTE,
		answered_at: TS + 20 * MINUTE,
		delivered: true,
		answers: { target: ["production"] },
		answered_by: { surface: "mobile" },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	});
}

/**
 * THE OTHER DOOR'S FREE-FORM ANSWER, DRAWN (design round 1, D2's addendum).
 *
 * The composer's Enter is routed to the ask (design §5.0), and `sendToAsk` writes the
 * RAW TYPED TEXT into the first unanswered question's draft - so a value the option
 * list never offered reaches this card as a plain string. Before this round the card
 * drew NOTHING for it: every radio empty beside a question that was already answered,
 * which made an answer that did not come from the list indistinguishable from no
 * answer at all. The marked row under the two options is the fix, and this frame is
 * what it looks like.
 */
export const OtherAnswer: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		/* The state the composer's door produces: `prod` is not a label of `ONE`'s
		 * staging/production question, so it arrives as the free-form value. */
		drafts: { "a-7f3c": { target: ["prod"] } },
		onDraftChange: noop,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** Refused, and the agent was told: settled, and the one-liner says which word. */
function declinedAsk(): PendingAsk {
	return ask({
		ask_id: "a-declined",
		status: "declined",
		questions: [
			{
				id: "target",
				question: "Should I also rotate the deploy token while I am here?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
	});
}
