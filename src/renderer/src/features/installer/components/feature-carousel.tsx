import { Box } from "@mui/material";
import {
	Target,
	ShieldCheck,
	Wrench,
	type LucideProps,
  Code,
  Handshake,
  HardDrive,
} from "lucide-react";
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
type Feature = {
	icon: React.ElementType<LucideProps>;
	title: string;
	description: string;
};

export const features: Feature[] = [
	{
		icon: Target,
		title: "Plans & Executes",
		description:
			"Breaks down complex goals into manageable steps and executes them with precision.",
	},
	{
		icon: ShieldCheck,
		title: "Prioritizes Security",
		description:
			"Built-in safety checks by independent AI review and user confirmations keep your system protected.",
	},
	{
		icon: Wrench,
		title: "Agentic Problem Solving",
		description:
			"Agents can intelligently handle errors and roadblocks by adapting approaches and finding alternative solutions.",
	},
  {
		icon: Code,
		title: "Universal Problem Solvers",
		description:
			"Local Operator agents use code as a universal tool to make their own integrations on the fly and creatively solve problems.",
	},
  {
		icon: Handshake,
		title: "Agent-to-Agent Communication",
		description:
			"Agents can delegate tasks and communicate with each other to solve more complex problems.",
	},
  {
		icon: HardDrive,
		title: "On-Device Work",
		description:
			"Agents can work on-device without relying on the cloud, reducing the back and forth between your files and the cloud, and improving privacy.",
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
						<FeatureIconContainer>
							<feature.icon size={32} strokeWidth={1} />
						</FeatureIconContainer>
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
