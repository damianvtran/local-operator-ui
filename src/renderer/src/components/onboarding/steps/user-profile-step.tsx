/**
 * User Profile Step Component
 *
 * Second step in the onboarding process that allows the user to set up their profile.
 */

import { TextField } from "@mui/material";
import { useUserStore } from "@renderer/store/user-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	FormContainer,
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

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

	// Handle email change
	const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setEmail(e.target.value);
	};

	return (
		<SectionContainer>
			<SectionTitle>Your Profile Information</SectionTitle>
			<SectionDescription>
				This information is stored locally and is only used to personalize your
				experience. It is not shared with any external services.
			</SectionDescription>

			<FormContainer>
				<TextField
					label="Your Name"
					variant="outlined"
					fullWidth
					value={name}
					onChange={handleNameChange}
					error={!!nameError}
					helperText={
						nameError || "This will be used to personalize your experience"
					}
					placeholder="Enter your name"
					required
				/>

				<TextField
					label="Email Address"
					variant="outlined"
					fullWidth
					value={email}
					onChange={handleEmailChange}
					helperText="Optional: This is only stored locally"
					placeholder="Enter your email address"
					type="email"
				/>
			</FormContainer>
		</SectionContainer>
	);
};
