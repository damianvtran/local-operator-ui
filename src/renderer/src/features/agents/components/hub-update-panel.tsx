/**
 * The hub-update panel on an agent's or team's detail pane.
 *
 * The sidebar mark is deliberately a single glyph, so this is where the sentence
 * lives: what the hub has, why an attempt failed (in the B6.4 words, never the
 * raw exception), and the actions - Update, Retry, and for a conflict the
 * person's own decision, "Keep mine" / "Use the hub's" (`apply` with `prefer`).
 * Replacing the local text wholesale is NOT offered here: it is the destructive
 * `replace` path and needs its own confirm, which this surface does not ship.
 *
 * It renders nothing for an item the backend does not list (up to date,
 * unlinked, built-in) and nothing at all without the `hub_updates` capability,
 * so it costs a user who never used the hub no pixels.
 *
 * The failure of a press is drawn HERE, beside the buttons, from
 * `useHubActions().failures` - the hub's one error language, no toast.
 */

import {
	useHubActions,
	useHubUpdates,
} from "@shared/api/local-operator/hub-hooks";
import {
	type HubItemKind,
	hubItemIndex,
	hubItemKey,
	hubMarkDetail,
	hubMarkFor,
} from "@shared/api/local-operator/hub-updates";
import { Button } from "@shared/components/ui/button";

export function HubUpdatePanel({
	kind,
	name,
	enabled,
}: {
	kind: HubItemKind;
	name: string;
	/** `desktopFeatureEnabled(capabilities, "hub_updates")` - the caller already holds capabilities. */
	enabled: boolean;
}) {
	const updates = useHubUpdates(enabled);
	const hub = useHubActions();
	const key = hubItemKey(kind, name);
	const item = hubItemIndex(updates.data).get(key);
	const mark = hubMarkFor(item);
	if (!item || !mark) return null;
	const busy = hub.pending.has(key);
	const failure = hub.failures[key];
	const conflict =
		mark.kind === "review" || item.classification === "baseline-unknown";
	return (
		<section
			data-testid="hub-update-panel"
			aria-label="Hub update"
			className="mb-6 max-w-3xl space-y-2 rounded-md border border-hairline p-3 text-body-sm"
		>
			<p className="text-ink">{hubMarkDetail(item, mark)}</p>
			{item.last_error && mark.kind !== "available" && (
				<p className="text-meta text-ink-muted">{item.last_error}</p>
			)}
			<div className="flex flex-wrap gap-2">
				{mark.kind === "available" && !conflict && (
					<Button
						size="sm"
						variant="outline"
						aria-disabled={busy || undefined}
						onClick={() => !busy && void hub.applyItem(kind, name)}
					>
						{busy ? "Updating…" : "Update from the hub"}
					</Button>
				)}
				{mark.kind === "failed" && (
					<Button
						size="sm"
						variant="outline"
						aria-disabled={busy || undefined}
						onClick={() => !busy && void hub.retryItem(kind, name)}
					>
						{busy ? "Retrying…" : "Retry"}
					</Button>
				)}
				{conflict && (
					<>
						<Button
							size="sm"
							variant="outline"
							aria-disabled={busy || undefined}
							onClick={() => !busy && void hub.applyItem(kind, name, "local")}
						>
							Keep mine
						</Button>
						<Button
							size="sm"
							variant="outline"
							aria-disabled={busy || undefined}
							onClick={() => !busy && void hub.applyItem(kind, name, "remote")}
						>
							Use the hub's
						</Button>
					</>
				)}
			</div>
			{failure && (
				<p role="alert" className="text-meta text-danger">
					{failure}
				</p>
			)}
		</section>
	);
}
