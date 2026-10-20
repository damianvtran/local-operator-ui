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
	 * The signature of the last preview ATTEMPT, successful or not. It is what
	 * stops the automatic build from asking again for a selection whose build
	 * already failed: the error is on screen with its own Retry, and a failing
	 * endpoint would otherwise be hit every 250ms for as long as the selection
	 * stood. It is state rather than a ref because the Retry clears it, and
	 * clearing it is what makes the automatic build run again.
	 */
	const [attemptedSignature, setAttemptedSignature] = useState<string | null>(
		null,
	);
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
		 * The preview is NOT cleared here: it stays on screen and goes stale (its
		 * signature no longer matches the selection), which is what lets the card
		 * update in place under the new numbers instead of vanishing.
		 */
		setConfirmed(false);
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
		setBusy("preview");
		setError(null);
		setAttemptedSignature(currentSignature);
		try {
			const next = await previewImport({
				sources: [activeSource],
				sessionIds: { [activeSource]: [...selected].sort() },
			});
			setPreview(next);
			setPreviewSignature(currentSignature);
		} catch (cause) {
			setPreview(null);
			setPreviewSignature(null);
			setError(
				t("ui.settings.imports.error_preview", { reason: reason(cause) }),
			);
		} finally {
			setBusy(null);
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
		// This selection was already built and the build failed: the error is on
		// screen, and the error's own Retry is what asks for another go.
		if (attemptedSignature === currentSignature) return;
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
		attemptedSignature,
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
		await loadSources();
		if (activeSource) await loadSessions(activeSource);
	}, [activeSource, jobActive, loadSessions, loadSources]);

	const onRetry = useCallback(() => {
		if (jobActive) {
			setError(null);
			setPollAttempt((value) => value + 1);
			return;
		}
		// A failed preview is rebuilt by asking again: the attempt that failed
		// is forgotten, and forgetting it is what makes the automatic build
		// run again.
		setAttemptedSignature(null);
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
