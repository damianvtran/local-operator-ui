import type { CdpContents } from "../cdp";
import { BrowserHostError } from "../errors";
import type { BrowserActionContext } from "./context";
import { requesterOf, stringParam } from "./context";

/**
 * `network_start` / `network_stop` / `network_read` / `network_clear`: the
 * desktop host's session-scoped network capture, and the one action family that
 * is NOT part of the shared extension protocol.
 *
 * WHY IT LIVES ON THE HOST. The `logs` action can buffer console output because
 * every driven view keeps a `webContents.debugger` attachment for the tab's whole
 * life. Network metadata needs the same standing arrangement, and it is exactly
 * what the extension cannot offer: its debugger attaches for the duration of one
 * command, so no subscription survives between calls.
 *
 * THE DECISIONS THIS FILE MAKES, each with its reason:
 *
 * - CAPTURE IS BOUND TO THE REQUESTER, not to the tab. The owner is
 *   `requesterOf(...)` (`session:<id>`), and every read/stop/clear answers only
 *   its own owner. A hand-over therefore cannot surface the previous session's
 *   buffer: the new session's first `network_start` REPLACES the record with an
 *   empty one (the alternative — refusing while another owner is active — would
 *   let a crashed session wedge the next one out of its own tab, which is the
 *   failure `owner_recover` exists to avoid).
 * - IN MEMORY ONLY, and it dies at every debugger boundary: `CdpPool.forget`,
 *   `CdpPool.detach`, the detach EVENT (DevTools took the target) and `close` all
 *   call `stopNetworkCapture`. Nothing is written to disk — a capture is
 *   transient telemetry about one session's own browsing, not a record.
 * - METADATA IS SAFE BY CONSTRUCTION. URLs keep scheme/host/path and are
 *   redacted like a log line: credentials, fragment and every query VALUE are
 *   removed, query KEYS are kept because they are what makes a request
 *   diagnosable. Request and response HEADERS are never copied, so cookies and
 *   bearer tokens cannot leak through this path at all.
 * - TWO RINGS, TWO CEILINGS. 500 entries / 1 MiB of metadata, and 256 KiB of
 *   retained request bodies (64 KiB each). Oldest first, and the counts of what
 *   fell off are reported, so "I do not see my request" is answerable.
 * - BODIES ARE DOUBLE OPT-IN AND EXACT-SCOPED. `network_start` keeps a request
 *   body only when `include_request_body=true` AND the caller names an exact
 *   http(s) `url` AND passes `approved=true`; matching is equality on
 *   origin+path (query ignored), so a bare origin is the root path and never a
 *   wildcard. `network_read` returns a body only under the same three
 *   conditions, and never by default. Bodies arrive base64 (`postData` is a
 *   string, so binary payloads are lossy — see the caveat in the session tool).
 *   Never response bodies.
 * - NOT `DOCUMENT_SCOPED`, like `logs`: the answer describes the tab's traffic
 *   across documents, not the document currently loaded (see the set's comment
 *   in `host.ts`).
 *
 * NO BODY OR HEADER IS EVER LOGGED. The module writes nothing to the app log at
 * all; the only channel out is the RPC response, and that channel redacts first.
 *
 * COVERAGE LIMIT, named rather than hidden: the `Network` domain is enabled on
 * the PAGE target only, and `CdpPool` deliberately never routes a child frame's
 * events to subscribers (an OOPIF's `Fetch.requestPaused` would be answered on
 * the wrong session). Requests a cross-site iframe makes are therefore absent
 * from the capture; top-level and same-process traffic is complete.
 */

/** One requester owns a capture. A restart replaces it rather than merging two
 * sessions' traffic or exposing a previous owner's buffer after handover. */
interface Capture {
	owner: string;
	active: boolean;
	unsubscribe: () => void;
	/** The webContents this capture belongs to. Kept because Chromium does not
	 * always inline the request body: `requestWillBeSent` may carry only
	 * `hasPostData: true` (a large form body, which a SAML assertion routinely
	 * is), and the bytes then live behind `Network.getRequestPostData`. */
	contents: CdpContents;
	/** The pool that owns the subscription, kept for the body pull. */
	cdp: BrowserActionContext["cdp"];
	bodyOriginPath: string;
	entries: NetworkEntry[];
	bytes: number;
	bodyBytes: number;
	sequence: number;
	droppedEntries: number;
	droppedBodies: number;
}

interface NetworkEntry {
	id: number;
	request_id: string;
	method: string;
	url: string;
	origin_path: string;
	status?: number;
	duration_ms?: number;
	resource_type?: string;
	loader_id?: string;
	frame_id?: string;
	wall_time?: number;
	redirect_request_id?: string;
	redirect_from_id?: number;
	redirect_to_id?: number;
	encoded_data_length: number;
	from_cache: boolean;
	error_text?: string;
	canceled?: boolean;
	finished: boolean;
	started_at?: number;
	request_body_size?: number;
	request_body_base64?: string;
}

const MAX_ENTRIES = 500;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BODY_PER_REQUEST = 64 * 1024;
const captures = new Map<number, Capture>();

function normalizedOriginPath(raw: unknown): string {
	if (typeof raw !== "string") return "";
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		return `${url.origin}${url.pathname}`;
	} catch {
		return "";
	}
}

/** Keep query keys for diagnostics, but never values, credentials or fragments. */
export function safeNetworkUrl(raw: unknown): string {
	if (typeof raw !== "string") return "";
	try {
		const url = new URL(raw);
		url.username = "";
		url.password = "";
		url.hash = "";
		url.search = "";
		const keys = [...new Set(new URL(raw).searchParams.keys())];
		if (keys.length)
			url.search = `?${keys.map((key) => encodeURIComponent(key)).join("&")}`;
		return url.toString();
	} catch {
		return "";
	}
}

function requireScope(
	params: Record<string, unknown>,
	approved = false,
): string {
	const url = stringParam(params, "url");
	const scope = normalizedOriginPath(url);
	// A NON-ROOT path is required, not merely an exact one. A bare origin
	// normalizes to `/`, and equality on origin+path would then accept every
	// root-path request of that origin; the approval names a capture scope, so
	// the scope has to be a path the operator was actually shown. The harness
	// refuses `/` too, and this is the trust boundary that has to hold when the
	// caller is not the harness (agent review round 1, R1-1).
	if (!scope || url.includes("#") || new URL(scope).pathname === "/") {
		throw new BrowserHostError(
			"origin_denied",
			"network body capture requires an exact HTTP(S) URL with a non-root path",
		);
	}
	if (approved && params.approved !== true) {
		throw new BrowserHostError(
			"origin_denied",
			"network request body capture requires approved=true",
		);
	}
	return scope;
}

function captureFor(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Capture {
	const tab = ctx.registry.requireSurface(String(params.tab ?? ""));
	const capture = captures.get(tab.view.webContents.id);
	const owner = requesterOf(params, requestId);
	if (!capture || capture.owner !== owner) {
		throw new BrowserHostError(
			"origin_denied",
			"network capture belongs to another requester or has not started",
		);
	}
	return capture;
}

function summary(capture: Capture): Record<string, unknown> {
	return {
		active: capture.active,
		count: capture.entries.length,
		dropped: capture.droppedEntries,
		dropped_entries: capture.droppedEntries,
		body_count: capture.entries.filter(
			(entry) => entry.request_body_base64 !== undefined,
		).length,
		body_bytes: capture.bodyBytes,
		dropped_bodies: capture.droppedBodies,
	};
}

function removeEntry(capture: Capture, index: number): void {
	const [entry] = capture.entries.splice(index, 1);
	if (!entry) return;
	capture.bytes -= metadataBytes(entry);
	if (entry.request_body_base64 !== undefined) {
		capture.bodyBytes -= entry.request_body_size ?? 0;
	}
}

function metadataBytes(entry: NetworkEntry): number {
	const {
		request_body_base64: _body,
		request_body_size: _bodySize,
		started_at: _started,
		...metadata
	} = entry;
	return Buffer.byteLength(JSON.stringify(metadata));
}

function trim(capture: Capture): void {
	while (
		capture.entries.length > MAX_ENTRIES ||
		capture.bytes > MAX_METADATA_BYTES
	) {
		removeEntry(capture, 0);
		capture.droppedEntries++;
	}
	while (capture.bodyBytes > MAX_BODY_BYTES) {
		const index = capture.entries.findIndex(
			(entry) => entry.request_body_base64 !== undefined,
		);
		if (index < 0) break;
		const entry = capture.entries[index];
		capture.bodyBytes -= entry.request_body_size ?? 0;
		entry.request_body_base64 = undefined;
		entry.request_body_size = 0;
		capture.droppedBodies++;
	}
}

function findEntry(
	capture: Capture,
	requestId: unknown,
): NetworkEntry | undefined {
	return capture.entries.findLast((entry) => entry.request_id === requestId);
}

/** Keep one inlined body, bounded per request, and account for it. */
function retainBody(capture: Capture, entry: NetworkEntry, data: string): void {
	if (!capture.active || !capture.entries.includes(entry)) return;
	const body = Buffer.from(data, "utf8");
	if (body.length > MAX_BODY_PER_REQUEST) {
		capture.droppedBodies++;
		return;
	}
	if (entry.request_body_base64 !== undefined) {
		capture.bodyBytes -= entry.request_body_size ?? 0;
	}
	entry.request_body_base64 = body.toString("base64");
	entry.request_body_size = body.length;
	capture.bodyBytes += body.length;
	trim(capture);
}

/** Ask the `Network` domain for a body the event did not inline. Bounded by the
 * pool's own CDP deadline, resolved as `""` when the request is gone. */
function pullPostData(capture: Capture, requestId: string): Promise<string> {
	if (!requestId || !capture.active) return Promise.resolve("");
	return capture.cdp
		.send<{ postData?: unknown }>(
			capture.contents,
			"Network.getRequestPostData",
			{
				requestId,
			},
		)
		.then((answer) =>
			typeof answer?.postData === "string" ? answer.postData : "",
		);
}

function onEvent(
	capture: Capture,
	method: string,
	params: Record<string, unknown>,
): void {
	if (!capture.active) return;
	if (method === "Network.requestWillBeSent") {
		const request = (params.request ?? {}) as Record<string, unknown>;
		const rawUrl = request.url;
		const originPath = normalizedOriginPath(rawUrl);
		const redirect = (params.redirectResponse ?? {}) as Record<string, unknown>;
		const entry: NetworkEntry = {
			id: ++capture.sequence,
			request_id: String(params.requestId ?? ""),
			method: String(request.method ?? ""),
			url: safeNetworkUrl(rawUrl),
			origin_path: originPath,
			status: undefined,
			resource_type: typeof params.type === "string" ? params.type : undefined,
			loader_id:
				typeof params.loaderId === "string" ? params.loaderId : undefined,
			frame_id: typeof params.frameId === "string" ? params.frameId : undefined,
			wall_time:
				typeof params.wallTime === "number" ? params.wallTime : undefined,
			redirect_request_id: params.redirectResponse
				? String(params.requestId ?? "")
				: undefined,
			encoded_data_length: 0,
			from_cache: false,
			finished: false,
			started_at:
				typeof params.timestamp === "number" ? params.timestamp : undefined,
		};
		// Correlate redirect hops by request id; each hop remains independently readable.
		if (params.redirectResponse) {
			const previous = findEntry(capture, params.requestId);
			if (previous && !previous.finished) {
				capture.bytes -= metadataBytes(previous);
				previous.status =
					typeof redirect.status === "number"
						? redirect.status
						: previous.status;
				previous.finished = true;
				previous.redirect_request_id = entry.request_id;
				previous.redirect_to_id = entry.id;
				if (
					typeof params.timestamp === "number" &&
					previous.started_at !== undefined
				) {
					previous.duration_ms = Math.round(
						Math.max(0, (params.timestamp - previous.started_at) * 1000),
					);
				}
				capture.bytes += metadataBytes(previous);
				entry.redirect_request_id = undefined;
				entry.redirect_from_id = previous.id;
			}
		}
		capture.entries.push(entry);
		capture.bytes += metadataBytes(entry);
		// The body is attached AFTER the entry is in the ring: `retainBody` refuses
		// an entry the buffer no longer holds, which is what keeps a late pull from
		// resurrecting traffic `trim` already evicted.
		if (capture.bodyOriginPath && originPath === capture.bodyOriginPath) {
			if (typeof request.postData === "string") {
				retainBody(capture, entry, request.postData);
			} else if (request.hasPostData === true) {
				// A MEASURED RISK rather than symmetry with the branch above:
				// Chromium omits `postData` when the body is longer than the size it
				// was told to inline, and a SAML assertion is routinely several
				// kilobytes. This pull is the only reliable way to get those bytes,
				// so a body the event did not carry is fetched instead of silently
				// missing from the entry the caller came for.
				void pullPostData(capture, String(params.requestId ?? "")).then(
					(data) => {
						if (typeof data === "string") retainBody(capture, entry, data);
					},
					() => {
						capture.droppedBodies++;
					},
				);
			}
		}
		trim(capture);
		return;
	}
	const entry = findEntry(capture, params.requestId);
	if (!entry) return;
	// Accounting is subtract-then-mutate-then-add: `metadataBytes` reads the
	// CURRENT shape, so subtracting after a mutation would subtract the new size
	// against a total that still held the old one and drift on every event.
	capture.bytes -= metadataBytes(entry);
	if (method === "Network.responseReceived") {
		const response = (params.response ?? {}) as Record<string, unknown>;
		entry.status =
			typeof response.status === "number" ? response.status : entry.status;
		entry.from_cache =
			response.fromDiskCache === true ||
			response.fromPrefetchCache === true ||
			response.fromServiceWorker === true;
		entry.resource_type =
			typeof params.type === "string" ? params.type : entry.resource_type;
	} else if (method === "Network.loadingFinished") {
		entry.encoded_data_length =
			typeof params.encodedDataLength === "number"
				? params.encodedDataLength
				: entry.encoded_data_length;
		entry.finished = true;
	} else if (method === "Network.loadingFailed") {
		entry.error_text =
			typeof params.errorText === "string"
				? params.errorText
				: "request failed";
		entry.canceled = params.canceled === true;
		entry.finished = true;
	} else return;
	if (
		entry.finished &&
		typeof params.timestamp === "number" &&
		entry.started_at !== undefined
	) {
		entry.duration_ms = Math.round(
			Math.max(0, (params.timestamp - entry.started_at) * 1000),
		);
	}
	capture.bytes += metadataBytes(entry);
	trim(capture);
}

export async function networkStart(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const tab = ctx.registry.requireSurface(String(params.tab ?? ""));
	const id = tab.view.webContents.id;
	const owner = requesterOf(params, requestId);
	const includeBody = params.include_request_body === true;
	const bodyOriginPath = includeBody ? requireScope(params, true) : "";
	const old = captures.get(id);
	if (old) {
		old.active = false;
		old.unsubscribe();
	}
	const capture: Capture = {
		owner,
		active: false,
		unsubscribe: () => undefined,
		contents: tab.view.webContents,
		cdp: ctx.cdp,
		bodyOriginPath,
		entries: [],
		bytes: 0,
		bodyBytes: 0,
		sequence: 0,
		droppedEntries: 0,
		droppedBodies: 0,
	};
	capture.unsubscribe = ctx.cdp.subscribe(id, (method, eventParams) =>
		onEvent(capture, method, eventParams),
	);
	captures.set(id, capture);
	try {
		await ctx.cdp.send(
			tab.view.webContents,
			"Network.enable",
			// Only a body capture asks Chromium to inline request bodies at all:
			// an ordinary metadata capture must not pay for copying bodies into
			// every `requestWillBeSent` event, and the size it is told to inline
			// is capped at the per-request limit this host is willing to retain.
			bodyOriginPath ? { maxPostDataSize: MAX_BODY_PER_REQUEST } : {},
		);
		capture.active = true;
		return summary(capture);
	} catch (error) {
		stopNetworkCapture(id);
		throw error;
	}
}

export async function networkStop(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Promise<Record<string, unknown>> {
	const capture = captureFor(ctx, params, requestId);
	const tab = ctx.registry.requireSurface(String(params.tab ?? ""));
	capture.active = false;
	capture.unsubscribe();
	await ctx.cdp.send(tab.view.webContents, "Network.disable");
	return summary(capture);
}

export function networkRead(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Record<string, unknown> {
	const capture = captureFor(ctx, params, requestId);
	const includeBody = params.include_request_body === true;
	const bodyOriginPath = includeBody ? requireScope(params, true) : "";
	if (includeBody && bodyOriginPath !== capture.bodyOriginPath) {
		throw new BrowserHostError(
			"origin_denied",
			"request bodies were not captured for this exact URL",
		);
	}
	const limit = params.limit === undefined ? 100 : Number(params.limit);
	if (!Number.isInteger(limit) || limit < 0 || limit > 200) {
		throw new BrowserHostError(
			"internal",
			"network_read limit must be an integer from 0 to 200",
		);
	}
	const afterId = params.after_id === undefined ? 0 : Number(params.after_id);
	if (!Number.isFinite(afterId) || afterId < 0) {
		throw new BrowserHostError(
			"internal",
			"network_read after_id must be a non-negative number",
		);
	}
	const status =
		params.status === undefined ? undefined : Number(params.status);
	if (status !== undefined && !Number.isFinite(status)) {
		throw new BrowserHostError(
			"internal",
			"network_read status must be a number",
		);
	}
	// Body scope consumes `url`; metadata's optional prefix filter is only
	// consulted on reads that do not request bodies. A filter that does not parse
	// as an http(s) URL refuses rather than silently matching everything.
	const prefix = includeBody ? "" : stringParam(params, "url");
	const safePrefix = prefix ? safeNetworkUrl(prefix) : "";
	if (prefix && (!normalizedOriginPath(prefix) || !safePrefix)) {
		throw new BrowserHostError(
			"origin_denied",
			"network_read url filter must be an http(s) URL",
		);
	}
	const entries = capture.entries
		.filter(
			(entry) =>
				entry.id > afterId &&
				(!stringParam(params, "request_id") ||
					entry.request_id === stringParam(params, "request_id")) &&
				(!stringParam(params, "method") ||
					entry.method.toUpperCase() ===
						stringParam(params, "method").toUpperCase()) &&
				(status === undefined || entry.status === status) &&
				(!prefix || entry.url.startsWith(safePrefix)),
		)
		.slice(0, limit)
		.map((entry) => {
			const {
				origin_path: _scope,
				started_at: _started,
				request_body_size: _bodySize,
				request_body_base64,
				...metadata
			} = entry;
			return includeBody &&
				entry.origin_path === bodyOriginPath &&
				request_body_base64 !== undefined
				? { ...metadata, request_body_base64 }
				: metadata;
		});
	return { ...summary(capture), entries };
}

export function networkClear(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
	requestId: string,
): Record<string, unknown> {
	const capture = captureFor(ctx, params, requestId);
	capture.entries = [];
	capture.bytes = 0;
	capture.bodyBytes = 0;
	// The buffer is the window these counters describe, so a clear resets them:
	// keeping a pre-clear drop count would make `count` and `dropped` describe
	// two different windows in one response.
	capture.droppedEntries = 0;
	capture.droppedBodies = 0;
	return summary(capture);
}

/** Buffers never survive a debugger lifecycle boundary. */
export function stopNetworkCapture(webContentsId: number): void {
	const capture = captures.get(webContentsId);
	if (!capture) return;
	capture.active = false;
	capture.unsubscribe();
	captures.delete(webContentsId);
}
