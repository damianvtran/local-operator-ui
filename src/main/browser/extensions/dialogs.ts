/**
 * Native consent dialogs for the extension manager (design §4.1 step 3).
 *
 * WHY native dialogs, not renderer UI: a native message box cannot be clicked
 * by CDP, `sendInputEvent` or a page, so an agent driving a tab can never
 * consent to an install, an access increase or a removal. They are also
 * refused (answer: false) unless the app window is focused in a launch mode
 * that may show UI, so a headless probe cannot summon one.
 *
 * Access lines come from the VERIFIED manifest (policy.ts accessOf), never the
 * store page's claim. "All websites" is stated explicitly when it applies.
 */
import { type BrowserWindow, dialog } from "electron";
import { t } from "../../../i18n";
import type { InstallPrompt } from "./manager";
import type { ExtensionAccess } from "./policy";

/** Long host lists are cut for the dialog; the manager's permission list shows
 * them all. 20 lines keeps the box on screen on a small display. */
const MAX_DIALOG_HOSTS = 20;

export function accessLines(access: ExtensionAccess): string[] {
	const lines: string[] = [];
	if (access.allSites) lines.push(t("ui.browser.extensions.perm_all_sites"));
	else if (access.hosts.length) {
		const shown = access.hosts.slice(0, MAX_DIALOG_HOSTS);
		const more = access.hosts.length - shown.length;
		lines.push(
			t("ui.browser.extensions.perm_sites", {
				hosts: more > 0 ? `${shown.join(", ")} (+${more})` : shown.join(", "),
			}),
		);
	}
	if (access.permissions.length)
		lines.push(
			t("ui.browser.extensions.perm_other", {
				permissions: access.permissions.join(", "),
			}),
		);
	if (!lines.length) lines.push(t("ui.browser.extensions.perm_none"));
	return lines;
}

export function installExtensionDialogs(
	window: BrowserWindow,
	mayAsk: () => boolean,
): {
	confirmInstall: (prompt: InstallPrompt) => Promise<boolean>;
	confirmRemove: (name: string) => Promise<boolean>;
} {
	return {
		confirmInstall: async (prompt) => {
			if (!mayAsk()) return false;
			const title =
				prompt.kind === "update"
					? t("ui.browser.extensions.install_confirm_update_title", {
							name: prompt.name,
						})
					: prompt.kind === "enable"
						? t("ui.browser.extensions.install_confirm_enable_title", {
								name: prompt.name,
							})
						: t("ui.browser.extensions.install_confirm_title", {
								name: prompt.name,
							});
			const accept =
				prompt.kind === "update"
					? t("ui.browser.extensions.install_confirm_update")
					: prompt.kind === "enable"
						? t("ui.browser.extensions.install_confirm_enable")
						: t("ui.browser.extensions.install_confirm_add");
			const detail = [
				t("ui.browser.extensions.install_confirm_body", {
					version: prompt.version,
				}),
				...accessLines(prompt.access).map((line) => `• ${line}`),
				"",
				t("ui.browser.extensions.install_compat_note"),
			].join("\n");
			const answer = await dialog.showMessageBox(window, {
				type: "question",
				title,
				message: title,
				detail,
				buttons: [t("ui.browser.extensions.install_confirm_cancel"), accept],
				// Cancel is the default and the Escape answer: consent is explicit.
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});
			return answer.response === 1;
		},
		confirmRemove: async (name) => {
			if (!mayAsk()) return false;
			const title = t("ui.browser.extensions.remove_confirm_title", { name });
			const answer = await dialog.showMessageBox(window, {
				type: "warning",
				title,
				message: title,
				detail: t("ui.browser.extensions.remove_confirm_body"),
				buttons: [
					t("ui.browser.extensions.install_confirm_cancel"),
					t("ui.browser.extensions.remove_confirm_remove"),
				],
				defaultId: 0,
				cancelId: 0,
				noLink: true,
			});
			return answer.response === 1;
		},
	};
}
