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
	// A durable transcript row references an image by content digest with the
	// payload stripped, so rendering a screenshot after a reload means fetching
	// bytes. That cannot go through the JSON transport (its envelope has nowhere
	// to put them), which is what puts it on this relay.
	//
	// Both identifiers are shape-constrained here as well as by the backend
	// route: this file's whole premise is that renderer code cannot pick a URL,
	// and a digest that reaches `endpoint()` unvalidated is renderer-controlled
	// path text.
	z
		.object({
			op: z.literal("sessions.attachment"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// The child-scoped twin of the op above, for the run panel's reader: a
	// child's durable rows reference attachments in the same content-addressed
	// store, and the parent's route takes the session whose transcript holds the
	// reference — which a child session is not, so it refuses. `childId` is
	// shape-constrained here for the same reason `sessionId` is: the path is
	// built in main, and an unvalidated id would be renderer-controlled path
	// text.
	z
		.object({
			op: z.literal("subagents.attachment"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			childId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
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
		case "sessions.attachment":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/attachments/${request.digest}`,
				method: "GET",
			};
		case "subagents.attachment":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/children/${request.childId}/attachments/${request.digest}`,
				method: "GET",
			};
	}
}

/**
 * A media request in the same two parts as `./desktop-transport`'s JSON twin,
 * for the same reason: every failure here resolves rather than throws, so the
 * promise's own resolution is no evidence that anything answered (review
 * round 1, F-1). `answered` is true exactly when `fetch` resolved.
 */
export type DesktopMediaOutcome = {
	response: DesktopMediaResponse;
	/** Whether the daemon itself answered this request. */
	answered: boolean;
};

export async function requestDesktopMediaOutcome(
	input: unknown,
	// ArrayBuffer-backed by contract: `Blob`, which this relay builds the
	// multipart body from, accepts no other view. `desktop-ipc.ts` is where the
	// value arriving over IPC is narrowed to this, so the requirement travels
	// with the type instead of being asserted again here.
	bytes: Uint8Array<ArrayBuffer> | null,
	backendUrl: string,
	token: string | null,
): Promise<DesktopMediaOutcome> {
	const parsed = mediaRequestSchema.safeParse(input);
	if (!parsed.success) {
		// Never sent.
		return {
			response: {
				status: 422,
				kind: "error",
				detail: "Invalid media operation.",
			},
			answered: false,
		};
	}
	if (!token) {
		// Never sent: this app has no credential to send.
		return {
			response: {
				status: 503,
				kind: "error",
				detail: "Restart with a desktop-managed backend to use these controls.",
			},
			answered: false,
		};
	}
	const request = parsed.data;
	if (bytes && bytes.byteLength > MAX_UPLOAD_BYTES) {
		// Never sent: refused on this side of the socket.
		return {
			response: {
				status: 413,
				kind: "error",
				detail: "This file is too large.",
			},
			answered: false,
		};
	}
	const target = endpoint(request);

	let body: BodyInit | undefined;
	let contentType: string | undefined;
	if (
		request.op === "agent.export" ||
		request.op === "sessions.attachment" ||
		request.op === "subagents.attachment"
	) {
		// A GET carries no body; `fetch` rejects one outright.
		body = undefined;
	} else if (request.op === "speech.create" || request.op === "speech.agent") {
		body = JSON.stringify(request.request);
		contentType = "application/json";
	} else {
		if (!bytes) {
			return {
				response: { status: 422, kind: "error", detail: "A file is required." },
				answered: false,
			};
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

	let answered = false;
	try {
		const response = await fetch(new URL(target.path, backendUrl), {
			method: target.method,
			headers: {
				Accept: "application/json, audio/*, image/*, application/octet-stream",
				...(contentType ? { "Content-Type": contentType } : {}),
				Authorization: `Bearer ${token}`,
			},
			body,
			redirect: "error",
			signal: AbortSignal.timeout(120000),
		});
		answered = true;
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
			return {
				response: { status: response.status, kind: "error", detail },
				answered: true,
			};
		}
		if (responseType.includes("application/json")) {
			return {
				response: {
					status: response.status,
					kind: "json",
					body: await response.json(),
				},
				answered: true,
			};
		}
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
			return {
				response: {
					status: 502,
					kind: "error",
					detail: "The backend returned too much data.",
				},
				// The daemon answered; what it sent was over this relay's ceiling.
				answered: true,
			};
		}
		return {
			response: {
				status: response.status,
				kind: "bytes",
				mimeType: responseType || "application/octet-stream",
				data: buffer,
			},
			answered: true,
		};
	} catch {
		return {
			response: {
				status: 503,
				kind: "error",
				detail:
					"The backend could not complete this request. Check its connection and try again.",
			},
			/*
			 * Survives the catch for the same reason as its JSON twin, and with the same
			 * two cases: a body that failed to parse was already `answered: true`, and so
			 * is a failure during the body read. A timeout abort that never got a
			 * response throws out of `fetch` first and returns `false` (review round 2
			 * MINOR-1; review round 3 MINOR-1 found the second case).
			 */
			answered,
		};
	}
}

export async function requestDesktopMedia(
	input: unknown,
	bytes: Uint8Array<ArrayBuffer> | null,
	backendUrl: string,
	token: string | null,
): Promise<DesktopMediaResponse> {
	return (await requestDesktopMediaOutcome(input, bytes, backendUrl, token))
		.response;
}
