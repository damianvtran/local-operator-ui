/**
 * One read of the backend settings registry, shared by every transcript flag
 * that has to be settled before the rows paint (`use-cross-session-hidden.ts`,
 * `use-turn-answer-rail.ts`), plus the two things that make settling possible:
 * the persisted seed and the early read an opening conversation arms.
 *
 * WHY ONE HOOK RATHER THAN ONE PER FLAG. The registry read is ONE query — the
 * same key object (`backendSettingsKeys.all`) and the same `settings.list` op
 * the Settings page itself uses — and the flags are two lookups in its payload.
 * Two hooks would be two subscriptions to one entry and two places to keep the
 * seed write honest; a flag is a key, so the hook takes a key.
 *
 * WHERE THE CAPABILITY ARM SITS, and it is the part a refactor must not move:
 * the plane's own answer is read BEFORE the payload. `enabled: false` stops the
 * query refetching but leaves whatever is cached in place, so a plane that stops
 * advertising `settings` would otherwise keep painting a flag off an answer it
 * can no longer stand behind (agent review round 1, R3 on the rail). Hence
 * `denied` — answered, and the answer is no — which is a different fact from
 * "no answer yet" and resolves the flag off in both cases, seed included: a
 * backend that does not advertise the registry has no opinion a seed can stand
 * in for.
 */
import { backendSettingsKeys } from "@features/settings/components/backend-settings-section";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
	type DisplayFlagReading,
	displayFlagReading,
	readDisplaySeed,
	readFlagValue,
	seededFlag,
	writeDisplaySeed,
} from "./display-settings";

/**
 * The registry read, spelled once so the hook and the open-time prefetch cannot
 * drift into two different requests for one entry.
 *
 * `staleTime` is the Settings page's own 10 s (`backend-settings-section.tsx`):
 * the same entry, so the same freshness rule — a shorter one here would refetch
 * a payload the page considers current, and a longer one would let a save in the
 * page's own tab go unnoticed by the transcript.
 */
export function backendSettingsQueryOptions() {
	return {
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		staleTime: 10_000,
	} as const;
}

/** The result of reading one flag for a surface that is about to paint. */
export type DisplayFlagView = {
	/** on / off / pending; see `displayFlagReading`. */
	reading: DisplayFlagReading;
	/** The persisted last-known value, when the seed had one. */
	seed: boolean | undefined;
	/**
	 * The PLANE's own answer to "does this backend serve the registry at all",
	 * false while the capability query is unanswered.
	 *
	 * It is returned rather than folded into `reading` because the two flags
	 * read it differently and both behaviours are pinned: the rail is OFF for a
	 * plane that stops advertising `settings`, cached payload or not (its own
	 * arm, agent review round 1 R3 / QA round 1 Q-1, and
	 * `turn-collapse-behaviour.test.mjs`'s matrix), while the cross-session
	 * filter has never consulted it — an answered payload that says
	 * `hide_cross_session` is true keeps hiding. The reading below is the same
	 * fact for both; the arm belongs to the reader.
	 */
	available: boolean;
};

/**
 * Read one display flag.
 *
 * THE `owed` TERM IS DELIBERATELY NARROW: a first answer is in flight for a
 * plane that advertises the registry, and no answer is in hand. That is the one
 * window in which painting the flag's effect and taking it back is a flicker the
 * app can still choose to avoid, and the ONLY window a seeded-on flag is held
 * for (`displayFlagReading`). It is bounded by the transport's own deadline, so
 * a plane that never answers releases the hold rather than holding forever; a
 * capability answer that never comes does not open the window at all, because
 * without it there is no request to be in flight.
 */
export function useDisplayFlag(key: string): DisplayFlagView {
	const capabilities = useDesktopCapabilities();
	const available = desktopFeatureEnabled(capabilities.data, "settings");
	const settingsQuery = useQuery({
		...backendSettingsQueryOptions(),
		enabled: available,
	});
	const settings = settingsQuery.data?.settings;
	/*
	 * The seed follows every answer this window sees, whichever surface caused
	 * the read (the query is shared, so this effect runs for the Settings page's
	 * refetches too). The write is idempotent and guarded, so it cannot fail the
	 * render or fight a second writer.
	 */
	useEffect(() => {
		writeDisplaySeed(settings);
	}, [settings]);
	const seed = useMemo(() => seededFlag(readDisplaySeed(), key), [key]);
	const answer = readFlagValue(settings, key);
	return {
		reading: displayFlagReading({
			answer,
			seed,
			owed:
				settingsQuery.data === undefined &&
				settingsQuery.fetchStatus === "fetching",
		}),
		seed,
		available,
	};
}
