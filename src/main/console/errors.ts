import type { ErrorCode } from "../browser/protocol";
import { BridgeCommandError } from "../browser/vendor/driver/errors";

/**
 * The console's typed failure, at the one place the console raises it.
 *
 * Design: docs/design/ui-console-tab.md 10.6 and 15. The class is the same value
 * the browser host raises (the vendored `BridgeCommandError`, re-exported as
 * `BrowserHostError` over there) on purpose: `rpc.ts` recognises a typed failure
 * with `instanceof`, and a second class here would demote every console refusal
 * to a bare `internal` — the exact shape a caller cannot act on and a reviewer
 * cannot read.
 *
 * `code` is any value of the shared vocabulary, not only the console's own
 * additions: a condition the browser already names is reused rather than renamed
 * (the caps are `tab_limit`, exactly as the browser reports them), and the
 * additions in `console/protocol.ts` are those the existing values would lie
 * about. It is NOT checked against `ERROR_CODES` here for the reason the vendored
 * class documents: an unknown code is silently dropped by the session's own
 * model, so the conversion to `internal` happens in `rpc.ts` on the way out
 * rather than as a throw in the middle of a command.
 */
export class ConsoleError extends BridgeCommandError {
	constructor(
		code: ErrorCode,
		message: string,
		data: Record<string, unknown> = {},
	) {
		super(code, message, data);
	}
}
