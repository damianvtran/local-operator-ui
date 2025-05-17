/**
 * User Profile Step Component
 *
 * Second step in the onboarding process that allows the user to set up their profile
 * with a clean and modern interface.
 */

import { Box, TextField, useTheme } from "@mui/material";
import { useUserStore } from "@shared/store/user-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	EmojiContainer,
	FieldLabel,
	FormContainer,
	LabelIcon,
	SectionContainer,
	SectionDescription,
} from "../onboarding-styled";

/**
 * User profile step in the onboarding process
 */
export const UserProfileStep: FC = () => {
	const theme = useTheme();
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

	// Define shadcn-like input styles using sx prop for simplicity
	const inputSx = {
		"& .MuiOutlinedInput-root": {
			borderRadius: theme.shape.borderRadius * 0.75, // Consistent radius
			backgroundColor: theme.palette.background.paper,
			border: `1px solid ${theme.palette.divider}`,
			minHeight: "40px", // Slightly taller for better touch targets/visuals
			height: "40px",
			transition: "border-color 0.2s ease, box-shadow 0.2s ease",
			"&:hover": {
				borderColor: theme.palette.text.secondary,
			},
			"&.Mui-focused": {
				borderColor: theme.palette.primary.main,
				boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
			},
			"& .MuiOutlinedInput-notchedOutline": {
				border: "none", // Remove the default notch
			},
			"& .MuiInputBase-input": {
				padding: theme.spacing(1, 1.5), // Adjusted padding
				fontSize: "0.875rem",
				height: "calc(40px - 16px)", // Adjust height based on padding
				boxSizing: "border-box",
			},
			"& .MuiInputBase-input::placeholder": {
				color: theme.palette.text.disabled,
				opacity: 1,
			},
			// Adjust adornment position if needed
			"& .MuiInputAdornment-root": {
				marginRight: theme.spacing(0.5), // Ensure space between adornment and text
			},
		},
		// Style helper text
		"& .MuiFormHelperText-root": {
			fontSize: "0.75rem",
			mt: 0.5,
			ml: 0.5, // Keep margin for alignment under the input
		},
		// Remove MUI label specific styles from inputSx
		// "& .MuiInputLabel-root": { ... },
		// "& .MuiInputLabel-outlined.MuiInputLabel-shrink": { ... },
	};

	return (
		<SectionContainer>
			<SectionDescription>
				<EmojiContainer>🔒</EmojiContainer> This info is stored locally to
				personalize your AI experience and is never shared externally.
			</SectionDescription>

			<FormContainer>
				{/* Name Field */}
				<Box>
					{" "}
					{/* Wrap Label and Input */}
					<FieldLabel>
						<LabelIcon>😎</LabelIcon> {/* Use LabelIcon */}
						Your Name
					</FieldLabel>
					<TextField
						// Remove label prop
						variant="outlined"
						fullWidth
						value={name}
						onChange={handleNameChange}
						error={!!nameError}
						helperText={nameError || "Used to personalize your AI interactions"}
						placeholder="Enter your name"
						required
						// Remove InputProps startAdornment if icon moved to label
						// InputProps={{ ... }}
						sx={inputSx} // Apply shared input styles
					/>
				</Box>

				{/* Email Field */}
				<Box>
					{" "}
					{/* Wrap Label and Input */}
					<FieldLabel>
						<LabelIcon>📧</LabelIcon> {/* Use LabelIcon */}
						Email Address (Optional)
					</FieldLabel>
					<TextField
						// Remove label prop
						variant="outlined"
						fullWidth
						value={email}
						onChange={handleEmailChange}
						helperText="Stored locally for convenience, not shared"
						placeholder="Enter your email address"
						type="email"
						// Remove InputProps startAdornment if icon moved to label
						// InputProps={{ ... }}
						sx={inputSx} // Apply shared input styles
					/>
				</Box>
			</FormContainer>

			{/* Use SectionDescription for the final tip */}
			<SectionDescription sx={{ mt: 3, textAlign: "center" }}>
				<EmojiContainer sx={{ mr: 0.5 }}>💡</EmojiContainer>
				Personalizing your profile helps AI assistants provide a more tailored
				experience!
			</SectionDescription>
		</SectionContainer>
	);
};
