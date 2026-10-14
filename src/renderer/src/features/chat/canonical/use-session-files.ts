import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	remoteOwnedId,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type SessionFile,
	type SessionFilesPage,
	mergeFilesPage,
} from "./session-files";

export type FileIndexState = {
	mode: "negotiating" | "fallback" | "index";
	state: "loading" | "building" | "ready" | "unsupported" | "error";
	rows: SessionFile[];
	total: number;
	statComplete: boolean;
	error: string | null;
	coveredBytes: number;
	totalBytes: number;
};
const EMPTY: Omit<FileIndexState, "mode"> = {
	state: "loading",
	rows: [],
	total: 0,
	statComplete: true,
	error: null,
	coveredBytes: 0,
	totalBytes: 0,
};

/**
 * One service-owned index, one cancelable pagination/backfill loop.
 *
 * The absent capability is the ONLY fallback door. A capable daemon's 404,
 * building response or remote unsupported state is not permission to scan this
 * machine's filesystem (nor to silently union old transcript mentions into the
 * authoritative list). While capability negotiation is pending, do neither.
 *
 * Requests already dispatched through IPC cannot be aborted, so cancellation is
 * an epoch fence plus interruptible delay: no old page can commit or issue its
 * next request after the view/session changes. Building-status polling is bounded to 60 passes (pagination is not a file-count cap);
 * unfinished backfill stays visible with an explicit Continue action.
 */
export function useSessionFiles(
	sessionId: string | undefined,
	enabled: boolean,
	revisionHint = 0,
) {
	const sort = useUiPreferencesStore((state) => state.finderFiles.sort);
	const order = useUiPreferencesStore((state) => state.finderFiles.order);
	const remote = useCanonicalSessionsStore((state) =>
		sessionId
			? remoteOwnedId(state.sessions, state.placementFacts, sessionId)
			: false,
	);
	const capabilities = useDesktopCapabilities();
	const known = capabilities.data !== undefined;
	const capable = desktopFeatureEnabled(capabilities.data, "session_files");
	const mode: FileIndexState["mode"] = !known
		? "negotiating"
		: capable || remote
			? "index"
			: "fallback";
	const sourceKey = `${sessionId ?? "draft"}:${mode}:${sort}:${order}:${remote}`;
	const [ownedSnapshot, setOwnedSnapshot] = useState<{
		key: string;
		value: Omit<FileIndexState, "mode">;
	}>({ key: sourceKey, value: EMPTY });
	// Effects run after paint. This render-phase owner fence prevents even one
	// frame of the previous session's absolute paths from entering the new view.
	const snapshot =
		ownedSnapshot.key === sourceKey ? ownedSnapshot.value : EMPTY;
	const [retry, setRetry] = useState(0);
	const epoch = useRef(0);
	const refresh = useCallback(() => setRetry((value) => value + 1), []);
	useEffect(() => {
		const setSnapshot = (
			value:
				| Omit<FileIndexState, "mode">
				| ((
						previous: Omit<FileIndexState, "mode">,
				  ) => Omit<FileIndexState, "mode">),
		) => {
			setOwnedSnapshot((previous) => ({
				key: sourceKey,
				value:
					typeof value === "function"
						? value(previous.key === sourceKey ? previous.value : EMPTY)
						: value,
			}));
		};
		// Explicit invalidation inputs, not query fields: refresh/settled turns restart
		// this inventory generation without changing the backend cursor query.
		void retry;
		void revisionHint;
		const ticket = ++epoch.current;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let wake: (() => void) | undefined;
		const live = () => epoch.current === ticket;
		const delay = (ms: number) =>
			new Promise<void>((resolve) => {
				wake = resolve;
				timer = setTimeout(resolve, ms);
			});
		setSnapshot(EMPTY);
		// An old daemon cannot give a peer index, and its transcript paths name the
		// OTHER device. Hold the unsupported state instead of probing this disk.
		if (remote && !capable) {
			setSnapshot({
				...EMPTY,
				state: "unsupported",
				error: "Remote files cannot be opened on this device.",
			});
			return;
		}
		if (!enabled || mode !== "index" || !sessionId) return;
		void (async () => {
			let rows: SessionFile[] = [];
			let revision: number | null = null;
			let cursor: string | null = null;
			let resets = 0;
			const cursors = new Set<string>();
			try {
				for (let poll = 0; poll < 60 && live(); ) {
					const response = await desktopRequest({
						op: "sessions.files",
						sessionId,
						scope: "family",
						sort,
						order,
						limit: 200,
						...(cursor ? { cursor } : {}),
					});
					if (!live()) return;
					if (response.status === 404 || response.status === 409) {
						setSnapshot({
							...EMPTY,
							state: "unsupported",
							error: "This session's files are not available on this device.",
						});
						return;
					}
					if (response.status < 200 || response.status >= 300)
						throw new Error(
							"The file index could not be read. Retry to reconnect.",
						);
					const page = (response.body as { result: SessionFilesPage }).result;
					if (
						!page ||
						!Array.isArray(page.rows) ||
						!["ready", "building", "unsupported"].includes(page.state)
					)
						throw new Error("The backend returned an invalid file index.");
					if (page.state === "unsupported") {
						setSnapshot({
							...EMPTY,
							state: "unsupported",
							error: "Remote files cannot be opened on this device.",
						});
						return;
					}
					const reset =
						page.cursor_reset ||
						(revision !== null && revision !== page.revision);
					rows = mergeFilesPage(rows, page, revision);
					revision = page.revision;
					setSnapshot({
						state:
							page.state === "ready" && page.next_cursor
								? "loading"
								: page.state,
						rows,
						total: page.total,
						statComplete: page.stat_complete,
						error: null,
						coveredBytes: page.scan?.covered_bytes ?? 0,
						totalBytes: page.scan?.total_bytes ?? 0,
					});
					// An unannounced revision change is not an offset into the new index.
					// Restart from page one unless the service itself sent cursor_reset.
					if (reset && !page.cursor_reset) {
						cursor = null;
						rows = [];
						if (++resets > 4)
							throw new Error(
								"Files are changing quickly. Retry after the current turn finishes.",
							);
						continue;
					}
					cursor = page.next_cursor;
					if (cursor) {
						if (page.cursor_reset) cursors.clear();
						if (cursors.has(cursor))
							throw new Error(
								"The file index repeated a page cursor. Retry to refresh it.",
							);
						cursors.add(cursor);
						continue;
					}
					if (page.state === "ready") return;
					poll++;
					cursors.clear();
					await delay(Math.min(5000, 1000 + poll * 100));
					// Re-read a building index from page one. It can grow without the
					// former partial index retaining a row now absent from the service.
					rows = [];
					cursor = null;
				}
				if (live())
					setSnapshot((old) => ({
						...old,
						state: "building",
						error:
							"The index is still building. Continue loading to check progress.",
					}));
			} catch (error) {
				if (live())
					setSnapshot((old) => ({
						...old,
						state: "error",
						error:
							error instanceof Error
								? error.message
								: "The file index could not be read.",
					}));
			}
		})();
		return () => {
			++epoch.current;
			clearTimeout(timer);
			wake?.();
		};
	}, [
		enabled,
		mode,
		sessionId,
		retry,
		revisionHint,
		sort,
		order,
		remote,
		capable,
		sourceKey,
	]);
	return {
		...snapshot,
		mode,
		refresh,
		localReadAllowed:
			!remote && mode !== "negotiating" && snapshot.state !== "unsupported",
	};
}
