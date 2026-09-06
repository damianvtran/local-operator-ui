/**
 * Authenticated binary/multipart relay for the legacy media routes.
 *
 * The JSON desktop transport cannot carry audio bytes or a multipart body,
 * and the managed backend now requires the bearer on speech, transcription
 * and agent ZIP import. This relay is the narrow bridge: a fixed allowlist of
 * operations, each mapped in main to an exact backend path and method, with
 * the bearer attached here and never crossing IPC. Renderer code submits
 * typed arguments and raw bytes; it cannot pick a URL, method or header.
 *
 * Bodies are bounded so a runaway payload cannot pin main's memory: 16 MiB
 * for uploads (audio and ZIP) and 32 MiB for downloaded speech.
 */

import { z } from "zod";

const id = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_-]+$/);

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;

const mediaRequestSchema = z.discriminatedUnion("op", [
	z
		.object({
			op: z.literal("speech.create"),
			request: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("speech.agent"),
			agentId: id,
			request: z.record(z.unknown()),
		})
		.strict(),
	z
		.object({
			op: z.literal("transcription.create"),
			fileName: z.string().min(1).max(255),
			mimeType: z.string().min(1).max(128),
			fields: z.record(z.string().max(4096)),
		})
		.strict(),
	z
		.object({
			op: z.literal("agent.import"),
			fileName: z.string().min(1).max(255),
		})
		.strict(),
	// Export is a gated GET that answers with a ZIP, so it belongs on this relay
	// rather than the JSON transport: `desktopEndpoint`'s envelope has nowhere to
	// put binary. It is the only read here, which is why `endpoint()` below
	// returns a method instead of assuming POST.
	z
		.object({ op: z.literal("agent.export"), agentId: id })
		.strict(),
]);

export type DesktopMediaRequest = z.infer<typeof mediaRequestSchema>;

export type DesktopMediaResponse =
	| { status: number; kind: "bytes"; mimeType: string; data: Uint8Array }
	| { status: number; kind: "json"; body: unknown }
	| { status: number; kind: "error"; detail: string };

function endpoint(request: DesktopMediaRequest): {
	path: string;
	method: "POST" | "GET";
} {
	switch (request.op) {
		case "speech.create":
			return { path: "/v1/tools/speech", method: "POST" };
		case "speech.agent":
			return { path: `/v1/agents/${request.agentId}/speech`, method: "POST" };
		case "transcription.create":
			return { path: "/v1/transcriptions", method: "POST" };
		case "agent.import":
			return { path: "/v1/agents/import", method: "POST" };
		case "agent.export":
			return { path: `/v1/agents/${request.agentId}/export`, method: "GET" };
	}
}

export async function requestDesktopMedia(
	input: unknown,
	bytes: Uint8Array | null,
	backendUrl: string,
	token: string | null,
): Promise<DesktopMediaResponse> {
	const parsed = mediaRequestSchema.safeParse(input);
	if (!parsed.success) {
		return { status: 422, kind: "error", detail: "Invalid media operation." };
	}
	if (!token) {
		return {
			status: 503,
			kind: "error",
			detail: "Restart with a desktop-managed backend to use these controls.",
		};
	}
	const request = parsed.data;
	if (bytes && bytes.byteLength > MAX_UPLOAD_BYTES) {
		return { status: 413, kind: "error", detail: "This file is too large." };
	}
	const target = endpoint(request);

	let body: BodyInit | undefined;
	let contentType: string | undefined;
	if (request.op === "agent.export") {
		// A GET carries no body; `fetch` rejects one outright.
		body = undefined;
	} else if (request.op === "speech.create" || request.op === "speech.agent") {
		body = JSON.stringify(request.request);
		contentType = "application/json";
	} else {
		if (!bytes) {
			return { status: 422, kind: "error", detail: "A file is required." };
		}
		const form = new FormData();
		const blob = new Blob([bytes], {
			type:
				request.op === "transcription.create"
					? request.mimeType
					: "application/zip",
		});
		form.append("file", blob, request.fileName);
		if (request.op === "transcription.create") {
			for (const [key, value] of Object.entries(request.fields)) {
				form.append(key, value);
			}
		}
		body = form;
		// fetch sets the multipart boundary itself; forcing the header breaks it.
	}

	try {
		const response = await fetch(new URL(target.path, backendUrl), {
			method: target.method,
			headers: {
				Accept: "application/json, audio/*, application/octet-stream",
				...(contentType ? { "Content-Type": contentType } : {}),
				Authorization: `Bearer ${token}`,
			},
			body,
			redirect: "error",
			signal: AbortSignal.timeout(120000),
		});
		const responseType = response.headers.get("content-type") ?? "";
		if (!response.ok) {
			// Error bodies from the backend already suppress reflected secrets;
			// still, only a short detail string is forwarded.
			let detail = "The media request failed.";
			if (responseType.includes("application/json")) {
				try {
					const parsedError = (await response.json()) as {
						detail?: unknown;
						message?: unknown;
					};
					const text = parsedError.detail ?? parsedError.message;
					if (typeof text === "string") detail = text.slice(0, 512);
				} catch {
					// Keep the generic detail.
				}
			}
			return { status: response.status, kind: "error", detail };
		}
		if (responseType.includes("application/json")) {
			return {
				status: response.status,
				kind: "json",
				body: await response.json(),
			};
		}
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
			return {
				status: 502,
				kind: "error",
				detail: "The backend returned too much data.",
			};
		}
		return {
			status: response.status,
			kind: "bytes",
			mimeType: responseType || "application/octet-stream",
			data: buffer,
		};
	} catch {
		return {
			status: 503,
			kind: "error",
			detail:
				"The backend could not complete this request. Check its connection and try again.",
		};
	}
}
