/**
 * The hub-update panel on an agent's or team's detail pane.
 *
 * The sidebar mark is deliberately a single glyph, so this is where the sentence
 * lives: what the hub has, why an attempt failed (in the B6.4 words, from the
 * error CLASS and never the backend's raw exception text - agent review round 1,
 * R8), and the actions - Update, Retry, and for an item that needs a decision a
 * PREVIEW of both sides followed by "Keep mine" / "Use the hub's".
 *
 * ## A decision is never taken for the person (UX round 1, U3; review R5)
 *
 * `both-changed` and `baseline-unknown` items get NO one-click apply anywhere.
 * "Preview" runs the backend's dry run (`apply` with `dry_run`) and shows, for
 * each region that differs, the person's text beside the hub's, so the choice is
 * made on evidence. The two buttons are worded for what they DO to those regions
 * only (`prefer` resolves the parts that differ; everything else merges as
 * usual), and neither is styled as the primary action: "Use the hub's" discards
 * the person's wording in those parts, and a bright button would invite it.
 * Replacing the local text wholesale is NOT offered here: it is the destructive
 * `replace` path and needs its own confirm, which this surface does not ship.
 *
 * ## Baseline unknown (review R3)
 *
 * Nothing records what the person changed, so the backend answers `needs-review`
 * to every apply unless the caller acknowledges it (A2.3). The panel says so in
 * words - "the hub's additions are added, nothing of yours is deleted" - and
 * sends `acknowledgeUnknownBaseline` WITH the button the person pressed, so the
 * press means what the sentence says.
 *
 * ## Every press ends in a sentence
 *
 * The answer to a press (`hub.notes`, one store shared with the sidebar) is drawn
 * here, and it stays drawn after the item leaves the backend's list: a merged
 * item drops out of the store, and a panel that returned null at that moment
 * would take the only sentence saying what happened with it.
 *
 * It renders nothing for an item the backend does not list (up to date,
 * unlinked, built-in) and nothing at all without the `hub_updates` capability, so
 * it costs a user who never used the hub no pixels.
 */

import { HubStateIcon } from "@features/chat/components/hub-update-mark";
import {
	useHubActions,
	useHubUpdates,
} from "@shared/api/local-operator/hub-hooks";
import {
	type HubItemKind,
	type HubMark,
	type HubMergeRegion,
	type HubMergeReport,
	hubItemIndex,
	hubItemKey,
	hubMarkDetail,
	hubMarkFor,
} from "@shared/api/local-operator/hub-updates";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { useState } from "react";

const asText = (value: unknown): string =>
	value === null || value === undefined
		? ""
		: typeof value === "string"
			? value
			: JSON.stringify(value, null, 2);

/**
 * The state's own border, so the box a mark reaches reads as the SAME state the
 * mark carries (design round 2, D12). The marks spend ink on state and this panel
 * is their destination, so a fault and a decision landing on the trivial state's
 * chrome broke the thread exactly where the stakes are highest. `warning-border`
 * for the decision, `danger-border` for the fault, the hairline for everything
 * with nothing to do - the same two tokens `trace/tool-row.tsx` and
 * `chat-status-strip.tsx` spend on their own state surfaces, one class each and
 * no new pattern.
 */
const STATE_BORDER: Record<HubMark["kind"], string> = {
	available: "border-hairline",
	updating: "border-hairline",
	applied: "border-hairline",
	review: "border-warning-border",
	failed: "border-danger-border",
};

/** The regions a person has to choose between: the two sides differ. */
export function differingRegions(
	reports: readonly HubMergeReport[] | null,
): { field: string; region: HubMergeRegion }[] {
	const out: { field: string; region: HubMergeRegion }[] = [];
	for (const report of reports ?? [])
		for (const field of report.fields ?? [])
			for (const region of field.regions ?? [])
				if (
					region.provenance === "unresolved" ||
					asText(region.local) !== asText(region.remote)
				)
					out.push({ field: field.field, region });
	return out;
}

function Preview({
	regions,
}: { regions: { field: string; region: HubMergeRegion }[] }) {
	if (!regions.length)
		return (
			<p className="text-meta text-ink-muted">
				No differences to show: the hub's version matches yours.
			</p>
		);
	return (
		<ul className="space-y-3" data-testid="hub-update-preview">
			{regions.map(({ field, region }, index) => (
				<li
					key={`${field}:${region.id ?? index}`}
					className="space-y-1 text-meta"
				>
					<p className="font-medium text-ink">
						{region.heading || region.name || field}
					</p>
					<div className="grid gap-2 sm:grid-cols-2">
						<div>
							<p className="text-ink-muted">Yours</p>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-hairline p-2 text-ink">
								{asText(region.local) || "(nothing)"}
							</pre>
						</div>
						<div>
							<p className="text-ink-muted">The hub's</p>
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-hairline p-2 text-ink">
								{asText(region.remote) || "(nothing)"}
							</pre>
						</div>
					</div>
				</li>
			))}
		</ul>
	);
}

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
	const [preview, setPreview] = useState<HubMergeReport[] | null>(null);
	const key = hubItemKey(kind, name);
	const item = hubItemIndex(updates.data).get(key);
	const mark = hubMarkFor(item);
	const note = hub.notes[key];
	const busy = hub.pending.has(key);
	if (!item || !mark) {
		// Keep the answer to the press that just removed this item from the list.
		if (!note) return null;
		return (
			<section
				data-testid="hub-update-panel"
				aria-label="Hub update"
				className="mb-8 rounded-md border border-hairline p-3 text-body-sm"
			>
				<p
					role={note.tone === "error" ? "alert" : "status"}
					className={note.tone === "error" ? "text-danger" : "text-ink"}
				>
					{note.message}
				</p>
			</section>
		);
	}
	const decision = mark.kind === "review";
	const unknownBaseline = item.classification === "baseline-unknown";
	const options = (prefer?: "local" | "remote") => ({
		prefer,
		acknowledgeUnknownBaseline: unknownBaseline,
	});
	const previewNow = async () => {
		const reports = await hub.applyItem(kind, name, {
			...options(),
			dryRun: true,
		});
		setPreview(reports ?? []);
	};
	return (
		<section
			data-testid="hub-update-panel"
			aria-label="Hub update"
			className={cn(
				"mb-8 space-y-2 rounded-md border p-3 text-body-sm",
				STATE_BORDER[mark.kind],
			)}
		>
			<p className="flex items-start gap-2 text-ink">
				<HubStateIcon mark={mark} className="mt-0.5" />
				<span className={cn(mark.kind === "failed" && "text-danger")}>
					{hubMarkDetail(item, mark)}
				</span>
			</p>
			{decision && unknownBaseline && (
				<p className="text-meta text-ink-muted">
					Nothing records what you changed on this device. Either choice adds
					the hub's additions and deletes nothing of yours; where the two
					versions differ, your choice decides which wording stays.
				</p>
			)}
			{decision && !unknownBaseline && (
				<p className="text-meta text-ink-muted">
					Where the two versions differ, your choice decides which wording
					stays. Everything else is merged, and your current version is saved as
					a backup first.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{mark.kind === "available" && (
					<Button
						size="sm"
						variant="outline"
						aria-disabled={busy || undefined}
						onClick={() => !busy && void hub.applyItem(kind, name)}
					>
						{busy ? "Updating…" : "Update from the hub"}
					</Button>
				)}
				{mark.kind === "failed" && mark.retryable && (
					<Button
						size="sm"
						variant="outline"
						aria-disabled={busy || undefined}
						onClick={() => !busy && void hub.retryItem(kind, name)}
					>
						{busy ? "Retrying…" : "Retry"}
					</Button>
				)}
				{decision && (
					<>
						<Button
							size="sm"
							variant="outline"
							aria-disabled={busy || undefined}
							onClick={() => !busy && void previewNow()}
						>
							{busy && !preview ? "Loading…" : "Preview the differences"}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							aria-disabled={busy || undefined}
							onClick={() =>
								!busy && void hub.applyItem(kind, name, options("local"))
							}
						>
							Keep mine where they differ
						</Button>
						<Button
							size="sm"
							variant="ghost"
							aria-disabled={busy || undefined}
							onClick={() =>
								!busy && void hub.applyItem(kind, name, options("remote"))
							}
						>
							Use the hub's where they differ
						</Button>
					</>
				)}
			</div>
			{preview && decision && <Preview regions={differingRegions(preview)} />}
			{note && (
				<p
					role={note.tone === "error" ? "alert" : "status"}
					className={
						note.tone === "error"
							? "text-meta text-danger"
							: "text-meta text-ink-muted"
					}
				>
					{note.message}
				</p>
			)}
		</section>
	);
}
