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
 * 2. PREVIEW IS A GATE. A preview is built for one exact selection; changing the
 *    selection clears it, and `import` refuses unless the preview still matches.
 * 3. NO SILENT WRITE. Import additionally needs the acknowledgement checkbox, so
 *    one press cannot turn browsing into a copy.
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
import { filterSessions, selectionSignature } from "./imports-model";

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
	const sessionRequest = useRef(0);

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
			setError(`Could not read the source stores. ${reason(cause)}`);
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
		setPreview(null);
		setPreviewSignature(null);
		setConfirmed(false);
	}, []);

	const onSelectSource = useCallback((source: ImportSourceName) => {
		setActiveSource(source);
		setQuery("");
	}, []);

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
		const next = new Set(selected);
		for (const session of filterSessions(sessions, query)) {
			next.add(session.sourceId);
		}
		resetSelection(next);
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
		if (!activeSource || selected.size === 0) return;
		setBusy("preview");
		setError(null);
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

	const onImport = useCallback(async () => {
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
				setProgress(next);
				if (next.result) setResult(next.result);
				if (!TERMINAL.has(next.state)) {
					timer = setTimeout(tick, 900);
				}
			} catch (cause) {
				if (!alive) return;
				setError(t("ui.settings.imports.error_job", { reason: reason(cause) }));
			}
		};
		timer = setTimeout(tick, 700);
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
		};
	}, [jobId, jobState]);

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

	const onRetry = useCallback(() => {
		if (activeSource) void loadSessions(activeSource);
		else void loadSources();
	}, [activeSource, loadSessions, loadSources]);

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
			onPreview={() => void onPreview()}
			onConfirmChange={setConfirmed}
			onImport={() => void onImport()}
			onCancel={() => void onCancel()}
			onRetry={onRetry}
			onImportAnother={onImportAnother}
			onCopyPath={onCopyPath}
		/>
	);
};
