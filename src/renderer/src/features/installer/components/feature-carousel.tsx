import { Box } from "@mui/material";
import type React from "react";
import { useEffect, useState } from "react";
import {
	FeatureContent,
	FeatureDescription,
	FeatureIconContainer,
	FeatureTitle,
	ProgressDot,
	ProgressDots,
} from "./installer-styled";

/**
 * Feature data for the carousel
 */
export const features = [
	{
		icon: "🎯",
		title: "Plans & Executes",
		description:
			"Breaks down complex goals into manageable steps and executes them with precision.",
	},
	{
		icon: "🔒",
		title: "Prioritizes Security",
		description:
			"Built-in safety checks by independent AI review and user confirmations keep your system protected.",
	},
	{
		icon: "🌐",
		title: "Flexible Deployment",
		description:
			"Run completely locally with Ollama models or leverage cloud providers like OpenAI.",
	},
	{
		icon: "🔧",
		title: "Problem Solving",
		description:
			"Intelligently handles errors and roadblocks by adapting approaches and finding alternative solutions.",
	},
];

/**
 * FeatureCarousel component
 *
 * Displays a carousel of features that automatically rotates
 */
export const FeatureCarousel: React.FC = () => {
	const [activeFeature, setActiveFeature] = useState(0);

	// Auto-rotate features every 5 seconds
	useEffect(() => {
		const interval = setInterval(() => {
			setActiveFeature((prev) => (prev + 1) % features.length);
		}, 5000);

		return () => clearInterval(interval);
	}, []);

	return (
		<Box
			sx={{
				position: "relative",
				height: "300px",
				width: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				alignItems: "center",
			}}
		>
			<Box
				sx={{
					position: "relative",
					height: "240px",
					width: "100%",
					display: "flex",
					justifyContent: "center",
					alignItems: "center",
					mb: 4,
				}}
			>
				{features.map((feature, index) => (
					<FeatureContent
						key={feature.title}
						isActive={index === activeFeature}
						sx={{
							opacity: index === activeFeature ? 1 : 0,
							pointerEvents: index === activeFeature ? "auto" : "none",
						}}
					>
						<FeatureIconContainer>{feature.icon}</FeatureIconContainer>
						<FeatureTitle variant="h4">{feature.title}</FeatureTitle>
						<FeatureDescription>{feature.description}</FeatureDescription>
					</FeatureContent>
				))}
			</Box>

			<ProgressDots>
				{features.map((feature, index) => (
					<ProgressDot
						key={`dot-${feature.title}`}
						active={index === activeFeature}
						onClick={() => setActiveFeature(index)}
						sx={{ cursor: "pointer" }}
					/>
				))}
			</ProgressDots>
		</Box>
	);
};
