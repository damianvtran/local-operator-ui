import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type HubLinkAction,
	type HubPullPreview,
	type HubPushPreview,
	useHubLinkActions,
} from "@shared/api/local-operator/hub-link-actions";
import { useHubLinks } from "@shared/api/local-operator/hub-link-hooks";
import {
	type HubLink,
	type HubLinkKind,
	type HubUnresolvedLink,
	linksForLocalItem,
} from "@shared/api/local-operator/hub-links";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Disclosure } from "@shared/components/ui/disclosure";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useId, useRef, useState } from "react";
import { hubLinkView } from "../hub-link-adapter";
import { hubDirectionStateText, hubReasonText } from "../hub-link-copy";
import { hubPreviewIsCurrent, hubPreviewMatches } from "../hub-preview-binding";
import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "./hub-link-policy-controls";

const hubTime = (value: string) =>
	Number.isFinite(Date.parse(value))
		? formatDateTime(new Date(value))
		: t("ui.hub.status.unknown", { state: "invalid-timestamp" });

const isBusy = (link: HubLink) =>
	[link.pull.state, link.push.state].some((state) =>
		["checking", "merging", "applying", "pushing"].includes(state),
	);

/**
 * One writable origin group, with independent directional facts and errors. The
 * full proposal is rendered before manual publication; a stale receipt is never
 * replaced with a proposal the user has not seen. Core does the final fresh-byte
 * validation/CAS. The UI cannot certify that from its cached inventory.
 */
export function HubLinkGroup({ link }: { link: HubLink }) {
	useI18nLocale();
	const actions = useHubLinkActions(link.link_id);
	const source = hubLinkSourceName(link);
	const view = hubLinkView(link);
	const [publishPreview, setPublishPreview] = useState<HubPushPreview | null>(
		null,
	);
	const [incomingPreview, setIncomingPreview] = useState<HubPullPreview | null>(
		null,
	);
	const [incomingReports, setIncomingReports] = useState<string | null>(null);
	const [acknowledgedBaseline, setAcknowledgedBaseline] = useState(false);
	const [previewChanged, setPreviewChanged] = useState(false);
	const safeActionRef = useRef<HTMLButtonElement>(null);
	const ackId = useId();
	const busy = actions.isPending || isBusy(link);
	const unknownBaseline = link.baseline_state !== "known";

	const activePreview = publishPreview ?? incomingPreview;
	useEffect(() => {
		if (activePreview && !hubPreviewIsCurrent(activePreview, link)) {
			setPublishPreview(null);
			setIncomingPreview(null);
			setPreviewChanged(true);
		}
	}, [link, activePreview]);
	// Expiry is a real state change even while the inventory is idle. The timer
	// cancels this viewed proposal, never requests a new one behind the dialog.
	useEffect(() => {
		if (!activePreview) return;
		const remaining = Date.parse(activePreview.expires_at) - Date.now();
		const timer = setTimeout(
			() => {
				setPublishPreview(null);
				setIncomingPreview(null);
				setPreviewChanged(true);
			},
			Math.max(0, Math.min(remaining, 2_147_483_647)),
		);
		return () => clearTimeout(timer);
	}, [activePreview]);

	const run = (input: HubLinkAction) => {
		if (busy) return;
		if (input.action === "preview") setPreviewChanged(false);
		actions.mutate(input, {
			onSuccess: (response) => {
				if (input.action === "preview")
					setPublishPreview(
						response.preview?.direction === "push" ? response.preview : null,
					);
				else if (input.action === "apply" && input.preview) {
					const incoming =
						response.preview?.direction === "pull" ? response.preview : null;
					setIncomingPreview(incoming);
					setIncomingReports(JSON.stringify(response.reports, null, 2));
					setAcknowledgedBaseline(
						incoming?.choices.acknowledge_unknown_baseline ?? false,
					);
				} else {
					setPublishPreview(null);
					setIncomingPreview(null);
				}
			},
			onError: (error) => {
				if (
					error instanceof DesktopControlError &&
					[
						"publication-preview-changed",
						"application-preview-changed",
						"remote-revision-changed",
					].includes(error.code ?? "")
				) {
					setPublishPreview(null);
					setIncomingPreview(null);
					setPreviewChanged(true);
				}
			},
		});
	};
	const close = () => {
		if (!actions.isPending) {
			setPublishPreview(null);
			setIncomingPreview(null);
		}
	};
	const directionLabel = (direction: "pull" | "push") =>
		t(
			direction === "pull"
				? "ui.hub.links.direction_pull"
				: "ui.hub.links.direction_push",
		);
	return (
		<section
			className="flex min-w-0 flex-col gap-4 py-4"
			data-hub-link={link.link_id}
		>
			<div className="min-w-0">
				<h3 className="break-words text-heading text-ink">{source}</h3>
				<p className="break-words text-meta text-ink-muted">{link.name}</p>
				<p className="break-all text-meta text-ink-dim">
					{t("ui.hub.links.source_address", { address: link.hub_source })}
				</p>
			</div>
			<HubLinkPolicyControls link={link} />
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{(["pull", "push"] as const).map((direction) => {
					const status = link[direction];
					return (
						<div
							key={direction}
							className="min-w-0"
							data-hub-direction={direction}
						>
							<h4 className="text-body-sm text-ink">
								{directionLabel(direction)}
							</h4>
							<p className="text-body-sm text-ink-muted">
								{hubDirectionStateText(status)}
							</p>
							{status.error_class && (
								<p className="text-meta text-warning">
									{hubReasonText(status.error_class)}
								</p>
							)}
							{status.last_checked_at && (
								<p className="text-meta text-ink-muted">
									{t("ui.hub.status.last_checked", {
										time: hubTime(status.last_checked_at),
									})}
								</p>
							)}
							{status.last_success_at && (
								<p className="text-meta text-ink-muted">
									{t("ui.hub.links.last_success", {
										time: hubTime(status.last_success_at),
									})}
								</p>
							)}
							{status.next_retry_at && (
								<p className="text-meta text-ink-muted">
									{t("ui.hub.status.next_retry", {
										time: hubTime(status.next_retry_at),
									})}
								</p>
							)}
							{status.model_used && (
								<p className="break-words text-meta text-ink-muted">
									{t("ui.hub.links.actual_model", { model: status.model_used })}
								</p>
							)}
							{status.operation_id && (
								<p className="break-all text-meta text-ink-dim">
									{t("ui.hub.status.receipt", {
										operation: status.operation_id,
									})}
								</p>
							)}
							{view[direction].retryable && (
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() =>
										run({ action: "retry", linkId: link.link_id, direction })
									}
								>
									{t("ui.hub.links.retry")}
								</Button>
							)}
						</div>
					);
				})}
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => run({ action: "check", linkId: link.link_id })}
				>
					{t("ui.hub.subscriptions.check")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() =>
						run({ action: "apply", linkId: link.link_id, preview: true })
					}
				>
					{t("ui.hub.links.preview_pull")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={
						busy ||
						!link.remote_revision ||
						link.baseline_state !== "known" ||
						(link.visibility === "org" && !link.tenant_name)
					}
					onClick={() => run({ action: "preview", linkId: link.link_id })}
				>
					{t("ui.hub.subscriptions.preview_publish")}
				</Button>
			</div>
			{previewChanged && (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.links.preview_changed")}
				</p>
			)}
			{actions.error && (
				<p role="alert" className="text-body-sm text-danger">
					{t("ui.hub.links.action_failed", {
						direction: directionLabel(
							actions.variables?.action === "preview" ||
								actions.variables?.action === "confirm"
								? "push"
								: "pull",
						),
						item: link.name,
						source,
					})}
				</p>
			)}
			{actions.data?.reports
				.filter((report) => report.link_id === link.link_id)
				.map((report, index) => (
					<output
						key={`${report.operation_id ?? report.direction}-${index}`}
						className="text-meta text-ink-muted"
					>
						{t("ui.hub.links.action_result", {
							direction: directionLabel(report.direction),
							item: link.name,
							source,
							outcome: report.outcome,
						})}
					</output>
				))}
			<Dialog
				open={publishPreview !== null || incomingPreview !== null}
				onOpenChange={(open) => {
					if (!open) close();
				}}
			>
				<DialogContent
					className="max-w-3xl"
					closeDisabled={actions.isPending}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						safeActionRef.current?.focus();
					}}
					onEscapeKeyDown={(event) => {
						if (actions.isPending) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{publishPreview
								? t("ui.hub.links.preview_payload", { source })
								: t("ui.hub.links.preview_pull")}
						</DialogTitle>
						<DialogDescription>
							{publishPreview || !unknownBaseline
								? t("ui.hub.subscriptions.enable_safety")
								: t("ui.hub.links.unknown_baseline")}
						</DialogDescription>
					</DialogHeader>
					<pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-3 text-mono-sm text-ink">
						{JSON.stringify(activePreview?.proposal, null, 2)}
					</pre>
					{activePreview?.warnings.length ? (
						<div>
							<h4 className="text-body-sm text-ink">
								{t("ui.hub.links.preview_warnings")}
							</h4>
							{activePreview.warnings.map((warning, index) => (
								<p
									key={`${index}-${warning}`}
									className="break-words text-body-sm text-warning"
								>
									{warning}
								</p>
							))}
						</div>
					) : null}
					{activePreview?.reason && (
						<p className="text-body-sm text-warning">
							{hubReasonText(activePreview.reason)}
						</p>
					)}
					{incomingPreview && incomingReports && (
						<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words bg-sunken p-3 text-mono-sm text-ink">
							{incomingReports}
						</pre>
					)}
					{incomingPreview && unknownBaseline && (
						<label
							htmlFor={ackId}
							className="flex items-start gap-2 text-body-sm text-ink"
						>
							<Checkbox
								id={ackId}
								checked={acknowledgedBaseline}
								onCheckedChange={(checked) =>
									setAcknowledgedBaseline(checked === true)
								}
							/>
							{t("ui.hub.links.acknowledge_baseline")}
						</label>
					)}
					{actions.error && (
						<p role="alert" className="text-body-sm text-danger">
							{t("ui.hub.links.action_failed", {
								direction: directionLabel(publishPreview ? "push" : "pull"),
								item: link.name,
								source,
							})}
						</p>
					)}
					<DialogFooter>
						<Button
							ref={safeActionRef}
							variant="outline"
							disabled={actions.isPending}
							onClick={close}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						{publishPreview ? (
							<Button
								disabled={
									actions.isPending || !hubPreviewMatches(publishPreview, link)
								}
								onClick={() =>
									run({
										action: "confirm",
										linkId: link.link_id,
										previewReceipt: publishPreview.preview_receipt,
									})
								}
							>
								{t("ui.hub.links.confirm_publish")}
							</Button>
						) : (
							<>
								{(["local", "remote"] as const).map((prefer) => (
									<Button
										key={prefer}
										variant="outline"
										disabled={
											actions.isPending ||
											(unknownBaseline && !acknowledgedBaseline)
										}
										onClick={() =>
											run({
												action: "apply",
												linkId: link.link_id,
												preview: true,
												prefer,
												acknowledgeUnknownBaseline:
													unknownBaseline && acknowledgedBaseline,
											})
										}
									>
										{t(
											prefer === "local"
												? "ui.hub.links.prefer_local"
												: "ui.hub.links.prefer_remote",
										)}
									</Button>
								))}
								<Button
									disabled={
										actions.isPending ||
										!incomingPreview ||
										!hubPreviewMatches(incomingPreview, link) ||
										incomingPreview.choices.acknowledge_unknown_baseline !==
											acknowledgedBaseline ||
										incomingPreview.choices.replace !== null ||
										incomingPreview.choices.confirm_replace
									}
									onClick={() => {
										if (!incomingPreview) return;
										run({
											action: "apply",
											linkId: link.link_id,
											previewReceipt: incomingPreview.preview_receipt,
											confirmApply: true,
											prefer: incomingPreview.choices.prefer ?? undefined,
											acknowledgeUnknownBaseline:
												incomingPreview.choices.acknowledge_unknown_baseline,
										});
									}}
								>
									{t("ui.hub.subscriptions.pull")}
								</Button>
							</>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

/** Unknown legacy origin is a diagnostic, never a fabricated public policy row. */
export function HubUnresolvedSource({ row }: { row: HubUnresolvedLink }) {
	useI18nLocale();
	return (
		<section
			className="flex min-w-0 flex-col gap-1 py-3"
			data-hub-source-unresolved={row.local_id}
		>
			<h4 className="break-words text-body-sm text-ink">{row.name}</h4>
			<p className="text-body-sm text-warning">
				{t("ui.hub.links.source_unavailable")}
			</p>
			<code className="break-all text-mono-sm text-ink-muted">
				{row.hub_id}
			</code>
		</section>
	);
}

/** Persistent healthy inventory; old backends keep their pending-only panel. */
export function HubLinksPanel({
	enabled,
	kind,
	name,
	localId,
}: { enabled: boolean; kind?: HubLinkKind; name?: string; localId?: string }) {
	useI18nLocale();
	const inventory = useHubLinks(enabled);
	if (!enabled) return null;
	const rows =
		kind && name
			? linksForLocalItem(inventory.data, kind, localId, name)
			: (inventory.data?.links.filter((link) => !kind || link.kind === kind) ??
				[]);
	const unresolved = (inventory.data?.unresolved ?? []).filter(
		(row) =>
			(!kind || row.kind === kind) &&
			(!name || (localId ? row.local_id === localId : row.name === name)),
	);
	return (
		<Disclosure
			summary={t("ui.hub.links.title")}
			defaultOpen
			className="min-w-0"
			data-hub-links-panel
		>
			{inventory.isLoading ? (
				<output className="text-body-sm text-ink-muted">
					{t("ui.hub.links.loading")}
				</output>
			) : inventory.error && !inventory.data ? (
				<div>
					<p role="alert" className="text-body-sm text-danger">
						{t("ui.hub.links.load_failed")}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void inventory.refetch()}
					>
						{t("ui.hub.links.retry")}
					</Button>
				</div>
			) : rows.length === 0 && unresolved.length === 0 ? (
				<p className="text-body-sm text-ink-muted">{t("ui.hub.links.empty")}</p>
			) : (
				<div className="divide-y divide-hairline">
					{rows.map((link) => (
						<HubLinkGroup key={link.link_id} link={link} />
					))}
					{unresolved.map((row) => (
						<HubUnresolvedSource
							key={`${row.kind}:${row.local_id}`}
							row={row}
						/>
					))}
				</div>
			)}
			{inventory.error && inventory.data && (
				<p role="alert" className="text-meta text-warning">
					{t("ui.hub.links.load_failed")}
				</p>
			)}
		</Disclosure>
	);
}
