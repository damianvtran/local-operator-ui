import { t } from "@shared/i18n";
/**
 * The Library's data layer: reads, writes, byte fetches and the chat
 * association, all over the frozen `library.*` desktop ops.
 *
 * THE KEY HIERARCHY IS ONE PREFIX (`["desktop", "library"]`), so every write
 * invalidates the listing, the detail, the tag vocabulary and the Librarian
 * status together - the four documents a library edit can change. A narrower
 * key per surface would let the rail's tag counts disagree with the detail's
 * chips after one rename, which is the class of drift the projects data layer
 * documents at its own keys.
 *
 * `enabled` IS AN INPUT, not a derivation: the page owns the capability gate,
 * and a read fired before that answer arrives would 404 against an older
 * backend and paint an error the user cannot act on. Every hook here is
 * fail-closed on the same boolean.
 *
 * THE LISTING IS SERVER-FILTERED. `q`, category, origin group, status and tag
 * travel to `library.list`; the renderer never re-filters the answer, because a
 * cursor page is not the catalog and a client predicate over it would make a
 * result count describe the page rather than the query.
 */

import { peaksFrom } from "@features/chat/canonical/use-waveform";
import {
	retryDesktopMutation,
	retryDesktopQuery,
} from "@shared/api/local-operator/backend-error";
import {
	desktopMedia,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	type InfiniteData,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type {
	DesktopLibrarianStatus,
	DesktopLibraryAsset,
	DesktopLibraryChatReceipt,
	DesktopLibraryList,
	DesktopLibraryTag,
	DesktopLibraryUpdateFields,
} from "../../../../../shared/desktop-control-contract";
import type { LibraryListFilters } from "../library-model";
import { organizedParam } from "../library-model";

/** Every library document hangs off this prefix. */
export const libraryKeys = {
	all: ["desktop", "library"] as const,
	list: (filters: LibraryListFilters) =>
		["desktop", "library", "list", filters] as const,
	detail: (id: string) => ["desktop", "library", "detail", id] as const,
	tags: ["desktop", "library", "tags"] as const,
	librarian: ["desktop", "library", "librarian"] as const,
};

/** How many rows one page asks for. */
export const LIBRARY_PAGE_SIZE = 60;

/** The request half of `library.list`, derived from the page's filters once. */
function listRequest(filters: LibraryListFilters, cursor?: string) {
	return {
		op: "library.list" as const,
		scope: filters.scope,
		...(filters.q.trim() ? { q: filters.q.trim() } : {}),
		...(filters.category ? { category: filters.category } : {}),
		...(filters.originGroup ? { origin_group: filters.originGroup } : {}),
		...(filters.tag ? { tag: filters.tag } : {}),
		...(filters.session ? { session_id: filters.session } : {}),
		...(filters.tag ? { tag_mode: filters.tagMode } : {}),
		...(filters.highlighted ? { highlighted: true } : {}),
		...(filters.status === "favorite" ? { favorite: true } : {}),
		...(() => {
			const organized = organizedParam(filters.status);
			return organized !== undefined ? { organized } : {};
		})(),
		sort: filters.sort,
		order: filters.order,
		limit: LIBRARY_PAGE_SIZE,
		...(cursor ? { cursor } : {}),
	};
}

/**
 * The listing, cursor-paged.
 *
 * `getNextPageParam` reads the route's opaque cursor and stops on null; the
 * route may also answer `cursor_reset` when the catalog revision moved, which
 * the page handles by replacing the pages rather than appending a stale set
 * (that flag is read off the last page in `useLibraryAssets`).
 */
export function useLibraryAssets(
	filters: LibraryListFilters,
	enabled: boolean,
) {
	return useInfiniteQuery({
		queryKey: libraryKeys.list(filters),
		enabled,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			desktopResult<DesktopLibraryList>(listRequest(filters, pageParam)),
		getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
		retry: retryDesktopQuery,
		/*
		 * A `building` answer is a promise the backend keeps working, so the page
		 * polls only while that state holds - the same division the session-files
		 * list ships. A ready catalog does not poll: writes invalidate, and window
		 * focus refetches globally.
		 */
		refetchInterval: (query) =>
			query.state.data?.pages.at(-1)?.state === "building" ? 2000 : false,
		/*
		 * The catalog revision is in every page's answer, and a revision move is
		 * the backend saying the aggregate changed. Refetching the whole infinite
		 * list on a timer would be expensive; the page instead reads
		 * `cursor_reset` from the next page append.
		 */
		staleTime: 10_000,
	});
}

/** The detail read, under the same prefix every write invalidates. */
export function useLibraryAsset(id: string | null, enabled: boolean) {
	return useQuery({
		queryKey: libraryKeys.detail(id ?? ""),
		enabled: enabled && Boolean(id),
		queryFn: () =>
			desktopResult<DesktopLibraryAsset>({
				op: "library.get",
				id: id as string,
			}),
		retry: retryDesktopQuery,
		staleTime: 5_000,
	});
}

/** The tag vocabulary, with each tag's count. */
export function useLibraryTags(enabled: boolean) {
	return useQuery({
		queryKey: libraryKeys.tags,
		enabled,
		queryFn: () => desktopResult<DesktopLibraryTag[]>({ op: "library.tags" }),
		retry: retryDesktopQuery,
		staleTime: 20_000,
	});
}

/** The Librarian's status row. */
export function useLibrarianStatus(enabled: boolean) {
	return useQuery({
		queryKey: libraryKeys.librarian,
		enabled,
		queryFn: () =>
			desktopResult<
				DesktopLibrarianStatus | { librarian: DesktopLibrarianStatus }
			>({ op: "library.librarian", action: "status" }).then((result) =>
				"librarian" in result ? result.librarian : result,
			),
		retry: retryDesktopQuery,
		staleTime: 30_000,
	});
}

/** Invalidate every library document after a write. */
function invalidateLibrary(client: QueryClient) {
	return client.invalidateQueries({ queryKey: libraryKeys.all });
}

/**
 * A metadata write.
 *
 * OPTIMISTIC, then a READ after a refusal: the contract's rule is that a user's
 * edit lands immediately but a refusal re-reads the row, so the field snaps
 * back to what the catalog actually holds rather than to the value the UI
 * hoped for. `onError` performs that re-read explicitly (the invalidation alone
 * would also do it, but a refusal that arrives after another write must not
 * paint a mixed document).
 */
/** A row as it reads with a patch applied; every patched field is optional. */
function patchedAsset(
	asset: DesktopLibraryAsset,
	fields: DesktopLibraryUpdateFields,
): DesktopLibraryAsset {
	return { ...asset, ...fields };
}

export function useUpdateLibraryAsset() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string; fields: DesktopLibraryUpdateFields }) =>
			desktopResult<DesktopLibraryAsset>({
				op: "library.update",
				id: input.id,
				fields: input.fields,
			}),
		/*
		 * THE PRESS PAINTS BEFORE THE WRITE ANSWERS, AND THE ROLLBACK IS THE ROW
		 * THE USER SAW. The operator asked for favourite to read as a toggle; a
		 * heart that only fills after a round trip on a 60-row page reads as a
		 * dead control, and on a filtered `favorite` list the row would drop out
		 * while the cursor is elsewhere.
		 *
		 * THE SNAPSHOT IS EVERY PAGE, not the detail row: this mutation writes a
		 * field that more than one surface reads (the grid card, the list row,
		 * the preview, the status counts), and a rollback that restored only the
		 * open detail would leave the list showing a favourite the server
		 * refused. `cancelQueries` first is what keeps an in-flight list read
		 * from landing the pre-press row over the optimistic one and then
		 * "winning" permanently.
		 */
		onMutate: async (input) => {
			await client.cancelQueries({ queryKey: libraryKeys.all });
			const detail = client.getQueryData<DesktopLibraryAsset>(
				libraryKeys.detail(input.id),
			);
			const lists = client.getQueriesData<InfiniteData<DesktopLibraryList>>({
				queryKey: [...libraryKeys.all, "list"],
			});
			if (detail) {
				client.setQueryData(
					libraryKeys.detail(input.id),
					patchedAsset(detail, input.fields),
				);
			}
			for (const [key, data] of lists) {
				if (!data) continue;
				client.setQueryData<InfiniteData<DesktopLibraryList>>(key, {
					...data,
					pages: data.pages.map((page) => ({
						...page,
						rows: page.rows.map((row) =>
							row.id === input.id ? patchedAsset(row, input.fields) : row,
						),
					})),
				});
			}
			return { detail, lists };
		},
		onSuccess: (asset) => {
			client.setQueryData(libraryKeys.detail(asset.id), asset);
			return invalidateLibrary(client);
		},
		onError: (_error, input, context) => {
			// The paint goes back to what it was before the press, then the reads
			// re-ask so a refusal's own state wins over both guesses.
			if (context?.detail) {
				client.setQueryData(libraryKeys.detail(input.id), context.detail);
			}
			for (const [key, data] of context?.lists ?? []) {
				client.setQueryData(key, data);
			}
			void client.invalidateQueries({
				queryKey: libraryKeys.detail(input.id),
			});
			void client.invalidateQueries({ queryKey: libraryKeys.all });
		},
		retry: retryDesktopMutation,
	});
}

/** Replace an asset's tag set. */
export function useAssignLibraryTags() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string; tags: string[]; primary?: string }) =>
			desktopResult<DesktopLibraryAsset>({
				op: "library.tags.assign",
				id: input.id,
				tags: input.tags,
				...(input.primary ? { primary: input.primary } : {}),
			}),
		onSuccess: (asset) => {
			client.setQueryData(libraryKeys.detail(asset.id), asset);
			return invalidateLibrary(client);
		},
		onError: () => invalidateLibrary(client),
		retry: retryDesktopMutation,
	});
}

/** The tag-vocabulary writes: create, rename/re-categorise, delete, merge. */
export function useLibraryTagMutations() {
	const client = useQueryClient();
	const refresh = () => invalidateLibrary(client);
	const create = useMutation({
		mutationFn: (input: { name: string; category?: string }) =>
			desktopResult<DesktopLibraryTag>({
				op: "library.tags.create",
				name: input.name,
				...(input.category ? { category: input.category } : {}),
			}),
		onSuccess: refresh,
		retry: retryDesktopMutation,
	});
	const update = useMutation({
		mutationFn: (input: { id: string; name?: string; category?: string }) =>
			desktopResult<DesktopLibraryTag>({
				op: "library.tags.update",
				id: input.id,
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.category !== undefined ? { category: input.category } : {}),
			}),
		onSuccess: refresh,
		retry: retryDesktopMutation,
	});
	const remove = useMutation({
		mutationFn: (input: { id: string }) =>
			desktopResult<unknown>({ op: "library.tags.delete", id: input.id }),
		onSuccess: refresh,
		retry: retryDesktopMutation,
	});
	const merge = useMutation({
		mutationFn: (input: { id: string; into: string }) =>
			desktopResult<unknown>({
				op: "library.tags.merge",
				id: input.id,
				into: input.into,
			}),
		onSuccess: refresh,
		retry: retryDesktopMutation,
	});
	return { create, update, remove, merge };
}

/** Record the session a chat about this asset runs in. */
export function useLinkAssetChat() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string; sessionId: string }) =>
			desktopResult<DesktopLibraryChatReceipt>({
				op: "library.chat.link",
				id: input.id,
				sessionId: input.sessionId,
			}),
		onSuccess: () => invalidateLibrary(client),
		onError: () => invalidateLibrary(client),
		retry: retryDesktopMutation,
	});
}

/** Clear an asset's chat association. */
export function useUnlinkAssetChat() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { id: string }) =>
			desktopResult<DesktopLibraryChatReceipt>({
				op: "library.chat.clear",
				id: input.id,
			}),
		onSuccess: () => invalidateLibrary(client),
		retry: retryDesktopMutation,
	});
}

/** The Librarian's four controls. The answer carries the opened session id. */
export function useLibrarianControl() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (action: "open" | "pause" | "resume" | "run") =>
			desktopResult<
				DesktopLibrarianStatus | { librarian: DesktopLibrarianStatus }
			>({ op: "library.librarian", action }).then((result) =>
				"librarian" in result ? result.librarian : result,
			),
		onSuccess: () => invalidateLibrary(client),
		retry: retryDesktopMutation,
	});
}

/**
 * Fetch one asset's content or thumbnail as bytes, for the preview.
 *
 * THE BLOB URL IS REVOKED ON EVERY EXIT, including a superseded asset: a pane
 * that switches selection ten times must not pin ten files in renderer memory.
 * `null` while the fetch is in flight, so an element is never mounted against a
 * stale URL from the previous asset.
 */
export function useLibraryBytes(
	assetId: string | null,
	kind: "content" | "thumbnail",
	enabled: boolean,
	/** Ask the content route for an attachment disposition (save-a-copy). */
	download = false,
) {
	const [state, setState] = useState<{
		bytes: Uint8Array | null;
		mimeType: string;
		error: string | null;
		loading: boolean;
	}>({ bytes: null, mimeType: "", error: null, loading: false });

	useEffect(() => {
		if (!enabled || !assetId) {
			setState({ bytes: null, mimeType: "", error: null, loading: false });
			return;
		}
		let cancelled = false;
		setState({ bytes: null, mimeType: "", error: null, loading: true });
		const request =
			kind === "thumbnail"
				? { op: "library.thumbnail" as const, assetId, width: 480 }
				: { op: "library.content" as const, assetId, download };
		void desktopMedia(request, null).then((response) => {
			if (cancelled) return;
			if (response.kind === "bytes") {
				setState({
					bytes: response.data,
					mimeType: response.mimeType,
					error: null,
					loading: false,
				});
				return;
			}
			setState({
				bytes: null,
				mimeType: "",
				error:
					response.kind === "error"
						? response.detail
						: t("ui.library.errors.preview_load"),
				loading: false,
			});
		});
		return () => {
			cancelled = true;
		};
	}, [assetId, kind, enabled, download]);

	return state;
}

/**
 * A Library audio asset's stored peaks, for the shared player's waveform.
 *
 * THE SIDECAR IS A PROPERTY OF THE ASSET, NOT OF THE SCREEN. The same sound can
 * be on a grid card, in the drawer and in a story at once; a digest-addressed
 * request per mount (the shape `use-waveform` documents for attachments) would
 * ask the same question three times per scroll. So the promise is cached per
 * ASSET ID for the module's lifetime, misses included: a 404 is an answer - the
 * catalog holds no sidecar for this asset - and re-asking cannot change it.
 *
 * EVERY ABSENCE IS `null`, never a fabricated shape: no id, a route the
 * backend has not shipped yet (the two lanes meet on this contract), a
 * non-JSON body, and a malformed peak list all fall through `peaksFrom` or the
 * response check. The player draws its honest flat scrubber for `null`.
 */
export function useLibraryWaveform(
	assetId: string | null,
	enabled = true,
): number[] | null {
	const [peaks, setPeaks] = useState<number[] | null>(() =>
		assetId ? (settledWaveforms.get(assetId) ?? null) : null,
	);
	useEffect(() => {
		/*
		 * RESET ON THE SWITCH, from the cache, BEFORE ANY AWAIT. The drawer
		 * re-renders one viewer with a new asset id while the mount stays, so
		 * the previous asset's peaks would survive into the new asset's first
		 * frames - A's bars under B's title until B's answer lands. Seeding
		 * from `settledWaveforms` gives B either its own painted envelope (a
		 * settled hit) or `null` (the honest flat scrubber) on that first frame.
		 */
		if (!assetId) {
			setPeaks(null);
			return;
		}
		setPeaks(settledWaveforms.get(assetId) ?? null);
		if (!enabled) return;
		let live = true;
		requestLibraryPeaks(assetId).then((value) => {
			if (live) setPeaks(value);
		});
		return () => {
			live = false;
		};
	}, [assetId, enabled]);
	return peaks;
}

/** Settled answers, so a later mount paints the waveform on its first frame. */
const settledWaveforms = new Map<string, number[] | null>();
const waveformRequests = new Map<string, Promise<number[] | null>>();

/**
 * One sidecar read. Exported so a node test can drive the exact relay call the
 * hook makes (the `fetchWaveformPeaks` convention beside `use-waveform`).
 */
export async function fetchLibraryWaveform(
	assetId: string,
): Promise<number[] | null> {
	try {
		const result = await desktopMedia(
			{ op: "library.waveform", assetId },
			null,
		);
		return result.kind === "json" ? peaksFrom(result.body) : null;
	} catch {
		// A transport failure and a 404 mean the same thing here: no shape.
		return null;
	}
}

function requestLibraryPeaks(assetId: string): Promise<number[] | null> {
	const existing = waveformRequests.get(assetId);
	if (existing) return existing;
	const pending = fetchLibraryWaveform(assetId)
		.then((value) => {
			settledWaveforms.set(assetId, value);
			return value;
		})
		.catch(() => {
			settledWaveforms.set(assetId, null);
			return null;
		});
	waveformRequests.set(assetId, pending);
	return pending;
}

/** Turn bytes into a revocable object URL the DOM can load. */
export function useObjectUrl(
	bytes: Uint8Array | null,
	mimeType: string,
): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		if (!bytes) {
			setUrl(null);
			return;
		}
		const blob = new Blob([bytes as BlobPart], {
			type: mimeType || "application/octet-stream",
		});
		const next = URL.createObjectURL(blob);
		setUrl(next);
		return () => URL.revokeObjectURL(next);
	}, [bytes, mimeType]);
	return url;
}
