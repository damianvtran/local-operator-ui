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
	// File transfer, appended in the Python source's order so the two lists stay
	// comparable by eye (design §6.1, §6.5). Both halves are NOT symmetric on the
	// extension, and the reason is a measurement rather than a preference — see
	// `EXTENSION_CANNOT_SERVE` in `browser_bridge/protocol.py`: no extension build
	// can serve `download`, because Chrome refuses an extension every CDP primitive
	// that could put a file where the harness chose (measured 2026-09-18, Chrome
	// 153), while `upload` rides `DOM.setFileInputFiles` on the session it already
	// holds. THIS host serves both.
	"download",
	"upload",
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
	// `download` waits on a PAGE rather than on us: the click that starts it may be
	// followed by a slow server, and the agent's own `timeout_s` may raise the wait
	// (clamped to `CAPS.downloadTimeoutMaxS`). It is the one method whose bound is
	// measured in minutes rather than seconds, which is why the harness's discovery
	// record is what tells a session this host can serve it at all (design §6.3)
	// rather than the budget implying it.
	download: 120.0,
	// `upload` is local: the browser reads the bytes off disk, so the budget covers
	// the attach plus the read-back that proves the DOM holds them.
	upload: 60.0,
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
	// Present for MIRROR PARITY with `protocol.py`'s `ErrorCode`, and emitted by the
	// DAEMON, never by this host (§6.2). It has to be in this list for the reason
	// `rpc.ts` narrows an unknown code to `internal`: an already-released session
	// validates `ErrorDetail.code` against the Python enum, so a frame carrying a
	// code it does not know is DROPPED — which is worse than a wrong answer, because
	// the caller waits out its whole budget. The daemon is on the safe side of that
	// direction (daemon -> session), a browser host is not, which is exactly why a
	// policy refusal travels as an `ok: true` result here.
	"capability_unsupported",
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

/** One file's facts, in the ONE shape both hosts return for `download` and
 * `upload` — byte-for-byte the generated `FileFact` (`gen_ts.py`, design §6.1).
 *
 * `sha256` is computed by PYTHON, never by a host: a host that reports a hash it
 * did not compute is a host whose word is being trusted, which is the property
 * the post-hoc verification (§5.3) exists to remove. A host therefore sends ""
 * here and Python replaces it from the bytes on disk.
 *
 * `sniffed` is what the reporting side observed about the CONTENT, or "" when it
 * could observe nothing — which is every case in this host: only Python reads the
 * bytes. `mime` is what the SERVER declared. */
export interface FileFact {
	name: string;
	path: string;
	bytes: number;
	mime: string;
	sniffed: string;
	sha256: string;
}

/** `download` -> the files that landed, whether a capture was armed at all, and
 * why not. `armed: false` with a `reason` is a POLICY ANSWER, not a fault. */
export interface DownloadResult {
	files: FileFact[];
	armed: boolean;
	reason: string;
}

/** `upload` -> the selectors that accepted files, and the facts of what the DOM
 * actually holds after the attach (read back, never assumed). */
export interface UploadResult {
	inputs: string[];
	accepted: FileFact[];
}

/**
 * The methods THIS host build serves, as it advertises them.
 *
 * WHY CAPABILITY AND NOT A VERSION COMPARISON (design §6.3): a host that predates
 * a feature must produce a TYPED degrade naming the remedy, and version
 * arithmetic cannot tell "older" from "current but stopped answering" — the two
 * have opposite remedies. The same list travels in the discovery record
 * (`state-file.ts`'s `capabilities`) and in `/health`, which is what lets the
 * harness degrade without opening a socket at all.
 *
 * ONE constant, three writers: a second list beside this one is how a host starts
 * advertising something it does not serve.
 */
export const HOST_CAPABILITIES: readonly Method[] = ["download", "upload"];

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
	/** The methods this build serves, additively (§6.3): a caller that predates the
	 * field reads a missing key as "nothing advertised" and degrades typed, and one
	 * that does not reads the same list the discovery record carries. */
	capabilities: string[];
}
