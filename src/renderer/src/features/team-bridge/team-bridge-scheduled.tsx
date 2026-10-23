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
import type { TeamBridgeScheduledMessage } from "../../../../shared/team-bridge-contract";
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
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	busy: boolean;
	onSchedule: (sendAt: string, body?: string) => Promise<unknown>;
	initialBody?: string;
	initialSendAt?: string;
}) {
	const locale = useI18nLocale();
	const id = useId();
	const [value, setValue] = useState(
		initialSendAt ? scheduledLocalInput(initialSendAt) : "",
	);
	const [body, setBody] = useState(initialBody ?? "");
	const [failed, setFailed] = useState(false);
	const [confirming, setConfirming] = useState<string | null>(null);
	const unchangedTime = Boolean(
		initialSendAt && value === scheduledLocalInput(initialSendAt),
	);
	const at = unchangedTime ? initialSendAt : scheduledSendAt(value);
	const changed =
		initialBody === undefined || body.trim() !== initialBody || !unchangedTime;
	const wasOpen = useRef(false);
	useEffect(() => {
		// Refreshes may update the row while a failed edit is still open. Preserve
		// those edits, but reopening must start from the latest server post-state.
		if (open && !wasOpen.current) {
			setBody(initialBody ?? "");
			setValue(initialSendAt ? scheduledLocalInput(initialSendAt) : "");
			setConfirming(null);
			setFailed(false);
		}
		wasOpen.current = open;
	}, [open, initialBody, initialSendAt]);
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
			<DialogContent>
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
						(initialBody !== undefined && !body.trim())
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
	readOnly = false,
}: {
	accountId: string;
	tenantIds: string[];
	organizationNames?: Readonly<Record<string, string>>;
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
			readOnly={readOnly}
			refresh={() => query.refetch()}
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
	readOnly = false,
	refresh,
}: {
	state: "loading" | "error" | "ready";
	messages: TeamBridgeScheduledMessage[];
	failedTenants?: string[];
	organizationNames?: Readonly<Record<string, string>>;
	readOnly?: boolean;
	refresh: () => Promise<unknown>;
}) {
	const [cancelFailed, setCancelFailed] = useState(false);

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
			{cancelFailed && (
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
						onCancelFailure={() => setCancelFailed(true)}
						readOnly={readOnly}
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
	onCancelFailure,
}: {
	message: TeamBridgeScheduledMessage;
	refresh: () => Promise<unknown>;
	readOnly?: boolean;
	onCancelFailure?: () => void;
}) {
	const locale = useI18nLocale();
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [edit, setEdit] = useState(false);
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
			<TeamBridgeMarkdown>{message.body}</TeamBridgeMarkdown>
			{message.status === "sending" ? (
				<p aria-live="polite">{t("ui.teamBridge.schedule.sending")}</p>
			) : (
				<div className="flex flex-wrap gap-2">
					<Button disabled={busy || readOnly} onClick={() => setEdit(true)}>
						{t("ui.teamBridge.schedule.reschedule")}
					</Button>
					<Button
						variant="ghost"
						className="h-auto min-h-8 max-w-full whitespace-normal text-left text-danger hover:text-danger"
						disabled={busy || readOnly}
						onClick={() => {
							setBusy(true);
							setFailed(false);
							void TeamBridgeApi.scheduledCancel(message.tenant_id, message.id)
								.then(refresh)
								.catch(() => {
									setFailed(true);
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
			{failed && (
				<p role="alert" className="text-sm text-danger">
					{t("ui.teamBridge.schedule.cancel_failed")}
				</p>
			)}
			<TeamBridgeScheduleDialog
				open={edit}
				onOpenChange={setEdit}
				busy={busy}
				initialBody={message.body}
				initialSendAt={message.send_at}
				onSchedule={async (sendAt, body) => {
					setBusy(true);
					try {
						await TeamBridgeApi.scheduledUpdate(
							message.tenant_id,
							message.id,
							scheduledEditPatch(message, sendAt, body),
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
