#!/usr/bin/env node
/**
 * The console host's option surface, read against the one place the app builds it.
 *
 * WHY THIS IS A MODULE AND NOT A CELL. `startConsoleHost` takes a large option
 * object and the app derives it from its own options at exactly ONE call site
 * (`startBrowserHost`, `src/main/browser/index.ts`). Every other construction path
 * in this repository is a test that injects the seams directly, which is precisely
 * why a dropped field can survive a green suite: the tests and the app build the
 * option object independently, so the app's copy was never the one under test. It
 * was measured, not theorised — the capture-view branch added `consoleCaptureUrl`
 * and `preloadPath` to the host's options, OPTIONAL so that a build without them
 * still starts, and the call site forwarded neither: the live app built no capture
 * view and `console_screenshot` answered `capture_unavailable` for every surface,
 * a typed and plausible condition rather than a failed start.
 *
 * SO THE RULE IS READ OFF THE SOURCE, not restated here as a list that can drift:
 * `consoleHostOptionFields` parses the fields the host declares, and the drift is
 *   - a declared field that is neither in the required set nor in the defaulted
 *     set: nobody decided about it, and an optional field defaults silently;
 *   - a field that must be forwarded and is not named at the construction site:
 *     the exact shape above.
 * The two ledgers live beside the options themselves
 * (`CONSOLE_REQUIRED_OPTIONS` / `CONSOLE_DEFAULTED_OPTIONS` in
 * `src/main/console/index.ts`), so a field added there is a field the
 * construction site has to answer for.
 *
 * A LIMITATION WORTH STATING: this reads TypeScript as text — one interface body and
 * one object literal — so it understands flat fields and no nesting, and it strips
 * both comment forms before it looks. A caller that forwards through a helper
 * instead of a literal will read as drifting, which is the intended direction: that
 * caller should either be a literal or teach this module the new shape. It reads the
 * real bytes the app runs, which is what a seam-injected test cannot do.
 */

const INTERFACE_OPEN = /^\s*export interface StartConsoleHostOptions\s*\{/;
const FIELD = /^\s*([A-Za-z_$][\w$]*)\s*\??\s*:/;
/** A shorthand property — `log,` rather than `log: log` — is the same key. */
const SHORTHAND = /^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/;
const CALL_OPEN = /startConsoleHost\(\s*\{/;

/** Cut a line's comments out, honouring a block comment carried in from above. */
function stripComments(line, state) {
	let text = line;
	if (state.inBlock) {
		const close = text.indexOf("*/");
		if (close === -1) return { text: "", state };
		text = text.slice(close + 2);
		state.inBlock = false;
	}
	for (;;) {
		const open = text.indexOf("/*");
		if (open === -1) break;
		const close = text.indexOf("*/", open + 2);
		if (close === -1) {
			state.inBlock = true;
			text = text.slice(0, open);
			break;
		}
		text = text.slice(0, open) + text.slice(close + 2);
	}
	const lineComment = text.indexOf("//");
	return {
		text: lineComment === -1 ? text : text.slice(0, lineComment),
		state,
	};
}

/** The fields `StartConsoleHostOptions` declares, in the order they appear. */
export function consoleHostOptionFields(source) {
	const lines = source.split("\n");
	const start = lines.findIndex((line) => INTERFACE_OPEN.test(line));
	if (start === -1) {
		throw new Error(
			"src/main/console/index.ts no longer declares `export interface StartConsoleHostOptions`; console-wiring.mjs reads that declaration and must be updated with it",
		);
	}
	const fields = [];
	const state = { inBlock: false };
	for (let index = start + 1; index < lines.length; index += 1) {
		const { text } = stripComments(lines[index], state);
		if (/^\s*\}/.test(text)) break;
		const match = FIELD.exec(text);
		if (match) fields.push(match[1]);
	}
	return fields;
}

/** The keys the app's one construction site hands to `startConsoleHost`. */
export function consoleCallSiteKeys(source) {
	const match = CALL_OPEN.exec(source);
	if (!match) {
		throw new Error(
			"src/main/browser/index.ts no longer calls `startConsoleHost({ ... })`; console-wiring.mjs reads that call and must be updated with it",
		);
	}
	const keys = [];
	let depth = 1;
	const state = { inBlock: false };
	for (const rawLine of source
		.slice(match.index + match[0].length)
		.split("\n")) {
		const { text } = stripComments(rawLine, state);
		if (depth === 1) {
			const key = FIELD.exec(text) ?? SHORTHAND.exec(text);
			if (key) keys.push(key[1]);
		}
		for (const character of text) {
			if (character === "{") depth += 1;
			else if (character === "}") depth -= 1;
		}
		if (depth <= 0) break;
	}
	return keys;
}

/**
 * What is wrong with the wiring, as two lists of field names rather than a boolean,
 * so a failure names the field a reader has to go and look at.
 */
export function consoleWiringDrift({
	hostSource,
	appSource,
	requiredOptions,
	defaultedOptions,
}) {
	const declared = consoleHostOptionFields(hostSource);
	const forwarded = new Set(consoleCallSiteKeys(appSource));
	const decided = new Set([...requiredOptions, ...defaultedOptions]);
	return {
		unclassified: declared.filter((field) => !decided.has(field)),
		missingAtCallSite: declared.filter(
			(field) => !forwarded.has(field) && !defaultedOptions.includes(field),
		),
	};
}
