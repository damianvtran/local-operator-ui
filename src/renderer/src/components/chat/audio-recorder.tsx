import {
	faMicrophone,
	faSpinner,
	faStop,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IconButton, alpha, styled } from "@mui/material";
import { useRef, useState } from "react";
import { TranscribeApi } from "../../api/local-operator/transcribe";
import { apiConfig } from "../../config";

const AudioRecorderButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.8)
			: alpha(theme.palette.primary.main, 0.15),
	color:
		theme.palette.mode === "light"
			? theme.palette.common.white
			: theme.palette.primary.light,
	width: 52,
	height: 52,
	borderRadius: theme.shape.borderRadius * 1.5,
	transition: "all 0.2s ease-in-out",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? theme.palette.primary.main
				: alpha(theme.palette.primary.main, 0.25),
		transform: "translateY(-2px)",
		boxShadow:
			theme.palette.mode === "light"
				? `0 4px 8px ${alpha(theme.palette.primary.main, 0.4)}`
				: `0 4px 8px ${alpha(theme.palette.primary.main, 0.2)}`,
	},
	"&:active": {
		transform: "translateY(0px)",
		boxShadow: "none",
	},
	"&.Mui-disabled": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.action.disabled, 0.3)
				: alpha(theme.palette.action.disabled, 0.1),
		color: theme.palette.action.disabled,
	},
}));

export const AudioRecorder = ({
	handlesubmitTranscribedAudio,
	disabled,
}: {
	handlesubmitTranscribedAudio: (value: string) => void;
	disabled: boolean;
}) => {
	const [recording, setRecording] = useState(false);
	const [loading, setLoading] = useState(false);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);

	const startRecording = async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mediaRecorder = new MediaRecorder(stream);
		mediaRecorderRef.current = mediaRecorder;
		audioChunksRef.current = [];

		mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				audioChunksRef.current.push(event.data);
			}
		};

		mediaRecorder.start();
		setRecording(true);
	};

	const stopRecording = async () => {
		setRecording(false);
		setLoading(true);

		mediaRecorderRef.current?.stop();
		const tracks = mediaRecorderRef.current?.stream.getTracks() ?? [];

		for (const track of tracks) {
			track.stop();
		}

		setTimeout(async () => {
			const audioBlob = new Blob(audioChunksRef.current, {
				type: "audio/webm",
			});
			const base64Audio = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => {
					const base64String = reader.result as string;
					resolve(base64String.split(",")[1]); // Remove the Data URL prefix
				};
				reader.onerror = reject;
				reader.readAsDataURL(audioBlob);
			});

			try {
				const response = await TranscribeApi.transcribeAudio(
					apiConfig.baseUrl,
					base64Audio,
				);

				const transcribedMessage = response?.result?.text?.trim() ?? "";
				handlesubmitTranscribedAudio(transcribedMessage);
			} catch (error) {
				console.error("Error sending audio:", error);
			} finally {
				setLoading(false);
			}
		}, 0);
	};

	return (
		<div>
			<AudioRecorderButton
				color={recording ? "error" : "primary"}
				onClick={recording ? stopRecording : startRecording}
				disabled={loading || disabled}
				aria-label={
					loading
						? "Transcribing audio, please wait"
						: recording
							? "Stop recording"
							: "Start recording"
				}
				aria-busy={loading}
			>
				{loading ? (
					<FontAwesomeIcon icon={faSpinner} size={"2xs"} spin />
				) : recording ? (
					<FontAwesomeIcon icon={faStop} size={"2xs"} />
				) : (
					<FontAwesomeIcon icon={faMicrophone} size="2xs" />
				)}
			</AudioRecorderButton>
		</div>
	);
};
