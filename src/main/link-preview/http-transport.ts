/**
 * One HTTP hop: a GET against an address that has ALREADY been validated.
 *
 * SPLIT OUT OF THE FETCHER ON PURPOSE. The redirect logic, the caps and the
 * sniffing live in `resolve.ts` and are pure functions over a `Hop`; this file is
 * the only part that touches a socket. That keeps the security decisions testable
 * without a network and this file small enough to read in one sitting - which
 * matters, because this is the code that runs on a hostile host's schedule.
 *
 * THE PIN. `lookup` is the callback from `ssrf.ts`, so the client performs no
 * resolution of its own; DNS rebinding has nothing to re-point. `agent: false` is
 * part of the same rule rather than an optimisation: a pooled keep-alive socket
 * is keyed by host:port and could be reused for a later request in which the same
 * hostname resolves differently, which is the rebinding window reopening one layer
 * down. A fresh connection per hop costs one handshake and closes that.
 *
 * DECOMPRESSION IS BOUNDED BY COUNTING THE OUTPUT. A gzip bomb compresses to
 * almost nothing, so a cap on the bytes ON THE WIRE never fires. The counter sits
 * on the decompressed stream and destroys the request the moment the cap is
 * crossed, which is the only place it can sit.
 */

import * as http from "node:http";
import * as https from "node:https";
import type { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { pinnedLookup } from "./ssrf";

/** What one hop is asked to do. `address` is the validated IP, never a name. */
export interface HopRequest {
	url: URL;
	address: string;
	family: 4 | 6;
	/** The remaining wall-clock budget for this hop. */
	timeoutMs: number;
	/** The decompressed byte cap. Exceeding it truncates and marks the hop. */
	maxBytes: number;
}

export interface HopResponse {
	status: number;
	/** The raw `Location` header, for the caller to resolve and re-validate. */
	location: string | null;
	contentType: string | null;
	/** Decompressed body, possibly truncated at `maxBytes`. */
	body: Uint8Array;
	/** The cap was crossed: the body is incomplete and must not be parsed. */
	truncated: boolean;
}

export type Hop = (request: HopRequest) => Promise<HopResponse>;

/** A decode this module cannot stream: the response is refused rather than
 * handed on undecoded, because the cap cannot be enforced on it. */
function decoderFor(encoding: string): Transform | null | "unsupported" {
	switch (encoding) {
		case "":
		case "identity":
			return null;
		case "gzip":
		case "x-gzip":
			return createGunzip();
		case "deflate":
			return createDeflateOrInflate();
		case "br":
			return createBr();
		default:
			return "unsupported";
	}
}

function createDeflateOrInflate(): Transform {
	// `deflate` is meant to be zlib-wrapped, but a meaningful share of servers
	// send a raw deflate stream; zlib's inflate rejects those, and the preview is
	// not worth a second request to guess.
	return createInflate();
}

function createBr(): Transform {
	return createBrotliDecompress();
}

const REQUEST_HEADERS = {
	// A preview only needs the document. The `*/*` tail keeps a server that
	// negotiates on Accept from answering 406.
	accept: "text/html,application/xhtml+xml;q=0.9,image/*;q=0.8,*/*;q=0.1",
	"accept-encoding": "gzip, deflate, br",
	"accept-language": "en",
	// No cookies, ever: this module has no jar and must not acquire one, so a
	// preview request can never carry a session to a third-party origin.
	"user-agent": "LocalOperator-LinkPreview/1",
} as const;

/** The real transport. Every failure rejects; the caller maps it to a state. */
export const nodeHop: Hop = (request) =>
	new Promise<HopResponse>((resolve, reject) => {
		const transport = request.url.protocol === "https:" ? https : http;
		const options: https.RequestOptions = {
			protocol: request.url.protocol,
			// The NAME is used for the Host header and TLS SNI; the CONNECTION is
			// pinned to the validated address by `lookup` below.
			hostname: request.url.hostname,
			path: `${request.url.pathname}${request.url.search}`,
			method: "GET",
			headers: REQUEST_HEADERS,
			lookup: pinnedLookup(request.address, request.family),
			agent: false,
			// A redirect's body is discarded, so a hostile server cannot spend the
			// budget by answering 302 with a large entity.
			maxHeaderSize: 32 * 1024,
			...(request.url.port === "" ? {} : { port: Number(request.url.port) }),
		};
		const outgoing = (transport.request as typeof https.request)(
			options,
			(response) => {
				const status = response.statusCode ?? 0;
				const encoding = String(response.headers["content-encoding"] ?? "")
					.split(",")[0]
					.trim()
					.toLowerCase();
				const location = response.headers.location ?? null;
				const contentType = response.headers["content-type"] ?? null;

				if (status >= 300 && status < 400) {
					response.resume();
					resolve({
						status,
						location,
						contentType,
						body: new Uint8Array(0),
						truncated: false,
					});
					return;
				}

				const decoder = decoderFor(encoding);
				if (decoder === "unsupported") {
					response.resume();
					reject(new Error("unsupported content-encoding"));
					return;
				}

				const source: NodeJS.ReadableStream = decoder
					? (response.pipe(decoder) as unknown as NodeJS.ReadableStream)
					: response;
				const chunks: Uint8Array[] = [];
				let total = 0;
				let truncated = false;
				let settled = false;

				const finish = (): void => {
					if (settled) return;
					settled = true;
					const body = new Uint8Array(total);
					let offset = 0;
					for (const chunk of chunks) {
						body.set(chunk, offset);
						offset += chunk.byteLength;
					}
					resolve({ status, location, contentType, body, truncated });
				};

				source.on("data", (chunk: Uint8Array) => {
					if (truncated) return;
					const remaining = request.maxBytes - total;
					if (chunk.byteLength > remaining) {
						// The cap crossed mid-chunk: keep the prefix (a truncated PNG header
						// still yields no dimensions rather than a crash) and stop reading.
						if (remaining > 0) {
							chunks.push(chunk.subarray(0, remaining));
							total += remaining;
						}
						truncated = true;
						outgoing.destroy();
						source.removeAllListeners("data");
						finish();
						return;
					}
					chunks.push(chunk);
					total += chunk.byteLength;
				});
				source.on("end", finish);
				source.on("error", (error: Error) => {
					if (settled) return;
					settled = true;
					reject(error);
				});
			},
		);

		outgoing.setTimeout(request.timeoutMs, () => {
			outgoing.destroy(new Error("timeout"));
		});
		outgoing.on("error", (error: Error) => reject(error));
		outgoing.end();
	});
