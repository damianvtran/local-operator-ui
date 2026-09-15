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
				<p className="mt-4 text-body-sm text-ink">
					Extensions can access signed-in pages independently of agent site
					approvals.
				</p>
				{/* The limitation is named as the CLASS of extension a user would recognise
				    (design round 1, D4) rather than as "companion connections": the reader
				    whose goal is "my password manager works here" is the one who needs
				    this sentence, and the reason is the verified one — native messaging
				    is refused by Chromium, which is what leaves a 1Password-class
				    extension unable to work (docs/browser-extensions.md, "The
				    1Password-class limitation, plainly"). */}
				<p className="mt-1 text-body-sm text-ink-muted">
					Review the manifest permissions before enabling. Chrome Web Store
					downloads are not supported, and neither is a password manager or
					other extension that talks to a desktop companion app: Chromium
					refuses native messaging.
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
						// `border-control` rather than no edge at all (design round 1, D3):
						// `danger-wash` on this sheet's `elevated` ground is 1.04-1.34:1 — a hue
						// difference rather than a boundary — so the panel's edge is the control
						// role the contract floors at 3:1 on every ground.
						className="mt-4 rounded-sm border border-control bg-danger-wash p-3 text-body-sm text-ink"
					>
						{error || state?.error}
					</p>
				)}
				{!state && !busy && api && (
					<p className="mt-4 text-body-sm text-ink-muted">
						Could not load extensions. Try Refresh.
					</p>
				)}
				{/* Not beside an error: a registry that could not be read has no rows
				    either, so gating on the row count alone put this sentence and the
				    error panel on screen together (review round 1, R5). */}
				{state && !state.error && state.rows.length === 0 && (
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
										? "Enabled, loaded"
										: row.enabled
											? "Enabled, not loaded"
											: "Disabled"}
							</p>
							<p className="mt-2 break-all font-mono text-mono-sm text-ink-muted">
								{row.path}
							</p>
							{row.error && (
								<p
									role="alert"
									className="mt-2 rounded-sm border border-control bg-danger-wash p-2 text-body-sm text-ink"
								>
									{row.error}
								</p>
							)}
							<details className="mt-3 text-body-sm text-ink-muted">
								<summary className="cursor-pointer text-ink">
									Permissions and compatibility
								</summary>
								{/* The id lives in here rather than on its own line of the row (design
								    round 1, N2): it is a fact a user consults, never one they decide
								    on, and as a row line it cost every row a line of height above the
								    disclosure it belongs with. */}
								{row.id && (
									<p className="mt-2 break-all font-mono text-mono-sm text-ink-dim">
										ID: {row.id}
									</p>
								)}
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
								{/* The destructive variant rather than `ghost` (design round 1, N1): as a
								    ghost control between two bordered ones, `Remove` read as body text,
								    its only distinguishing feature being the edge it did not have.
								    `danger` is the palette's own destructive triple, floored as text
								    by this same contract. */}
								<Button
									variant="danger"
									size="sm"
									disabled={busy || !!state.error}
									onClick={() => setRemoveKey(row.key)}
								>
									Remove
								</Button>
							</div>
							{/* The confirmation panel carries `border-control` for the reason the alert
							    above does (design round 1, D3): `surface` on `elevated` is 1.05-1.25:1,
							    so without an edge its boundary is a lightness step rather than a
							    control boundary. */}
							{removeKey === row.key && (
								<div className="mt-3 rounded-sm border border-control bg-surface p-3">
									<p className="text-body-sm text-ink">
										Remove this registration? It will stop loading on launch.
										Source files and stored extension data will stay on disk.
									</p>
									<div className="mt-2 flex gap-2">
										{/* `danger`, not `outline` (design round 1, N1): the confirmation of
										    a destructive action was drawn exactly as the reversible `Disable`
										    button is. */}
										<Button
											variant="danger"
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
