/**
 * The dev driver's `--attach` queue: the paperclip without the native picker.
 *
 * WHY THIS EXISTS. The composer's attach path is `handleAttachFile` ->
 * `ipcRenderer.invoke("show-open-dialog")` -> `addAttachment`. A rig can press
 * the button, but the OS dialog a browser-driven press opens cannot be clicked
 * by a CDP scene, so the one step a live proof needs - "the paperclip stages this
 * PDF" - was unreachable. This flag replaces ONLY the native picker's answer:
 * the press, the IPC round trip and `addAttachment` all run as they do for a
 * person, and the scene reports the store's staged list, not a fabricated one.
 *
 * FAIL-CLOSED, like the rest of the driver:
 *   - it is read ONLY when the dev-driver bridge is armed (`resolveDevDriverArming`);
 *     an unarmed launch ignores the arguments entirely, so the operator's own app
 *     can never have its file dialog answered by a flag;
 *   - every path must be ABSOLUTE. A relative one would be resolved against
 *     whatever cwd the app happens to hold, and a scene that staged a file from a
 *     directory nobody named is a claim the run cannot check;
 *   - a malformed value (an empty `--attach=`, a missing operand) is a PROBLEM
 *     line, not a silent skip: a run whose queue is empty would look exactly like
 *     a rig bug in the compose path.
 *
 * Deliberately imports nothing from Electron so a Node test can exercise the
 * parser in process, the same reason `dev-driver.ts` and `window-mode.ts` import
 * nothing either.
 */

import { isAbsolute } from "node:path";

/** The flag's exact spelling, stated once for the parser and the docs. */
export const ATTACH_FLAG = "--attach";

export type AttachArguments = {
	/** Absolute paths in the order the flags were given. */
	paths: string[];
	/** One line per value this run could not accept. */
	problems: string[];
};

/**
 * Read every `--attach` from an argv.
 *
 * Both spellings a Chromium/Electron command line actually carries are accepted -
 * `--attach=/abs/path` and `--attach /abs/path` - because the driver appends the
 * first and a person typing the second gets the same answer rather than a
 * surprise. Unknown sub-flags are left alone: this parser owns one flag and must
 * not swallow another module's argument.
 */
export function readAttachArguments(argv: readonly string[]): AttachArguments {
	const paths: string[] = [];
	const problems: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === ATTACH_FLAG) {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				problems.push(`${ATTACH_FLAG} needs an absolute path`);
				continue;
			}
			index += 1;
			accept(value, paths, problems);
			continue;
		}
		if (argument.startsWith(`${ATTACH_FLAG}=`)) {
			accept(argument.slice(ATTACH_FLAG.length + 1), paths, problems);
		}
	}
	return { paths, problems };
}

function accept(value: string, paths: string[], problems: string[]): void {
	if (!value.trim()) {
		problems.push(`${ATTACH_FLAG} needs an absolute path`);
		return;
	}
	if (!isAbsolute(value)) {
		problems.push(
			`${ATTACH_FLAG} takes an absolute path (got ${JSON.stringify(value)})`,
		);
		return;
	}
	paths.push(value);
}
