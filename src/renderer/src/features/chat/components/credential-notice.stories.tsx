/**
 * The two notice rows the credential capture raises AT SUBMIT, framed as the
 * operator sees them.
 *
 * WHY THIS EXISTS (design round 1, D3). Every other string this feature added is
 * framed — the citation chips are, the composer's own notice row is — and these
 * two were not: they appear in the corner toast at the moment the operator is
 * most likely to act on them, in a bounded measure, carrying a key name and two
 * sentences. A sentence that only ever appears in a toast is a sentence nobody
 * has looked at in a 440-wide column, which is where a toast actually lands on a
 * narrow window.
 *
 * WHAT IS REAL: the shipped notice functions (`unconfirmedNotice`,
 * `unstoredNotice`) and the shipped toast manager and container, held open with
 * `toastDuration: Infinity` for the reason `download-agent-outcomes.stories.tsx`
 * gives — a toast that auto-closes cannot be re-photographed, and the dedup keys
 * are module state a fixture has to clear for itself.
 *
 * WHAT IS NOT: nothing here drives a send. The frames are the notice's own copy
 * and measure; the send that raises it is driven by
 * `scripts/credential-composer.test.mjs` and, on the live app, by QA's pass.
 *
 * THE CAPTION IS PART OF THE FRAME, as it is in the pull-outcome frames: it names
 * the register the toast belongs to, so a reader comparing the pair has the two
 * states side by side rather than inferring one from a toast alone.
 */

import { resetToastDedup, showWarningToast } from "@shared/utils/toast-manager";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import "../../../styles/index.css";
import { unconfirmedNotice, unstoredNotice } from "./credential-capture";

/*
 * The window timer, taken once at module scope: the story's cleanup must call the
 * real one even where a test has swapped the global.
 */
const realSetTimeout = globalThis.setTimeout;

const meta: Meta = { title: "chat/credential-notice" };
export default meta;

type Story = StoryObj;

/** The key the operator's own session held while a citation denied it. */
const SESSION_KEY = ["LOP", "SECRET", "4CE3Y48G"].join("_");

/**
 * Push one notice through the real toast manager, over the caption that names it.
 *
 * The ground is deliberately plain: a toast's own measure is what these frames are
 * for, and a busier page would put the toast against content it never meets in
 * practice — the submit-time notice lands over the transcript.
 */
const Notice = ({ caption, note, raise }: NoticeProps) => {
	useEffect(() => {
		/*
		 * ONE TASK LATER, and that is a measurement rather than a precaution: raised in
		 * the effect's own tick the toast did not reach the frame at all (2026-09-20 —
		 * the rig photographed the page with no toast in it), while the pull-outcome
		 * frames, whose toast comes from an ASYNC mutation, carry theirs. A toast is a
		 * state update sonner owns, and a story's first commit is earlier than the
		 * container's own subscription.
		 */
		const raised = realSetTimeout(() => {
			// Module state, cleared for the fixture rather than for the product: the
			// manager deduplicates identical notices, so a second capture of the same
			// story would photograph nothing at all.
			resetToastDedup();
			// The duration rides the call as well as the container: the container's own
			// prop is what the pull-outcome frames rely on, and this is the same number
			// passed where sonner reads it for a toast raised after mount.
			showWarningToast(raise(), {
				duration: Number.POSITIVE_INFINITY,
			});
		}, 250);
		return () => clearTimeout(raised);
	}, [raise]);
	return (
		<div className="min-h-[320px] bg-canvas p-4 font-sans text-ink">
			<ul className="space-y-2 text-sm">
				<li>
					<span className="text-ink-muted">State: </span>
					<span>{caption}</span>
				</li>
				<li>
					<span className="text-ink-muted">Noticed when: </span>
					<span>{note}</span>
				</li>
				<li>
					<span className="text-ink-muted">Sentence: </span>
					<span className="font-mono">{raise()}</span>
				</li>
			</ul>
		</div>
	);
};

type NoticeProps = {
	/** What this state IS, for the reader of the frame. */
	caption: string;
	/** When the operator meets it. */
	note: string;
	/** The shipped notice function, called for the toast and for the caption. */
	raise: () => string;
};

/** The unresolved store: what is known, and the move that works. */
export const Unconfirmed: Story = {
	render: () => (
		<Notice
			caption="the store never confirmed the write — it may have landed"
			note="the send that cited a credential whose store outcome could not be settled"
			raise={() => unconfirmedNotice([SESSION_KEY])}
		/>
	),
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
};

/**
 * The refusal, for the pair: the register the unresolved notice must not be
 * mistaken for. It is here so the two frames read beside each other.
 */
export const Unstored: Story = {
	render: () => (
		<Notice
			caption="the store answered, and the value is not there"
			note="the send that cited a credential the store refused"
			raise={() => unstoredNotice([SESSION_KEY])}
		/>
	),
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
};
