import { t } from "@shared/i18n";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ExtensionInstallProgress,
	ExtensionSummary,
	ExtensionUpdateReport,
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

/** The update check's sentence (review U2). "Up to date" is said only when
 * every check succeeded and nothing waits for approval; a failure is never
 * reported as current. Exported for its regression test. */
export function updateReportMessage(report: ExtensionUpdateReport): string {
	const parts: string[] = [];
	if (report.applied > 0)
		parts.push(
			t("ui.browser.extensions.updates_applied", { count: report.applied }),
		);
	if (report.pending > 0)
		parts.push(
			t("ui.browser.extensions.updates_pending", { count: report.pending }),
		);
	if (report.failed > 0) parts.push(t("ui.browser.extensions.updates_failed"));
	return parts.length
		? parts.join(" ")
		: t("ui.browser.extensions.updates_none");
}

export type ExtensionsLoadState = "loading" | "ready" | "error";

/**
 * Main's extension list, refreshed on the SAME browser-state event other chrome
 * mutations use (main calls notifyChanged on every status transition), so an
 * open menu or the lop://extensions page observes "Starting…" → ready without
 * polling.
 *
 * `ok:false` from set-enabled/uninstall is usually the user pressing Cancel in
 * main's native dialog, so it is NOT an error toast; the card's own status
 * shows real failures. Toasts are for a failed IPC or a failed open.
 */
export function useBrowserExtensions(
	request: Request = desktopRequest,
	subscribe: Subscribe = desktopSubscribe,
) {
	const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
	const [installing, setInstalling] = useState<ExtensionInstallProgress[]>([]);
	const [loadState, setLoadState] = useState<ExtensionsLoadState>("loading");
	const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
	const [checking, setChecking] = useState(false);
	const [updateMessage, setUpdateMessage] = useState<string | null>(null);
	const epoch = useRef(0);
	const mounted = useRef(true);

	const accept = useCallback((response: ExtensionsResponse) => {
		setExtensions(response.extensions);
		setInstalling(response.installing ?? []);
		setLoadState("ready");
	}, []);

	const refresh = useCallback(() => {
		const generation = ++epoch.current;
		void request({ op: "list" })
			.then((response) => {
				if (mounted.current && generation === epoch.current) accept(response);
			})
			.catch(() => {
				// Browser host unavailable: keep the last list; only a FIRST load
				// that fails is an error state (the page offers Try again).
				if (mounted.current && generation === epoch.current)
					setLoadState((current) => (current === "ready" ? current : "error"));
			});
	}, [request, accept]);

	useEffect(() => {
		mounted.current = true;
		const stop = subscribe(refresh);
		refresh();
		return () => {
			mounted.current = false;
			++epoch.current;
			stop();
		};
	}, [refresh, subscribe]);

	const run = useCallback(
		async (
			op: ExtensionsRequest,
			key: string,
		): Promise<ExtensionsResponse | null> => {
			setBusy((current) => new Set(current).add(key));
			try {
				const response = await request(op);
				++epoch.current;
				if (mounted.current) accept(response);
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
		[request, accept],
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
	/** Resolves true when main removed it (false: the user cancelled). */
	const remove = useCallback(
		async (extension: ExtensionSummary) =>
			!!(await run({ op: "uninstall", id: extension.id }, extension.id))?.ok,
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
	const openLink = useCallback(
		async (extension: ExtensionSummary, link: "listing" | "homepage") => {
			const response = await run(
				{
					op: link === "listing" ? "open-listing" : "open-homepage",
					id: extension.id,
				},
				extension.id,
			);
			if (response && !response.ok)
				showErrorToast(t("ui.browser.extensions.error_generic"));
		},
		[run],
	);
	const retry = useCallback(
		(extension: ExtensionSummary) => {
			// U12: the badge says "Starting…" the moment the user asks, not ~2 s
			// later when main's own `loading` push arrives. Main's next list
			// replaces this optimistic row either way.
			setExtensions((current) =>
				current.map((entry) =>
					entry.id === extension.id ? { ...entry, status: "loading" } : entry,
				),
			);
			void run({ op: "retry", id: extension.id }, extension.id);
		},
		[run],
	);
	const cancelInstall = useCallback(
		(id: string) => void run({ op: "cancel", id }, `install:${id}`),
		[run],
	);
	const openStore = useCallback(
		() => void run({ op: "open-store" }, "store"),
		[run],
	);
	const checkUpdates = useCallback(async () => {
		setChecking(true);
		setUpdateMessage(null);
		try {
			const response = await run({ op: "check-updates" }, "updates");
			if (!response) return;
			// No report = main could not run the check at all (host stopping).
			const message = updateReportMessage(
				response.updates ?? { applied: 0, pending: 0, failed: 1 },
			);
			if (mounted.current) setUpdateMessage(message);
			showInfoToast(message);
		} finally {
			if (mounted.current) setChecking(false);
		}
	}, [run]);

	return {
		extensions,
		installing,
		loadState,
		busy,
		checking,
		updateMessage,
		refresh,
		setEnabled,
		remove,
		open,
		openLink,
		retry,
		cancelInstall,
		openStore,
		checkUpdates,
	};
}
