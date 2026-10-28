/**
 * The application menu's English-catalogue keys, resolved at BUILD time.
 *
 * WHY A FUNCTION AND NOT A TABLE. A module-scope object of resolved sentences
 * freezes whatever locale was current at import — which, for the main process,
 * is the device tag before the backend has answered — so a language change could
 * never reach the menu. `createApplicationMenu` calls this per build, and the
 * locale subscription beside it rebuilds the menu when the resolved tag moves.
 *
 * WHY THE LABELS ARE HERE rather than inlined at the template. The template
 * lives in `index.ts`, which has top-level Electron side effects and therefore
 * cannot be imported by a test; this module holds nothing but the catalogue
 * lookups, so the suite can assert that every label comes from a key and follows
 * the active locale. `scripts/application-menu-labels.test.mjs` pins both halves:
 * the resolver here, and (in `index.ts`) that the template reads these labels
 * rather than literals.
 *
 * WHAT DOES NOT COME FROM HERE: the items Electron itself labels from a `role`
 * (`undo`, `copy`, `hide`, `services`, `togglefullscreen`, `help`, …). A role's
 * label is the OS's own vocabulary in the OS's language, which is the right
 * behaviour for an accelerator table and is reported as a known gap rather than
 * half-copied: keying a role's label would claim a language the role does not
 * follow, and the app menu is built before the backend can answer anyway.
 */

import { t } from "../i18n";

/** Every label the template sets itself, resolved in the active locale. */
export type ApplicationMenuLabels = {
	file: string;
	edit: string;
	view: string;
	window: string;
	newBrowserTab: string;
	reload: string;
	forceReload: string;
	actualSize: string;
	zoomIn: string;
	zoomOut: string;
	closeTabOrWindow: string;
	learnMore: string;
	/**
	 * `About {name}`: only "About" is copy. `name` is `app.name`, the product
	 * name, which every locale keeps verbatim — the same rule the key's own
	 * translator context states.
	 */
	about: (appName: string) => string;
};

/** Resolve the menu's own labels in the locale that is active RIGHT NOW. */
export function applicationMenuLabels(): ApplicationMenuLabels {
	return {
		file: t("ui.shell.menubar.file"),
		edit: t("ui.shell.menubar.edit"),
		view: t("ui.shell.menubar.view"),
		window: t("ui.shell.menubar.window"),
		newBrowserTab: t("ui.shell.menubar.new_browser_tab"),
		reload: t("ui.shell.menubar.reload"),
		forceReload: t("ui.shell.menubar.force_reload"),
		actualSize: t("ui.shell.menubar.actual_size"),
		zoomIn: t("ui.shell.menubar.zoom_in"),
		zoomOut: t("ui.shell.menubar.zoom_out"),
		closeTabOrWindow: t("ui.shell.menubar.close_tab_or_window"),
		learnMore: t("ui.shell.menubar.learn_more"),
		about: (appName: string) => t("ui.shell.menubar.about", { name: appName }),
	};
}
