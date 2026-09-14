/**
 * The session-leg wire envelope, mirrored for the UI host.
 *
 * This is NOT a second protocol. It is the same `Request`/`Response`/
 * `ErrorCode` vocabulary `local_operator/browser_bridge/protocol.py` defines,
 * so the Python session client (`BridgeClient.call`, `backend.py`) can talk to
 * this host by reading a different state file and changing nothing else. The
 * design (`docs/design/ui-browser-tab.md` 3(a), 10.1-10.2) requires exactly
 * that: one POST to `http://127.0.0.1:<port>/rpc` with the `X-Bridge-Key`
 * header, and a `Response` back.
 *
 * PROVENANCE — read this before editing a single value here.
 *
 * The design's end state (12.2) is that this file is a GENERATED, vendored
 * artifact: `gen_ts.py` grows a second target and emits
 * `src/main/browser/vendor/protocol.gen.ts` from `protocol.py`, with a
 * `PROVENANCE.json` pin and a `check-vendored.mjs` CI gate. That lop-side work
 * (design PR 2: `gen_ts.py` bundle target) has not landed on this branch's
 * base, so this file is the hand-written stand-in and is deliberately kept
 * byte-comparable with the Python source it mirrors: same constant names, same
 * string values, same order. Every value below was read off
 * `local_operator/browser_bridge/protocol.py` at `d383e6bfe`.
 *
 * TODO(vendoring): replace this file with the generated `protocol.gen.ts` and
 * delete nothing else — the imports in `host.ts`/`rpc.ts` are written against
 * the names this file exports so the swap is a path change, not a rewrite.
 *
 * WHY PROTO_VERSION IS NOT BUMPED BY THIS WORK. Adding a host does not add a
 * wire method, change an envelope, or add an `ErrorCode` the released extension
 * could emit, so the window invariant at `protocol.py:20-45` is respected. A
 * bump would close every already-released extension build with 4001, which the
 * design calls out as a defect rather than a nicety.
 */

/** The protocol version this host answers (`protocol.py:16`). */
export const PROTO_VERSION = 1;

/** How long the browser session's consent prompt is given before auto-deny.
 *
 * Mirrored from `protocol.py:227`. In this host the prompt renders in UI chrome
 * (design 9.2) which is a later PR; until then a pending request simply expires
 * unanswered, which default-denies — the honest direction.
 */
export const ORIGIN_PROMPT_TIMEOUT_MS = 60_000;

/**
 * Every RPC method this host answers, in the Python source's order.
 *
 * `retitle` is present because the wire carries it and the session may send it;
 * the host answers it as a no-op (design 4: the UI has no tab groups, and the
 * tab's label is the page title).
 */
export const METHODS = [
	"open",
	"goto",
	"read",
	"snapshot",
	"screenshot",
	"click",
	"type",
	"close",
	"status",
	"tabs",
	"scroll",
	"logs",
	"request_access",
	"await_access",
	"cancel_access",
	"retitle",
	"owner_recover",
	"owner_finish",
	"owner_retain",
	"owner_release",
] as const;

export type Method = (typeof METHODS)[number];

const METHOD_SET: ReadonlySet<string> = new Set<string>(METHODS);

/** Whether a raw string is one of the methods above. */
export function isMethod(value: unknown): value is Method {
	return typeof value === "string" && METHOD_SET.has(value);
}

/**
 * Per-method budgets, mirrored from `COMMAND_TIMEOUTS` (`protocol.py:233`).
 *
 * The host does not enforce these (the session's daemon/client does) — they are
 * here because `await_access`'s bounded slice and `scroll`'s settle both need a
 * number the two sides agree on, and inventing a second constant beside the
 * one the Python side already publishes is how the two drift.
 */
export const COMMAND_TIMEOUTS_S: Record<Method, number> = {
	owner_recover: 20.0,
	owner_finish: 20.0,
	owner_retain: 20.0,
	owner_release: 20.0,
	open: 30.0,
	goto: 30.0,
	click: 25.0,
	type: 25.0,
	read: 20.0,
	snapshot: 20.0,
	screenshot: 20.0,
	close: 20.0,
	status: 20.0,
	tabs: 20.0,
	scroll: 20.0,
	logs: 20.0,
	request_access: 20.0,
	await_access: 25.0,
	cancel_access: 20.0,
	retitle: 20.0,
};

/**
 * The typed error vocabulary, mirrored from `ErrorCode` (`protocol.py:283-333`).
 *
 * The string values are the contract: the session maps them to model-facing
 * sentences, and an unknown value fails the Python-side model validation and is
 * SILENTLY DROPPED (the frame never reaches the agent). So a host-side failure
 * must reuse a code from this list — never invent one.
 */
export const ERROR_CODES = [
	"extension_disconnected",
	"not_paired",
	"tab_closed",
	"nav_failed",
	"nav_timeout",
	"element_not_found",
	"origin_denied",
	"origin_prompt_pending",
	"origin_not_allowed",
	"debugger_conflict",
	"access_queue_full",
	"tab_limit",
	"tab_ambiguous",
	"busy",
	"proto_mismatch",
	"owner_refused",
	"extension_unresponsive",
	"internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One buffered console/runtime log line, as `logs` returns it (newest last). */
export interface LogEntry {
	level: string;
	text: string;
	source: string;
	url: string;
	line: number;
	timestamp: number;
}

/** What `scroll` reports back so the agent knows where the viewport landed. */
export interface ScrollResult {
	scrollX: number;
	scrollY: number;
	moreBelow: boolean;
	moreRight: boolean;
	url: string;
	title: string;
}

export interface Request {
	id: string;
	method: Method;
	params: Record<string, unknown>;
}

export interface ErrorDetail {
	code: ErrorCode;
	message: string;
	data: Record<string, unknown>;
}

export type Response =
	| { id: string; ok: true; result: Record<string, unknown> }
	| { id: string; ok: false; error: ErrorDetail };

/**
 * The body `/health` answers, and the check a STALE state file is acquitted by
 * (design 10.2).
 *
 * `pid` is the reason this is not a bare 200: a stale state file whose port has
 * been recycled by another process must NOT be acquitted, and the caller knows
 * which pid it is asking about. The bridge's `_health_ok` (`backend.py:185-194`)
 * requires `extension_connected` for the same reason.
 */
export interface HealthBody {
	host: "ui";
	proto: number;
	pid: number;
}
