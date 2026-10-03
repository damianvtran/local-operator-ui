/**
 * The queued-ask PANEL, which is now the whole of this mount.
 *
 * These render the PRODUCTION component from real `PendingAsk` fixtures — the
 * shape the backend publishes on the frontend state — so what is judged is what
 * ships. A live queue is worse than slow to photograph: the states that matter
 * most here are the ones a session produces least often. A queue of three with
 * one timed out, a multi-select question, a secret question, a truncated list
 * and an answered-late row are all ordinary in the backend's fold and rare on
 * anyone's screen at the moment a camera is pointed at it.
 *
 * ## What left this file, and where it went
 *
 * The minimized bar used to live here, and its stories with it. The affordance is
 * now an ITEM in the composer's status row — a peer of `All to-dos resolved` and
 * `2 wakes armed` — so the trigger's four states (waiting, settled, moved-on,
 * multiple) are photographed from
 * `composer-status-row.stories.tsx`, next to the chips they have to look right
 * beside. What stays here is everything that is a fact about the PANEL: the
 * question as asked and the answer as given, the countdown, the secret field, the
 * refusal and the enabled primary action. The panel is only ever mounted while
 * the item is expanded (`ask-surfaces.tsx` returns nothing when it is collapsed),
 * so every story below pins `expanded`.
 *
 * What to look for, since these frames are the design review (design
 * `docs/design/ask-nonblocking.md` §5.0, §5.2):
 *
 * - **The accent is spent exactly once per surface.** Inside the panel it is the
 *   status glyph and the primary control, and nowhere else — § 2's budget is
 *   about three accent spends a screen.
 * - **QUEUED and TIMED-OUT do not look alike.** The copy contract's sentences
 *   are the difference, and the timeout keeps its answer controls live: a
 *   timed-out ask is still answerable (that is the `late` path), so it must not
 *   be drawn as a closed state.
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
	component: AskSurfaces,
	parameters: {
		layout: "padded",
	},
	decorators: [
		(Story) => (
			<div className="w-[617px] bg-canvas p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AskSurfaces>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** One open ask, expanded: the form that answers it whole. */
export const ExpandedSingle: Story = {
	args: {
		frontend: frontend([ONE]),
		expanded: true,
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
		expanded: true,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A credential question: the masked field is the whole answer path. */
export const SecretQuestion: Story = {
	args: {
		frontend: frontend([SECRET]),
		expanded: true,
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
		expanded: true,
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
		expanded: true,
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
		expanded: true,
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
 * A COLLAPSED mount draws nothing at all.
 *
 * Worth its own story because the whole point of the move is that nothing about an
 * ask occupies the transcript's flow or the band above the box any more: the
 * trigger is a row item in the composer's status row, and this mount has no
 * collapsed surface left to paint. The pair with `Empty` is the difference between
 * "collapsed" and "nothing to show" — both render an empty frame, and only one of
 * them is a state a user is in.
 */
export const CollapsedDrawsNothing: Story = {
	args: {
		frontend: frontend([ONE]),
		expanded: false,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};
