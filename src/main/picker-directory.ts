/**
 * Remembering where each picker was last used, so it opens there again.
 *
 * Electron 43 changed what `dialog.showOpenDialog` does when `defaultPath` is
 * omitted: the dialog now starts in the user's Downloads folder (their home
 * directory if there is none) and the OS stops remembering the last-used
 * directory at all — "Behavior Changed: Dialog methods default to Downloads
 * directory" in electronjs.org/docs/latest/breaking-changes. Every picker in
 * this app is a repeat of one task (pick the working directory, pick a file to
 * attach), so the pre-43 behaviour is the one users know, and handing the
 * remembered directory back as `defaultPath` is the workaround that same note
 * documents.
 *
 * Kept as its own module rather than inline in index.ts for one reason: index.ts
 * boots the app on import, so nothing can unit-test logic that lives there.
 * scripts/desktop-contract.test.mjs bundles this file in memory and exercises
 * the branches.
 *
 * Scope is the process on purpose: the OS's own memory of the last directory
 * cannot be restored, and persisting one here would invent a preference this
 * app does not otherwise keep.
 */
import { dirname } from "node:path";

const lastPickedDirectory = new Map<string, string>();

/**
 * Add the remembered directory to `options` as `defaultPath`, unless the caller
 * already chose one — an explicit `defaultPath` from a caller always wins.
 *
 * Generic over the option shape so the untyped options the renderer supplies
 * for `show-open-dialog` pass through unchanged.
 */
export function withRememberedDirectory<T extends { defaultPath?: string }>(
	kind: string,
	options: T,
): T {
	const remembered = lastPickedDirectory.get(kind);
	if (!remembered || options.defaultPath) return options;
	return { ...options, defaultPath: remembered };
}

/**
 * Record where a picker landed, for the next one of the same kind.
 *
 * `directoryPicked` is the caller saying "the chosen path IS the directory"
 * (the working-directory picker) rather than "the chosen path is a file inside
 * it" — for a file, the directory to remember is its parent.
 */
export function rememberPickedDirectory(
	kind: string,
	filePaths: readonly string[],
	directoryPicked = false,
): void {
	const [first] = filePaths;
	if (!first) return;
	lastPickedDirectory.set(kind, directoryPicked ? first : dirname(first));
}
