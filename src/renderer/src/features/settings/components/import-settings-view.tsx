/**
 * The presentational half of Settings -> Import conversations.
 *
 * It owns no data access and no selection policy: every state arrives as a prop,
 * every transition leaves through a callback. That is what lets Storybook paint
 * the loading/empty/error/populated/preview/progress/result frames from the same
 * component the shipped Settings page mounts, rather than a second mock of it.
 *
 * The import gate is visible here on purpose: the button cannot be pressed until
 * a preview exists for the CURRENT selection and the acknowledgement checkbox is
 * ticked. There is no select-all default and no auto-import on source open.
 */

import {
	Alert,
	AlertDescription,
	AlertTitle,
	Badge,
	Button,
	Checkbox,
	Input,
	Progress,
	Skeleton,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { formatCalendarDateTime } from "@shared/utils/date-utils";
import {
	Check,
	Copy,
	Download,
	Loader2,
	RefreshCw,
	Search,
	Square,
} from "lucide-react";
import type { FC } from "react";
import { useMemo, useState } from "react";
import type {
	ImportAvailability,
	ImportOutcome,
	ImportPreview,
	ImportProgress,
	ImportResult,
	ImportSession,
	ImportSessionResult,
	ImportSource,
	ImportSourceName,
} from "./imports-api";
import { cleanSessionTitle, filterSessions } from "./imports-model";
import { SettingsSection } from "./settings-section";

const CANCEL_WARNING = /cancel/i;
const TERMINAL_STATES = new Set<ImportProgress["state"]>([
	"done",
	"failed",
	"cancelled",
]);

export type ImportBusy = "sources" | "sessions" | "preview" | "start" | null;

export type ImportSettingsViewProps = {
	sources: ImportSource[];
	activeSource: ImportSourceName | null;
	sessions: ImportSession[];
	query: string;
	selected: Set<string>;
	preview: ImportPreview | null;
	previewStale: boolean;
	/**
	 * A preview build's own failure, rendered inside the preview block rather
	 * than in the section banner. The banner stays for source, session and job
	 * failures, which have no block of their own to live in; a preview failure
	 * belongs beside the acknowledgement it disables.
	 */
	previewError: string | null;
	confirmed: boolean;
	busy: ImportBusy;
	error: string | null;
	progress: ImportProgress | null;
	result: ImportResult | null;
	cancelling: boolean;
	onSelectSource: (source: ImportSourceName) => void;
	onQueryChange: (value: string) => void;
	onToggleSession: (sourceId: string) => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onConfirmChange: (value: boolean) => void;
	onImport: () => void;
	onCancel: () => void;
	onRetry: () => void;
	onImportAnother: () => void;
	onRefresh: () => void;
	selectionNotice: string | null;
	onCopyPath: (path: string) => Promise<boolean>;
};

const availabilityKey = (value: ImportAvailability) => {
	switch (value) {
		case "metadata_only":
			return "ui.settings.imports.availability_metadata_only";
		case "unsupported":
			return "ui.settings.imports.availability_unsupported";
		default:
			return "ui.settings.imports.availability_full";
	}
};

const stateKey = (value: ImportProgress["state"]) => {
	switch (value) {
		case "queued":
			return "ui.settings.imports.state_queued";
		case "done":
			return "ui.settings.imports.state_done";
		case "failed":
			return "ui.settings.imports.state_failed";
		case "cancelled":
			return "ui.settings.imports.state_cancelled";
		default:
			return "ui.settings.imports.state_running";
	}
};

const phaseKey = (value: string) => {
	switch (value) {
		case "selecting":
			return "ui.settings.imports.phase_selecting";
		case "memory":
			return "ui.settings.imports.phase_memory";
		case "done":
			return "ui.settings.imports.phase_done";
		case "cancelled":
			return "ui.settings.imports.phase_cancelled";
		case "queued":
			return "ui.settings.imports.phase_queued";
		default:
			return "ui.settings.imports.phase_importing";
	}
};

const outcomeKey = (value: ImportOutcome) => {
	switch (value) {
		case "resumed":
			return "ui.settings.imports.outcome_resumed";
		case "skipped_already_imported":
			return "ui.settings.imports.outcome_skipped";
		case "metadata_only":
			return "ui.settings.imports.outcome_metadata";
		case "failed":
			return "ui.settings.imports.outcome_failed";
		case "cancelled":
			return "ui.settings.imports.outcome_cancelled";
		default:
			return "ui.settings.imports.outcome_imported";
	}
};

const outcomeTone = (value: ImportOutcome) => {
	if (value === "failed") return "danger" as const;
	if (value === "metadata_only" || value === "skipped_already_imported")
		return "neutral" as const;
	if (value === "cancelled") return "warning" as const;
	return "success" as const;
};

const sessionLabel = (session: ImportSession) =>
	cleanSessionTitle(session.title) || session.sourceId;

const ReviewPath: FC<{
	path: string;
	label: string;
	onCopyPath: (path: string) => Promise<boolean>;
}> = ({ path, label, onCopyPath }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-start justify-between gap-3 rounded-md border border-hairline bg-surface p-3">
			<div className="min-w-0">
				<p className="text-body-sm text-ink">{label}</p>
				<p className="mt-1 break-all font-mono text-meta text-ink-muted">
					{path}
				</p>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="shrink-0"
				onClick={() => {
					void onCopyPath(path).then((ok) => {
						if (!ok) return;
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					});
				}}
			>
				{copied ? <Check size={14} /> : <Copy size={14} />}
				{copied
					? t("ui.settings.imports.copied")
					: t("ui.settings.imports.copy_path")}
			</Button>
		</div>
	);
};

const ProgressRows: FC<{
	progress: ImportProgress;
	sessions: ImportSession[];
	selected: Set<string>;
}> = ({ progress, sessions, selected }) => {
	const done = new Map(progress.results.map((row) => [row.sourceId, row]));
	const current = progress.sessionId;
	const pending = Math.max(
		0,
		progress.total -
			progress.completed -
			(current && !done.has(current) ? 1 : 0),
	);
	const selectedRows = sessions.filter((row) => selected.has(row.sourceId));
	return (
		<div className="flex flex-col gap-2">
			{progress.results.map((row) => (
				<SessionResultRow
					key={`${row.source}:${row.sourceId}`}
					row={row}
					jobCancelled={progress.state === "cancelled"}
				/>
			))}
			{selectedRows
				.filter((row) => !done.has(row.sourceId) && row.sourceId !== current)
				.map((row) => (
					<div
						key={row.sourceId}
						className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface p-2 text-body-sm text-ink-muted"
					>
						<span className="min-w-0 truncate">{sessionLabel(row)}</span>
						<Badge variant="neutral">
							{t("ui.settings.imports.session_pending")}
						</Badge>
					</div>
				))}
			{current && !done.has(current) && (
				<div className="flex items-center gap-2 rounded-md border border-hairline bg-surface p-2 text-body-sm text-ink-muted">
					<Loader2 size={14} className="animate-spin" />
					<span>{t("ui.settings.imports.session_importing")}</span>
					<span className="min-w-0 truncate">{current}</span>
				</div>
			)}
			{pending > 0 && (
				<p className="text-meta text-ink-muted">
					{t("ui.settings.imports.progress_pending", { count: pending })}
				</p>
			)}
			{progress.warnings.map((warning) => (
				<p
					key={`${warning.code}:${warning.sessionId}:${warning.message}`}
					className="text-meta text-warning"
				>
					{warning.message}
				</p>
			))}
		</div>
	);
};

export const SessionResultRow: FC<{
	row: ImportSessionResult;
	/** A cancelled job reports the interrupted session as failed at the core. */
	jobCancelled?: boolean;
}> = ({ row, jobCancelled = false }) => {
	const cancelled =
		jobCancelled &&
		row.outcome === "failed" &&
		row.warnings.some((warning) => CANCEL_WARNING.test(warning));
	const outcome: ImportOutcome = cancelled ? "cancelled" : row.outcome;
	return (
		<div className="rounded-md border border-hairline bg-surface p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="min-w-0 truncate text-body-sm text-ink">
					{row.sourceId}
				</span>
				<Badge variant={outcomeTone(outcome)}>{t(outcomeKey(outcome))}</Badge>
				<span className="text-meta text-ink-muted">
					{t("ui.settings.imports.session_meta", {
						messages: row.messages,
						compactions: row.compactions,
					})}
				</span>
			</div>
			{/* A skipped row has no new messages but its existing target is the
			    whole point of the result; only zero-row cancelled/failed targets
			    are empty directories and stay hidden. */}
			{row.targetSessionId &&
				(row.messages > 0 || row.outcome === "skipped_already_imported") && (
					<p className="mt-1 break-all font-mono text-meta text-ink-muted">
						{t("ui.settings.imports.result_target", {
							target: row.targetSessionId,
						})}
					</p>
				)}
			{row.warnings.map((warning) => (
				<p key={warning} className="mt-1 text-meta text-warning">
					{warning}
				</p>
			))}
		</div>
	);
};

export const ImportSettingsView: FC<ImportSettingsViewProps> = ({
	sources,
	activeSource,
	sessions,
	query,
	selected,
	preview,
	previewStale,
	previewError,
	confirmed,
	busy,
	error,
	progress,
	result,
	cancelling,
	onSelectSource,
	onQueryChange,
	onToggleSession,
	onSelectAll,
	onClearSelection,
	onConfirmChange,
	onImport,
	onCancel,
	onRetry,
	onImportAnother,
	onRefresh,
	selectionNotice,
	onCopyPath,
}) => {
	useI18nLocale();
	const active = sources.find((source) => source.source === activeSource);
	const jobActive = progress !== null && !TERMINAL_STATES.has(progress.state);
	const resultTotal = progress?.total ?? selected.size;
	const visibleSessions = useMemo(
		() => filterSessions(sessions, query),
		[query, sessions],
	);
	const allVisibleSelected =
		visibleSessions.length > 0 &&
		visibleSessions.every((session) => selected.has(session.sourceId));
	const selectedCount = selected.size;
	const canImport =
		selectedCount > 0 &&
		preview !== null &&
		!previewStale &&
		confirmed &&
		!busy &&
		!progress &&
		!result;

	return (
		<SettingsSection
			title={t("ui.settings.imports.title")}
			icon={Download}
			description={t("ui.settings.imports.description")}
			dataTourTag="settings-import-section"
		>
			<div className="flex flex-col gap-5">
				{error && (
					<Alert variant="warning">
						<AlertTitle>{t("ui.settings.imports.title")}</AlertTitle>
						<AlertDescription>
							<span className="flex flex-wrap items-center justify-between gap-3">
								<span>{error}</span>
								<Button variant="secondary" size="sm" onClick={onRetry}>
									{t("ui.settings.imports.retry")}
								</Button>
							</span>
						</AlertDescription>
					</Alert>
				)}

				{busy === "sources" && sources.length === 0 ? (
					<div className="flex flex-col gap-2">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-20 w-full" />
						<p className="text-meta text-ink-muted">
							{t("ui.settings.imports.loading_sources")}
						</p>
					</div>
				) : sources.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						{t("ui.settings.imports.empty_sources")}
					</p>
				) : (
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<h3 className="text-heading text-ink">
								{t("ui.settings.imports.source_heading")}
							</h3>
							<Button
								variant="ghost"
								size="sm"
								onClick={onRefresh}
								disabled={
									jobActive || busy === "sources" || busy === "sessions"
								}
							>
								<RefreshCw
									size={14}
									className={cn(busy === "sources" && "animate-spin")}
								/>
								{t("ui.settings.imports.refresh")}
							</Button>
						</div>
						{!sources.some((source) => source.detected) && (
							<p className="text-body-sm text-ink-muted">
								{t("ui.settings.imports.empty_sources")}
							</p>
						)}
						<div className="grid gap-2 lg:grid-cols-3">
							{sources.map((source) => {
								const isActive = source.source === activeSource;
								const availability = source.detected
									? t(availabilityKey(source.availability))
									: t("ui.settings.imports.source_not_found");
								return (
									<button
										key={source.source}
										type="button"
										aria-pressed={isActive}
										disabled={jobActive}
										onClick={() => onSelectSource(source.source)}
										className={cn(
											"rounded-lg border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
											"focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
											isActive
												? "border-accent bg-accent-wash"
												: "border-hairline bg-surface hover:bg-sunken",
										)}
									>
										<div className="flex items-center justify-between gap-2">
											<span className="text-body-sm font-medium text-ink">
												{source.label}
											</span>
											<Badge
												variant={
													source.detected && source.availability === "full"
														? "success"
														: "neutral"
												}
											>
												{availability}
											</Badge>
										</div>
										<p className="mt-1 text-meta text-ink-muted">
											{t("ui.settings.imports.source_sessions", {
												count: source.sessionCount,
											})}
										</p>
										<p className="mt-1 break-all text-meta text-ink-dim">
											{source.detail || source.root}
										</p>
									</button>
								);
							})}
						</div>
					</div>
				)}

				{active && !progress && !result && (
					<div className="flex flex-col gap-3 border-t border-hairline pt-5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-heading text-ink">
								{t("ui.settings.imports.source_heading")} · {active.label}
							</h3>
							<div className="flex items-center gap-2">
								<Button
									variant="secondary"
									size="sm"
									onClick={allVisibleSelected ? onClearSelection : onSelectAll}
									disabled={visibleSessions.length === 0}
								>
									{allVisibleSelected
										? t("ui.settings.imports.clear_all")
										: t("ui.settings.imports.select_all")}
								</Button>
								<span className="text-meta text-ink-muted">
									{t("ui.settings.imports.selected", {
										count: selectedCount,
									})}
								</span>
							</div>
						</div>
						{selectionNotice && (
							<output className="text-meta text-warning">
								{selectionNotice}
							</output>
						)}

						<div className="relative">
							<Search
								size={15}
								className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-ink-dim"
							/>
							<Input
								value={query}
								onChange={(event) => onQueryChange(event.target.value)}
								placeholder={t("ui.settings.imports.search_placeholder")}
								className="ps-9"
							/>
						</div>

						{busy === "sessions" ? (
							<div className="flex flex-col gap-2">
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
								<p className="text-meta text-ink-muted">
									{t("ui.settings.imports.loading_sessions", {
										source: active.label,
									})}
								</p>
							</div>
						) : sessions.length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								{t("ui.settings.imports.empty_sessions", {
									source: active.label,
								})}
							</p>
						) : visibleSessions.length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								{t("ui.settings.imports.empty_filter")}
							</p>
						) : (
							<div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
								{visibleSessions.map((session) => {
									/*
									 * ONE FOCUS STOP PER ROW. The row text used to be a second
									 * `<button>` with the same onClick as the checkbox, so a
									 * screen reader heard two controls for one action, and the
									 * second one did not expose the checked state. A `<label>`
									 * associated with the checkbox keeps the large pointer target,
									 * makes one click toggle exactly once, and leaves the checkbox
									 * as the only focusable control. The `<label>` is a SIBLING,
									 * not a wrapper: a checkbox inside its own label fires twice
									 * for one press.
									 */
									const inputId = `import-session-${session.source}-${session.sourceId}`;
									return (
										<div
											key={session.sourceId}
											className={cn(
												"flex items-start gap-3 rounded-md border p-3",
												selected.has(session.sourceId)
													? "border-accent bg-row-selected"
													: "border-hairline bg-surface hover:bg-sunken",
											)}
										>
											<Checkbox
												id={inputId}
												checked={selected.has(session.sourceId)}
												onCheckedChange={() =>
													onToggleSession(session.sourceId)
												}
												aria-label={sessionLabel(session)}
												className="mt-0.5"
											/>
											<label
												htmlFor={inputId}
												className="min-w-0 flex-1 cursor-pointer text-start"
											>
												<span className="flex flex-wrap items-center gap-2">
													<span className="min-w-0 truncate text-body-sm text-ink">
														{sessionLabel(session)}
													</span>
													<Badge
														variant={
															session.availability === "full"
																? "neutral"
																: "warning"
														}
													>
														{t(availabilityKey(session.availability))}
													</Badge>
												</span>
												<span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-muted">
													<span>
														{t("ui.settings.imports.session_meta", {
															messages: session.messageCount ?? 0,
															compactions: session.compactionCount,
														})}
													</span>
													<span>
														{t("ui.settings.imports.session_updated", {
															date: formatCalendarDateTime(
																new Date(
																	(session.updatedTs || session.createdTs) *
																		1000,
																),
															),
														})}
													</span>
												</span>
												{session.cwd && (
													<span className="mt-1 block break-all font-mono text-meta text-ink-dim">
														{session.cwd}
													</span>
												)}
												{session.availability === "metadata_only" && (
													<span className="mt-1 block text-meta text-warning">
														{t("ui.settings.imports.metadata_only_explain")}
													</span>
												)}
												{session.availability === "unsupported" && (
													<span className="mt-1 block text-meta text-warning">
														{t("ui.settings.imports.session_index_only")}
													</span>
												)}
											</label>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				{active && selectedCount > 0 && !progress && !result && (
					<div className="flex flex-col gap-3 border-t border-hairline pt-5">
						<h3 className="text-heading text-ink">
							{t("ui.settings.imports.preview_heading")}
						</h3>
						{/*
						 * THE PREVIEW IS BUILT AUTOMATICALLY now (the container
						 * debounces a build per selection change), so this state is
						 * "a preview for what you just selected is on its way", not
						 * "go and build one yourself". `preview_required` said the
						 * latter and is no longer true of this screen.
						 *
						 * The third clause is the gap between the selection and the
						 * first build landing: the debounce means there is a moment
						 * where a selection exists, no preview does, and neither the
						 * spinner nor a summary is showing - and the Import button
						 * below is grey with nothing saying why. "Building the
						 * preview..." is the honest answer there, and it is the same
						 * answer the other two clauses give. The error case is
						 * excluded because the preview block below states the failure
						 * and offers its Retry, and a spinner under a failure would be
						 * a lie.
						 */}
						{(busy === "preview" ||
							previewStale ||
							(preview === null && !previewError)) && (
							<p className="flex items-center gap-2 text-meta text-ink-muted">
								<Loader2 size={14} className="animate-spin" />
								{t("ui.settings.imports.loading_preview")}
							</p>
						)}
						{preview && !previewStale && (
							<div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-4">
								<p className="text-body-sm text-ink">
									{t("ui.settings.imports.preview_summary", {
										sessions: preview.totalSessions,
										messages: preview.totalMessages,
										compactions: preview.totalCompactions,
									})}
								</p>
								<p className="text-meta text-ink-muted">
									{t("ui.settings.imports.preview_memory", {
										records: preview.totalMemoryRecords,
										tokens: preview.projectedMemoryTokens.toLocaleString(),
									})}
								</p>
								{preview.warnings.slice(0, 4).map((warning, index) => (
									<p
										key={`${warning.code}:${warning.sessionId}:${index}`}
										className="text-meta text-warning"
									>
										{warning.message}
									</p>
								))}
								{preview.warnings.length > 4 && (
									<p className="text-meta text-warning">
										{t("ui.settings.imports.warnings_heading", {
											count: preview.warnings.length,
										})}
									</p>
								)}
								<p className="text-meta text-ink-muted">
									{t("ui.settings.imports.preview_confirm")}
								</p>
							</div>
						)}
						{/*
						 * THE CONFIRMATION AND THE BUTTON IT GATES ARE ONE BLOCK.
						 * They used to be two controls in two sections, which is why
						 * the row's tick and this square looked like the same kind of
						 * control doing the same kind of job. One bordered box, the
						 * acknowledgement directly above the button it holds shut, and
						 * `preview_confirm` above them says what is still outstanding.
						 */}
						<div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
							{/*
							 * THE FAILURE BELONGS WHERE IT HAPPENED, inside the block
							 * that holds the controls it disables. It used to be reported
							 * only in the section banner at the top, above the source
							 * cards and the whole session list - so at this block the
							 * operator saw a grey Import and no explanation. Same copy
							 * (`error_preview`), same `retry` control.
							 */}
							{previewError && (
								<Alert variant="warning">
									<AlertDescription>
										<span className="flex flex-wrap items-center justify-between gap-3">
											<span>{previewError}</span>
											<Button variant="secondary" size="sm" onClick={onRetry}>
												{t("ui.settings.imports.retry")}
											</Button>
										</span>
									</AlertDescription>
								</Alert>
							)}
							<div className="flex items-start gap-2 text-body-sm text-ink">
								<Checkbox
									checked={confirmed}
									onCheckedChange={(value) => onConfirmChange(value === true)}
									disabled={!preview || previewStale}
									aria-label={t("ui.settings.imports.confirm_label")}
									className="mt-0.5"
								/>
								<span>{t("ui.settings.imports.confirm_label")}</span>
							</div>
							<Button
								variant="primary"
								onClick={onImport}
								disabled={!canImport}
								className="self-start"
							>
								{busy === "start" ? (
									<Loader2 size={14} className="animate-spin" />
								) : (
									<Download size={14} />
								)}
								{t("ui.settings.imports.import_button", {
									count: selectedCount,
								})}
							</Button>
						</div>
					</div>
				)}

				{progress && !result && (
					<div className="flex flex-col gap-3 border-t border-hairline pt-5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-heading text-ink">
								{t("ui.settings.imports.progress_heading")}
							</h3>
							<Button
								variant="secondary"
								size="sm"
								onClick={onCancel}
								disabled={
									cancelling ||
									progress.state === "done" ||
									progress.state === "cancelled" ||
									progress.state === "failed"
								}
							>
								<Square size={12} />
								{cancelling
									? t("ui.settings.imports.cancelling")
									: t("ui.settings.imports.cancel")}
							</Button>
						</div>
						<p className="text-meta text-ink-muted">
							{t("ui.settings.imports.progress_job", {
								job: progress.jobId,
								state: t(stateKey(progress.state)),
							})}
							{" · "}
							{t(phaseKey(progress.phase))}
						</p>
						<Progress
							value={
								progress.total ? (progress.completed / progress.total) * 100 : 0
							}
							className="h-1.5"
						/>
						<ProgressRows
							progress={progress}
							sessions={sessions}
							selected={selected}
						/>
					</div>
				)}

				{result && (
					<div className="flex flex-col gap-3 border-t border-hairline pt-5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<h3 className="text-heading text-ink">
								{t("ui.settings.imports.result_heading")}
							</h3>
							<Button variant="secondary" size="sm" onClick={onImportAnother}>
								{t("ui.settings.imports.import_another")}
							</Button>
						</div>
						<p className="text-body-sm text-ink">
							{result.state === "cancelled"
								? t("ui.settings.imports.result_summary_cancelled", {
										state: t(stateKey(result.state)),
										sessions: result.sessions.length,
										total: resultTotal,
										messages: result.messages,
									})
								: t("ui.settings.imports.result_summary", {
										state: t(stateKey(result.state)),
										sessions: result.sessions.length,
										messages: result.messages,
									})}
						</p>
						{result.sessions.map((row) => (
							<SessionResultRow
								key={`${row.source}:${row.sourceId}:${row.targetSessionId}`}
								row={row}
								jobCancelled={result.state === "cancelled"}
							/>
						))}
						{(result.instructionReviewPath || result.memoryReviewPath) && (
							<div className="flex flex-col gap-2">
								{result.instructionReviewPath && (
									<ReviewPath
										path={result.instructionReviewPath}
										label={t("ui.settings.imports.review_instructions")}
										onCopyPath={onCopyPath}
									/>
								)}
								{result.memoryReviewPath && (
									<ReviewPath
										path={result.memoryReviewPath}
										label={t("ui.settings.imports.review_memory")}
										onCopyPath={onCopyPath}
									/>
								)}
							</div>
						)}
						{result.warnings.length > 0 && (
							<Alert variant="warning">
								<AlertDescription>
									<span className="flex flex-col gap-1">
										<span>
											{t("ui.settings.imports.warnings_heading", {
												count: result.warnings.length,
											})}
										</span>
										{result.warnings.slice(0, 4).map((warning, index) => (
											<span key={`${warning.code}:${index}`}>
												{warning.message}
											</span>
										))}
									</span>
								</AlertDescription>
							</Alert>
						)}
						{result.error && (
							<Alert variant="danger">
								<AlertDescription>{result.error}</AlertDescription>
							</Alert>
						)}
						<p className="text-meta text-ink-muted">
							{t("ui.settings.imports.rerun_safe")}
						</p>
					</div>
				)}

				{busy === "start" && !progress && (
					<p className="flex items-center gap-2 text-body-sm text-ink-muted">
						<Loader2 size={14} className="animate-spin" />
						{t("ui.settings.imports.importing")}
					</p>
				)}
			</div>
		</SettingsSection>
	);
};
