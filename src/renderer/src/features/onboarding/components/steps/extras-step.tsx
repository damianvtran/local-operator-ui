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
	/**
	 * Whether her first-run greeting is still OWED (`aidaOwesGreeting`, read off
	 * the status document). The sentence below promises that she speaks first, and
	 * that promise is only true while this is: on an install whose greeting was
	 * delivered or skipped, the step describes what the button does instead.
	 *
	 * DEFAULTS TRUE so a caller that has not read the state yet (and every story)
	 * keeps the shipped copy rather than silently promising nothing.
	 */
	oweGreeting?: boolean;
};

export const ExtrasStep: FC<ExtrasStepProps> = ({
	aidaName = null,
	oweGreeting = true,
}) => (
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
				 * TWO SENTENCES, ONE TRUE AT A TIME (code review round 1's contract
				 * addendum, point 1). The first promises a greeting she still owes;
				 * the second does not, and is what an install says when her hello has
				 * already been delivered or skipped - where the promise would describe
				 * a first meeting the user has already had. Which one is owed comes
				 * from the ledger's state word read off the status document
				 * (`aidaOwesGreeting`), never inferred here.
				 */}
				<p className="text-body text-ink-muted">
					{oweGreeting
						? `${aidaName} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.`
						: `${aidaName} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.`}
				</p>
			</section>
		) : null}
	</div>
);
