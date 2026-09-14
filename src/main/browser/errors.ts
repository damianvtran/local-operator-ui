import type { ErrorCode } from "./protocol";

/**
 * The one typed failure this host raises, and the only way a command ends in an
 * error response.
 *
 * WHY a class rather than return values: every action in `actions/` can fail at
 * any of several depths (attach, CDP, settle, the tab closing underneath it) and
 * the wire needs one `{code, message, data}` regardless of where it happened.
 * A throw keeps the happy path linear and lets `host.ts` be the single place
 * that turns a failure into a `Response`, which is also the single place that
 * guarantees the code is one the Python side knows.
 *
 * `code` is deliberately NOT checked against `ERROR_CODES` at construction
 * time. The reason is the same one the extension's `errors.ts` documents: the
 * released session drops a frame whose code it does not know, so an unknown
 * code is a silent hang rather than a visible failure — and a dev-time throw
 * here would surface that as a crash in the app instead. `rpc.ts` downgrades an
 * unrecognised code to `internal` on the way out, which is the safe direction.
 */
export class BrowserHostError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
		public readonly data: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "BrowserHostError";
	}
}

/** Narrow an unknown throwable to a `data` discriminator without a cast. */
export function errorData(error: unknown): Record<string, unknown> {
	return error instanceof BrowserHostError ? error.data : {};
}
