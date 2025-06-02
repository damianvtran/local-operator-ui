/**
 * Local Operator API - Transcription Endpoints
 */
import type {
	CRUDResponse,
	CreateTranscriptionParams,
	RadientTranscriptionResponseData,
} from "./types";

/**
 * Transcription API client for the Local Operator API
 */
export const TranscriptionApi = {
	/**
	 * Transcribe Audio File
	 *
	 * Transcribes an audio file using the specified model and parameters.
	 * The audio file is sent as `multipart/form-data`.
	 * @param baseUrl - The base URL of the Local Operator API.
	 * @param params - The parameters for the transcription request.
	 * @returns A promise that resolves to the transcription result.
	 * @throws Will throw an error if the request fails.
	 */
	async createTranscription(
		baseUrl: string,
		params: CreateTranscriptionParams,
	): Promise<CRUDResponse<RadientTranscriptionResponseData>> {
		const formData = new FormData();
		formData.append("file", params.file);
		if (params.model !== undefined) formData.append("model", params.model);
		if (params.prompt !== undefined) formData.append("prompt", params.prompt);
		if (params.response_format !== undefined)
			formData.append("response_format", params.response_format);
		if (params.temperature !== undefined)
			formData.append("temperature", params.temperature.toString());
		if (params.language !== undefined)
			formData.append("language", params.language);
		if (params.provider !== undefined)
			formData.append("provider", params.provider);

		const response = await fetch(`${baseUrl}/v1/transcriptions`, {
			method: "POST",
			body: formData,
			// Content-Type for FormData is set automatically by the browser, including the boundary.
			// Ensure 'Accept' header is set if the server expects it, though for FormData it's often not strictly needed for the request itself.
			// However, for consistency with other API calls and to ensure JSON error responses are handled:
			headers: {
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			let errorDetail = `Transcription request failed: ${response.status} ${response.statusText}`;
			try {
				const errorData = await response.json();
				// Assuming error responses follow the CRUDResponse structure or have a 'detail' field
				errorDetail = errorData.message || errorData.detail || errorDetail;
			} catch (_) {
				// Ignore if response is not JSON or parsing fails
			}
			throw new Error(errorDetail);
		}

		// Assuming successful responses are not necessarily in CRUDResponse format for this specific endpoint,
		// but the data itself is RadientTranscriptionResponseData.
		// If the server wraps this in CRUDResponse, the casting will need to be adjusted.
		// Based on the OpenAPI spec, the response is directly RadientTranscriptionResponseData for 200.
		// To align with the pattern of other clients returning CRUDResponse<T>, we'll wrap it.
		const data = await response.json() as RadientTranscriptionResponseData;
		return {
			status: response.status,
			message: "Transcription successful", // Or derive from response if available
			result: data,
		};
	},
};
