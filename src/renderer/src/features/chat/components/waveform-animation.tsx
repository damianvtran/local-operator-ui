import { Box } from "@mui/material";
import { keyframes, styled } from "@mui/material/styles";
import type { FC } from "react";

const waveformAnimation = keyframes`
  0%, 100% { height: 2px; }
  50% { height: 16px; }
`;

const WaveformContainer = styled(Box)(() => ({
	display: "flex",
	alignItems: "center",
	height: "24px",
	gap: "2px",
}));

const WaveformBar = styled(Box)(({ theme }) => ({
	width: "3px",
	backgroundColor: theme.palette.primary.main,
	animation: `${waveformAnimation} 1.2s infinite ease-in-out`,
	borderRadius: "1px",
}));

export const WaveformAnimation: FC = () => {
	return (
		<WaveformContainer>
			<WaveformBar sx={{ animationDelay: "0s" }} />
			<WaveformBar sx={{ animationDelay: "0.2s", height: "8px" }} />
			<WaveformBar sx={{ animationDelay: "0.4s" }} />
			<WaveformBar sx={{ animationDelay: "0.6s", height: "12px" }} />
			<WaveformBar sx={{ animationDelay: "0.8s" }} />
		</WaveformContainer>
	);
};

WaveformAnimation.displayName = "WaveformAnimation";
