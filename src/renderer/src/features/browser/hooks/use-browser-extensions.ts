import { t } from "@shared/i18n";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ExtensionSummary,
	ExtensionsRequest,
	ExtensionsResponse,
} from "../../../../../shared/browser-extensions";

type Request = (request: ExtensionsRequest) => Promise<ExtensionsResponse>;
type Subscribe = (changed: () => void) => () => void;

// Hosts without the desktop bridge (Storybook, jsdom tests of the page menu)
// get an empty, inert manager instead of a render-time crash.
const desktopRequest: Request = (request) =>
	window.api?.browser?.extensions
		? window.api.browser.extensions(request)
		: Promise.resolve({ extensions: [], ok: false });
const desktopSubscribe: Subscribe = (changed) =>
	window.api?.browser?.onStateChanged
		? window.api.browser.onStateChanged(changed)
		: () => {};

/**
 * Main's extension list, refreshed on the SAME browser-state event other chrome
 * mutations use (main calls notifyChanged on every status transition), so an
 * open menu/dialog observes "Starting…" → "On"/"Not working" without polling.
 *
 * `ok:false` from set-enabled/uninstall is usually the user pressing Cancel in
 * main's native dialog, so it is NOT an error toast; the row's own status shows
 * real failures. Toasts are for a failed IPC or a failed open.
 */
export function useBrowserExtensions(
	request: Request = desktopRequest,
	subscribe: Subscribe = desktopSubscribe,
) {
	const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [checking, setChecking] = useState(false);
	const epoch = useRef(0);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		const refresh = () => {
			const generation = ++epoch.current;
			void request({ op: "list" })
				.then((response) => {
					if (mounted.current && generation === epoch.current)
						setExtensions(response.extensions);
				})
				.catch(() => {
					/* Browser host unavailable: keep the last list. */
				});
		};
		const stop = subscribe(refresh);
		refresh();
		return () => {
			mounted.current = false;
			++epoch.current;
			stop();
		};
	}, [request, subscribe]);

	const run = useCallback(
		async (
			op: ExtensionsRequest,
			key: string,
		): Promise<ExtensionsResponse | null> => {
			setBusy((current) => new Set(current).add(key));
			try {
				const response = await request(op);
				++epoch.current;
				if (mounted.current) setExtensions(response.extensions);
				return response;
			} catch {
				showErrorToast(t("ui.browser.extensions.error_generic"));
				return null;
			} finally {
				if (mounted.current)
					setBusy((current) => {
						const next = new Set(current);
						next.delete(key);
						return next;
					});
			}
		},
		[request],
	);

	const setEnabled = useCallback(
		async (extension: ExtensionSummary, enabled: boolean) => {
			const response = await run(
				{ op: "set-enabled", id: extension.id, enabled },
				extension.id,
			);
			if (response?.ok && !enabled)
				showInfoToast(
					t("ui.browser.extensions.disabled_info", { name: extension.name }),
				);
		},
		[run],
	);
	const remove = useCallback(
		(extension: ExtensionSummary) =>
			void run({ op: "uninstall", id: extension.id }, extension.id),
		[run],
	);
	const open = useCallback(
		async (extension: ExtensionSummary, page: "popup" | "options") => {
			const response = await run(
				{
					op: page === "popup" ? "open-popup" : "open-options",
					id: extension.id,
				},
				extension.id,
			);
			if (response && !response.ok)
				showErrorToast(t("ui.browser.extensions.error_startup"));
		},
		[run],
	);
	const openStore = useCallback(
		() => void run({ op: "open-store" }, "store"),
		[run],
	);
	const checkUpdates = useCallback(async () => {
		setChecking(true);
		try {
			const response = await run({ op: "check-updates" }, "updates");
			if (!response) return;
			const updated = response.updated ?? 0;
			showInfoToast(
				updated > 0
					? t("ui.browser.extensions.updates_applied", { count: updated })
					: t("ui.browser.extensions.updates_none"),
			);
		} finally {
			if (mounted.current) setChecking(false);
		}
	}, [run]);

	return {
		extensions,
		busy,
		checking,
		setEnabled,
		remove,
		open,
		openStore,
		checkUpdates,
	};
}
