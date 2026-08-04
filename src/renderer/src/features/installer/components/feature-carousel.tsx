import { cn } from "@shared/lib/utils";
import {
	Code,
	Handshake,
	HardDrive,
	type LucideProps,
	ShieldCheck,
	Target,
	Wrench,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

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
		title: "Plans and executes",
		description:
			"Breaks down complex goals into manageable steps and executes them with precision.",
	},
	{
		icon: ShieldCheck,
		title: "Prioritizes security",
		description:
			"Built-in safety checks by independent AI review and user confirmations keep your system protected.",
	},
	{
		icon: Wrench,
		title: "Agentic problem solving",
		description:
			"Agents can intelligently handle errors and roadblocks by adapting approaches and finding alternative solutions.",
	},
	{
		icon: Code,
		title: "Universal problem solvers",
		description:
			"Local Operator agents use code as a universal tool to make their own integrations on the fly and creatively solve problems.",
	},
	{
		icon: Handshake,
		title: "Agent-to-agent communication",
		description:
			"Agents can delegate tasks and communicate with each other to solve more complex problems.",
	},
	{
		icon: HardDrive,
		title: "On-device work",
		description:
			"Agents can work on your device, reducing the back and forth between your files and the cloud, and improving privacy.",
	},
];

const ROTATION_MS = 5000;

/**
 * FeatureCarousel component
 *
 * Rotates through the product's capabilities while the install runs.
 *
 * All six panes are stacked and cross-faded rather than mounted one at a time,
 * so the block never changes height as the copy length changes. The inactive
 * ones are hidden from assistive technology and from the pointer, which is the
 * part a plain `opacity: 0` gets wrong.
 */
export const FeatureCarousel: React.FC = () => {
	const [activeFeature, setActiveFeature] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setActiveFeature((prev) => (prev + 1) % features.length);
		}, ROTATION_MS);

		return () => clearInterval(interval);
	}, []);

	return (
		<div className="flex w-full flex-col items-center">
			<div className="relative flex h-60 w-full items-center justify-center">
				{features.map((feature, index) => {
					const isActive = index === activeFeature;
					return (
						<div
							key={feature.title}
							aria-hidden={!isActive}
							className={cn(
								"absolute flex max-w-120 flex-col items-center text-center",
								"transition-opacity duration-slow ease-out-quart",
								isActive ? "opacity-100" : "pointer-events-none opacity-0",
							)}
						>
							<feature.icon
								size={32}
								strokeWidth={1.5}
								className="mb-5 text-accent"
								aria-hidden="true"
							/>
							<h2 className="mb-2 text-title text-ink">{feature.title}</h2>
							<p className="max-w-100 text-body text-ink-muted">
								{feature.description}
							</p>
						</div>
					);
				})}
			</div>

			<div className="flex justify-center gap-2">
				{features.map((feature, index) => (
					<button
						key={`dot-${feature.title}`}
						type="button"
						aria-label={feature.title}
						aria-current={index === activeFeature}
						onClick={() => setActiveFeature(index)}
						className={cn(
							"size-2.5 rounded-full transition-colors duration-base ease-out-quart",
							/* `control` rather than `hairline`: hairline is a line weight and
							   a 10px disc filled with it does not read against `surface`. */
							index === activeFeature ? "bg-accent" : "bg-control",
						)}
					/>
				))}
			</div>
		</div>
	);
};
