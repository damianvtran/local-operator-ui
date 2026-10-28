/**
 * The Skills tab's two reads: the library list and one skill's details.
 *
 * Both are `GET /v1/desktop/skills` (core `skill_library:1`, local-operator
 * #2998): the list with no `name`, the details with `name=<skill>`, which adds
 * `detail` (the resolver text) and `skill_detail`. READ-ONLY - there is no
 * mutation in this file, and the hub actions (pull / subscribe / unpull /
 * publish) are deliberately not wired here (U2).
 *
 * KEYS SIT UNDER `["desktop", "skills"]` on purpose. The hub's pull, subscribe
 * and unpull mutations already invalidate that prefix when they land
 * (`use-hub-skills.ts`), so a skill pulled from the Hub page refreshes this list
 * without this tab knowing the Hub exists. The `"library"` segment keeps it off
 * the slash-command picker's `["desktop", "skills", <sessionId>]` entries, whose
 * rows are the older two-key shape.
 *
 * THE RESPONSE IS PARSED, NOT CAST. An unrecognisable body throws, and the tab
 * shows its error state with Retry rather than painting cards from a shape it
 * only hoped for; the schema's optional fields are what keep an older core's
 * short rows parsing.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useHubUpdates } from "@shared/api/local-operator/hub-hooks";
import {
	hubLinksKey,
	useHubLinks,
} from "@shared/api/local-operator/hub-link-hooks";
import type { HubLink } from "@shared/api/local-operator/hub-links";
import { hubItemIndex } from "@shared/api/local-operator/hub-updates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
	type SkillsListResult,
	skillsListResultSchema,
} from "../../../../../shared/desktop-contract";
import {
	type SkillCard,
	joinSkillHub,
	toSkillCards,
} from "../skills-library-model";

export const skillsLibraryKey = ["desktop", "skills", "library"] as const;

async function readSkills(name?: string): Promise<SkillsListResult> {
	const envelope = await desktopResult<{ data?: unknown }>({
		op: "skills.list",
		...(name ? { name } : {}),
	});
	const parsed = skillsListResultSchema.safeParse(envelope?.data);
	if (!parsed.success) throw new Error("skills-library-invalid");
	return parsed.data;
}

/** The rows. `enabled` is the caller's `skill_library` capability, nothing looser. */
export function useSkillsLibrary(enabled: boolean) {
	return useQuery({
		queryKey: skillsLibraryKey,
		enabled,
		queryFn: () => readSkills(),
		staleTime: 10_000,
		retry: retryDesktopQuery,
	});
}

/** One skill's details; only while a row is open. */
export function useSkillDetail(name: string | null, enabled: boolean) {
	return useQuery({
		queryKey: [...skillsLibraryKey, name],
		enabled: enabled && Boolean(name),
		queryFn: () => readSkills(name ?? undefined),
		staleTime: 10_000,
		// A refusal is about the row (removed since the list was read); asking again
		// is the same question, so the pane's Retry is the reader's to press.
		retry: false,
	});
}

/**
 * THE TAB'S WHOLE READ MODEL: rows, the hub facts they join to, and the join.
 *
 * Hub state is NOT in `skills.list` (core copies none of it): a `hub` row carries
 * a `link_id` and this joins it to the links inventory and the updates store the
 * Hub page already reads, through `hubSkillState()`. The reads are the Hub's own
 * hooks and query keys, so the two pages share one cache entry and one refetch
 * cadence rather than polling twice.
 */
export function useSkillsTab(options: {
	/** `skill_library` negotiated. */
	enabled: boolean;
	/** `hub_links` negotiated; without it hub rows read "unknown", never invented. */
	linksEnabled: boolean;
	/** `hub_updates` negotiated. */
	updatesEnabled: boolean;
}) {
	const library = useSkillsLibrary(options.enabled);
	const links = useHubLinks(options.enabled && options.linksEnabled);
	const updates = useHubUpdates(options.enabled && options.updatesEnabled);
	const cards = useMemo(
		() => toSkillCards(library.data?.skills ?? []),
		[library.data],
	);
	const updateIndex = useMemo(() => hubItemIndex(updates.data), [updates.data]);
	// "No link row" is a fact only once the inventory has ANSWERED. Without the
	// capability it never will, which is also "not ready" - the card then says
	// the state is unavailable instead of "not downloaded" for a skill that is.
	const inventoryReady =
		options.linksEnabled && !links.isLoading && !links.error;
	const savesVersion = useLocalSavesVersion();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `savesVersion` is a re-derive trigger, read through `savedSinceCheck`.
	const join = useCallback(
		(card: SkillCard) => {
			const joined = joinSkillHub(
				card,
				links.data?.links,
				updateIndex,
				inventoryReady,
			);
			// A save core has not checked yet reads as the local change it is (Q8);
			// `both-changed` is the stronger fact and is left alone.
			if (
				!joined?.link ||
				!card.installed ||
				!savedSinceCheck(joined.link) ||
				joined.link.push?.classification === "both-changed"
			)
				return joined;
			return {
				...joined,
				link: {
					...joined.link,
					push: { ...joined.link.push, classification: "local-only" },
				},
			};
		},
		// `savesVersion` re-derives the join when a save is recorded.
		[links.data, updateIndex, inventoryReady, savesVersion],
	);
	return { library, cards, join, inventoryReady, linksFailed: !!links.error };
}

/* ---------------------------------------------------------------- writes --- */

/**
 * The Skills tab's three writes (core `skill_write:1`): Copy to my skills, the
 * inline SKILL.md save, and Remove. Each sends a FRESH `requestId` per attempt -
 * the route receipts by it, so reusing one would replay the first answer instead
 * of trying again.
 *
 * WHAT IS INVALIDATED, AND WHY BOTH. The library key is a prefix of every skill's
 * detail key, so one invalidation refreshes the list and the open skill; the hub
 * links inventory is the source of a linked skill's Modified state and its
 * content presence, which a save or a remove changes. React Query keeps the old
 * data on screen while the refetch is in flight, so the pane does not flash a
 * skeleton under the reader.
 *
 * A refusal is rethrown as the transport's own error, whose `code` is the
 * route's machine code (`skill_stale`, `skill_local_changes_unpublished`, ...):
 * the caller decides the sentence, never a regex over prose.
 */
/*
 * Hub copies saved inline on this machine, by link id, with when. Module scope
 * on purpose: the mark must survive the pane and the tab remounting, exactly
 * as long as the renderer holds the cache it corrects.
 */
const localSaves = new Map<string, number>();
const localSaveListeners = new Set<() => void>();
let localSavesVersion = 0;
function noteLocalSave(linkId: string) {
	localSaves.set(linkId, Date.now());
	localSavesVersion += 1;
	for (const listener of localSaveListeners) listener();
}
/**
 * Whether this machine saved the linked copy after core last checked it - i.e.
 * the copy is locally modified though the link cannot say so yet.
 */
export function savedSinceCheck(link: HubLink | undefined): boolean {
	if (!link) return false;
	const saved = localSaves.get(link.link_id);
	if (saved === undefined) return false;
	const checked = link.push?.last_checked_at
		? Date.parse(link.push.last_checked_at)
		: Number.NaN;
	return !(checked > saved);
}
function useLocalSavesVersion(): number {
	return useSyncExternalStore(
		(listener) => {
			localSaveListeners.add(listener);
			return () => localSaveListeners.delete(listener);
		},
		() => localSavesVersion,
	);
}

export function useSkillWrites() {
	const client = useQueryClient();
	const refresh = useCallback(() => {
		void client.invalidateQueries({ queryKey: skillsLibraryKey });
		void client.invalidateQueries({ queryKey: hubLinksKey });
	}, [client]);
	/*
	 * NO RETRY ON A SKILL WRITE (QA r1 Q1). The app-wide `mutations.retry: 1`
	 * repeated every refusal: one Save over a moved skill sent PUT 409 twice, one
	 * Remove of a modified hub copy DELETE 409 twice, one refused Copy POST 422
	 * twice. Each retry mints a fresh request id, so it is a second write, not a
	 * replay - and every refusal here is a fact the reader must answer, not a
	 * transient the transport should hide.
	 */
	const copy = useMutation({
		retry: 0,
		mutationFn: (name: string) =>
			desktopResult({
				op: "skills.create",
				requestId: crypto.randomUUID(),
				name,
				copyFrom: name,
			}),
		onSettled: refresh,
	});
	const update = useMutation({
		retry: 0,
		mutationFn: (input: {
			name: string;
			expectedFingerprint: string;
			skillMd: string;
			/** The hub link this skill is a copy of, when it is one (Q5). */
			linkId?: string | null;
		}) =>
			desktopResult({
				op: "skills.update",
				requestId: crypto.randomUUID(),
				name: input.name,
				expectedFingerprint: input.expectedFingerprint,
				// SKILL.md ONLY, which is safe solely because the caller offers the
				// inline edit only for a skill with no reference files: the route
				// replaces the whole file set (`skillEditability`).
				files: [{ path: "SKILL.md", content: input.skillMd }],
			}),
		/*
		 * A SAVED EDIT ON A HUB COPY IS A LOCAL CHANGE NOW (QA r1 Q5, r2 Q8). Core
		 * does not re-classify the link until its next CHECK, so the links read
		 * after the save still says `push: null` - and a cache patch was undone by
		 * that very refetch one frame later. The save is recorded here instead and
		 * the join reads it as `local-only` until core has checked the link SINCE
		 * the save (`push.last_checked_at` newer), whose own answer then wins. Not
		 * a forced check: that needs the hub reachable, and an unreachable hub
		 * would leave the mark just as wrong.
		 */
		onSuccess: (_result, input) => {
			if (input.linkId) noteLocalSave(input.linkId);
		},
		onSettled: refresh,
	});
	const remove = useMutation({
		retry: 0,
		mutationFn: (input: { name: string; discardLocalChanges: boolean }) =>
			desktopResult({
				op: "skills.remove",
				requestId: crypto.randomUUID(),
				name: input.name,
				discardLocalChanges: input.discardLocalChanges,
			}),
		onSettled: refresh,
	});
	return { copy, update, remove };
}
