/**
 * User Profile Step Component
 *
 * Second step in the onboarding process that allows the user to set up their profile
 * with a fun and engaging interface.
 */

import { Box, TextField } from "@mui/material";
import { useUserStore } from "@renderer/store/user-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	EmojiContainer,
	FormContainer,
	SectionContainer,
	SectionDescription,
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
			<SectionDescription>
				<EmojiContainer>🔒</EmojiContainer> This information is stored locally
				and is only used to personalize your AI experience. It's never shared
				with any external services - your privacy matters to us!
			</SectionDescription>

			<FormContainer>
				<Box sx={{ position: "relative" }}>
					<TextField
						label="Your Name"
						variant="outlined"
						fullWidth
						value={name}
						onChange={handleNameChange}
						error={!!nameError}
						helperText={
							nameError ||
							"This will be used to create a personalized AI experience"
						}
						placeholder="Enter your name"
						required
						InputProps={{
							startAdornment: (
								<EmojiContainer style={{ marginRight: "8px" }}>
									😎
								</EmojiContainer>
							),
						}}
						sx={{
							"& .MuiOutlinedInput-root": {
								"&.Mui-focused fieldset": {
									borderColor: "primary.main",
									borderWidth: 2,
								},
							},
						}}
					/>
				</Box>

				<Box sx={{ position: "relative" }}>
					<TextField
						label="Email Address"
						variant="outlined"
						fullWidth
						value={email}
						onChange={handleEmailChange}
						helperText="Optional: This is only stored locally for your convenience"
						placeholder="Enter your email address"
						type="email"
						InputProps={{
							startAdornment: (
								<EmojiContainer style={{ marginRight: "8px" }}>
									📧
								</EmojiContainer>
							),
						}}
						sx={{
							"& .MuiOutlinedInput-root": {
								"&.Mui-focused fieldset": {
									borderColor: "primary.main",
									borderWidth: 2,
								},
							},
						}}
					/>
				</Box>
			</FormContainer>

			<Box sx={{ mt: 3, display: "flex", alignItems: "center" }}>
				<EmojiContainer>💡</EmojiContainer>
				<Box
					component="span"
					sx={{
						fontSize: "0.9rem",
						fontStyle: "italic",
						color: "text.secondary",
					}}
				>
					Personalizing your profile helps your AI assistants provide a more
					tailored experience!
				</Box>
			</Box>
		</SectionContainer>
	);
};
