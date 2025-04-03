/**
 * Local Operator API - Transcribe Endpoints
 */
import type { CRUDResponse, TranscribeResponse } from "./types";

/**
 * Transcribe API client for the Local Operator API
 */
export const TranscribeApi = {
	/**
	 * Transcribe audio
	 * Accepts an audio blob and returns the transcribed text.
	 *
	 * @param baseUrl - The base URL of the Local Operator API
	 * @param audioData - The base64 encoded audio data
	 * @returns Promise resolving to the transcribed text
	 */
	async transcribeAudio(
		baseUrl: string,
		audioData: string,
	): Promise<CRUDResponse<TranscribeResponse>> {
		try {
			const response = await fetch(`${baseUrl}/v1/transcribe`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({ data: audioData }),
			});

			if (!response.ok) {
				throw new Error(
					`Transcription request failed: ${response.status} ${response.statusText}`,
				);
			}

			return response.json();
		} catch (error) {
			console.error("Failed to transcribe audio:", error);
			throw error;
		}
	},
};
