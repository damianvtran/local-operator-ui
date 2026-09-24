/**
 * Extras Step Component
 *
 * Step 3 of 3: the two things that are genuinely optional, on one screen
 * (design audit § 5). Name and web search used to be two required-looking
 * steps between signing in and seeing the model it bought (design D6); here
 * they are one screen whose footer offers "Skip" beside "Finish".
 *
 * The name field writes to the same user store the old profile step wrote
 * to, and the search key uses the existing search step's content unchanged,
 * so nothing about where either value lives has moved.
 */

import { Input, Label } from "@shared/components/ui";
import { useUserStore } from "@shared/store/user-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { SearchApiStep } from "./search-api-step";

const NAME_INPUT_ID = "onboarding-extras-name";
const NAME_HELP_ID = "onboarding-extras-name-help";

export const ExtrasStep: FC = () => {
	const { profile, updateProfile } = useUserStore();
	// The store's placeholder name is not the user's; an empty field says so.
	const [name, setName] = useState(profile.name === "User" ? "" : profile.name);

	useEffect(() => {
		if (name.trim()) updateProfile({ name: name.trim() });
	}, [name, updateProfile]);

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-2">
				<Label htmlFor={NAME_INPUT_ID}>Your name (optional)</Label>
				<Input
					id={NAME_INPUT_ID}
					inputSize="lg"
					value={name}
					onChange={(event) => setName(event.target.value)}
					autoComplete="name"
					aria-describedby={NAME_HELP_ID}
				/>
				<p id={NAME_HELP_ID} className="text-ink-dim text-meta">
					What agents call you. It stays on this computer.
				</p>
			</div>
			<section
				className="flex flex-col gap-3"
				aria-labelledby="onboarding-extras-search"
			>
				<h3 id="onboarding-extras-search" className="text-heading text-ink">
					Web search
				</h3>
				<SearchApiStep />
			</section>
		</div>
	);
};
