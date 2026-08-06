/**
 * User Profile Step Component
 *
 * Second step in the onboarding process. Two fields, one of them optional, and
 * a line saying where the answers go.
 */

import { Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUserStore } from "@shared/store/user-store";
import type { FC } from "react";
import { useEffect, useState } from "react";

/*
 * Ids are named once and shared by each label, its input, and its help text. A
 * typo in an inline `htmlFor` breaks the association silently: the field still
 * looks labelled and only a screen reader finds out otherwise.
 */
const NAME_INPUT_ID = "onboarding-profile-name";
const NAME_HELP_ID = "onboarding-profile-name-help";
const EMAIL_INPUT_ID = "onboarding-profile-email";
const EMAIL_HELP_ID = "onboarding-profile-email-help";

/**
 * User profile step in the onboarding process
 */
export const UserProfileStep: FC = () => {
	const { profile, updateProfile } = useUserStore();
	const [name, setName] = useState(profile.name === "User" ? "" : profile.name);
	const [email, setEmail] = useState(
		profile.email === "user@example.com" ? "" : profile.email,
	);
	const [nameError, setNameError] = useState("");

	// Update the user profile when the form values change
	useEffect(() => {
		if (name.trim()) {
			updateProfile({ name: name.trim() });
		}

		if (email.trim()) {
			updateProfile({ email: email.trim() });
		}
	}, [name, email, updateProfile]);

	// Validate the name field
	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setName(value);

		if (!value.trim()) {
			setNameError("Name is required");
		} else {
			setNameError("");
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body text-ink-muted">
				So your agents know what to call you. Both fields stay on this computer
				and are never sent anywhere.
			</p>

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<Label htmlFor={NAME_INPUT_ID}>Your name</Label>
					<Input
						id={NAME_INPUT_ID}
						inputSize="lg"
						value={name}
						onChange={handleNameChange}
						/* No placeholder. The label above already says what goes here,
						   and "Enter your name" under "Your name" is the same words
						   twice in a field that is about to be typed into. */
						required
						/* The invalid border is painted from this attribute alone, so
						   the red edge and the announced error cannot disagree. */
						aria-invalid={nameError ? true : undefined}
						aria-describedby={NAME_HELP_ID}
					/>
					<p
						id={NAME_HELP_ID}
						className={cn(
							"text-meta",
							nameError ? "text-danger" : "text-ink-dim",
						)}
					>
						{nameError || "Used when an agent addresses you"}
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor={EMAIL_INPUT_ID}>Email address (optional)</Label>
					<Input
						id={EMAIL_INPUT_ID}
						inputSize="lg"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						autoComplete="email"
						aria-describedby={EMAIL_HELP_ID}
					/>
					<p id={EMAIL_HELP_ID} className="text-ink-dim text-meta">
						Kept for convenience, never shared
					</p>
				</div>
			</div>
		</div>
	);
};
