import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
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
	listScheduledTenants,
	scheduledEditPatch,
	scheduledLocalInput,
} from "./team-bridge-scheduling";

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
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onSchedule: (
		sendAt: string,
		body?: string,
		attachmentIds?: readonly string[],
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
	accountId?: string;
	returnFocus?: { current: HTMLElement | null };
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
	const [failed, setFailed] = useState(false);
	const [confirming, setConfirming] = useState<string | null>(null);
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
	const imagesChanged = kept.length !== (initialAttachments?.length ?? 0);
	const changed =
		initialBody === undefined ||
		body.trim() !== initialBody ||
		!unchangedTime ||
		imagesChanged;
	const wasOpen = useRef(false);
	useEffect(() => {
		// Refreshes may update the row while a failed edit is still open. Preserve
		// those edits, but reopening must start from the latest server post-state.
		if (open && !wasOpen.current) {
			setBody(initialBody ?? "");
			setKept(initialAttachments ?? []);
			setValue(initialSendAt ? scheduledLocalInput(initialSendAt) : "");
			setConfirming(null);
			setFailed(false);
		}
		wasOpen.current = open;
	}, [open, initialBody, initialSendAt, initialAttachments]);
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) {
					setConfirming(null);
					setFailed(false);
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				onCloseAutoFocus={(event) => {
					const target = returnFocus?.current ?? opener.current;
					opener.current = null;
					if (!target || !target.isConnected) return;
					event.preventDefault();
					target.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("ui.teamBridge.schedule.title")}</DialogTitle>
					<DialogDescription>
						{t("ui.teamBridge.schedule.timezone", { timezone })}
					</DialogDescription>
				</DialogHeader>
				{initialBody !== undefined && (
					<label className="flex flex-col gap-1 text-sm text-ink">
						{t("ui.teamBridge.schedule.edit_body")}
						<textarea
							value={body}
							onChange={(event) => {
								setBody(event.target.value);
								setConfirming(null);
							}}
							disabled={busy}
							className="rounded-md border border-control bg-surface p-2 text-ink"
						/>
					</label>
				)}
				{kept.length > 0 && (
					<div className="flex flex-col gap-1">
						<TeamBridgeScheduledAttachments
							attachments={kept}
							accountId={accountId}
						/>
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
					</div>
				)}
				<label htmlFor={id} className="text-sm text-ink">
					{t("ui.teamBridge.schedule.when")}
				</label>
				<input
					id={id}
					type="datetime-local"
					value={value}
					disabled={busy}
					onChange={(event) => {
						setValue(event.target.value);
						setConfirming(null);
					}}
					aria-describedby={`${id}-help`}
					className="rounded-md border border-control bg-surface p-2 text-ink"
				/>
				<p id={`${id}-help`} className="text-sm text-ink-muted">
					{t("ui.teamBridge.schedule.window")}
				</p>
				{value && !at && (
					<p role="alert" className="text-sm text-danger">
						{t("ui.teamBridge.schedule.invalid")}
					</p>
				)}
				{confirming && (
					<p aria-live="polite" className="text-sm text-ink">
						{t("ui.teamBridge.schedule.confirm", {
							date: new Intl.DateTimeFormat(locale, {
								dateStyle: "full",
								timeStyle: "long",
							}).format(new Date(confirming)),
						})}
					</p>
				)}
				{failed && (
					<p role="alert" className="text-sm text-danger">
						{t("ui.teamBridge.schedule.failed")}
					</p>
				)}
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
						setFailed(false);
						void onSchedule(
							currentAt,
							initialBody === undefined ? undefined : body.trim(),
							initialAttachments === undefined
								? undefined
								: kept.map((row) => row.id),
						)
							.then(() => {
								onOpenChange(false);
								setConfirming(null);
							})
							.catch(() => setFailed(true));
					}}
				>
					{t(
						confirming
							? "ui.teamBridge.schedule.confirm_action"
							: "ui.teamBridge.schedule.review",
					)}
				</Button>
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
			) : messages.length === 0 ? (
				<p className="text-ink-muted">{t("ui.teamBridge.schedule.empty")}</p>
			) : (
				messages.map((message) => (
					<TeamBridgeScheduledRow
						key={message.id}
						message={message}
						refresh={refresh}
						organizationNames={organizationNames}
						conversationNames={conversationNames}
						onCancelFailure={() => setCancelFailure(message.id)}
						onCancelSuccess={() => setCancelFailure(null)}
						readOnly={readOnly}
						accountId={accountId}
					/>
				))
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
}) {
	const locale = useI18nLocale();
	const [busy, setBusy] = useState(false);
	const [edit, setEdit] = useState(false);
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
	return (
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
							void TeamBridgeApi.scheduledCancel(message.tenant_id, message.id)
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
			<TeamBridgeScheduleDialog
				open={edit}
				onOpenChange={setEdit}
				returnFocus={rescheduleRef}
				busy={busy}
				initialBody={message.body}
				initialSendAt={message.send_at}
				initialAttachments={message.attachments}
				accountId={accountId}
				onSchedule={async (sendAt, body, attachmentIds) => {
					setBusy(true);
					try {
						await TeamBridgeApi.scheduledUpdate(
							message.tenant_id,
							message.id,
							scheduledEditPatch(message, sendAt, body, attachmentIds),
						);
						await refresh();
					} catch (error) {
						await refresh();
						throw error;
					} finally {
						setBusy(false);
					}
				}}
			/>
		</article>
	);
}
