/**
 * Settings -> Import conversations: the stateful half.
 *
 * All foreign-store work is the backend's (`/v1/desktop/imports/*`); this file
 * only sequences reads, selection, preview, job polling and cancellation, and
 * hands each state to the presentational view. The three invariants it owns:
 *
 * 1. NO DEFAULT-ALL. The selection starts empty and is only filled by explicit
 *    row presses or the explicit Select all control, which selects the visible
 *    filtered rows and nothing else.
 * 2. PREVIEW IS A GATE. A preview is built for one exact selection, and `import`
 *    refuses unless the preview still matches the current selection. The preview
 *    is BUILT AUTOMATICALLY from the selection (debounced), so it is never
 *    missing for long; while a rebuild is in flight the old one is marked stale
 *    rather than thrown away, so the card updates in place.
 * 3. NO SILENT WRITE. Import additionally needs the acknowledgement checkbox, so
 *    one press cannot turn browsing into a copy. The acknowledgement is cleared
 *    whenever the selection changes: a different set of conversations is a
 *    different copy, and it has to be acknowledged again.
 */

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImportSettingsView } from "./import-settings-view";
import type { ImportBusy } from "./import-settings-view";
import {
	cancelImport,
	fetchImportJob,
	fetchImportSessions,
	fetchImportSources,
	previewImport,
	startImport,
} from "./imports-api";
import type {
	ImportPreview,
	ImportProgress,
	ImportResult,
	ImportSession,
	ImportSource,
	ImportSourceName,
} from "./imports-api";
import {
	MAX_IMPORT_SESSIONS,
	selectAllWithinCap,
	selectionSignature,
} from "./imports-model";

const TERMINAL = new Set(["done", "failed", "cancelled"]);

const reason = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const ImportSettingsSection: FC = () => {
	useI18nLocale();
	const [sources, setSources] = useState<ImportSource[]>([]);
	const [activeSource, setActiveSource] = useState<ImportSourceName | null>(
		null,
	);
	const [sessions, setSessions] = useState<ImportSession[]>([]);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [preview, setPreview] = useState<ImportPreview | null>(null);
	const [previewSignature, setPreviewSignature] = useState<string | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const [busy, setBusy] = useState<ImportBusy>(null);
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState<ImportProgress | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [cancelling, setCancelling] = useState(false);
	const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
	const [pollAttempt, setPollAttempt] = useState(0);
	const sessionRequest = useRef(0);
	/*
	 * The generation of the preview build in flight. Same shape as
	 * `sessionRequest` above, and for the same reason: a selection change can
	 * start a second preview while the first is still running (the debounce
	 * delays each build's START, it does not serialize them), and responses can
	 * land out of order. Without this guard the older response overwrites the
	 * newer one's preview and signature, and the screen sits at "Building the
	 * preview..." with no retry and no way back.
	 */
	const previewRequest = useRef(0);
	/*
	 * The signature of the last preview build that FAILED. It is what stops the
	 * automatic build from asking again for a selection whose build already
	 * failed, which would hit a failing endpoint every 250ms for as long as the
	 * selection stood. It is set only in the catch - a SUCCESS never records
	 * here - and it is cleared wherever the preview it describes is dropped
	 * (selection change, source change, Import more, Refresh, Retry).
	 *
	 * The guard that reads it also requires that no preview exists. A stale
	 * preview must still rebuild: if this marker alone could satisfy the guard,
	 * the screen would stay on the spinner forever after an out-of-order
	 * response, which is exactly the bug this replaces.
	 */
	const [failedSignature, setFailedSignature] = useState<string | null>(null);
	/*
	 * The preview's own failure, kept separate from `error` because it is
	 * rendered INSIDE the preview block, beside the acknowledgement it disables.
	 * `error` stays the section-level banner for source, session and job
	 * failures, which have no block of their own to live in.
	 */
	const [previewError, setPreviewError] = useState<string | null>(null);
	const jobError = useRef<string | null>(null);
	const jobActive = progress !== null && !TERMINAL.has(progress.state);

	const loadSources = useCallback(async () => {
		setBusy("sources");
		setError(null);
		try {
			const next = await fetchImportSources();
			setSources(next);
			setActiveSource((current) => {
				const stillPresent = next.some(
					(source) => source.source === current && source.detected,
				);
				if (stillPresent) return current;
				return next.find((source) => source.detected)?.source ?? null;
			});
		} catch (cause) {
			setError(
				t("ui.settings.imports.error_sources", { reason: reason(cause) }),
			);
		} finally {
			setBusy(null);
		}
	}, []);

	useEffect(() => {
		void loadSources();
	}, [loadSources]);

	const loadSessions = useCallback(async (source: ImportSourceName) => {
		const request = ++sessionRequest.current;
		setBusy("sessions");
		setError(null);
		try {
			const next = await fetchImportSessions(source);
			if (request !== sessionRequest.current) return;
			setSessions(next);
		} catch (cause) {
			if (request !== sessionRequest.current) return;
			setSessions([]);
			setError(
				t("ui.settings.imports.error_sessions", {
					source,
					reason: reason(cause),
				}),
			);
		} finally {
			if (request === sessionRequest.current) setBusy(null);
		}
	}, []);

	useEffect(() => {
		if (!activeSource) {
			setSessions([]);
			return;
		}
		setSessions([]);
		setSelected(new Set());
		setPreview(null);
		setPreviewSignature(null);
		setFailedSignature(null);
		setPreviewError(null);
		setConfirmed(false);
		setResult(null);
		setProgress(null);
		void loadSessions(activeSource);
	}, [activeSource, loadSessions]);

	const resetSelection = useCallback((next: Set<string>) => {
		setSelected(next);
		/*
		 * THE ACKNOWLEDGEMENT IS CLEARED ON EVERY SELECTION CHANGE, and that is
		 * deliberate. "I understand these conversations will be copied into Local
		 * Operator" is a statement about a SET of conversations; a different set
		 * is a different copy, so the acknowledgement has to be re-stated for it.
		 * The automatic preview arriving does not re-arm it either: a preview is
		 * not a confirmation.
		 *
		 * The failure marker is dropped here for a different reason: it describes
		 * a failure of the OLD selection. Keeping it would latch a selection that
		 * failed, was changed away from, and then returned to.
		 *
		 * The preview is NOT cleared here: it stays in state and goes stale (its
		 * signature no longer matches the selection). `previewStale` is what makes
		 * the view drop the old numbers and show the build spinner, so stale
		 * figures are never painted as if they described the new selection; the
		 * preview's own value is what the state machine compares signatures
		 * against.
		 */
		setConfirmed(false);
		setFailedSignature(null);
		setPreviewError(null);
		setSelectionNotice(null);
	}, []);

	const onSelectSource = useCallback(
		(source: ImportSourceName) => {
			// Changing source clears `progress` in the active-source effect below,
			// so it would silently abandon a running job's monitor and Cancel
			// control while the core job kept writing. The cards are disabled for
			// the same reason; this guard also covers keyboard/programmatic use.
			if (jobActive) return;
			setActiveSource(source);
			setQuery("");
		},
		[jobActive],
	);

	const onToggleSession = useCallback(
		(sourceId: string) => {
			const next = new Set(selected);
			if (next.has(sourceId)) next.delete(sourceId);
			else next.add(sourceId);
			resetSelection(next);
		},
		[resetSelection, selected],
	);

	const onSelectAll = useCallback(() => {
		const result = selectAllWithinCap(sessions, query, selected);
		resetSelection(result.selected);
		if (result.capped) {
			setSelectionNotice(
				t("ui.settings.imports.selection_limit", {
					max: MAX_IMPORT_SESSIONS,
				}),
			);
		}
	}, [query, resetSelection, selected, sessions]);

	const onClearSelection = useCallback(() => {
		resetSelection(new Set());
	}, [resetSelection]);

	const currentSignature = useMemo(
		() => selectionSignature(activeSource, selected),
		[activeSource, selected],
	);
	const previewStale =
		preview !== null && previewSignature !== currentSignature;

	const onPreview = useCallback(async () => {
		/*
		 * The guard is unreachable from the UI now: the preview block only
		 * renders for a non-empty selection, and the preview is built
		 * automatically from the selection rather than by a button. It stays as
		 * the container's own invariant, not as a user-facing gate - a fired
		 * guard can no longer read as "nothing happened" because there is no
		 * control left to press.
		 */
		if (!activeSource || selected.size === 0) return;
		/*
		 * THE REQUEST GENERATION IS CAPTURED BEFORE THE AWAIT. Only the latest
		 * build may write state: a superseded response must not overwrite the
		 * newer preview, must not clear the newer build's spinner, and must not
		 * record a failure for a selection that is no longer current.
		 */
		const request = ++previewRequest.current;
		const signature = currentSignature;
		setBusy("preview");
		setError(null);
		setPreviewError(null);
		try {
			const next = await previewImport({
				sources: [activeSource],
				sessionIds: { [activeSource]: [...selected].sort() },
			});
			if (request !== previewRequest.current) return;
			setPreview(next);
			/*
			 * The signature captured with the request, not the one in this
			 * closure: the response describes the selection that was asked for,
			 * and pairing it with a newer signature would paint these counts as
			 * if they described the new selection.
			 */
			setPreviewSignature(signature);
		} catch (cause) {
			if (request !== previewRequest.current) return;
			setPreview(null);
			setPreviewSignature(null);
			setFailedSignature(signature);
			setPreviewError(
				t("ui.settings.imports.error_preview", { reason: reason(cause) }),
			);
		} finally {
			if (request === previewRequest.current) setBusy(null);
		}
	}, [activeSource, currentSignature, selected]);

	/*
	 * THE PREVIEW IS BUILT AUTOMATICALLY, debounced.
	 *
	 * The operator's flow used to be three disconnected interactions: select a
	 * conversation, scroll to a separate "Preview" section and press a button
	 * that read "Preview" UNDER A HEADING THAT ALSO READ "Preview", then tick a
	 * second, identically shaped empty checkbox in a third block before the
	 * Import button came alive. A preview is a function of the selection, so
	 * the selection now produces it; the debounce keeps a multi-row selection
	 * (or Select all over twenty rows) from asking the core once per row.
	 */
	useEffect(() => {
		if (!activeSource || selected.size === 0 || progress || result) return;
		// A preview for exactly this selection already exists: nothing to build.
		if (preview && previewSignature === currentSignature) return;
		// This exact selection was already attempted and failed. The failure is
		// on screen in the preview block with its own Retry, and a failing
		// endpoint must not be hit every 250ms for as long as the selection
		// stands. The guard also requires that no preview exists: a STALE
		// preview must still rebuild, or an out-of-order response would wedge
		// this effect here forever.
		if (!preview && failedSignature === currentSignature) return;
		const timer = setTimeout(() => {
			void onPreview();
		}, 250);
		return () => clearTimeout(timer);
	}, [
		activeSource,
		selected,
		currentSignature,
		preview,
		previewSignature,
		failedSignature,
		progress,
		result,
		onPreview,
	]);

	const onImport = useCallback(async () => {
		/*
		 * The gate is the container's invariant, and it is also what the Import
		 * button's `disabled` state is computed from - so a user cannot reach
		 * this guard by pressing it. It cannot fire silently at the user, and
		 * the reason the button is disabled is on screen beside it: the
		 * acknowledgement is right above it, and the preview's own state is
		 * stated in the block above that.
		 */
		if (
			!activeSource ||
			selected.size === 0 ||
			!preview ||
			previewStale ||
			!confirmed ||
			progress
		) {
			return;
		}
		setBusy("start");
		setError(null);
		setResult(null);
		try {
			const jobId = await startImport({
				sources: [activeSource],
				sessionIds: { [activeSource]: [...selected].sort() },
			});
			const now = Date.now() / 1000;
			setProgress({
				jobId,
				state: "queued",
				phase: "queued",
				source: activeSource,
				sessionId: "",
				completed: 0,
				total: selected.size,
				results: [],
				warnings: [],
				error: "",
				startedAt: now,
				updatedAt: now,
			});
		} catch (cause) {
			setError(t("ui.settings.imports.error_start", { reason: reason(cause) }));
		} finally {
			setBusy(null);
		}
	}, [activeSource, confirmed, preview, previewStale, progress, selected]);

	const jobId = progress?.jobId ?? null;
	const jobState = progress?.state ?? null;

	useEffect(() => {
		if (!jobId || !jobState || TERMINAL.has(jobState)) return;
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async () => {
			try {
				const next = await fetchImportJob(jobId);
				if (!alive) return;
				if (jobError.current) {
					const previous = jobError.current;
					jobError.current = null;
					setError((current) => (current === previous ? null : current));
				}
				setProgress(next);
				// The nested result carries its own job id; the polled id is the
				// one this screen started and keyed the monitor on, so reconcile
				// rather than letting two ids disagree in the same result view.
				if (next.result) setResult({ ...next.result, jobId: next.jobId });
				if (!TERMINAL.has(next.state)) {
					timer = setTimeout(tick, 900);
				}
			} catch (cause) {
				if (!alive) return;
				const message = t("ui.settings.imports.error_job", {
					reason: reason(cause),
				});
				jobError.current = message;
				setError(message);
				// A transient read must not end monitoring: the job keeps running
				// on the backend, so retry until a terminal state arrives. Retry
				// restarts this effect immediately via `pollAttempt`.
				timer = setTimeout(tick, 2000);
			}
		};
		timer = setTimeout(tick, pollAttempt > 0 ? 0 : 700);
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
		};
	}, [jobId, jobState, pollAttempt]);

	const onCancel = useCallback(async () => {
		if (!progress || TERMINAL.has(progress.state)) return;
		setCancelling(true);
		setError(null);
		try {
			await cancelImport(progress.jobId);
		} catch (cause) {
			setError(
				t("ui.settings.imports.error_cancel", { reason: reason(cause) }),
			);
		} finally {
			setCancelling(false);
		}
	}, [progress]);

	const onImportAnother = useCallback(() => {
		setSelected(new Set());
		setPreview(null);
		setPreviewSignature(null);
		setFailedSignature(null);
		setPreviewError(null);
		setConfirmed(false);
		setSelectionNotice(null);
		setResult(null);
		setProgress(null);
		setError(null);
		if (activeSource) void loadSessions(activeSource);
	}, [activeSource, loadSessions]);

	const onCopyPath = useCallback(async (path: string) => {
		try {
			await navigator.clipboard.writeText(path);
			return true;
		} catch {
			return false;
		}
	}, []);

	// Refresh means both halves of the screen: source card counts were stale
	// after a source grew, and reloading only the rows left the card misleading.
	const onRefresh = useCallback(async () => {
		if (jobActive) return;
		setSelectionNotice(null);
		/*
		 * Refresh is the user's "try that again" for this screen, so it drops the
		 * record of a failed preview as well as reloading the data. Without this
		 * the automatic build would keep refusing the same selection.
		 */
		setFailedSignature(null);
		setPreviewError(null);
		await loadSources();
		if (activeSource) await loadSessions(activeSource);
	}, [activeSource, jobActive, loadSessions, loadSources]);

	const onRetry = useCallback(() => {
		if (jobActive) {
			setError(null);
			setPollAttempt((value) => value + 1);
			return;
		}
		/*
		 * A failed preview is rebuilt by asking again: the failed signature is
		 * forgotten, which is what lets the automatic build run for this
		 * selection again.
		 */
		setFailedSignature(null);
		setPreviewError(null);
		void onRefresh();
	}, [jobActive, onRefresh]);

	return (
		<ImportSettingsView
			sources={sources}
			activeSource={activeSource}
			sessions={sessions}
			query={query}
			selected={selected}
			preview={preview}
			previewStale={previewStale}
			previewError={previewError}
			confirmed={confirmed}
			busy={busy}
			error={error}
			progress={progress}
			result={result}
			cancelling={cancelling}
			onSelectSource={onSelectSource}
			onQueryChange={setQuery}
			onToggleSession={onToggleSession}
			onSelectAll={onSelectAll}
			onClearSelection={onClearSelection}
			onConfirmChange={setConfirmed}
			onImport={() => void onImport()}
			onCancel={() => void onCancel()}
			onRetry={onRetry}
			onImportAnother={onImportAnother}
			onRefresh={onRefresh}
			selectionNotice={selectionNotice}
			onCopyPath={onCopyPath}
		/>
	);
};
