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

/*
 * Six panes, each one event the reader could actually witness.
 *
 * The previous set was written in the vocabulary of the thing rather than the
 * vocabulary of the person waiting for it — "agentic problem solving",
 * "universal problem solvers", "agent-to-agent communication" — and two of
 * the six were the same claim under different jargon. Someone reading this is
 * three minutes into their first contact with the product and has not agreed
 * to learn a vocabulary yet.
 */
export const features: Feature[] = [
	{
		icon: Target,
		title: "Breaks work into steps",
		description:
			"Give it a goal in a sentence. It works out the steps and does them in order.",
	},
	{
		icon: Code,
		title: "Writes and runs code",
		description:
			"Code is how it reads a spreadsheet, calls an API or renames a folder — written for the job in front of it.",
	},
	{
		icon: HardDrive,
		title: "Works on your files",
		description:
			"Your documents stay on this computer. No uploading a folder to get an answer about it.",
	},
	{
		icon: ShieldCheck,
		title: "Checks before it acts",
		description:
			"A second model reviews anything risky, and you confirm the rest.",
	},
	{
		icon: Wrench,
		title: "Recovers from errors",
		description:
			"When something fails it reads the error and tries another way, rather than stopping and asking you.",
	},
	{
		icon: Handshake,
		title: "Agents hand work to each other",
		description:
			"A researcher can pass what it found to a writer, without you carrying it across.",
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
			{/* Reserved for the tallest pane and no more. At 240px the block held
			    about 90px of nothing under every one of the six, which read as the
			    installer having lost its place rather than as breathing room. */}
			<div className="relative flex h-44 w-full items-center justify-center">
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
								className="mb-5 text-accent"
								aria-hidden="true"
							/>
							<h2 className="mb-2 text-heading text-ink">{feature.title}</h2>
							<p className="max-w-100 text-body text-ink-muted">
								{feature.description}
							</p>
						</div>
					);
				})}
			</div>

			<div className="mt-6 flex justify-center gap-2">
				{features.map((feature, index) => (
					<button
						key={`dot-${feature.title}`}
						type="button"
						aria-label={feature.title}
						aria-current={index === activeFeature}
						onClick={() => setActiveFeature(index)}
						className={cn(
							"size-2 rounded-full transition-colors duration-base ease-out-quart",
							/* `control` rather than `hairline`: hairline is a line weight and
							   an 8px disc filled with it does not read against `surface`. */
							index === activeFeature ? "bg-accent" : "bg-control",
						)}
					/>
				))}
			</div>
		</div>
	);
};
