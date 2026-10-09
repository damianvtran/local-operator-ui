/**
 * The plain-language explainer under the "Delegated work" group's title.
 *
 * WHY THE DESKTOP WRITES THIS ITSELF. The registry's section description is one
 * long sentence written for a terminal footer; here it would be the whole of the
 * explanation for a policy that DELETES data by default, in a single unbroken
 * paragraph. Three short lines answer the three questions a reader has - what is
 * removed, what is kept, and when - and one more says what the first launch will
 * feel like. The facts are the backend's (`delegated_retention.py`, rules 1-6);
 * only the layout is ours, and `scripts/retention-duration.test.mjs` pins the
 * section name this replaces so a rename cannot leave the registry's version
 * showing beside it.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. Forks (`/fork`) are NOT listed as removed:
 * the backend treats a fork as the reader's own conversation
 * (`resume.USER_ORIGINS`), so a sentence naming them would promise a deletion
 * that never happens. There is also no pull-request registry in the harness, so
 * "linked to an open PR" is not offered as a protection.
 */

import type { FC } from "react";

const Line: FC<{ term: string; children: React.ReactNode }> = ({
	term,
	children,
}) => (
	<p className="text-meta text-ink-dim">
		<span className="font-medium text-ink-muted">{term}</span> {children}
	</p>
);

export const DelegatedRetentionCopy: FC = () => (
	<div
		data-delegated-retention-copy=""
		className="flex flex-col gap-1 px-1 pb-2"
	>
		<Line term="Removed:">
			sessions started by subagents, agent shells and background runs such as{" "}
			<code className="font-mono">lop exec</code>. Never your own conversations
			or the workstreams in your sidebar.
		</Line>
		<Line term="Kept:">
			anything running or waiting, anything whose parent conversation was active
			recently, anything linked to an open project, and folders with unsaved git
			work.
		</Line>
		<Line term="When:">
			after the time below with no activity. Checked when the app starts, a
			limited batch at a time, so a large backlog can take several launches to
			clear.
		</Line>
	</div>
);
