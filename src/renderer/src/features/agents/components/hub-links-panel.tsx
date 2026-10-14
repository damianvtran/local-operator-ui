import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { usableOrgs } from "@features/agent-hub/org-access";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type HubLinkAction,
	type HubPullPreview,
	type HubPushPreview,
	useHubLinkActions,
	useHubSourceResolution,
} from "@shared/api/local-operator/hub-link-actions";
import { useHubLinks } from "@shared/api/local-operator/hub-link-hooks";
import {
	type HubLink,
	type HubLinkKind,
	type HubUnresolvedLink,
	baselineIsKnown,
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
import { apiConfig } from "@shared/config/api-config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
	// Known-ness is the provenance literal; only `adopt-unknown` is unknown.
	const unknownBaseline = !baselineIsKnown(link.baseline_state);

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
							{/*
							 * Item 8 (UX U6): the state sentence was always `ink-muted`,
							 * so a FAILED direction looked as calm as an idle one. The ink
							 * now follows the state's severity, and `available` (an action
							 * the reader may take) reads as accent rather than dim.
							 */}
							<p
								className={cn(
									"text-body-sm",
									status.state === "failed"
										? "text-danger"
										: status.state === "available"
											? "text-accent"
											: "text-ink-muted",
								)}
							>
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
							{view[direction].retryable &&
								(direction === "pull" || link.policy.auto_push) && (
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
						!baselineIsKnown(link.baseline_state) ||
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
export function HubUnresolvedSource({
	row,
	source,
	organizations,
	isAuthenticated,
	onSignIn,
}: {
	row: HubUnresolvedLink;
	/** The approved/configured credential-free source this app already holds. */
	source: string;
	/** The viewer's verified organizations; a stated org scope picks one. */
	organizations: { tenant_id: string; tenant_name: string }[];
	/** A signed-out viewer cannot reach any organization destination. */
	isAuthenticated: boolean;
	onSignIn: () => void;
}) {
	useI18nLocale();
	const [open, setOpen] = useState(false);
	/*
	 * NO PRE-SELECTION (UX U1 / design D3). The scope starts EMPTY — "" is not a
	 * destination — so confirming is a deliberate choice rather than a press of the
	 * default. Pre-selecting Public would make an irreversible publish the outcome
	 * of inaction, which is exactly what this control must not do.
	 */
	const [target, setTarget] = useState<string>("");
	const resolution = useHubSourceResolution();
	/*
	 * Focus moves INTO the confirmation region when it opens, so a deliberate
	 * irreversible act is not one keystroke from a control the reader cannot see
	 * (UX U4). The region is focusable by its own heading; nothing is auto-pressed.
	 */
	const resolveRegionRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (open) resolveRegionRef.current?.focus();
	}, [open]);
	const targetIsOrg = target !== "public" && target !== "";
	const org = targetIsOrg
		? organizations.find((candidate) => candidate.tenant_id === target)
		: null;
	// A half-stated destination cannot be confirmed: nothing selected, or an org
	// target with no known organization, is refused here rather than composed into
	// a guessed scope.
	const destinationKnown = target !== "" && (!targetIsOrg || !!org);
	const chose = destinationKnown && (targetIsOrg || target === "public");
	return (
		<section
			className="flex min-w-0 flex-col gap-1 py-3"
			data-hub-source-unresolved={row.local_id}
		>
			<h4 className="break-words text-body-sm text-ink">{row.name}</h4>
			{/*
			 * Design D5-D12: name the STATE, not the bare hub id. The id is a
			 * diagnostic, not an origin, so it moves beside the label rather than
			 * being the row's heading (the h4/h3 flip is fixed by this being a label
			 * and the id a muted detail).
			 */}
			<p className="text-body-sm text-warning" data-hub-unresolved-label>
				{t("ui.hub.links.source_not_confirmed")}
			</p>
			<p className="break-all text-mono-sm text-ink-dim">
				{t("ui.hub.links.source_address", { address: row.hub_id })}
			</p>
			{/*
			 * SOURCE CONFIRMATION, stated by the operator, never inferred.
			 *
			 * The row is a diagnostic with no origin, so the only honest way to give
			 * it one is an explicit act that names the source AND the scope. The
			 * app contributes the one approved source it already holds; the operator
			 * chooses Public or one of their VERIFIED organizations. The service owns
			 * the real identity/link computation and refuses a conflicting known scope
			 * (`origin-conflict`), so this control never fabricates a link or a policy.
			 */}
			{open ? (
				<div
					ref={resolveRegionRef}
					tabIndex={-1}
					className="mt-1 flex flex-col gap-2 outline-none"
				>
					<h5 className="text-body-sm text-ink">
						{t("ui.hub.links.resolve_title")}
					</h5>
					<p className="text-meta text-ink-muted">
						{t("ui.hub.links.resolve_description", { item: row.name })}
					</p>
					<code className="break-all text-mono-sm text-ink-muted">
						{source}
					</code>
					{/*
					 * Design D5-D12: the irreversibility warning is a body-level
					 * callout in warning ink, not a quiet meta line — it states a
					 * permanent consequence and must read like one.
					 */}
					<p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-body-sm text-warning">
						{t("ui.hub.links.resolve_irreversible")}
					</p>
					{isAuthenticated ? (
						<label className="text-body-sm text-ink">
							{t("ui.hub.links.scope_label")}
							<select
								className="mt-1 w-full rounded-md border border-control bg-surface px-2 py-1 text-body-sm text-ink"
								value={target}
								disabled={resolution.isPending}
								onChange={(event) => setTarget(event.target.value)}
							>
								{/* An empty option keeps confirming a deliberate choice. */}
								<option value="" disabled />
								<option value="public">{t("ui.hub.links.scope_public")}</option>
								{organizations.map((candidate) => (
									<option key={candidate.tenant_id} value={candidate.tenant_id}>
										{t("ui.hub.links.scope_private", {
											organization: candidate.tenant_name,
										})}
									</option>
								))}
							</select>
						</label>
					) : (
						/*
						 * A signed-out viewer gets the reason and the way back in, never
						 * a bare Public-only chooser (UX U1): the destinations they care
						 * about are their organizations, and offering only Public would
						 * push an irreversible publish at someone who cannot reach it.
						 */
						<Button variant="outline" onClick={onSignIn}>
							{t("ui.hub.links.sign_in_to_publish", {
								organization: t("ui.hub.links.scope_private", {
									organization: row.name,
								}),
							})}
						</Button>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={resolution.isPending}
							onClick={() => setOpen(false)}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							disabled={resolution.isPending || !chose}
							onClick={() =>
								resolution.mutate({
									kind: row.kind,
									localId: row.local_id,
									name: row.name,
									hubSource: source,
									visibility: targetIsOrg ? "org" : "public",
									tenantId: targetIsOrg ? (org?.tenant_id ?? null) : null,
								})
							}
						>
							{resolution.isPending
								? t("ui.hub.links.resolve_action_confirming")
								: resolution.isSuccess
									? t("ui.hub.links.resolve_action_done")
									: t("ui.hub.links.resolve_action_confirm")}
						</Button>
					</div>
					{/* A refusal is not a resolved row: the old state is byte-unchanged.
					 * Item 7 (UX U5): distinguish the KNOWN-scope conflict from any
					 * other failure instead of one blanket sentence. */}
					{resolution.error ? (
						<p role="alert" className="text-body-sm text-danger">
							{/* Item 7 (UX U5): a KNOWN-scope conflict has its own named
							 * sentence; every other refusal shows the real service reason
							 * via `hubReasonText` when one is carried, and only falls back
							 * to the generic sentence when it is not. */}
							{resolution.error instanceof DesktopControlError &&
							resolution.error.code === "origin-conflict"
								? t("ui.hub.links.resolve_conflict")
								: resolution.error instanceof DesktopControlError &&
										resolution.error.code
									? hubReasonText(resolution.error.code)
									: t("ui.hub.links.resolve_failed_generic")}
						</p>
					) : null}
				</div>
			) : (
				<Button
					variant="outline"
					size="sm"
					className="mt-1 self-start"
					onClick={() => setOpen(true)}
				>
					{t("ui.hub.links.resolve_action")}
				</Button>
			)}
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
	/*
	 * The ONE approved source this app already holds, plus the viewer's VERIFIED
	 * organizations. A source confirmation may name only these: the operator picks
	 * Public or one verified org, and the app never invents a base URL or infers
	 * the active organization as the destination.
	 */
	const { isAuthenticated } = useRadientAuth();
	const navigate = useNavigate();
	const { memberships } = useMembershipsQuery({
		enabled: enabled && isAuthenticated,
	});
	const organizations = usableOrgs(memberships).map((org) => ({
		tenant_id: org.tenant_id,
		tenant_name: org.tenant_name,
	}));
	const approvedSource = apiConfig.radientBaseUrl;
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
	/*
	 * Item 4 (UX elevated + design D2): the panel used to mount OPEN above the
	 * agent's title and displaced primary content ~40%. It now defaults COLLAPSED
	 * with a one-line summary, and the reader opens it. A healthy link therefore
	 * never displaces the page; the summary still names the source and the two
	 * independent policy facts so the collapsed row is informative rather than a
	 * bare heading. The summary is COMPOSED from existing keys (title + source +
	 * every row's on/off), so it needs no new catalogue copy.
	 */
	const summaryState =
		rows.length > 0
			? `${hubLinkSourceName(rows[0])} · Subscribe ${t(
					rows[0].policy.subscribe
						? "ui.hub.subscriptions.configured_on"
						: "ui.hub.subscriptions.configured_off",
				)} · Auto-push ${t(
					rows[0].policy.auto_push
						? "ui.hub.subscriptions.configured_on"
						: "ui.hub.subscriptions.configured_off",
				)}`
			: unresolved.length > 0
				? t("ui.hub.links.source_unavailable")
				: t("ui.hub.links.empty");
	/*
	 * Auto-open ONLY when a row needs the reader: an unresolved diagnostic, or a
	 * direction in a state that asks for attention (`available` wants an apply;
	 * `failed` wants a retry). A healthy/idle link stays collapsed, which is the
	 * acceptance criterion: a healthy link must not displace primary content.
	 */
	const needsAttention =
		unresolved.length > 0 ||
		rows.some((link) =>
			[link.pull.state, link.push.state].some(
				(state) => state === "available" || state === "failed",
			),
		);
	return (
		<Disclosure
			summary={`${t("ui.hub.links.title")} · ${summaryState}`}
			defaultOpen={needsAttention}
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
							source={approvedSource}
							organizations={organizations}
							isAuthenticated={isAuthenticated}
							onSignIn={() => navigate("/settings")}
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
