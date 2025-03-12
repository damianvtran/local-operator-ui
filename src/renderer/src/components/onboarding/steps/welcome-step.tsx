/**
 * Welcome Step Component
 *
 * First step in the onboarding process that introduces the user to the app.
 */

import { Box, Typography } from "@mui/material";
import type { FC } from "react";
import {
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Welcome step in the onboarding process
 */
export const WelcomeStep: FC = () => {
	return (
		<Box>
			<Typography variant="body1" paragraph>
				Welcome to Local Operator! Let's set up your environment so you can
				start working with AI agents.
			</Typography>

			<Typography variant="body1" paragraph>
				This quick setup will guide you through:
			</Typography>

			<SectionContainer>
				<SectionTitle>What we'll cover:</SectionTitle>
				<SectionDescription>
					<Box component="ul" sx={{ pl: 2, mt: 0 }}>
						<Box component="li" sx={{ mb: 1 }}>
							Setting up your user profile
						</Box>
						<Box component="li" sx={{ mb: 1 }}>
							Adding your first AI model provider credential
						</Box>
						<Box component="li" sx={{ mb: 1 }}>
							Optionally enabling web search capabilities
						</Box>
						<Box component="li" sx={{ mb: 1 }}>
							Selecting your default model
						</Box>
						<Box component="li">Creating your first agent</Box>
					</Box>
				</SectionDescription>
			</SectionContainer>

			<Typography variant="body2" sx={{ mt: 2, fontStyle: "italic" }}>
				You can always change these settings later in the Settings page.
			</Typography>
		</Box>
	);
};
