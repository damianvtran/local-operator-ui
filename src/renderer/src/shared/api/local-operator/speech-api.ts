import type { AgentSpeechRequest, SpeechRequest } from "./types";

export const SpeechApi = {
	/**
	 * Generates speech from text.
	 * @param baseUrl - The base URL of the API.
	 * @param request - The speech request details.
	 * @returns A promise that resolves to the audio data as a Blob.
	 */
	create: async (
		baseUrl: string,
		request: SpeechRequest,
	): Promise<Blob> => {
		const response = await fetch(`${baseUrl}/v1/tools/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Failed to generate speech: ${response.status} ${errorText}`,
			);
		}

		return response.blob();
	},

	/**
	 * Generates speech from an agent's last message.
	 * @param baseUrl - The base URL of the API.
	 * @param agentId - The ID of the agent.
	 * @param request - The speech request details.
	 * @returns A promise that resolves to the audio data as a Blob.
	 */
	createForAgent: async (
		baseUrl: string,
		agentId: string,
		request: AgentSpeechRequest,
	): Promise<Blob> => {
		const response = await fetch(`${baseUrl}/v1/agents/${agentId}/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Failed to generate speech: ${response.status} ${errorText}`,
			);
		}

		return response.blob();
	},
};
