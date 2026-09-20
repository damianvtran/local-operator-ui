import { ConsoleError } from "./errors";
import type { ConsoleHost } from "./host";
import { DEFAULT_COLS, DEFAULT_ROWS, clampGrid } from "./host";
import type { ConsoleMethod, ConsoleReveal } from "./protocol";

/**
 * The wire half of the console: one method name becomes one host call.
 *
 * Design: docs/design/ui-console-tab.md 10.2 (the params and returns, exactly),
 * 10.6/15 (what a caller reads when it is refused).
 *
 * WHY THIS IS SEPARATE FROM THE HOST: the host's methods take typed arguments and
 * are driven by the app's own chrome as well as by the wire; this file is the only
 * place that knows what JSON looks like, and therefore the only place a missing or
 * malformed param can turn into a refusal. Keeping the two apart is what lets the
 * main-process tests drive the host directly (no transport) while the rig drives
 * the same behaviour through real HTTP.
 *
 * NOT HERE: the `unsupported_method` refusal. That belongs to the RPC layer, which
 * is where "this app does not know that method at all" is decidable — by the time
 * a call reaches this file the method is in the vocabulary.
 */

/** Every method this namespace answers, for the dispatcher's own exhaustiveness. */
const METHODS: readonly ConsoleMethod[] = [
	"console_list",
	"console_create",
	"console_status",
	"console_read",
	"console_screenshot",
	"console_input",
	"console_keys",
	"console_resize",
	"console_secure",
	"console_close",
];

/** Whether this namespace answers a method. The RPC layer uses it to route. */
export function isConsoleDispatchMethod(
	method: string,
): method is ConsoleMethod {
	return (METHODS as readonly string[]).includes(method);
}

export async function dispatchConsole(
	host: ConsoleHost,
	method: ConsoleMethod,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	switch (method) {
		case "console_list": {
			const sessionId = optionalString(params.session_id, "session_id");
			const surfaces = host.list(sessionId);
			return { surfaces, count: surfaces.length };
		}
		case "console_create": {
			const cols = optionalGrid(params.cols, "cols", DEFAULT_COLS);
			const rows = optionalGrid(params.rows, "rows", DEFAULT_ROWS);
			// Refused, not clamped, for the same reason a resize is: a caller that asked
			// for a 9000-column terminal has asked for something this host will not do,
			// and answering with the clamp would hide that from every log the caller can
			// see. Omitted values are the documented default (design 8.4).
			const clamped = clampGrid(cols, rows);
			if (clamped.cols !== cols || clamped.rows !== rows) {
				throw new ConsoleError(
					"invalid_grid",
					`${cols}x${rows} is outside the supported grid; the clamp would be ${clamped.cols}x${clamped.rows}`,
					// §10.6's key for this code is the nested `clamp`, which is what a
					// consumer's sentence names — the requested grid is already in the
					// message above it.
					{ clamp: clamped },
				);
			}
			// Spread rather than returned directly: the host's result is an interface,
			// which TypeScript will not widen to the wire's index signature.
			return {
				...host.create({
					sessionId: requiredString(params.session_id, "session_id"),
					origin: "agent",
					cwd: optionalString(params.cwd, "cwd"),
					command: optionalString(params.command, "command"),
					args: optionalStringList(params.args, "args"),
					input: optionalString(params.input, "input"),
					env: optionalEnv(params.env),
					cols,
					rows,
					reveal: optionalReveal(params.reveal),
					retain: optionalBoolean(params.retain, "retain"),
					sizing: optionalSizing(params.sizing),
				}),
			};
		}
		case "console_status": {
			return host.status(requiredSurface(params.surface));
		}
		case "console_read": {
			return host.read(
				requiredSurface(params.surface),
				requiredMode(params.mode),
				{
					start: optionalCount(params.start, "start"),
					count: optionalCount(params.count, "count"),
				},
			);
		}
		case "console_screenshot": {
			const format = optionalString(params.format, "format");
			if (format !== undefined && format !== "png") {
				// A format this host does not produce is an absent CAPABILITY rather
				// than a bad argument, which is what `unsupported_method` says: the
				// caller asked for something this app version cannot do.
				throw new ConsoleError(
					"unsupported_method",
					`this app version captures png only, not ${JSON.stringify(format)}`,
					{ format },
				);
			}
			return host.screenshot(requiredSurface(params.surface));
		}
		case "console_input": {
			const surface = requiredSurface(params.surface);
			const text = optionalString(params.text, "text");
			const bytes = optionalBytes(params.bytes);
			if (text === undefined && bytes === undefined) {
				// `secret_ref` is resolved by the TOOL, not here (design 11.3): the
				// session turns a ref into text before the call, so a call that arrives
				// with neither is a caller mistake rather than a value this host may go
				// looking for — there is nothing on this side to look in.
				throw new ConsoleError(
					"internal",
					"console_input needs text or bytes; a secret_ref is resolved by the tool before the call",
					{ surface },
				);
			}
			return host.input(surface, {
				text,
				bytes,
				paste: optionalBoolean(params.paste, "paste"),
			});
		}
		case "console_keys": {
			const surface = requiredSurface(params.surface);
			const keys = params.keys;
			if (
				!Array.isArray(keys) ||
				keys.length === 0 ||
				keys.some((key) => typeof key !== "string")
			) {
				throw new ConsoleError(
					"unknown_key",
					"console_keys needs a non-empty list of key names",
					{},
				);
			}
			return host.keys(surface, keys as string[]);
		}
		case "console_resize": {
			const surface = requiredSurface(params.surface);
			const cols = requiredInteger(params.cols, "cols");
			const rows = requiredInteger(params.rows, "rows");
			// Refused rather than clamped, with the clamp it would have applied
			// (design 10.6): a caller that asked for a 10-column terminal has asked for
			// something this host will not do, and answering "done" with 40 would hide
			// that from every log the caller can see. `create` is the exception, and
			// for one reason: an omitted grid inherits the documented default rather
			// than whatever a pane happens to be showing (design 8.4).
			const clamped = clampGrid(cols, rows);
			if (clamped.cols !== cols || clamped.rows !== rows) {
				throw new ConsoleError(
					"invalid_grid",
					`${cols}x${rows} is outside the supported grid; the clamp would be ${clamped.cols}x${clamped.rows}`,
					{ clamp: clamped },
				);
			}
			return host.resize(surface, cols, rows);
		}
		case "console_secure": {
			const surface = requiredSurface(params.surface);
			const on = params.on;
			if (typeof on !== "boolean") {
				throw new ConsoleError(
					"internal",
					"console_secure needs `on` to be true or false",
					{ surface },
				);
			}
			return host.setSecure(surface, on);
		}
		case "console_close": {
			const surface = requiredSurface(params.surface);
			return host.close(surface, {
				kill: optionalBoolean(params.kill, "kill"),
				retain: optionalBoolean(params.retain, "retain"),
			});
		}
	}
}

/**
 * The `surface` param, with the one code that fits it: a caller that named no
 * handle, or named something that is not a string, is asking about a surface that
 * cannot be resolved — the same refusal the browser's dispatcher gives a missing
 * `tab`.
 */
function requiredSurface(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new ConsoleError(
			"surface_unavailable",
			"a console command needs a surface handle",
			{ param: "surface" },
		);
	}
	return value;
}

/** Every other param: a malformed ARGUMENT is the caller's mistake rather than a
 * condition with its own vocabulary, so it is `internal` with a message that names
 * the parameter and the shape it wanted — the same convention `browser/ipc.ts`
 * uses at its own boundary. */
function requiredString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new ConsoleError("internal", `${name} must be a non-empty string`, {
			param: name,
		});
	}
	return value;
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return requiredString(value, name);
}

function optionalStringList(
	value: unknown,
	name: string,
): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new ConsoleError("internal", `${name} must be a list of strings`, {
			param: name,
		});
	}
	return value as string[];
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") {
		throw new ConsoleError("internal", `${name} must be true or false`, {
			param: name,
		});
	}
	return value;
}

function optionalGrid(value: unknown, name: string, fallback: number): number {
	if (value === undefined || value === null) {
		// The documented default, not the pane's current size (design 8.4).
		return fallback;
	}
	return requiredInteger(value, name);
}

function requiredInteger(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new ConsoleError("invalid_grid", `${name} must be a whole number`, {
			param: name,
		});
	}
	return value;
}

function optionalCount(value: unknown, name: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	const parsed = requiredInteger(value, name);
	if (parsed < 0) {
		throw new ConsoleError("internal", `${name} must not be negative`, {
			param: name,
		});
	}
	return parsed;
}

function requiredMode(value: unknown): "viewport" | "scrollback" {
	if (value === "viewport" || value === "scrollback") return value;
	throw new ConsoleError(
		"internal",
		'mode must be "viewport" or "scrollback"',
		{
			param: "mode",
		},
	);
}

function optionalReveal(value: unknown): ConsoleReveal | undefined {
	if (value === undefined || value === null) return undefined;
	if (value === "none" || value === "session" || value === "open") return value;
	throw new ConsoleError(
		"internal",
		'reveal must be "none", "session" or "open"',
		{
			param: "reveal",
		},
	);
}

function optionalSizing(value: unknown): "auto" | "fixed" | undefined {
	if (value === undefined || value === null) return undefined;
	if (value === "auto" || value === "fixed") return value;
	throw new ConsoleError("internal", 'sizing must be "auto" or "fixed"', {
		param: "sizing",
	});
}

/** `env` is a map of strings only: node-pty's own type takes string values, and a
 * number or a nested object would arrive at the child as `[object Object]`. */
function optionalEnv(value: unknown): Record<string, string> | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ConsoleError("internal", "env must be an object of strings", {
			param: "env",
		});
	}
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw !== "string") {
			throw new ConsoleError("internal", `env.${key} must be a string`, {
				param: "env",
				key,
			});
		}
		out[key] = raw;
	}
	return out;
}

/** A JSON array of byte values. The wire is JSON, so a byte string is a list
 * rather than base64: the push channel's frames are base64 because they are large
 * and produced in main, where encoding costs one call, whereas an input payload is
 * small and written by a caller that already holds the bytes. */
function optionalBytes(value: unknown): Uint8Array | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		!Array.isArray(value) ||
		value.some(
			(byte) =>
				typeof byte !== "number" ||
				!Number.isInteger(byte) ||
				byte < 0 ||
				byte > 255,
		)
	) {
		throw new ConsoleError(
			"internal",
			"bytes must be a list of integers between 0 and 255",
			{ param: "bytes" },
		);
	}
	return Uint8Array.from(value as number[]);
}
