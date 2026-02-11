/**
 * Welcome Step Component
 *
 * First step in the onboarding process that introduces the user to the app
 * with an exciting and engaging presentation.
 */

import { Box, Typography } from "@mui/material";
import {
	Bot,
	KeyRound,
	Lightbulb,
	Search,
	Sparkles,
	UserRound,
} from "lucide-react";
import type { FC } from "react";
import {
	InlineIcon,
	SectionContainer,
	SectionDescription,
} from "../onboarding-styled";

/**
 * Welcome step in the onboarding process
 */
export const WelcomeStep: FC = () => {
	return (
		<Box sx={{ animation: "fadeIn 0.6s ease-out" }}>
			<Typography
				variant="body1"
				sx={{
					fontSize: "1.1rem",
					fontWeight: 500,
					lineHeight: 1.6,
					mb: 2,
				}}
			>
				Let's set up your AI environment so you can start creating amazing
				things with AI agents!
			</Typography>

			<Typography
				variant="body1"
				sx={{
					fontSize: "1.05rem",
					mb: 3,
				}}
			>
				This quick setup will guide you through:
			</Typography>

			<SectionContainer>
				<SectionDescription>
					<Box sx={{ mt: 0 }}>
						<Box sx={{ mb: 1.5, display: "flex", alignItems: "flex-start" }}>
							<InlineIcon>
								<UserRound size={16} />
							</InlineIcon>
							Setting up your personalized user profile
						</Box>
						<Box sx={{ mb: 1.5, display: "flex", alignItems: "flex-start" }}>
							<InlineIcon>
								<KeyRound size={16} />
							</InlineIcon>
							Adding your first AI model provider credential
						</Box>
						<Box sx={{ mb: 1.5, display: "flex", alignItems: "flex-start" }}>
							<InlineIcon>
								<Search size={16} />
							</InlineIcon>
							Supercharging your AI with web search capabilities
						</Box>
						<Box sx={{ mb: 1.5, display: "flex", alignItems: "flex-start" }}>
							<InlineIcon>
								<Bot size={16} />
							</InlineIcon>
							Selecting your perfect default AI model
						</Box>
						<Box sx={{ display: "flex", alignItems: "flex-start" }}>
							<InlineIcon>
								<Sparkles size={16} />
							</InlineIcon>
							Creating your first intelligent AI assistant
						</Box>
					</Box>
				</SectionDescription>
			</SectionContainer>

			<Box
				sx={{
					mt: 3,
					fontStyle: "italic",
					display: "flex",
					alignItems: "center",
					fontSize: "0.875rem", // Equivalent to variant="body2"
					color: "text.secondary",
				}}
			>
				<InlineIcon>
					<Lightbulb size={16} />
				</InlineIcon>
				Don't worry! You can always customize these settings later in the
				Settings page.
			</Box>
		</Box>
	);
};
