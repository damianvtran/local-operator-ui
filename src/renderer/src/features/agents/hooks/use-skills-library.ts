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
import type { HubLinks } from "@shared/api/local-operator/hub-links";
import { hubItemIndex } from "@shared/api/local-operator/hub-updates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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
	const join = useCallback(
		(card: SkillCard) =>
			joinSkillHub(card, links.data?.links, updateIndex, inventoryReady),
		[links.data, updateIndex, inventoryReady],
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
		 * A SAVED EDIT ON A HUB COPY IS A LOCAL CHANGE NOW (QA r1 Q5). Core does not
		 * re-classify the link until its next check, so the row and the header kept
		 * reading as unmodified after the reader changed it. The link's push side is
		 * marked `local-only` in the cache (unless it already says `both-changed`,
		 * the stronger fact); the settled invalidation then re-reads core, whose
		 * own answer replaces this the moment it has one.
		 */
		onSuccess: (_result, input) => {
			if (!input.linkId) return;
			client.setQueryData<HubLinks>(hubLinksKey, (current) =>
				current
					? {
							...current,
							links: current.links.map((link) =>
								link.link_id === input.linkId &&
								link.push.classification !== "both-changed"
									? {
											...link,
											push: { ...link.push, classification: "local-only" },
										}
									: link,
							),
						}
					: current,
			);
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
