import { Box } from "@mui/material";
import type { Theme } from "@mui/material/styles";

/**
 * Props for the RingLoadingIndicator component.
 */
type RingLoadingIndicatorProps = {
	size?: number;
};

/**
 * A sophisticated loading indicator with multiple animated rings and a glowing core.
 * This component is designed to provide a visually engaging loading experience.
 *
 * @param {RingLoadingIndicatorProps} props - The props for the component.
 * @param {number} [props.size=30] - The base size of the loading indicator. All elements will scale relative to this.
 * @returns {JSX.Element} The rendered sophisticated loading indicator.
 */
export const RingLoadingIndicator = ({
	size = 30,
}: RingLoadingIndicatorProps): JSX.Element => {
	return (
		<Box
			sx={{
				mt: 1,
				mb: 1,
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				height: size,
				width: size,
				position: "relative",
				"@keyframes outerPulse": {
					"0%": {
						transform: "scale(1)",
						opacity: 0.8,
					},
					"50%": {
						transform: "scale(1.1)",
						opacity: 0.4,
					},
					"100%": {
						transform: "scale(1)",
						opacity: 0.8,
					},
				},
				"@keyframes innerRotate": {
					"0%": { transform: "rotate(0deg)" },
					"100%": { transform: "rotate(360deg)" },
				},
				"@keyframes middleRotate": {
					"0%": { transform: "rotate(0deg)" },
					"100%": { transform: "rotate(-360deg)" },
				},
				"@keyframes glow": {
					"0%": {
						boxShadow: (theme: Theme) =>
							`0 0 ${size * 0.16}px ${theme.palette.primary.main}40`,
					},
					"50%": {
						boxShadow: (theme: Theme) =>
							`0 0 ${size * 0.66}px ${theme.palette.primary.main}80, 0 0 ${size}px ${theme.palette.primary.main}40`,
					},
					"100%": {
						boxShadow: (theme: Theme) =>
							`0 0 ${size * 0.16}px ${theme.palette.primary.main}40`,
					},
				},
			}}
		>
			{/* Outer pulsing ring */}
			<Box
				sx={{
					position: "absolute",
					width: size,
					height: size,
					borderRadius: "50%",
					border: (theme: Theme) => `2px solid ${theme.palette.primary.main}60`,
					animation: "outerPulse 2s ease-in-out infinite",
				}}
			/>

			{/* Middle rotating ring */}
			<Box
				sx={{
					position: "absolute",
					width: size * 0.73, // 22/30
					height: size * 0.73, // 22/30
					borderRadius: "50%",
					border: () => "2px solid transparent",
					borderTop: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
					borderRight: (theme: Theme) =>
						`2px solid ${theme.palette.primary.main}80`,
					animation: "middleRotate 1.5s linear infinite",
				}}
			/>

			{/* Inner fast rotating ring */}
			<Box
				sx={{
					position: "absolute",
					width: size * 0.5, // 15/30
					height: size * 0.5, // 15/30
					borderRadius: "50%",
					border: () => "2px solid transparent",
					borderTop: (theme: Theme) => `2px solid ${theme.palette.primary.main}`,
					borderLeft: (theme: Theme) =>
						`2px solid ${theme.palette.primary.main}60`,
					animation: "innerRotate 1s linear infinite",
				}}
			/>

			{/* Central glowing core */}
			<Box
				sx={{
					width: size * 0.2, // 6/30
					height: size * 0.2, // 6/30
					borderRadius: "50%",
					backgroundColor: (theme: Theme) => theme.palette.primary.main,
					animation: "glow 2s ease-in-out infinite",
				}}
			/>
		</Box>
	);
};

RingLoadingIndicator.displayName = "RingLoadingIndicator";
