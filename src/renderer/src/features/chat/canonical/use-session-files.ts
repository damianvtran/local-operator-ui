import { desktopRequest } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	remoteOwnedId,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../../../i18n/messages";
import {
	type SessionFile,
	type SessionFilesPage,
	mergeFilesPage,
} from "./session-files";

/**
 * Why the index is not usable, as a STABLE CODE.
 *
 * WHY NOT THE SENTENCE: the snapshot is stored state. A translated string put
 * here is frozen at the moment the request settled, so a language switch leaves
 * the Files pane speaking the old language until the next refresh — and the
 * code also keeps this hook free of locale at fetch time. The presentation
 * layer translates with `fileIndexErrorMessage`.
 */
export type FileIndexError =
	| "remote-unavailable"
	| "not-available"
	| "read-failed"
	| "invalid-index"
	| "churning"
	| "repeated-cursor"
	| "still-building"
	| "unreadable";

/** A failure this module raised itself, carrying the code it must store. */
class SessionFilesError extends Error {
	constructor(readonly code: FileIndexError) {
		super(code);
	}
}

/**
 * The sentence the Files pane shows for a stored code.
 *
 * Called AT RENDER, so the sentence follows the active locale and a switch
 * re-labels the pane without a refetch. `null` in, `null` out: the pane draws
 * nothing for an index that has nothing to say.
 */
export function fileIndexErrorMessage(
	error: FileIndexError | null,
): string | null {
	switch (error) {
		case null:
			return null;
		case "remote-unavailable":
			return t(
				"ui.chat.canonical.use_session_files.remote_files_cannot_be_opened_on_this_device",
			);
		case "not-available":
			return t(
				"ui.chat.canonical.use_session_files.this_sessions_files_are_not_available_on_this_device",
			);
		case "read-failed":
			return t(
				"ui.chat.canonical.use_session_files.the_file_index_could_not_be_read_retry_to_reconnect",
			);
		case "invalid-index":
			return t(
				"ui.chat.canonical.use_session_files.the_backend_returned_an_invalid_file_index",
			);
		case "churning":
			return t(
				"ui.chat.canonical.use_session_files.files_are_changing_quickly_retry_after_the_current_turn_finishes",
			);
		case "repeated-cursor":
			return t(
				"ui.chat.canonical.use_session_files.the_file_index_repeated_a_page_cursor_retry_to_refresh",
			);
		case "still-building":
			return t(
				"ui.chat.canonical.use_session_files.the_index_is_still_building_continue_loading_to_check_progress",
			);
		case "unreadable":
			return t(
				"ui.chat.canonical.use_session_files.the_file_index_could_not_be_read",
			);
	}
}

export type FileIndexState = {
	mode: "negotiating" | "fallback" | "index";
	state: "loading" | "building" | "ready" | "unsupported" | "error";
	rows: SessionFile[];
	total: number;
	statComplete: boolean;
	error: FileIndexError | null;
	coveredBytes: number;
	totalBytes: number;
	/** Progress of the private pass; never thumbnail-producing membership. */
	loadedRows: number;
	pendingTotal: number;
};
const EMPTY: Omit<FileIndexState, "mode"> = {
	state: "loading",
	rows: [],
	total: 0,
	statComplete: true,
	error: null,
	coveredBytes: 0,
	totalBytes: 0,
	loadedRows: 0,
	pendingTotal: 0,
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
	// Display sorting is local; it cannot change inventory ownership or restart
	// pagination. Only a different session/authority may hide the former paths.
	const sourceKey = `${sessionId ?? "draft"}:${mode}:${remote}`;
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
		// Same-source refresh keeps the displayed generation until a complete pass
		// can replace it. Painting EMPTY here loses focus and pins an empty list
		// when the reader is hovering while a settled turn asks for a refresh.
		setSnapshot((old) => ({ ...old, state: "loading", error: null }));
		// An old daemon cannot give a peer index, and its transcript paths name the
		// OTHER device. Hold the unsupported state instead of probing this disk.
		if (remote && !capable) {
			setSnapshot({
				...EMPTY,
				state: "unsupported",
				error: "remote-unavailable",
			});
			return;
		}
		if (!sessionId) {
			setSnapshot({ ...EMPTY, state: "ready" });
			return;
		}
		if (!enabled || mode !== "index") return;
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
						sort: "recent",
						order: "desc",
						limit: 200,
						...(cursor ? { cursor } : {}),
					});
					if (!live()) return;
					if (response.status === 404 || response.status === 409) {
						setSnapshot({
							...EMPTY,
							state: "unsupported",
							error: "not-available",
						});
						return;
					}
					if (response.status < 200 || response.status >= 300)
						throw new SessionFilesError("read-failed");
					const page = (response.body as { result: SessionFilesPage }).result;
					if (
						!page ||
						!Array.isArray(page.rows) ||
						!["ready", "building", "unsupported"].includes(page.state)
					)
						throw new SessionFilesError("invalid-index");
					if (page.state === "unsupported") {
						setSnapshot({
							...EMPTY,
							state: "unsupported",
							error: "remote-unavailable",
						});
						return;
					}
					const reset =
						page.cursor_reset ||
						(revision !== null && revision !== page.revision);
					// A revision change matters only while consuming a cursor. Backfill
					// publishes a new revision per slice; a fresh page-one poll is an
					// expected new generation, not one of the defensive restart budget.
					if (cursor && reset && !page.cursor_reset) {
						cursor = null;
						rows = [];
						revision = null;
						cursors.clear();
						if (++resets > 4) throw new SessionFilesError("churning");
						continue;
					}
					rows = mergeFilesPage(rows, page, revision);
					revision = page.revision;
					const complete = page.state === "ready" && !page.next_cursor;
					// Cursor pages and backfill slices are PRIVATE assembly, including
					// the cold first pass. Painting their changing membership remounted
					// thumbnails on each page and snapped late Highlights above the list.
					// Publish progress only until one complete ready generation exists;
					// refresh keeps the former complete rows throughout that assembly.
					// Capture the array before the loop resets it: React may apply this
					// functional update after the next request/poll has already started.
					const assembledRows = rows;
					setSnapshot((previous) => ({
						state:
							page.state === "ready" && page.next_cursor
								? "loading"
								: page.state,
						rows: complete ? assembledRows : previous.rows,
						total:
							complete || !previous.rows.length ? page.total : previous.total,
						loadedRows: assembledRows.length,
						pendingTotal: page.total,
						statComplete: page.stat_complete,
						error: null,
						coveredBytes: page.scan?.covered_bytes ?? 0,
						totalBytes: page.scan?.total_bytes ?? 0,
					}));
					cursor = page.next_cursor;
					if (cursor) {
						if (page.cursor_reset) cursors.clear();
						if (cursors.has(cursor))
							throw new SessionFilesError("repeated-cursor");
						cursors.add(cursor);
						continue;
					}
					if (page.state === "ready") return;
					resets = 0;
					poll++;
					cursors.clear();
					await delay(Math.min(5000, 1000 + poll * 100));
					// Re-read a building index from page one. It can grow without the
					// former partial index retaining a row now absent from the service.
					rows = [];
					revision = null;
					cursor = null;
				}
				if (live())
					setSnapshot((old) => ({
						...old,
						state: "building",
						error: "still-building",
					}));
			} catch (error) {
				if (live())
					setSnapshot((old) => ({
						...old,
						state: "error",
						error:
							error instanceof SessionFilesError ? error.code : "unreadable",
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
