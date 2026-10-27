import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, AlertTitle } from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type {
	TeamBridgeAttachment,
	TeamBridgeScheduledMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeScheduledAttachments } from "./team-bridge-attachments";
import { scheduledSendAt } from "./team-bridge-drafts";
import { TeamBridgeMarkdown } from "./team-bridge-markdown";
import {
	type ScheduledEditBase,
	type ScheduledRebaseReport,
	describeScheduledRebase,
	listScheduledTenants,
	rebaseScheduledEdit,
	sameAttachmentIds,
	scheduledEditFailure,
	scheduledEditPatch,
	scheduledLocalInput,
	scheduledRebaseIsNews,
	updateScheduledEdit,
} from "./team-bridge-scheduling";

/*
 * Why an open dialog is showing an alert. `failed` is the generic refusal;
 * `conflict` means the row changed under the dialog (the hub's `concurrent_edit`
 * 409, or a refresh that moved the row) and the draft was rebased onto it. The
 * conflict carries WHAT moved, because a notice that only says "something
 * changed" leaves the user to diff the fields from memory - and silently
 * swapped their typed text for another device's (design review round 1, D2).
 * `report` is null when the hub said conflict but the refresh showed nothing
 * different yet.
 */
type ScheduleNotice =
	| { kind: "failed" }
	| { kind: "conflict"; report: ScheduledRebaseReport | null }
	| null;

/* Two rebases in one open dialog: the user must hear about both. */
function mergeReports(
	a: ScheduledRebaseReport | null,
	b: ScheduledRebaseReport,
): ScheduledRebaseReport {
	if (!a) return b;
	return {
		bodyReplaced: a.bodyReplaced || b.bodyReplaced,
		bodyChanged: (a.bodyChanged || b.bodyChanged) && !b.bodyReplaced,
		lostBody: b.lostBody ?? a.lostBody,
		timeReplaced: a.timeReplaced || b.timeReplaced,
		timeChanged: (a.timeChanged || b.timeChanged) && !b.timeReplaced,
		imagesAdded: a.imagesAdded + b.imagesAdded,
		imagesRemoved: a.imagesRemoved + b.imagesRemoved,
	};
}

/*
 * The disabled recipe the Button primitive already uses, for the fields: in the
 * gone state disabled is a RESTING state, and a field that only gains a
 * not-allowed cursor still reads as editable (design review round 1, D3).
 * `ink-muted` rather than `ink-disabled` keeps the text readable (7.18:1 light,
 * 9.08:1 dark on `sunken`, measured in that review).
 */
const FIELD =
	"rounded-md border border-control bg-surface p-2 text-ink disabled:border-hairline disabled:bg-sunken disabled:text-ink-muted";

const attachmentIds = (rows: readonly TeamBridgeAttachment[] | undefined) =>
	(rows ?? []).map((row) => row.id);

export function TeamBridgeScheduleDialog({
	open,
	onOpenChange,
	busy,
	onSchedule,
	initialBody,
	initialSendAt,
	initialAttachments,
	accountId,
	returnFocus,
	unavailable = false,
	initialVersion,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onSchedule: (
		sendAt: string,
		body?: string,
		attachmentIds?: readonly string[],
		/* The hub `version` of the row this draft was derived from, if known. */
		expectedVersion?: number,
	) => Promise<unknown>;
	initialBody?: string;
	initialSendAt?: string;
	/*
	 * An edited schedule's images (descriptors; no bytes are fetched for a
	 * reserved image). The edit can REMOVE images - the hub releases them in
	 * the same update - but not add: adding means staging bytes, which belongs
	 * to the composer, and the schedule keeps its reserved set otherwise.
	 */
	initialAttachments?: readonly TeamBridgeAttachment[];
	/* The edited row's hub `version` (agent-server #223); absent on older hubs. */
	initialVersion?: number | null;
	accountId?: string;
	returnFocus?: { current: HTMLElement | null };
	/*
	 * The edited schedule is no longer pending: it vanished from the refreshed
	 * list (cancelled or sent on another device) or is already `sending`. Nothing
	 * can be edited any more, so the dialog offers Close instead of a retry that
	 * could only 404 (agent-server #223 QA r2, Q3).
	 */
	unavailable?: boolean;
}) {
	const locale = useI18nLocale();
	const id = useId();
	const [value, setValue] = useState(
		initialSendAt ? scheduledLocalInput(initialSendAt) : "",
	);
	const [body, setBody] = useState(initialBody ?? "");
	const [kept, setKept] = useState<readonly TeamBridgeAttachment[]>(
		initialAttachments ?? [],
	);
	const [notice, setNotice] = useState<ScheduleNotice>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	/*
	 * The server row this draft was derived from. A refresh that moves the row
	 * is rebased against it, so only this user's own deltas survive (see
	 * `rebaseScheduledEdit`). A ref, not state: it is bookkeeping, never drawn.
	 */
	const base = useRef<ScheduledEditBase | null>(null);
	/*
	 * FOCUS RETURNS TO THE OPENER. This dialog is opened programmatically (the
	 * clock, or a row's Reschedule), so Radix has no trigger to restore to and
	 * drops focus on `body`; a keyboard user then has to tab from the top of the
	 * page to get back (design review round 1, D33). Capture on open, restore on
	 * close, and suppress Radix's own body-focus default.
	 */
	const opener = useRef<HTMLElement | null>(null);
	const wasOpenForFocus = useRef(false);
	useEffect(() => {
		const wasOpenHere = wasOpenForFocus.current;
		wasOpenForFocus.current = open;
		if (open) {
			if (returnFocus?.current) opener.current = returnFocus.current;
			return;
		}
		// A dialog that never opened has nothing to restore; without this guard a
		// first render with `open=false` would pull focus to the clock.
		if (!wasOpenHere) return;
		/*
		 * Restore HERE as well as in `onCloseAutoFocus`: Radix's close-auto-focus
		 * runs while its focus scope is still mounted in some paths (Escape from
		 * jsdom included), and a `focus()` inside the trap is redirected to body.
		 * By the time this effect runs the dialog is unmounted, so the handoff
		 * sticks (design review round 1, D33).
		 */
		const target = returnFocus?.current ?? opener.current;
		opener.current = null;
		if (target?.isConnected) target.focus();
	}, [open, returnFocus]);
	const unchangedTime = Boolean(
		initialSendAt && value === scheduledLocalInput(initialSendAt),
	);
	const at = unchangedTime ? initialSendAt : scheduledSendAt(value);
	const imagesChanged = !sameAttachmentIds(
		attachmentIds(kept),
		attachmentIds(initialAttachments),
	);
	const changed =
		initialBody === undefined ||
		body.trim() !== initialBody ||
		!unchangedTime ||
		imagesChanged;
	const wasOpen = useRef(false);
	useEffect(() => {
		const opening = open && !wasOpen.current;
		wasOpen.current = open;
		const next: ScheduledEditBase | null =
			initialSendAt === undefined
				? null
				: {
						body: initialBody ?? "",
						sendAt: initialSendAt,
						attachments: initialAttachments ?? [],
						...(typeof initialVersion === "number"
							? { version: initialVersion }
							: {}),
					};
		// Opening starts from the latest server post-state.
		if (opening) {
			base.current = next;
			setBody(initialBody ?? "");
			setKept(initialAttachments ?? []);
			setValue(initialSendAt ? scheduledLocalInput(initialSendAt) : "");
			setConfirming(null);
			setNotice(null);
			return;
		}
		/*
		 * A refresh moved the row while the dialog is open (after a failed edit,
		 * or a list refetch). Keeping the old draft is what let a retry resend a
		 * stale full replacement and erase another device's image or text
		 * (agent-server #223 QA r2, Q2), so the draft is REBASED onto the new
		 * row. Compared by value and image ids, never identity: every refetch
		 * hands down fresh arrays. A row that is no longer pending is not rebased;
		 * the dialog shows it as gone instead.
		 */
		const previous = base.current;
		if (!open || unavailable || !previous || !next) return;
		if (
			previous.body === next.body &&
			previous.sendAt === next.sendAt &&
			sameAttachmentIds(
				attachmentIds(previous.attachments),
				attachmentIds(next.attachments),
			)
		) {
			/*
			 * Nothing visible moved, but the version may have (this user's own
			 * edit landed behind a lost response, or another device rewrote the
			 * same values). Adopt it, or every later submit is pinned to a
			 * version that no longer exists and 409s forever.
			 */
			base.current = next;
			return;
		}
		base.current = next;
		const draft = { body, when: value, kept };
		const rebased = rebaseScheduledEdit(previous, next, draft);
		const report = describeScheduledRebase(previous, next, draft);
		setBody(rebased.body);
		setValue(rebased.when);
		setKept(rebased.kept);
		// A confirmation was for content that no longer exists.
		setConfirming(null);
		/*
		 * Say so only when what the user is looking at actually moved. A lost
		 * response whose edit DID land refreshes to exactly this draft, and
		 * telling that user "another device changed it" would be false.
		 */
		if (
			scheduledRebaseIsNews(report) &&
			(rebased.body.trim() !== draft.body.trim() ||
				rebased.when !== draft.when ||
				!sameAttachmentIds(attachmentIds(rebased.kept), attachmentIds(kept)))
		)
			setNotice((current) => ({
				kind: "conflict",
				report: mergeReports(
					current?.kind === "conflict" ? current.report : null,
					report,
				),
			}));
	}, [
		open,
		unavailable,
		initialBody,
		initialSendAt,
		initialAttachments,
		initialVersion,
		body,
		value,
		kept,
	]);
	const conflict = notice?.kind === "conflict" ? notice.report : undefined;
	/*
	 * The user's own text lost to the other device. Recoverable until they take
	 * it back or type something else, so a typed paragraph never vanishes
	 * without a trace (D2).
	 */
	const lostBody =
		conflict?.lostBody !== undefined && body.trim() !== conflict.lostBody.trim()
			? conflict.lostBody
			: undefined;
	/*
	 * A conflict that left nothing of the user's to save. "Review it and try
	 * again" beside a disabled Review is a dead end (D1): say so and make Close
	 * the action instead.
	 */
	const nothingLeft = notice?.kind === "conflict" && !changed;
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) {
					setConfirming(null);
					setNotice(null);
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				/*
				 * TOP-ANCHORED, not centred: a centred dialog grows both ways when a
				 * notice appears, so the top edge and the button the user just
				 * pressed jumped (69 px measured for confirm -> conflict, design
				 * review round 1, D5). Anchored, a notice only pushes content below
				 * it down.
				 */
				className="top-[12vh] translate-y-0"
				// The gone state has one way out, its own Close; a second "Close" in
				// the corner duplicated the name in the a11y tree (D6). Escape still
				// closes it.
				showClose={!unavailable}
				onCloseAutoFocus={(event) => {
					const target = returnFocus?.current ?? opener.current;
					opener.current = null;
					if (!target || !target.isConnected) return;
					event.preventDefault();
					target.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{t(
							unavailable
								? "ui.teamBridge.schedule.edit_gone_title"
								: "ui.teamBridge.schedule.title",
						)}
					</DialogTitle>
					<DialogDescription>
						{t("ui.teamBridge.schedule.timezone", { timezone })}
					</DialogDescription>
				</DialogHeader>
				{/*
				 * THE NOTICE IS THE HEADLINE, so it sits above the fields it explains
				 * rather than footnoting them (D4). Conflict and gone are status the
				 * user acts on, not a mistake they made: `warning`. A refused write
				 * stays `danger`.
				 */}
				{unavailable ? (
					<Alert variant="warning" role="alert">
						<p>{t("ui.teamBridge.schedule.edit_gone")}</p>
					</Alert>
				) : notice?.kind === "conflict" ? (
					<Alert variant="warning" role="alert">
						<AlertTitle>{t("ui.teamBridge.schedule.edit_conflict")}</AlertTitle>
						{lostBody !== undefined && (
							<p>{t("ui.teamBridge.schedule.conflict_body_replaced")}</p>
						)}
						{conflict?.bodyChanged && (
							<p>{t("ui.teamBridge.schedule.conflict_body_changed")}</p>
						)}
						{conflict?.timeReplaced && (
							<p>{t("ui.teamBridge.schedule.conflict_time_replaced")}</p>
						)}
						{conflict?.timeChanged && (
							<p>{t("ui.teamBridge.schedule.conflict_time_changed")}</p>
						)}
						{(conflict?.imagesAdded ?? 0) > 0 && (
							<p>
								{t("ui.teamBridge.schedule.conflict_images_added", {
									count: conflict?.imagesAdded ?? 0,
								})}
							</p>
						)}
						{(conflict?.imagesRemoved ?? 0) > 0 && (
							<p>
								{t("ui.teamBridge.schedule.conflict_images_removed", {
									count: conflict?.imagesRemoved ?? 0,
								})}
							</p>
						)}
						<p>
							{t(
								nothingLeft
									? "ui.teamBridge.schedule.conflict_nothing_left"
									: "ui.teamBridge.schedule.conflict_review",
							)}
						</p>
						{lostBody !== undefined && (
							<div>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => {
										setBody(lostBody);
										setConfirming(null);
									}}
								>
									{t("ui.teamBridge.schedule.conflict_restore_body")}
								</Button>
							</div>
						)}
					</Alert>
				) : (
					notice?.kind === "failed" && (
						<Alert variant="danger" role="alert">
							<p>
								{/* The create copy ("retry with the original text and time")
								    is the wrong next step for an edit (QA r2, Q4). */}
								{t(
									initialSendAt === undefined
										? "ui.teamBridge.schedule.failed"
										: "ui.teamBridge.schedule.edit_failed",
								)}
							</p>
						</Alert>
					)
				)}
				{initialBody !== undefined && (
					<label className="flex flex-col gap-1 text-sm text-ink">
						{t("ui.teamBridge.schedule.edit_body")}
						<textarea
							value={body}
							onChange={(event) => {
								setBody(event.target.value);
								setConfirming(null);
							}}
							disabled={busy || unavailable}
							className={`${FIELD} ${unavailable ? "resize-none" : ""}`}
						/>
					</label>
				)}
				{kept.length > 0 && (
					<div className="flex flex-col gap-1">
						<TeamBridgeScheduledAttachments
							attachments={kept}
							accountId={accountId}
						/>
						{/* Edit-only chrome is hidden once nothing can be edited (D5). */}
						{!unavailable && (
							<Button
								variant="ghost"
								size="sm"
								disabled={busy}
								onClick={() => {
									setKept([]);
									setConfirming(null);
								}}
							>
								{t("ui.teamBridge.attachments.remove_all")}
							</Button>
						)}
					</div>
				)}
				<label htmlFor={id} className="text-sm text-ink">
					{t("ui.teamBridge.schedule.when")}
				</label>
				<input
					id={id}
					type="datetime-local"
					value={value}
					disabled={busy || unavailable}
					onChange={(event) => {
						setValue(event.target.value);
						setConfirming(null);
					}}
					aria-describedby={unavailable ? undefined : `${id}-help`}
					className={FIELD}
				/>
				{!unavailable && (
					<p id={`${id}-help`} className="text-sm text-ink-muted">
						{t("ui.teamBridge.schedule.window")}
					</p>
				)}
				{!unavailable && value && !at && (
					<p role="alert" className="text-sm text-danger">
						{t("ui.teamBridge.schedule.invalid")}
					</p>
				)}
				{!unavailable && confirming && (
					<p aria-live="polite" className="text-sm text-ink">
						{t("ui.teamBridge.schedule.confirm", {
							date: new Intl.DateTimeFormat(locale, {
								dateStyle: "full",
								timeStyle: "long",
							}).format(new Date(confirming)),
						})}
					</p>
				)}
				{unavailable || nothingLeft ? (
					<Button onClick={() => onOpenChange(false)}>
						{t("ui.common.actions.close")}
					</Button>
				) : (
					<Button
						disabled={
							!at ||
							!changed ||
							busy ||
							(initialBody !== undefined && !body.trim() && kept.length === 0)
						}
						onClick={() => {
							const currentAt = unchangedTime
								? initialSendAt
								: scheduledSendAt(value);
							if (!currentAt) {
								setConfirming(null);
								return;
							}
							if (confirming !== currentAt) {
								setConfirming(currentAt);
								return;
							}
							setNotice(null);
							void onSchedule(
								currentAt,
								initialBody === undefined ? undefined : body.trim(),
								initialAttachments === undefined
									? undefined
									: kept.map((row) => row.id),
								base.current?.version,
							)
								.then(() => {
									onOpenChange(false);
									setConfirming(null);
								})
								/*
								 * Never downgrade a conflict: the refresh inside `onSchedule`
								 * may already have rebased this draft and said what moved,
								 * and the generic sentence would hide that.
								 */
								.catch((error) => {
									const kind = scheduledEditFailure(error);
									setNotice((current) =>
										current?.kind === "conflict"
											? current
											: kind === "conflict"
												? { kind: "conflict", report: null }
												: { kind: "failed" },
									);
								});
						}}
					>
						{t(
							confirming
								? "ui.teamBridge.schedule.confirm_action"
								: "ui.teamBridge.schedule.review",
						)}
					</Button>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function TeamBridgeScheduledList({
	accountId,
	tenantIds,
	organizationNames,
	conversationNames,
	readOnly = false,
}: {
	accountId: string;
	tenantIds: string[];
	organizationNames?: Readonly<Record<string, string>>;
	conversationNames?: Readonly<Record<string, string>>;
	readOnly?: boolean;
}) {
	const query = useQuery({
		queryKey: ["team-bridge", "scheduled", accountId, ...[...tenantIds].sort()],
		queryFn: () => listScheduledTenants(tenantIds, TeamBridgeApi.scheduledList),
		staleTime: 0,
		gcTime: 0,
	});
	return (
		<TeamBridgeScheduledListView
			state={
				query.isPending
					? "loading"
					: query.isError ||
							(tenantIds.length > 0 &&
								query.data?.failedTenants.length === tenantIds.length)
						? "error"
						: "ready"
			}
			messages={query.data?.scheduled ?? []}
			failedTenants={query.data?.failedTenants ?? []}
			organizationNames={organizationNames}
			conversationNames={conversationNames}
			readOnly={readOnly}
			refresh={() => query.refetch()}
			accountId={accountId}
		/>
	);
}

/** Presentational read states also used by stories: no fixture transport and
 * no hidden retries are needed to review loading/empty/error/populated frames. */
export function TeamBridgeScheduledListView({
	state,
	messages,
	failedTenants = [],
	organizationNames = {},
	conversationNames = {},
	readOnly = false,
	refresh,
	accountId,
}: {
	state: "loading" | "error" | "ready";
	messages: TeamBridgeScheduledMessage[];
	failedTenants?: string[];
	organizationNames?: Readonly<Record<string, string>>;
	conversationNames?: Readonly<Record<string, string>>;
	readOnly?: boolean;
	refresh: () => Promise<unknown>;
	accountId?: string;
}) {
	/*
	 * The failure names the ROW it belongs to, so there is exactly one notice
	 * (here) instead of one at the page and one under the row, and so a later
	 * success — or a reload where that row is gone — can clear it. A bare
	 * boolean could not: it outlived both, so the empty state contradicted
	 * itself (design review round 1, D31).
	 */
	const [cancelFailure, setCancelFailure] = useState<string | null>(null);
	useEffect(() => {
		if (cancelFailure && !messages.some((row) => row.id === cancelFailure))
			setCancelFailure(null);
	}, [messages, cancelFailure]);
	/*
	 * The row whose edit dialog is open, as last seen. When a refresh drops it
	 * (cancelled, or sent on another device) the row is kept mounted as `gone`
	 * so its OPEN dialog can say so and offer Close; unmounting it would yank the
	 * dialog away mid-edit, and the old dialog kept retrying into a 404 (agent-
	 * server #223 QA r2, Q3). Released when that dialog closes.
	 */
	const [editing, setEditing] = useState<TeamBridgeScheduledMessage | null>(
		null,
	);
	// Track the LATEST copy of the edited row, so a row that vanishes is shown
	// as it last was, not as it was when its dialog opened.
	useEffect(() => {
		if (!editing) return;
		const latest = messages.find((row) => row.id === editing.id);
		if (latest && latest !== editing) setEditing(latest);
	}, [messages, editing]);
	/*
	 * A row missing from `messages` is GONE only when the list actually loaded
	 * its organization (review R1-01). `listScheduledTenants` drops every row of
	 * an organization whose read failed - the same unavailable hub that just
	 * refused the edit usually refuses the refresh too - and calling that
	 * "cancelled or already sent" was false, threw away the typed edit, and
	 * invited a duplicate. An unconfirmed absence keeps the last-seen row
	 * mounted and EDITABLE, with the failure copy its dialog already shows.
	 */
	const missing =
		editing && !messages.some((row) => row.id === editing.id) ? editing : null;
	const gone =
		missing && state === "ready" && !failedTenants.includes(missing.tenant_id)
			? missing
			: null;
	const held = missing && !gone ? missing : null;
	const rows = missing
		? [...messages, missing].sort((a, b) => a.send_at.localeCompare(b.send_at))
		: messages;
	const rowFor = (message: TeamBridgeScheduledMessage, detached = false) => (
		<TeamBridgeScheduledRow
			key={message.id}
			message={message}
			gone={message === gone}
			detached={detached}
			onEditingChange={(open) => setEditing(open ? message : null)}
			refresh={refresh}
			organizationNames={organizationNames}
			conversationNames={conversationNames}
			onCancelFailure={() => setCancelFailure(message.id)}
			onCancelSuccess={() => setCancelFailure(null)}
			readOnly={readOnly}
			accountId={accountId}
		/>
	);

	return (
		<section
			className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5"
			aria-label={t("ui.teamBridge.schedule.list")}
		>
			<h2 className="text-lg font-medium text-ink">
				{t("ui.teamBridge.schedule.list")}
			</h2>
			{state === "ready" &&
				failedTenants.map((tenant) => (
					<div key={tenant} role="alert" className="text-sm text-danger">
						<p>
							{t("ui.teamBridge.schedule.load_failed")}{" "}
							<span>{organizationNames[tenant]?.trim() || tenant}</span>
						</p>
						<Button
							onClick={() => {
								void refresh();
							}}
						>
							{t("ui.teamBridge.list.retry")}
						</Button>
					</div>
				))}
			{cancelFailure && (
				<p role="alert" className="text-sm text-danger">
					{t("ui.teamBridge.schedule.cancel_failed")}
				</p>
			)}
			{state === "loading" ? (
				<Spinner size="sm" label={t("ui.teamBridge.schedule.loading")} />
			) : state === "error" ? (
				<div role="alert">
					<p>{t("ui.teamBridge.schedule.load_failed")}</p>
					<Button
						onClick={() => {
							void refresh();
						}}
					>
						{t("ui.teamBridge.list.retry")}
					</Button>
				</div>
			) : (
				rows.length === 0 && (
					<p className="text-ink-muted">{t("ui.teamBridge.schedule.empty")}</p>
				)
			)}
			{/*
			 * The rows keep ONE slot in every state, so a row whose dialog is open
			 * survives a failed reload as the same component: rendered from a second
			 * slot it remounted and lost the typed edit (review R1-01). With the
			 * list in its error state only that held row renders, detached from its
			 * card.
			 */}
			{(state === "ready" ? rows : held ? [held] : []).map((message) =>
				rowFor(message, state !== "ready"),
			)}
		</section>
	);
}

export function TeamBridgeScheduledRow({
	message,
	refresh,
	readOnly = false,
	organizationNames = {},
	conversationNames = {},
	onCancelFailure,
	accountId,
	onCancelSuccess,
	gone = false,
	detached = false,
	onEditingChange,
}: {
	message: TeamBridgeScheduledMessage;
	refresh: () => Promise<unknown>;
	readOnly?: boolean;
	organizationNames?: Readonly<Record<string, string>>;
	conversationNames?: Readonly<Record<string, string>>;
	onCancelFailure?: () => void;
	/* Whose in-memory upload previews this row may show (account-fenced). */
	accountId?: string;
	onCancelSuccess?: () => void;
	/*
	 * The list no longer carries this row; it is still mounted only because its
	 * edit dialog is open (see `TeamBridgeScheduledListView`). It renders the
	 * dialog alone, in its no-longer-editable state.
	 */
	gone?: boolean;
	/*
	 * Render the open dialog alone, without the row card: the list behind it is
	 * in its load-error state and has no rows to show (review R1-01).
	 */
	detached?: boolean;
	/* Lets the list keep this row mounted while its edit dialog is open. */
	onEditingChange?: (open: boolean) => void;
}) {
	const locale = useI18nLocale();
	const [busy, setBusy] = useState(false);
	const [edit, setEditState] = useState(false);
	const setEdit = (open: boolean) => {
		setEditState(open);
		onEditingChange?.(open);
	};
	const rescheduleRef = useRef<HTMLButtonElement>(null);
	const destinationId = useId();
	/*
	 * Cancellation is destructive and immediate, so a row has to say WHICH
	 * conversation (and organization, when the view spans more than one) it
	 * belongs to: body copy is not a destination (design review round 1, D32).
	 * The cancel button points at this line with `aria-describedby`, so the
	 * affordance carries the identity without new copy for every row.
	 */
	const destination = [
		conversationNames[message.conversation_id]?.trim(),
		organizationNames[message.tenant_id]?.trim(),
	]
		.filter(Boolean)
		.join(" · ");
	const dialog = (
		<TeamBridgeScheduleDialog
			open={edit}
			onOpenChange={setEdit}
			returnFocus={rescheduleRef}
			busy={busy}
			unavailable={gone || message.status === "sending"}
			initialBody={message.body}
			initialSendAt={message.send_at}
			initialAttachments={message.attachments}
			initialVersion={message.version}
			accountId={accountId}
			onSchedule={async (sendAt, body, attachmentIds, expectedVersion) => {
				setBusy(true);
				try {
					// `message` is the LATEST row: the dialog rebased its draft onto it,
					// so the patch carries only this user's deltas against it.
					await updateScheduledEdit(
						TeamBridgeApi.scheduledUpdate,
						message.tenant_id,
						message.id,
						scheduledEditPatch(message, sendAt, body, attachmentIds),
						expectedVersion,
					);
					await refresh();
				} catch (error) {
					// The refresh is what lets the dialog rebase (changed row) or show
					// the schedule as gone (cancelled or sent elsewhere).
					await refresh();
					throw error;
				} finally {
					setBusy(false);
				}
			}}
		/>
	);
	/*
	 * The dialog is a STABLE sibling of the card, never its child: a row that
	 * goes gone or detached drops the card, and had the dialog moved with it,
	 * React would remount it and lose the typed edit (review R1-01). It portals
	 * out either way, so the DOM position does not matter.
	 */
	const card =
		gone || detached ? null : (
			/*
			 * `elevated`, one lightness step above the `surface` page (design round
			 * 2, D11): a row on its own page's ground had no edge, and consecutive
			 * rows ran together. Grouped by ground value, never by a border
			 * (docs/branding.md: elevation is a lightness step; panels and cards
			 * take no rule). The row's secondary buttons rest on `surface`, a step
			 * below the card, and keep their own `border-control`.
			 */
			<article className="rounded-lg bg-elevated p-3 text-ink">
				<p className="text-sm text-ink-muted">
					{new Intl.DateTimeFormat(locale, {
						dateStyle: "medium",
						timeStyle: "long",
					}).format(new Date(message.send_at))}
				</p>
				{destination && (
					<p id={destinationId} className="text-sm text-ink-muted">
						{destination}
					</p>
				)}
				{message.body.trim() !== "" && (
					<TeamBridgeMarkdown>{message.body}</TeamBridgeMarkdown>
				)}
				{(message.attachments?.length ?? 0) > 0 && (
					<TeamBridgeScheduledAttachments
						attachments={message.attachments ?? []}
						accountId={accountId}
					/>
				)}
				{message.status === "sending" ? (
					<p aria-live="polite">{t("ui.teamBridge.schedule.sending")}</p>
				) : (
					<div className="flex flex-wrap gap-2">
						<Button
							ref={rescheduleRef}
							disabled={busy || readOnly}
							onClick={() => setEdit(true)}
						>
							{t("ui.teamBridge.schedule.reschedule")}
						</Button>
						<Button
							variant="ghost"
							className="h-auto min-h-8 max-w-full whitespace-normal text-left text-danger hover:text-danger"
							disabled={busy || readOnly}
							aria-describedby={destination ? destinationId : undefined}
							onClick={() => {
								setBusy(true);
								void TeamBridgeApi.scheduledCancel(
									message.tenant_id,
									message.id,
								)
									.then(() => {
										// A later success is the newest truth; the failure it
										// supersedes must not outlive it (D31).
										onCancelSuccess?.();
										return refresh();
									})
									.catch(() => {
										onCancelFailure?.();
										void refresh();
									})
									.finally(() => setBusy(false));
							}}
						>
							{t("ui.teamBridge.schedule.cancel")}
						</Button>
					</div>
				)}
			</article>
		);
	return (
		<>
			{card}
			{dialog}
		</>
	);
}
