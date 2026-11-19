import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { usableOrgs } from "@features/agent-hub/org-access";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	type HubLinkAction,
	type HubPushPreview,
	isDirectionalReport,
	useHubLinkActions,
	useHubSourceResolution,
} from "@shared/api/local-operator/hub-link-actions";
import { useHubLinks } from "@shared/api/local-operator/hub-link-hooks";
import {
	type HubLink,
	type HubLinkKind,
	type HubUnresolvedLink,
	baselineIsKnown,
	hubLinkContentState,
	linksForLocalItem,
} from "@shared/api/local-operator/hub-links";
import { HubMutationUpgradeRequired } from "@shared/api/local-operator/hub-mutation-safety";
import type { HubMergeReport } from "@shared/api/local-operator/hub-updates";
import { Alert, AlertTitle } from "@shared/components/ui/alert";
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
import { useNavigate, useSearchParams } from "react-router-dom";
import { hubLinkView } from "../hub-link-adapter";
import {
	hubActionFailureText,
	hubDirectionStateText,
	hubOutcomeText,
	hubReasonText,
} from "../hub-link-copy";
import { hubPreviewIsCurrent, hubPreviewMatches } from "../hub-preview-binding";
import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "./hub-link-policy-controls";

/*
 * UX U3'/design D20: an unparseable timestamp degrades to the same cause-neutral
 * sentence, with NO raw `{state}` token and no action the surface does not have.
 */
const hubTime = (value: string) =>
	Number.isFinite(Date.parse(value))
		? formatDateTime(new Date(value))
		: t("ui.hub.status.unknown");

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
export function HubLinkGroup({
	link,
	displayName,
	itemsById,
}: {
	link: HubLink;
	/** The local item's DISPLAY name (an agent/team row's `name` is its id). */
	displayName?: string;
	/** `desktopFeatureEnabled(capabilities, "hub_items_by_id")`. */
	itemsById: boolean;
}) {
	useI18nLocale();
	const actions = useHubLinkActions(link, { displayName, itemsById });
	const source = hubLinkSourceName(link);
	const view = hubLinkView(link);
	const [publishPreview, setPublishPreview] = useState<HubPushPreview | null>(
		null,
	);
	/*
	 * THE INCOMING PREVIEW IS THE DRY-RUN'S OWN REPORTS.
	 *
	 * Core's `/updates/apply` answers `{reports, status}` and NO `preview`
	 * member (`desktop_hub.py`), and its report rows carry no `link_id` or
	 * `direction` (`report.py` `ItemMergeReport.to_json`). The panel therefore
	 * cannot read a `HubPullPreview` from that answer - the type has no producer
	 * on this route - so the dialog is built from the one report for this row.
	 *
	 * The honest limit: core RECOMPUTES the merge when the real apply arrives
	 * (the route re-checks the item), so what is shown is advisory, not a
	 * receipt. The dialog says so; it must never claim to apply exactly this.
	 */
	const [incomingReports, setIncomingReports] = useState<
		HubMergeReport[] | null
	>(null);
	/** The merge preference the reader picked while previewing, applied on Pull. */
	const [incomingPrefer, setIncomingPrefer] = useState<
		"local" | "remote" | undefined
	>(undefined);
	const [acknowledgedBaseline, setAcknowledgedBaseline] = useState(false);
	const [previewChanged, setPreviewChanged] = useState(false);
	const safeActionRef = useRef<HTMLButtonElement>(null);
	const ackId = useId();
	const busy = actions.isPending || isBusy(link);
	// Known-ness is the provenance literal; only `adopt-unknown` is unknown.
	const unknownBaseline = !baselineIsKnown(link.baseline_state);
	/*
	 * A dry run answers one of three classes, and they are NOT "changed" and
	 * "everything else" (`report.py` `ItemOutcome`, measured over the wire by
	 * review round 3):
	 *
	 *   - `would-merge`          - Pull would write.
	 *   - `needs-review`         - there IS something to merge, but core needs a
	 *                              decision: a conflict (`merge-refused`) or an
	 *                              unknown baseline (`model-unavailable`, which
	 *                              is EVERY unknown-baseline dry run without the
	 *                              acknowledgement - `merge.py` returns
	 *                              `needs-review`, never `would-merge`). The
	 *                              prefer buttons and the acknowledgement live
	 *                              in the dialog, so this class MUST open it.
	 *   - `up-to-date`/`unchanged` - a genuine no-op: state it inline.
	 *
	 * A failure class (`unavailable`, `failed`, `skipped`) is stated inline as
	 * a failure with core's own `message`; it is not "nothing to pull" either.
	 * `refused` never reaches here: the route answers 422 for a single item.
	 */
	const incomingOutcomes = new Set(
		(incomingReports ?? []).map((report) => report.outcome),
	);
	const incomingDelta = incomingOutcomes.has("would-merge");
	const incomingNeedsReview = incomingOutcomes.has("needs-review");
	const incomingActionable = incomingDelta || incomingNeedsReview;
	const incomingFailure =
		incomingReports?.find((report) =>
			["failed", "skipped", "unavailable"].includes(report.outcome),
		) ?? null;

	const activePreview = publishPreview;
	useEffect(() => {
		if (activePreview && !hubPreviewIsCurrent(activePreview, link)) {
			setPublishPreview(null);
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
					/*
					 * One row's dry-run reports. Matched on `local_id` (the exact
					 * identity this row was addressed by), never on a name: a name
					 * arm can answer for two rows, and showing another item's merge
					 * under this row would be a lie about what Pull would do.
					 */
					setIncomingReports(
						(response.reports ?? []).filter(
							(report) => report.local_id === link.local_id,
						),
					);
					setIncomingPrefer(input.prefer);
					/* The re-preview that follows a tick keeps the tick: resetting it
					 * here would make the acknowledgement impossible to leave on. */
					setAcknowledgedBaseline(input.acknowledgeUnknownBaseline === true);
				} else {
					setPublishPreview(null);
					setIncomingReports(null);
				}
			},
			onError: (error) => {
				/*
				 * A REFUSED preview shows nothing of the previous answer: its
				 * inline result described a request that is no longer the latest,
				 * so keeping it under the new alert would state two outcomes for
				 * one press (QA round 3, Q8).
				 */
				if (input.action === "apply" && input.preview) setIncomingReports(null);
				if (
					error instanceof DesktopControlError &&
					[
						"publication-preview-changed",
						"application-preview-changed",
						"remote-revision-changed",
					].includes(error.code ?? "")
				) {
					setPublishPreview(null);
					setIncomingReports(null);
					setPreviewChanged(true);
				}
			},
		});
	};
	const close = () => {
		if (!actions.isPending) {
			setPublishPreview(null);
			setIncomingReports(null);
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
							/* UX U10/design D21: one explicit column gap normalises
							 * the spacing, so a control (Retry) is not stranded ~4px
							 * under its own "Next retry:" line at a narrow width. */
							className="flex min-w-0 flex-col items-start gap-1"
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
										disabled={busy || !actions.canWrite}
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
					disabled={busy || !actions.canWrite}
					onClick={() => run({ action: "check", linkId: link.link_id })}
				>
					{t("ui.hub.subscriptions.check")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					/*
					 * NOTHING TO PREVIEW INTO WITHOUT A COPY (QA r1 Q3 / UX U1): on a
					 * subscribed-but-not-installed skill core answers this dry run 422
					 * ("did not complete"), a dead end in developer words. The way in
					 * is the pane's own Download; this waits for a copy to exist.
					 */
					disabled={
						busy ||
						!actions.canWrite ||
						(link.kind === "skill" && hubLinkContentState(link) === "absent")
					}
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
						!actions.canWrite ||
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
					{actions.error instanceof HubMutationUpgradeRequired
						? actions.error.message
						: hubActionFailureText(actions.variables?.action, {
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
			{/*
			 * Design D8: a RETRY result restated the row below it. The post-mutation
			 * refetch has already written the new state sentence under these same
			 * controls, so the second line was one outcome told twice. A CHECK or a PULL
			 * keeps its line: its answer is not a state this row can render on its own.
			 */}
			{actions.variables?.action !== "retry" &&
				actions.data?.reports
					.filter(isDirectionalReport)
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
								/*
								 * Design D10: the same defect class D1 fixed one string over. `outcome` is
								 * core's `ItemOutcome` enum (`report.py`), so interpolating it raw put
								 * "would-merge" in front of a reader - and in a locale it left the one
								 * word this app does translate in English. `hubOutcomeText` is the word
								 * for the class, degrading to the raw token only for a class this build
								 * has never seen.
								 */
								outcome: hubOutcomeText(report.outcome),
							})}
						</output>
					))}
			{incomingReports && !incomingActionable && !incomingFailure && (
				<output className="text-meta text-ink-muted">
					{t("ui.hub.links.incoming_nothing", {
						outcome: hubOutcomeText(
							incomingReports[0]?.outcome ?? "up-to-date",
						),
					})}
				</output>
			)}
			{incomingFailure && (
				<div role="alert" className="flex flex-col gap-0.5">
					<p className="text-body-sm text-danger">
						{/*
						 * Design D10, the second string in this dialog: the failure sentence ran
						 * the raw `ItemFailure` outcome in, so a locale could not translate it.
						 */}
						{t("ui.hub.links.incoming_failed", {
							outcome: hubOutcomeText(incomingFailure.outcome),
						})}
					</p>
					{/*
					 * NEVER core's raw message here: on a hub outage it carries the endpoint
					 * URL and the raw response body (QA round 3, Q9). The class maps to the
					 * same sentence the row's own status uses, which names the situation
					 * without developer detail.
					 */}
					<p className="break-words text-meta text-ink-muted">
						{hubReasonText(incomingFailure.error_class)}
					</p>
				</div>
			)}
			<Dialog
				open={publishPreview !== null || incomingActionable}
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
							{publishPreview
								? t("ui.hub.subscriptions.enable_safety")
								: t("ui.hub.links.preview_recomputed")}
						</DialogDescription>
						{!publishPreview && unknownBaseline && (
							<p className="text-body-sm text-warning">
								{t("ui.hub.links.unknown_baseline")}
							</p>
						)}
					</DialogHeader>
					{incomingReports ? (
						<>
							{incomingNeedsReview && (
								<p className="text-body-sm text-ink" data-needs-review>
									{t("ui.hub.links.incoming_needs_review")}
								</p>
							)}
							<ul className="flex flex-col gap-1" data-incoming-reports>
								{incomingReports.map((report, index) => (
									<li
										key={`${report.local_id}-${index}`}
										/* Design D1: the conclusion and its explanation rank separately - see
										 * the two lines below. */
										className="flex flex-col gap-0.5"
									>
										<p className="text-body-sm text-ink">
											{t("ui.hub.links.incoming_outcome", {
												item: displayName?.trim() || link.name,
												outcome: hubOutcomeText(report.outcome),
											})}
										</p>
										{/*
										 * Core's unknown-baseline refusal names the CLI flag
										 * (`--accept-unknown-baseline`, `merge.py`), which means
										 * nothing in this window: the control it describes is the
										 * checkbox below. The discriminator is the TICK, not the
										 * error class: core reports an unacknowledged unknown
										 * baseline as `model-unavailable` on some rows and
										 * `merge-refused` on others, and keeps `model-unavailable`
										 * for a REAL conflict once the tick is on (QA round 3, Q7,
										 * both directions). Before the tick, the checkbox sentence;
										 * after it, core's own words.
										 */}
										{(unknownBaseline && !acknowledgedBaseline) ||
										report.message ? (
											<p className="text-meta text-ink-muted">
												{unknownBaseline && !acknowledgedBaseline
													? t("ui.hub.links.incoming_unknown_baseline")
													: report.message}
											</p>
										) : null}
									</li>
								))}
							</ul>
						</>
					) : (
						<pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-3 text-mono-sm text-ink">
							{JSON.stringify(activePreview?.proposal, null, 2)}
						</pre>
					)}
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
					{/*
					 * No raw report dump: it duplicated the list above and printed
					 * core's machine words — including the CLI flag its
					 * unknown-baseline message names — as if they were copy.
					 */}
					{incomingReports && unknownBaseline && (
						<label
							htmlFor={ackId}
							className="flex items-start gap-2 text-body-sm text-ink"
						>
							<Checkbox
								id={ackId}
								checked={acknowledgedBaseline}
								onCheckedChange={(checked) => {
									const next = checked === true;
									setAcknowledgedBaseline(next);
									/* The acknowledgement changes what core is allowed to
									 * do, so the preview is re-asked: Pull must never ride a
									 * report produced without the value it would send. */
									run({
										action: "apply",
										linkId: link.link_id,
										preview: true,
										prefer: incomingPrefer,
										acknowledgeUnknownBaseline: next,
									});
								}}
							/>
							{t("ui.hub.links.acknowledge_baseline")}
						</label>
					)}
					{actions.error && (
						<p role="alert" className="text-body-sm text-danger">
							{actions.error instanceof HubMutationUpgradeRequired
								? actions.error.message
								: hubActionFailureText(actions.variables?.action, {
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
									actions.isPending ||
									!actions.canWrite ||
									!hubPreviewMatches(publishPreview, link)
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
											!actions.canWrite ||
											(unknownBaseline && !acknowledgedBaseline)
										}
										onClick={() => {
											/* `incomingPrefer` is set by the ANSWER, never by
											 * the press: a failed re-preview must not leave Pull
											 * sending a preference no shown preview used. */
											run({
												action: "apply",
												linkId: link.link_id,
												preview: true,
												prefer,
												acknowledgeUnknownBaseline:
													unknownBaseline && acknowledgedBaseline,
											});
										}}
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
										!actions.canWrite ||
										!incomingDelta ||
										(unknownBaseline && !acknowledgedBaseline)
									}
									onClick={() =>
										run({
											action: "apply",
											linkId: link.link_id,
											prefer: incomingPrefer,
											acknowledgeUnknownBaseline:
												unknownBaseline && acknowledgedBaseline,
										})
									}
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
	initialOpen,
	onResolved,
}: {
	row: HubUnresolvedLink;
	/** The approved/configured credential-free source this app already holds. */
	source: string;
	/** The viewer's verified organizations; a stated org scope picks one. */
	organizations: { tenant_id: string; tenant_name: string }[];
	/** A signed-out viewer cannot reach any organization destination. */
	isAuthenticated: boolean;
	onSignIn: () => void;
	/** Opened on arrival for a `?resolve=1` deep link from the sidebar affordance. */
	initialOpen?: boolean;
	onResolved?: () => void;
}) {
	useI18nLocale();
	const [open, setOpen] = useState(initialOpen ?? false);
	/*
	 * NO PRE-SELECTION (UX U1 / design D3). The scope starts EMPTY — "" is not a
	 * destination — so confirming is a deliberate choice rather than a press of the
	 * default. Pre-selecting Public would make an irreversible publish the outcome
	 * of inaction, which is exactly what this control must not do.
	 */
	const [target, setTarget] = useState<string>("");
	const resolution = useHubSourceResolution(onResolved);
	/*
	 * Focus moves INTO the confirmation region when it opens, so a deliberate
	 * irreversible act is not one keystroke from a control the reader cannot see
	 * (UX U4). The region is focusable by its own heading; nothing is auto-pressed.
	 */
	const resolveRegionRef = useRef<HTMLDivElement>(null);
	const openerRef = useRef<HTMLButtonElement>(null);
	/*
	 * UX U4': opening moves focus INTO the region (a deliberate irreversible act is
	 * never a keystroke from an unseen control), and CANCEL returns focus to the
	 * opener so the reader is not dropped back to `body`.
	 */
	const returnToOpener = useRef(false);
	useEffect(() => {
		if (open) resolveRegionRef.current?.focus();
		else if (returnToOpener.current) {
			// Cancel's opener exists only AFTER the close commit, not in its handler.
			returnToOpener.current = false;
			openerRef.current?.focus();
		}
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
		/*
		 * ONE CARD, IN THE RECORD'S OWN COLUMN (operator report, 2026-10-19:
		 * "it's weird showing up above the title of the agent and it doesn't
		 * have the same width as the agent view constraint, it's not immediately
		 * clear what it's saying and what you're supposed to do").
		 *
		 * The page passes this block into the record's pane, below its title, so
		 * it is part of the record it describes rather than a banner over it, and
		 * it inherits the pane's measure instead of carrying a second one.
		 *
		 * THE ACT SITS BELOW THE CARD, NOT INSIDE IT. The card is the warning
		 * wash, and the only control the contrast contract asserts on that wash
		 * is a filled primary (the "primary remedy on the warning wash" row);
		 * an outlined control or an input field painted on the wash would be an
		 * unasserted pairing. The scope chooser and its buttons therefore sit on
		 * the pane's own ground, immediately under the card that explains them.
		 */
		<section
			className="flex min-w-0 flex-col gap-3"
			data-hub-source-unresolved={row.local_id}
		>
			<Alert variant="warning" className="p-4">
				<div className="flex flex-col gap-3">
					{resolution.upgradeMessage && (
						<output
							className="block text-meta text-warning"
							data-hub-core-upgrade
						>
							{resolution.upgradeMessage}
						</output>
					)}
					{/*
					 * THE STATE IS THE TITLE; THE ITEM IS THE HEADING.
					 *
					 * Design D5-D12 named the state rather than the bare hub id, and
					 * the id stays a diagnostic - a muted mono line, never a heading.
					 * The heading is the ITEM, at the level under the record's own
					 * title (h3): the card lives inside the record now, so it does
					 * not skip a level the way the old h4 did.
					 */}
					<AlertTitle data-hub-unresolved-label>
						{t("ui.hub.links.source_not_confirmed")}
					</AlertTitle>
					<h3 className="break-words text-body-sm font-medium text-ink">
						{row.name}
					</h3>
					{/*
					 * WHAT / WHY / WHAT TO DO, in that order and in the reader's own
					 * words. The block used to say "Source not confirmed" and stop:
					 * a state with no consequence and no next step, which is what
					 * "not immediately clear what it's saying and what you're
					 * supposed to do" describes.
					 */}
					<p className="text-body-sm text-ink">
						{t("ui.hub.links.unresolved_what", { item: row.name })}
					</p>
					<p className="text-body-sm text-ink">
						{t("ui.hub.links.unresolved_why", { item: row.name })}
					</p>
					<p className="text-body-sm text-ink">
						{t("ui.hub.links.unresolved_next")}
					</p>
					{/*
					 * THE SOURCE ADDRESS IS A FACT; THE HUB ID IS A DIAGNOSTIC.
					 *
					 * The two used to be conflated - the id was labelled "Hub
					 * source", which reads like an origin rather than the
					 * identifier it is - so the id now says what it is, and the one
					 * approved address this app already holds is stated beside it.
					 */}
					<p className="text-meta text-ink-muted">
						{t("ui.hub.links.source_address", { address: source })}
					</p>
					<p className="break-all text-mono-sm text-ink-muted">
						{t("ui.hub.links.hub_id", { address: row.hub_id })}
					</p>
					{/*
					 * THE IRREVERSIBILITY WARNING IS SECONDARY NOW. The sentence is
					 * unchanged - it states a permanent consequence - but it is a
					 * quiet line, because the card around it is now the loud thing
					 * and the state on it is what the reader has to act on.
					 */}
					<p className="text-meta text-ink-muted">
						{t("ui.hub.links.resolve_irreversible")}
					</p>
					{/*
					 * SOURCE CONFIRMATION, stated by the operator, never inferred.
					 *
					 * The row is a diagnostic with no origin, so the only honest way
					 * to give it one is an explicit act that names the source AND
					 * the scope. The app contributes the one approved source it
					 * already holds; the operator chooses Public or one of their
					 * VERIFIED organizations. The service owns the real
					 * identity/link computation and refuses a conflicting known
					 * scope (`origin-conflict`), so this control never fabricates a
					 * link or a policy.
					 *
					 * The opener is a FILLED primary because it is painted on the
					 * warning wash, and that is the one control the contract
					 * asserts there. It is the card's remedy, and it is the only
					 * primary on screen while the region below is closed.
					 */}
					{open ? null : (
						<Button
							ref={openerRef}
							variant="primary"
							size="sm"
							className="self-start"
							onClick={() => setOpen(true)}
						>
							{t("ui.hub.links.resolve_action")}
						</Button>
					)}
				</div>
			</Alert>
			{open ? (
				<div
					ref={resolveRegionRef}
					tabIndex={-1}
					className="flex flex-col gap-2 outline-none"
				>
					<h4 className="text-body-sm text-ink">
						{t("ui.hub.links.resolve_title")}
					</h4>
					<p className="text-meta text-ink-muted">
						{t("ui.hub.links.resolve_description", { item: row.name })}
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
								{/* UX U8 (design D19): a disabled PLACEHOLDER, so the blank
								 * select reads as an unanswered question rather than a filled
								 * one, while keeping confirming a deliberate choice. */}
								<option value="" disabled>
									{t("ui.hub.links.scope_placeholder")}
								</option>
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
						/*
						 * UX U1' (design D13, QA Q2): a signed-out viewer has NO
						 * organization list, so naming one - let alone the ITEM - as the
						 * destination is a lie the copy then compounded into
						 * "… · Private · Private". The affordance states the act (choose a
						 * scope by signing in) and names no destination at all.
						 */
						<Button variant="outline" onClick={onSignIn}>
							{t("ui.hub.links.sign_in_to_publish")}
						</Button>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={resolution.isPending}
							onClick={() => {
								returnToOpener.current = true;
								setOpen(false);
							}}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							disabled={resolution.isPending || !resolution.canWrite || !chose}
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
					{/* UX U8: the confirm stays disabled until a scope is chosen; the hint
					 * names the missing step while it is. Signed OUT there is no chooser
					 * on screen (the sign-in affordance stands in for it), so the sentence
					 * would contradict the surface - hide it then (D-fold, correctness). */}
					{!chose && !resolution.isPending && isAuthenticated ? (
						<p className="text-meta text-ink-muted">
							{t("ui.hub.links.scope_required")}
						</p>
					) : null}
					{resolution.error ? (
						<p role="alert" className="text-body-sm text-danger">
							{/* Item 7 (UX U5): a KNOWN-scope conflict has its own named
							 * sentence; every other refusal shows the real service reason
							 * via `hubReasonText` when one is carried, and only falls back
							 * to the generic sentence when it is not. */}
							{resolution.error instanceof HubMutationUpgradeRequired
								? resolution.error.message
								: resolution.error instanceof DesktopControlError &&
										resolution.error.code === "origin-conflict"
									? t("ui.hub.links.resolve_conflict")
									: resolution.error instanceof DesktopControlError &&
											resolution.error.code
										? hubReasonText(resolution.error.code)
										: t("ui.hub.links.resolve_failed_generic")}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}

/** Persistent healthy inventory; old backends keep their pending-only panel. */
export function HubLinksPanel({
	enabled,
	kind,
	name,
	localId,
	itemsById = false,
}: {
	enabled: boolean;
	kind?: HubLinkKind;
	name?: string;
	localId?: string;
	/** The caller's `desktopFeatureEnabled(capabilities, "hub_items_by_id")`. */
	itemsById?: boolean;
}) {
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
	/*
	 * A `?resolve=1` deep link (the sidebar's unresolved affordance) opens the
	 * source-confirmation region on arrival, so the roster indicator lands the
	 * reader ON the act rather than on a collapsed panel they must open.
	 */
	const [searchParams] = useSearchParams();
	/*
	 * The `resolve` value is a REQUEST TOKEN, not a boolean: the sidebar affordance
	 * writes a fresh value on every press, so a second press for the SAME
	 * already-open row re-mounts the region open/focused instead of no-opping
	 * (CODE MINOR-E). A plain `=1` would leave `initialOpen`-seeded state unchanged.
	 */
	const resolveRequest = searchParams.get("resolve");
	const openResolve = resolveRequest !== null;
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
	/*
	 * UX U9 (design D16, CODE NIT-1): the summary describes ALL the rows, not just
	 * the first, and names a COUNT when an item has several origins - "2 sources"
	 * is the fact that distinguishes an aggregate from a single origin. The
	 * vocabulary is the SURFACE's own ("Source not confirmed" here matched the
	 * row's label; it used to read "Source unavailable", a different state). Every
	 * piece is a catalogue string, so a copy edit cannot leave a stray literal
	 * behind.
	 */
	const onOff = (value: boolean) =>
		t(
			value
				? "ui.hub.subscriptions.configured_on"
				: "ui.hub.subscriptions.configured_off",
		);
	/*
	 * D24: a group policy is stated ONLY when EVERY row agrees. Reading the pair
	 * off `rows[0]` made a multi-origin item OVERCLAIM - the summary said
	 * "Subscribe On" while the second origin ("Minerva · Private") was Off, which
	 * is a false claim about the user's own configuration. Where the rows differ,
	 * the pair reads "mixed" rather than naming one row's policy for the group.
	 */
	const agreeOn = (value: (link: HubLink) => boolean) => {
		const first = rows[0] ? value(rows[0]) : false;
		return rows.every((link) => value(link) === first);
	};
	const groupOnOff = (value: (link: HubLink) => boolean) =>
		agreeOn(value) ? onOff(value(rows[0])) : t("ui.hub.links.mixed");
	/*
	 * THE SUMMARY IS COMPOSED FROM THE ROWS, so it needs a row. A record whose
	 * ONLY hub state is an unresolved diagnostic has no link row at all, and
	 * reading `rows[0]` there is a crash, not an empty string - the summary is
	 * only ever drawn inside the disclosure, which is only drawn when there ARE
	 * rows, so the guard is what keeps the two in step.
	 */
	const summaryState = (() => {
		if (rows.length === 0) return "";
		const first = rows[0];
		const origins =
			rows.length > 1
				? ` · ${t("ui.hub.links.sources_count", { count: rows.length })}`
				: "";
		return `${hubLinkSourceName(first)}${origins} · ${t(
			"ui.hub.subscriptions.subscribe",
		)} ${groupOnOff((link) => link.policy.subscribe)} · ${t(
			"ui.hub.subscriptions.auto_push",
		)} ${groupOnOff((link) => link.policy.auto_push)}`;
	})();
	/*
	 * Auto-open ONLY when a row needs the reader: a direction in a state that
	 * asks for attention (`available` wants an apply; `failed` wants a retry). A
	 * healthy/idle link stays collapsed, which is the acceptance criterion: a
	 * healthy link must not displace primary content.
	 *
	 * The source-confirmation half of this rule moved with the unresolved row
	 * itself. That row is no longer a line inside this disclosure - it is the
	 * card the record's pane carries (see `HubUnresolvedSource`) - so the act it
	 * asks for is visible without anything being opened, and the disclosure
	 * here holds only the link rows and opens only for them.
	 */
	const needsAttention = rows.some((link) =>
		[link.pull.state, link.push.state].some(
			(state) => state === "available" || state === "failed",
		),
	);
	/*
	 * CODE MINOR-C: the panel's own open state, hoisted OUT of `Disclosure`.
	 * `needsAttention` is known only after the async inventory answers, but
	 * `Disclosure`'s uncontrolled `defaultOpen` seeds `useState` ONCE - on the
	 * pre-answer render - so a cold load never auto-opened on an available/failed
	 * payload. One state here, synced on the transition INTO attention, opens on
	 * the answer without a second owner fighting the reader's clicks.
	 */
	const panelRef = useRef<HTMLDivElement>(null);
	const [resolutionCompleted, setResolutionCompleted] = useState(false);
	useEffect(() => {
		if (!resolutionCompleted || rows.length === 0) return;
		// The diagnostic disappears on success. Its surviving link disclosure,
		// rather than BODY or a detached confirm button, owns the next keyboard step.
		panelRef.current
			?.querySelector<HTMLButtonElement>("button[aria-expanded]")
			?.focus();
		setResolutionCompleted(false);
	}, [resolutionCompleted, rows]);
	const [open, setOpen] = useState(needsAttention);
	const wasAttention = useRef(needsAttention);
	useEffect(() => {
		if (needsAttention && !wasAttention.current) setOpen(true);
		wasAttention.current = needsAttention;
	}, [needsAttention]);
	/*
	 * QUIET BY DEFAULT (operator report, 2026-10-19).
	 *
	 * The panel used to draw a "Hub links - Not linked to the hub" disclosure on
	 * EVERY record - above the record's title, at a measure of its own - so a
	 * record with no hub presence at all carried a line about having none. A
	 * record that has no link and nothing to act on now says NOTHING: the two
	 * surfaces below are the only ones that can be true of it.
	 *
	 * The three early returns below are the whole of that rule, in the order the
	 * reader meets them:
	 *
	 *  - the capability is off: there is no hub panel to draw at all;
	 *  - the inventory has not answered yet: a loading line for every record
	 *    that will turn out to have no link is a flash of noise, not a state;
	 *  - the read FAILED: this one is said out loud, with the retry, because
	 *    hiding a failure behind a collapsed disclosure is how a broken
	 *    inventory reads as a quiet record.
	 */
	if (inventory.isLoading) return null;
	if (inventory.error && !inventory.data) {
		return (
			<div className="flex flex-col items-start gap-2">
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
		);
	}
	if (rows.length === 0 && unresolved.length === 0) return null;
	return (
		/*
		 * THE PANE-SCOPED MARKER. `Disclosure` does not forward unknown props to
		 * its root, so the marker lives on this wrapper - it is what lets the
		 * evidence scene find THIS panel's own trigger instead of the first
		 * expander in the pane, which is now some other control (the panel sits
		 * below the record's title, so the record's own disclosures come first).
		 */
		<div
			ref={panelRef}
			className="flex min-w-0 flex-col gap-3"
			data-hub-links-panel
		>
			{/*
			 * THE UNRESOLVED ROW IS A CARD, NOT A LINE IN THE DISCLOSURE. It is
			 * the one thing on this surface that asks the reader to ACT, and an
			 * act must not sit behind a summary line the reader has to expand to
			 * find - nor behind a second, differently-measured column of its own.
			 */}
			{unresolved.map((row) => (
				<HubUnresolvedSource
					/* CODE MINOR-E: the key carries the request timestamp, so a
					 * SECOND `?resolve=1` press for the SAME already-open row
					 * REMOUNTS the region open/focused instead of no-opping on
					 * mount-only state (`initialOpen` seeds `useState` once). */
					key={`${row.kind}:${row.local_id}:${resolveRequest}`}
					row={row}
					source={approvedSource}
					organizations={organizations}
					isAuthenticated={isAuthenticated}
					onSignIn={() => navigate("/settings")}
					initialOpen={openResolve}
					onResolved={() => setResolutionCompleted(true)}
				/>
			))}
			{rows.length > 0 ? (
				<Disclosure
					open={open}
					onOpenChange={setOpen}
					summary={`${t("ui.hub.links.title")} · ${summaryState}`}
					className="min-w-0"
				>
					<div className="divide-y divide-hairline">
						{rows.map((link) => (
							<HubLinkGroup
								key={link.link_id}
								link={link}
								displayName={name}
								itemsById={itemsById}
							/>
						))}
					</div>
					{inventory.error && inventory.data && (
						<p role="alert" className="text-meta text-warning">
							{t("ui.hub.links.load_failed")}
						</p>
					)}
				</Disclosure>
			) : null}
		</div>
	);
}
