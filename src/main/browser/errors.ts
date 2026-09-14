import { BridgeCommandError } from "./vendor/driver/errors";

/**
 * The one typed failure this host raises, and the only way a command ends in an
 * error response.
 *
 * THE CLASS IS VENDORED, not re-implemented. `errors.ts` is one of the modules
 * design 12.2 shares with the extension — the same throw shape crossing the
 * same wire — so this file is a thin, host-named alias over the vendored copy
 * and the app's imports (`./errors`, `BrowserHostError`) are unchanged.
 *
 * WHY THE ALIAS MATTERS RATHER THAN A LOOKALIKE CLASS: `rpc.ts` recognises a
 * typed failure with `instanceof`. A second class here would fail that test for
 * every error raised inside a vendored module (a `deadline()` stall is the
 * everyday case), which would silently demote a typed error with its `data` to
 * a bare `internal` — the exact shape QA round 1 flagged as unreadable.
 *
 * `code` is deliberately NOT checked against `ERROR_CODES` at construction
 * time. The reason is the one the extension's own header documents: the
 * released session drops a frame whose code it does not know, so an unknown
 * code is a silent hang rather than a visible failure, and a dev-time throw
 * here would surface that as a crash in the app instead. `rpc.ts` downgrades an
 * unrecognised code to `internal` on the way out, which is the safe direction.
 */
export { BridgeCommandError as BrowserHostError };

/** Narrow an unknown throwable to a `data` discriminator without a cast. */
export function errorData(error: unknown): Record<string, unknown> {
	return error instanceof BridgeCommandError ? error.data : {};
}
