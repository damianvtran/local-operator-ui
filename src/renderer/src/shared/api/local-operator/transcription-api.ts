/**
 * Local Operator API - Transcription Endpoints
 */
import { desktopMedia, mediaError } from "./desktop-api";
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
		_baseUrl: string,
		params: CreateTranscriptionParams,
	): Promise<CRUDResponse<RadientTranscriptionResponseData>> {
		// Multipart is rebuilt by the relay from bytes plus string fields; the
		// renderer never assembles an authenticated request itself.
		const fields: Record<string, string> = {};
		if (params.model !== undefined) fields.model = params.model;
		if (params.prompt !== undefined) fields.prompt = params.prompt;
		if (params.response_format !== undefined)
			fields.response_format = params.response_format;
		if (params.temperature !== undefined)
			fields.temperature = params.temperature.toString();
		if (params.language !== undefined) fields.language = params.language;
		if (params.provider !== undefined) fields.provider = params.provider;
		const bytes = new Uint8Array(await params.file.arrayBuffer());
		const result = await desktopMedia(
			{
				op: "transcription.create",
				fileName: params.file.name || "audio",
				mimeType: params.file.type || "application/octet-stream",
				fields,
			},
			bytes,
		);
		if (result.kind !== "json") throw mediaError(result);
		return result.body as CRUDResponse<RadientTranscriptionResponseData>;
	},
};
