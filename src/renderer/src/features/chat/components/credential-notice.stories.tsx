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
import "../../../styles/index.css";
import { useEffect, useState } from "react";
import { unconfirmedNotice, unstoredNotice } from "./credential-capture";

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
/*
 * HOW LONG THE TOAST IS HELD, and why it is a large FINITE number rather than
 * `Infinity`: a toast that auto-closes cannot be re-photographed, so the hold has to
 * outlast the capture by a wide margin — and a day does that while staying a value
 * the container and sonner each read the same way.
 */
const TOAST_HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Push one notice through the real toast manager, over the caption that names it.
 *
 * THE STORY WAITS FOR ITS OWN SUBJECT, which is the second half of this fixture's
 * correction (2026-09-20). Raising the notice from an effect photographed the page
 * with NO toast in it twice — once with a delay, and once across all twelve themes
 * of a whole set — because the rig's shutter fires as soon as the story has drawn
 * enough of its own elements, and the caption alone is enough of them. A frame of a
 * notice surface with no notice on it is not evidence of anything, so the ground is
 * deliberately bare (one element, under the rig's floor) until the container has
 * actually put the toast on the page: the poll watches for sonner's own
 * `[data-sonner-toast]`, and only then does the caption — seven elements, over the
 * floor — appear, which is what lets the shutter fire. A selector that stops
 * matching therefore FAILS the capture loudly rather than quietly photographing an
 * empty state.
 *
 * The ground is otherwise plain on purpose: a toast's own measure is what these
 * frames are for, and a busier page would put the toast against content it never
 * meets in practice — the submit-time notice lands over the transcript.
 */
const Notice = ({ caption, note, raise }: NoticeProps) => {
	const [drawn, setDrawn] = useState(false);
	useEffect(() => {
		let raised = false;
		/*
		 * TWO CONDITIONS, POLLED IN ORDER, because raising too early is what made this
		 * fixture unreliable: a notice pushed before the container has subscribed is
		 * simply not there (measured: a story that raises in its own effect tick
		 * photographs a page with no toast on it, and so does one that raises at the
		 * first render — the container takes a task or two to arrive). So the poll
		 * waits for sonner's container, raises ONCE, and then waits for the toast
		 * element itself; only after both does the caption appear.
		 *
		 * THE FIRST SELECTOR IS THE STABLE ONE, and that is not a style choice: sonner
		 * attaches `data-sonner-toaster` to the inner `<ol>` that it renders ONLY when
		 * a toast exists, so waiting on that attribute deadlocks (measured: a poll
		 * that waited on it raised nothing for 60s and the capture failed loudly, which
		 * is the failure mode this fixture is built to have). The container itself is
		 * the always-mounted `<section aria-label="Notifications …">`.
		 */
		const poll = setInterval(() => {
			if (!raised) {
				if (!document.querySelector('section[aria-label^="Notifications"]'))
					return;
				raised = true;
				// Module state, cleared for the fixture rather than for the product: the
				// manager deduplicates identical notices, so a second capture of the same
				// story would photograph nothing at all.
				resetToastDedup();
				showWarningToast(raise(), { duration: TOAST_HOLD_MS });
				return;
			}
			if (document.querySelector("[data-sonner-toast]")) {
				clearInterval(poll);
				setDrawn(true);
			}
		}, 30);
		return () => clearInterval(poll);
	}, [raise]);
	if (!drawn)
		return <div className="min-h-[320px] bg-canvas font-sans text-ink" />;
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
	parameters: { toastDuration: TOAST_HOLD_MS },
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
	parameters: { toastDuration: TOAST_HOLD_MS },
};
