import { useId } from "react";

/**
 * Geometry, not a second brand palette: every pigment follows the active theme.
 * Warning is the kit's warm semantic role; accentAlt is violet in the brand
 * palettes, so it cannot carry the single warm node. No external media, text,
 * animation or filters are needed to keep this decorative band theme-safe.
 */
export function AgentMessagesHero() {
	const glowId = useId();
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 960 400"
			preserveAspectRatio="xMidYMid slice"
			className="absolute inset-0 h-full w-full"
		>
			<defs>
				<radialGradient id={glowId} cx="50%" cy="45%" r="60%">
					<stop offset="0" stopColor="var(--lo-accent)" stopOpacity="0.14" />
					<stop offset="1" stopColor="var(--lo-accent)" stopOpacity="0" />
				</radialGradient>
			</defs>
			<path fill="var(--lo-elevated)" d="M0 0h960v400H0z" />
			<path fill="var(--lo-surface)" d="M0 310Q480 220 960 310V0H0z" />
			<path fill={`url(#${glowId})`} d="M0 0h960v400H0z" />
			<g fill="none" stroke="var(--lo-hairline)" strokeWidth="1.5">
				<path d="M130 275Q255 100 440 150T795 245" />
				<path d="M130 275Q350 310 600 125Q720 110 795 245" />
				<path d="M285 160Q410 290 620 255T795 245" />
				<path d="M440 150Q525 180 620 255" />
			</g>
			<g fill="var(--lo-accent)">
				<circle cx="130" cy="275" r="7" />
				<circle cx="285" cy="160" r="11" />
				<circle cx="440" cy="150" r="8" />
				<circle cx="600" cy="125" r="6" />
				<circle cx="795" cy="245" r="10" />
			</g>
			<circle cx="620" cy="255" r="12" fill="var(--lo-warning)" />
			<g fill="none" stroke="var(--lo-ink-muted)" strokeOpacity="0.16">
				<circle cx="285" cy="160" r="25" />
				<circle cx="620" cy="255" r="28" />
			</g>
		</svg>
	);
}
