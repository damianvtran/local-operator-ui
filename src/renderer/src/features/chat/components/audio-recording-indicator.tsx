import { Box, Typography, alpha } from "@mui/material";
import { styled, keyframes } from "@mui/material/styles";

/**
 * Props for the AudioRecordingIndicator component
 */
type AudioRecordingIndicatorProps = {
	isRecording: boolean;
};

const pulseAnimation = keyframes`
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(255, 82, 82, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(255, 82, 82, 0);
  }
`;

const RecordingIndicatorContainer = styled(Box)(({ theme }) => ({
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	minHeight: "50px", // Match TextField height
	padding: theme.spacing(1, 2),
	borderRadius: theme.shape.borderRadius,
	backgroundColor: alpha(theme.palette.error.light, 0.1),
	border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
	color: theme.palette.error.dark,
}));

const RecordingText = styled(Typography)(({ theme }) => ({
	fontSize: "0.9rem",
	fontWeight: 500,
	marginRight: theme.spacing(1.5),
}));

const RecordingDot = styled(Box)(({ theme }) => ({
	width: 12,
	height: 12,
	backgroundColor: theme.palette.error.main,
	borderRadius: "50%",
	animation: `${pulseAnimation} 1.5s infinite ease-in-out`,
}));

/**
 * AudioRecordingIndicator component
 * Displays a visual indicator when audio is being recorded.
 */
export const AudioRecordingIndicator = ({
	isRecording,
}: AudioRecordingIndicatorProps): JSX.Element | null => {
	if (!isRecording) {
		return null;
	}

	return (
		<RecordingIndicatorContainer>
			<RecordingText variant="body2">Recording audio</RecordingText>
			<RecordingDot />
		</RecordingIndicatorContainer>
	);
};

AudioRecordingIndicator.displayName = "AudioRecordingIndicator";
