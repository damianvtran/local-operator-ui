import { desktopMedia, mediaError } from "./desktop-api";
import type { AgentSpeechRequest, SpeechRequest } from "./types";

/**
 * Speech synthesis through the authenticated media relay. The managed backend
 * requires the desktop bearer on these routes, which only main (or the dev
 * server proxy) can attach; the `baseUrl` parameter is kept for signature
 * compatibility with the hooks that call this and is no longer used.
 */
export const SpeechApi = {
	create: async (_baseUrl: string, request: SpeechRequest): Promise<Blob> => {
		const result = await desktopMedia(
			{ op: "speech.create", request: request as Record<string, unknown> },
			null,
		);
		if (result.kind !== "bytes") throw mediaError(result);
		return new Blob([result.data as BlobPart], { type: result.mimeType });
	},

	createForAgent: async (
		_baseUrl: string,
		agentId: string,
		request: AgentSpeechRequest,
	): Promise<Blob> => {
		const result = await desktopMedia(
			{
				op: "speech.agent",
				agentId,
				request: request as Record<string, unknown>,
			},
			null,
		);
		if (result.kind !== "bytes") throw mediaError(result);
		return new Blob([result.data as BlobPart], { type: result.mimeType });
	},
};
