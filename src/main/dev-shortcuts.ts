/**
 * The only window shortcut main handles before the page sees a key (#1085).
 *
 * `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils` used to sit
 * here; in packaged builds it cancelled Ctrl+R (so the Console's reverse search
 * never reached the shell) and, by default, Cmd/Ctrl+minus (so Zoom Out never
 * fired). Keep main's interception to dev-only F12 and let every other key
 * reach the page, the menu and the app's own zoom listener.
 */
export interface ShortcutInput {
	type: string;
	code: string;
}

export function shouldToggleDevTools(
	input: ShortcutInput,
	isDev: boolean,
): boolean {
	return isDev && input.type === "keyDown" && input.code === "F12";
}
