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
import {
	DESKTOP_MACHINE_DETAIL,
	DESKTOP_REFUSAL_CODE,
	type DesktopRefusalCode,
	REQUEST_ID_PATTERN,
	type VoiceRefusalCode,
	desktopRefusalCodeForStatus,
	isDesktopRefusalCode,
	isVoiceRefusalCode,
} from "../shared/desktop-contract";

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
	// A generated sound's PRE-RENDER peaks sidecar (`<digest>.peaks.json`, 240
	// bars). It rides this relay because it is content IN the session store,
	// served beside the audio it describes by the same attachment route family -
	// the renderer asks the store one question ("what did this session keep under
	// this digest?") rather than learning the store's layout - and because the
	// route needs the bearer, which this relay attaches and the JSON transport's
	// callers would have to re-plumb. Same shape constraints as the attachment op
	// above for the same reason: main builds the path.
	z
		.object({
			op: z.literal("sessions.attachment.waveform"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// One supplement component's assembled HTML document (turn-supplements
	// memo §2.7), as `{ html }` JSON. Both identifiers are shape-constrained
	// here for the same reason the attachment ops' are: the path is built in
	// main, and an unvalidated digest would be renderer-controlled path text.
	// The digest regex is the contract's own (`DIGEST_PATTERN`,
	// `local_operator/supplements/contract.py`): 32 lowercase hex characters.
	z
		.object({
			op: z.literal("sessions.supplementDocument"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			digest: z.string().regex(/^[a-f0-9]{32}$/),
		})
		.strict(),
	// SESSION VOICE'S TEXT DOOR (the frozen contract): the Qwen rig's transcript,
	// as TEXT. The fields are NAMED rather than a free record, and the object is
	// strict, so renderer code cannot add a field the route might one day read as
	// authority - in particular there is no `file`/`fileName`/`mimeType`: this app
	// never uploads a recording, and `requestDesktopMediaOutcome` refuses bytes for
	// this op. The route admits the words as an ordinary prompt/steer and has no
	// path to a gate answer (V7).
	z
		.object({
			op: z.literal("voice.utterance"),
			sessionId: z.string().regex(/^[a-f0-9]{12}$/),
			// The route's own `RequestID`; refused here rather than as its 422.
			requestId: z.string().regex(REQUEST_ID_PATTERN),
			text: z.string().min(1).max(16_000),
			textOrigin: z.literal("qwen_s2s").optional(),
		})
		.strict(),
]);

export type DesktopMediaRequest = z.infer<typeof mediaRequestSchema>;

export type DesktopMediaResponse =
	| { status: number; kind: "bytes"; mimeType: string; data: Uint8Array }
	| { status: number; kind: "json"; body: unknown }
	| {
			status: number;
			kind: "error";
			detail: string;
			/**
			 * The pairing-family refusal this was, when it was one (`shared/desktop-contract`).
			 *
			 * The media transport answers a DIFFERENT shape from its JSON twin, so the
			 * code is carried here rather than in a `detail` envelope - and it is carried
			 * at all for the same reason: a media refusal the plane wrote must not be
			 * rendered as this app's own sentence (design § 3.5, § 5.1).
			 */
			code?: DesktopRefusalCode;
			/** A voice route's declared refusal (see `VOICE_REFUSAL_CODES`). */
			voiceCode?: VoiceRefusalCode;
	  };

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
		case "sessions.attachment.waveform":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/attachments/${request.digest}/waveform`,
				method: "GET",
			};
		case "sessions.supplementDocument":
			return {
				path: `/v1/desktop/sessions/${request.sessionId}/supplements/${request.digest}/document`,
				method: "GET",
			};
		case "voice.utterance":
			return { path: "/v1/desktop/voice/utterance", method: "POST" };
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
		// Never sent: this app has no credential to send. Coded, so the renderer can
		// say THIS fact (a pairing condition) rather than echoing the machine sentence.
		return {
			response: {
				status: 503,
				kind: "error",
				detail: DESKTOP_MACHINE_DETAIL.noCredential,
				code: DESKTOP_REFUSAL_CODE.noCredential,
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
		request.op === "subagents.attachment" ||
		request.op === "sessions.attachment.waveform" ||
		request.op === "sessions.supplementDocument"
	) {
		// A GET carries no body; `fetch` rejects one outright.
		body = undefined;
	} else if (request.op === "speech.create" || request.op === "speech.agent") {
		body = JSON.stringify(request.request);
		contentType = "application/json";
	} else if (request.op === "voice.utterance") {
		if (bytes) {
			// Never sent: the text door carries no recording (see the schema).
			return {
				response: {
					status: 422,
					kind: "error",
					detail: "A voice utterance carries text only.",
				},
				answered: false,
			};
		}
		// The route's own field names. `URLSearchParams` is the form encoding FastAPI's
		// `Form(...)` reads; no multipart, because there is no file part to carry.
		const form = new URLSearchParams();
		form.append("session_id", request.sessionId);
		form.append("request_id", request.requestId);
		form.append("text", request.text);
		if (request.textOrigin) form.append("text_origin", request.textOrigin);
		body = form;
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
			let declaredCode: string | undefined;
			if (responseType.includes("application/json")) {
				try {
					const parsedError = (await response.json()) as {
						detail?: unknown;
						message?: unknown;
					};
					const raw = parsedError.detail ?? parsedError.message;
					if (typeof raw === "string") {
						detail = raw.slice(0, 512);
					} else if (typeof raw === "object" && raw !== null) {
						/*
						 * The core's i18n envelope `{code, params, text}` (RFC §2.6): the
						 * sentence is `text` (the newer contract, read before the older
						 * object shape's `message`) and the DECLARED code is carried so the
						 * renderer's media reader can treat it like any other declared
						 * code - the precedence `desktopResult` documents.
						 */
						const envelope = raw as {
							code?: unknown;
							text?: unknown;
							message?: unknown;
						};
						const sentence =
							typeof envelope.text === "string" && envelope.text.trim()
								? envelope.text
								: typeof envelope.message === "string" &&
										envelope.message.trim()
									? envelope.message
									: null;
						if (sentence !== null) detail = sentence.slice(0, 512);
						if (typeof envelope.code === "string") {
							declaredCode = envelope.code;
						}
					}
				} catch {
					// Keep the generic detail.
				}
			}
			return {
				response: {
					status: response.status,
					kind: "error",
					detail,
					// A code the refusal DECLARED wins (its own category); otherwise only a
					// path the plane has to ADMIT makes the status a pairing fact:
					// `speech.create` and `agent.export` are outside `/v1/desktop/`, where a
					// 503 is that route's own failure and not this app's pairing.
					code:
						declaredCode !== undefined && isDesktopRefusalCode(declaredCode)
							? declaredCode
							: desktopRefusalCodeForStatus(target.path, response.status),
					// The voice routes' declared words, op-scoped, so the controller can
					// act on "the slot moved" rather than parse a sentence.
					...(request.op === "voice.utterance" &&
					isVoiceRefusalCode(declaredCode)
						? { voiceCode: declaredCode }
						: {}),
				},
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
				detail: DESKTOP_MACHINE_DETAIL.transportFailed,
				code: DESKTOP_REFUSAL_CODE.transportFailed,
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
