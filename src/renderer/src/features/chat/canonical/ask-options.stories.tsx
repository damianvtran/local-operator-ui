/**
 * The pending `ask` gate, across the states that decide whether its options
 * are answerable.
 *
 * These render the PRODUCTION `CanonicalTranscript` from real
 * `PendingDesktopGate` fixtures, so what is judged is what ships — not a
 * hand-built card with the same class names. A live gate is slow and awkward
 * to hold open for a photograph (it needs a model that asks, and it ends the
 * moment anyone answers), and the states that matter most here are the ones a
 * live session produces least often: eight options, a label that wraps, a
 * multi-question ask, a secret ask with no options at all.
 *
 * What to look for, since these frames are the design review:
 *
 * - **The options read as controls.** The previous version of this card was
 *   inert muted text numbered `1.`, `2.`, `3.` — indistinguishable from prose,
 *   and the whole defect. Each option now has its own fill and edge, so the
 *   card says "press one" without a sentence having to say it.
 * - **The options are OUTSIDE the accent wash, and that is deliberate.** The
 *   callout keeps the accent and owns the question; the buttons sit beneath it
 *   on the transcript's own ground. `border-control` on `accent-wash` measures
 *   2.69:1 at its worst (cyberpunk; 2.89:1 on iceberg) — under the 3:1
 * structural floor — so a bordered control inside the wash is not a thing that
 * can exist in any theme. They still read as one unit, by proximity and a
 * shared left rail.
 * - **The recommended option says the word.** Not a colour difference and not
 *   a bare glyph: the terminal card learned in its own design round that a
 *   marker styled like the prose around it cannot be found in a rendered frame
 *   without searching for it.
 * - **The ordinals survive.** They are the shortcut the terminal teaches, and
 *   typing one now resolves to that option's label rather than sending "1" —
 *   so the numerals are no longer a promise the app breaks.
 * - **The in-flight state disables by COLOUR, never opacity**, so the disabled
 *   card is legible on its own ground rather than washed toward it.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import type { PendingDesktopGate } from "../../../../../shared/desktop-session-contract";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const TS = 1_760_000_000_000;

/*
 * Every frame carries the user turn that provoked the question.
 *
 * Not decoration, and not merely realism: `CanonicalTranscript` COLLAPSES
 * itself to `h-0 overflow-hidden` when it holds no records, so the composer
 * band below can grow into the column instead of sitting under an empty void.
 * A gate rendered against an empty transcript therefore paints nothing at all
 * — the state is unreachable in the app, where a gate always follows the turn
 * that asked, and a story that fixtured it photographed a blank frame.
 */
function transcriptWith(text: string): TranscriptState {
	const records: TranscriptRecord[] = [
		{ kind: "user", id: "user:1", ts: TS, text, images: [] },
	];
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		// No pass in flight: the working line's `compacting` rung reads this, and
		// every story here is a settled or answering state, never a compaction.
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const gate = (over: Partial<PendingDesktopGate> = {}): PendingDesktopGate => ({
	request_id: REQUEST,
	kind: "ask",
	title: "Is the extension popup open?",
	detail: "",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

const Frame = ({
	pending,
	asked,
	height = 320,
	width = "100%",
	answering = false,
}: {
	pending: PendingDesktopGate;
	/** The user turn the question is an answer to. See `transcriptWith`. */
	asked: string;
	height?: number;
	width?: string;
	/** An answer is in flight: every option is disabled. */
	answering?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		/*
		 * A FLEX column of a fixed height, not a plain scroller.
		 *
		 * `CanonicalTranscript` is the app's scroll container and expects to be the
		 * flex child that absorbs the pane's leftover height (`min-h-0 grow`).
		 * Wrapped in a plain `overflow-y-auto` div it was instead free to grow to
		 * its own content height inside that div, which is how a story twice the
		 * pane's height photographed as the TOP of a document: the frame showed the
		 * callout and clipped the hint, which is not a state the app can be in. It
		 * is the pane's behaviour that matters for a height question, and the app
		 * pins the pane to its newest content — so the story has to be the pane.
		 */
		<div
			className="flex flex-col overflow-hidden p-6"
			ref={containerRef}
			style={{ width, height }}
		>
			<CanonicalTranscript
				transcript={transcriptWith(asked)}
				gate={pending}
				waiting={false}
				/*
				 * A story cannot admit a send, so the wait line is not in play here: the
				 * branch this file's frame is about is the pending question, which
				 * outranks the wait line anyway (`working-line-model.ts`).
				 */
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				// Required by main's failure-notice work, and a no-op here for the
				// same reason `onAnswer` is: this story renders no failure state,
				// so nothing can reach the action. The other canonical stories
				// pass an empty function too.
				onReconnect={() => {}}
				// `failure`, not the pre-rebase `error`: main's chat-failure work
				// replaced the transcript's error slot with the published failure
				// notice, and the rebase left this story naming a prop that no
				// longer exists. Null is the honest value either way - these
				// frames are about the pending gate, not about a failure - and
				// every other story in this directory passes it the same way.
				failure={null}
				// Required by this branch's hold work: the pane keys its placeholder on
				// whether a page for THIS session is still owed, so every call site states
				// it. This story's transcript has rows and nothing is in flight, and the
				// other canonical stories pass `false` for the same frames.
				awaitingHydration={false}
				answering={answering}
				// A no-op on purpose: these frames are about what the card LOOKS
				// like, and a story has no session to answer. The click path is
				// asserted in `scripts/ask-options.test.mjs` and demonstrated in a
				// real renderer on the PR.
				onAnswer={() => {}}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Ask options",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The common case: three options, the first one recommended. */
export const Options: Story = {
	render: () => (
		<Frame
			asked="Pair the browser extension so you can drive my browser."
			height={470}
			pending={gate({
				options: [
					{
						label: "Popup is open — generate the pairing code",
						description: "I will read the code back to you.",
					},
					{
						label: "Popup is not open",
						description: "Walk me through opening it first.",
					},
					{ label: "Something else" },
				],
				// Index 0, because `AskQuestion._shape` hoists the recommended
				// option to the top before the wire ever sees it.
				recommended: 0,
			})}
		/>
	),
};

/**
 * One option, which is the shape that most tempts a card into looking broken:
 * a single button under a question reads as a confirmation dialog unless the
 * free-text hint below it stays honest.
 *
 * NOT A PRODUCTION STATE, kept as defensive coverage. `AskQuestion._shape` in
 * the harness (`local_operator/harness/types.py`) rejects a non-secret ask with
 * fewer than two options — "at least two answers to pick from" — so a real `ask`
 * gate never arrives holding one. The frame is still worth having because the
 * component is what decides whether it degrades honestly if a future wire does
 * carry one; it is not evidence about a state a user can reach (code review
 * round 1, R-NIT).
 */
export const SingleOption: Story = {
	render: () => (
		<Frame
			asked="Cut the 0.18.0 release when the pipeline is green."
			height={380}
			pending={gate({
				title: "Ready to publish the release?",
				options: [
					{
						label: "Publish it",
						description: "Tags v0.18.0 and pushes to PyPI.",
					},
				],
			})}
		/>
	),
};

/**
 * Eight options — the density at which the ordinals earn their keep and at
 * which the option band has to cap itself.
 *
 * Captured at a 620px pane on purpose, which is the app's own default window
 * (1380x900 leaves the transcript about 617px once the header and the composer
 * band are taken out). Before the band had a ceiling this state pushed the
 * callout, the eyebrow and the question out of the top of the pane — the
 * options stayed visible and the question they answer did not (design round 1,
 * D1). At 620 the frame IS the failure mode the fix addresses, so a regression
 * shows up here rather than only at a window nobody runs.
 */
export const ManyOptions: Story = {
	render: () => (
		<Frame
			asked="Start the design pass on the desktop app."
			height={620}
			pending={gate({
				title: "Which surface should I start with?",
				options: [
					{ label: "Transcript", description: "The chat column itself." },
					{ label: "Composer", description: "Input, attachments, slash." },
					{ label: "Sidebar", description: "Session list and search." },
					{ label: "Settings", description: "Providers and credentials." },
					{ label: "Usage dialog", description: "Quota and spend." },
					{ label: "Update flow", description: "Download, verify, install." },
					{ label: "Notifications", description: "Toasts and banners." },
					{ label: "None of these", description: "I will describe it." },
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * Long labels and long consequence lines, both wrapping.
 *
 * The label and its description must stay distinguishable after they wrap, and
 * the ordinal must stay pinned to the first line rather than centring itself
 * against a three-line block.
 *
 * Captured at two widths. At the 1024 column the label does not wrap at all, so
 * the property this story exists for was never in any committed frame (design
 * round 1, D5); at 760 it still did not — the label box measured one 19.5px line
 * and the only thing that wrapped was the `Recommended` mark, so the frame this
 * story was read for showed the ordinal pinned against a wrapped MARK (design
 * round 2, D9). It is captured at 560 now, where the button's interior is
 * narrower than the label's own ~581px single-line measure and the label itself
 * has to wrap. Both widths ship because the difference between them is the point:
 * 1024 is "the label fits, everything on one line", 560 is "the label wraps and
 * the ordinal stays with its first line".
 */
export const WrappingLabels: Story = {
	render: () => (
		<Frame
			asked="The staging migration failed halfway through."
			height={620}
			pending={gate({
				title: "How should I handle the failing migration?",
				detail:
					"The migration is halfway applied on staging and the rollback script has never been exercised.",
				options: [
					{
						label:
							"Roll forward with a corrective migration that backfills the null column and re-runs the constraint",
						description:
							"Keeps the partial state and repairs it in place. Nothing is dropped, but the constraint stays unenforced until the backfill finishes, which on the current row count is roughly forty minutes.",
					},
					{
						label: "Roll back to the previous revision and re-plan",
						description:
							"Exercises the untested rollback path on staging, which is where you would rather discover it does not work.",
					},
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * A multi-question ask: the "Question 1 of 3." prefix has to survive beside
 * the new "Choose an option" hint, because knowing more questions follow is
 * what stops the first answer feeling like the last.
 */
export const MultiQuestion: Story = {
	render: () => (
		<Frame
			asked="Deploy the new enrichment worker."
			height={450}
			pending={gate({
				title: "Which environment am I deploying to?",
				options: [
					{ label: "Staging", description: "Safe to break." },
					{ label: "Production", description: "Customer traffic." },
				],
				question_index: 0,
				question_total: 3,
				recommended: 0,
			})}
		/>
	),
};

/**
 * An answer is in flight.
 *
 * Every option is disabled so a second press — or a typed send racing a click
 * — cannot post a second answer for one question, and the callout's eyebrow
 * says what is happening: "Sending your answer…", because with the eyebrow
 * static this state is indistinguishable from a press that never registered
 * (design round 1, D3; UX round 1, U2, measured at 9.1s of no feedback at all).
 * Disabled changes COLOUR and never opacity, which is what keeps this frame
 * legible rather than faded.
 */
export const AnswerInFlight: Story = {
	render: () => (
		<Frame
			asked="Pair the browser extension so you can drive my browser."
			height={470}
			answering={true}
			pending={gate({
				options: [
					{
						label: "Popup is open — generate the pairing code",
						description: "I will read the code back to you.",
					},
					{
						label: "Popup is not open",
						description: "Walk me through opening it first.",
					},
					{ label: "Something else" },
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * A `secret` ask, which arrives with EMPTY options.
 *
 * The assertion here is an ABSENCE: no option list renders, because the answer
 * is a credential pasted into the composer's masked input and a clickable list
 * has nothing to offer it. The hint falls back to "Type your answer below."
 */
export const SecretAsk: Story = {
	render: () => (
		<Frame
			asked="Set up the GitHub integration."
			height={360}
			pending={gate({
				title: "Paste the GitHub token",
				detail: "It is stored in the credential store, not in the transcript.",
				secret: true,
				options: [],
			})}
		/>
	),
};

/**
 * An approval gate, unchanged by this work and captured so that stays true.
 *
 * The wire carries no options for an approval and it is answered yes/no in the
 * composer, so this card must look exactly as it did before.
 */
export const ApprovalUnchanged: Story = {
	render: () => (
		<Frame
			asked="Clean the build output before rebuilding."
			height={360}
			pending={gate({
				kind: "approval",
				title: "Run `rm -rf ./dist`?",
				detail: "In ~/local-operator-ui.",
				options: [],
			})}
		/>
	),
};
