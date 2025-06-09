import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { create } from "zustand";

type SpeechState = {
	audioCache: Map<string, Blob>;
	loadingMessageId: string | null;
	playingMessageId: string | null;
	error: string | null;
	audioElement: HTMLAudioElement | null;
};

type SpeechActions = {
	playSpeech: (
		messageId: string,
		agentId: string,
		inputText: string,
	) => Promise<void>;
	stopSpeech: () => void;
	replaySpeech: (messageId: string) => Promise<void>;
};

const client = createLocalOperatorClient(apiConfig.baseUrl);

export const useSpeechStore = create<SpeechState & SpeechActions>(
	(set, get) => ({
		audioCache: new Map(),
		loadingMessageId: null,
		playingMessageId: null,
		error: null,
		audioElement: null,

		playSpeech: async (
			messageId: string,
			agentId: string,
			inputText: string,
		) => {
			const { audioCache, stopSpeech } = get();

			stopSpeech(); // Stop any currently playing audio

			set({ loadingMessageId: messageId, error: null });

			try {
				let audioBlob = audioCache.get(messageId);

				if (!audioBlob) {
					audioBlob = await client.speech.createForAgent(agentId, {
						input_text: inputText,
					});
					if (audioBlob) {
						set((state) => ({
							audioCache: new Map(state.audioCache).set(
								messageId,
								audioBlob as Blob,
							),
						}));
					}
				}

				if (!audioBlob) {
					throw new Error("Speech generation failed, no audio data received.");
				}

				const audioUrl = URL.createObjectURL(audioBlob);
				const audioElement = new Audio(audioUrl);
				audioElement.onended = () => {
					set({ playingMessageId: null, audioElement: null });
					URL.revokeObjectURL(audioUrl);
				};
				audioElement.onerror = () => {
					set({
						error: "Error playing audio.",
						playingMessageId: null,
						audioElement: null,
					});
					URL.revokeObjectURL(audioUrl);
				};

				await audioElement.play();
				set({
					playingMessageId: messageId,
					loadingMessageId: null,
					audioElement,
				});
			} catch (err) {
				const errorMessage =
					err instanceof Error ? err.message : "Failed to generate speech";
				set({ error: errorMessage, loadingMessageId: null });
			}
		},

		stopSpeech: () => {
			const { audioElement, playingMessageId } = get();
			if (audioElement) {
				audioElement.pause();
				audioElement.onended = null; // Clean up listener
				audioElement.onerror = null; // Clean up listener
				// Get the blob from cache to revoke its URL
				if (playingMessageId) {
					const audioBlob = get().audioCache.get(playingMessageId);
					if (audioBlob) {
						const audioUrl = URL.createObjectURL(audioBlob);
						URL.revokeObjectURL(audioUrl);
					}
				}
				set({ playingMessageId: null, audioElement: null });
			}
		},

		replaySpeech: async (messageId: string) => {
			const { audioCache, stopSpeech } = get();
			const audioBlob = audioCache.get(messageId);

			stopSpeech();

			if (audioBlob) {
				try {
					const audioUrl = URL.createObjectURL(audioBlob);
					const audioElement = new Audio(audioUrl);
					audioElement.onended = () => {
						set({ playingMessageId: null, audioElement: null });
						URL.revokeObjectURL(audioUrl);
					};
					audioElement.onerror = () => {
						set({
							error: "Error playing audio.",
							playingMessageId: null,
							audioElement: null,
						});
						URL.revokeObjectURL(audioUrl);
					};
					await audioElement.play();
					set({ playingMessageId: messageId, audioElement });
				} catch (err) {
					const errorMessage =
						err instanceof Error ? err.message : "Failed to replay speech";
					set({ error: errorMessage, playingMessageId: null });
				}
			} else {
				set({ error: "No audio to replay for this message." });
			}
		},
	}),
);
