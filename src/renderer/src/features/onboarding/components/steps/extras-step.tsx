/**
 * Extras Step Component
 *
 * Step 3 of 3: web search, the one thing left that is genuinely optional, and
 * what happens when setup ends.
 *
 * NO NAME FIELD ANY MORE (first-run onboarding, U7/D12). It wrote the name to
 * the renderer's own store, where no agent, no other surface and no other
 * device ever read it - a question asked on the first screen whose answer went
 * nowhere. Aida asks instead, in her first conversation, and records the answer
 * where every session reads it (the backend's operator profile in her stable
 * prompt prefix); when the user signed in with Radient she already has the name
 * and email from the account and only confirms them. That logic is the
 * backend's and hers, not this screen's.
 *
 * The search key uses the existing search step's content unchanged, so nothing
 * about where those keys live has moved.
 */

import type { FC } from "react";
import { SearchApiStep } from "./search-api-step";

type ExtrasStepProps = {
	/**
	 * Her live display name when setup will end in her conversation, or null when
	 * it will not (a backend without her, or with her switched off) - in which
	 * case the step says nothing about her, because promising someone who will
	 * never answer is worse than saying nothing.
	 */
	aidaName?: string | null;
};

export const ExtrasStep: FC<ExtrasStepProps> = ({ aidaName = null }) => (
	<div className="flex flex-col gap-8">
		<SearchApiStep showCredentialDescription={false} />
		{aidaName ? (
			/*
			 * What the primary button does, said before it is pressed: the step is
			 * instructional end to end (U7), and "Meet Aida" alone does not say she
			 * will speak first or what she will ask.
			 */
			<section
				className="flex flex-col gap-2"
				aria-labelledby="onboarding-extras-next"
			>
				<h3 id="onboarding-extras-next" className="text-heading text-ink">
					Next: meet {aidaName}
				</h3>
				{/*
				 * The promise is about a greeting she still OWES, and this screen
				 * cannot check that: the ledger's state word (`greeting_state`) is on
				 * the POST's answer, and the status document this step reads carries
				 * only `enabled`/`greeted`/`name`. So the sentence is the tolerant
				 * path — true for a fresh install and for an older backend, and the
				 * one shape it does not cover is an install whose greeting was already
				 * delivered or skipped, where she has met the user somewhere else. If
				 * the read grows that field, gating this on
				 * `greeting_state === "owed"` is one line (code review round 1's
				 * contract addendum, point 1).
				 */}
				<p className="text-body text-ink-muted">
					{aidaName} is your chief of staff. She will say hello first, ask what
					to call you and what you would like help with, and show you around.
					You can also skip straight to a new chat.
				</p>
			</section>
		) : null}
	</div>
);
