import { Button } from "@shared/components/ui";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@shared/components/ui/sheet";
import { useCallback, useEffect, useState } from "react";
import type {
	BrowserExtensionsApi,
	BrowserExtensionsState,
} from "../../../../../shared/browser-extensions";

/** The transport is injectable for the component gallery, not a second registry.
 * Every completed mutation replaces the projection with main's actual response. */
export function BrowserExtensionsSheet({
	open,
	onOpenChange,
	api = window.api?.browser?.extensions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	api?: BrowserExtensionsApi;
}) {
	const [state, setState] = useState<BrowserExtensionsState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [removeKey, setRemoveKey] = useState<string | null>(null);
	const run = useCallback(
		async (action: () => Promise<BrowserExtensionsState> | Promise<void>) => {
			setBusy(true);
			setError(null);
			try {
				const next = await action();
				if (next) setState(next);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				setBusy(false);
			}
		},
		[],
	);
	useEffect(() => {
		if (!open) {
			setRemoveKey(null);
			return;
		}
		if (api) void run(() => api.list());
	}, [open, api, run]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="w-full overflow-y-auto sm:max-w-lg"
				data-tour-tag="browser-extensions-sheet"
			>
				<SheetHeader>
					<SheetTitle>Browser extensions</SheetTitle>
					<SheetDescription>
						Load unpacked extensions from a local directory you trust. They
						share this app’s browser profile across conversations and restarts.
					</SheetDescription>
				</SheetHeader>
				<p className="mt-4 text-body-sm text-ink-muted">
					Extensions can access signed-in pages independently of agent site
					approvals. Review the manifest permissions before enabling. Chrome Web
					Store downloads and desktop companion connections are not supported.
				</p>
				<div className="mt-4 flex gap-2">
					<Button
						variant="primary"
						size="sm"
						disabled={busy || !api || !!state?.error}
						onClick={() => api && void run(() => api.install())}
					>
						Choose extension directory
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy || !api}
						onClick={() => api && void run(() => api.list())}
					>
						Refresh
					</Button>
				</div>
				{!api && (
					<output className="mt-4 block text-body-sm text-ink-muted">
						Extension management is available in the desktop app.
					</output>
				)}
				{busy && (
					<output className="mt-4 block text-body-sm text-ink-muted">
						Working… If a system dialog is open, review or cancel it to
						continue.
					</output>
				)}
				{(error || state?.error) && (
					<p
						role="alert"
						className="mt-4 rounded-sm bg-danger-wash p-3 text-body-sm text-ink"
					>
						{error || state?.error}
					</p>
				)}
				{!state && !busy && api && (
					<p className="mt-4 text-body-sm text-ink-muted">
						Could not load extensions. Try Refresh.
					</p>
				)}
				{state?.rows.length === 0 && (
					<p className="mt-6 text-body text-ink-muted">
						No extensions installed. Choose a directory containing a
						manifest.json file to get started.
					</p>
				)}
				<ul
					className="mt-5 flex flex-col gap-5"
					aria-label="Installed extensions"
				>
					{state?.rows.map((row) => (
						<li key={row.key} className="border-hairline border-t pt-4">
							<h3 className="break-words text-heading text-ink">
								{row.name}{" "}
								<span className="text-meta text-ink-muted">{row.version}</span>
							</h3>
							<p className="mt-1 text-body-sm text-ink-muted">
								{row.error
									? "Load error"
									: row.loaded
										? "Enabled · loaded"
										: row.enabled
											? "Enabled · not loaded"
											: "Disabled"}
							</p>
							<p className="mt-2 break-all font-mono text-mono-sm text-ink-muted">
								{row.path}
							</p>
							{row.id && (
								<p className="mt-1 break-all font-mono text-mono-sm text-ink-dim">
									ID: {row.id}
								</p>
							)}
							{row.error && (
								<p
									role="alert"
									className="mt-2 rounded-sm bg-danger-wash p-2 text-body-sm text-ink"
								>
									{row.error}
								</p>
							)}
							<details className="mt-3 text-body-sm text-ink-muted">
								<summary className="cursor-pointer text-ink">
									Permissions and compatibility
								</summary>
								<ul className="mt-2 list-disc space-y-2 pl-4">
									{row.permissions.length ? (
										row.permissions.map((permission) => (
											<li className="break-all" key={permission}>
												{permission}
											</li>
										))
									) : (
										<li>No manifest permissions declared.</li>
									)}
									{row.warnings.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							</details>
							<div className="mt-3 flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={busy || !!state.error}
									onClick={() =>
										api && void run(() => api.setEnabled(row.key, !row.enabled))
									}
								>
									{row.enabled ? "Disable" : "Enable"}
								</Button>
								{row.popup && (
									<Button
										variant="outline"
										size="sm"
										disabled={busy || !row.loaded}
										onClick={() =>
											api && void run(() => api.openPopup(row.key))
										}
									>
										Open popup
									</Button>
								)}
								<Button
									variant="ghost"
									size="sm"
									disabled={busy || !!state.error}
									onClick={() => setRemoveKey(row.key)}
								>
									Remove
								</Button>
							</div>
							{removeKey === row.key && (
								<div className="mt-3 rounded-sm bg-surface p-3">
									<p className="text-body-sm text-ink">
										Remove this registration? It will stop loading on launch.
										Source files and stored extension data will stay on disk.
									</p>
									<div className="mt-2 flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() =>
												api &&
												void run(async () => {
													const next = await api.remove(row.key);
													setRemoveKey(null);
													return next;
												})
											}
										>
											Remove registration
										</Button>
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											onClick={() => setRemoveKey(null)}
										>
											Cancel
										</Button>
									</div>
								</div>
							)}
						</li>
					))}
				</ul>
			</SheetContent>
		</Sheet>
	);
}
