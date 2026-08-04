import logo from "@assets/clear-icon-with-text.png";
import type React from "react";

/**
 * LogoSection component
 *
 * The product mark and its one-line promise, above the feature carousel.
 */
export const LogoSection: React.FC = () => {
	return (
		<>
			<img
				src={logo}
				alt="Local Operator"
				className="mb-6 block h-30 w-auto object-contain"
				onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
					// Fallback if the path is incorrect
					e.currentTarget.src = "../assets/icon.png";
				}}
			/>
			{/* The mark already carries the name, so this heading is the accessible
			    one and the image above it is decorative-adjacent; both name the
			    product, which is what a splash screen is for. */}
			<h1 className="text-center text-display text-ink">Local Operator</h1>
			<p className="mt-2 mb-8 max-w-125 text-center text-body text-ink-muted">
				Personal AI assistants that turn ideas into action
			</p>
		</>
	);
};
