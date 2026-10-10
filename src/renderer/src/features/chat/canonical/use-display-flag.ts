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
import { useEffect, useMemo, useState } from "react";
import {
	DISPLAY_HOLD_BUDGET_MS,
	type DisplayFlagReading,
	type DisplayPlane,
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
	 * What the PLANE (this window's backend) has said about the registry: no answer
	 * yet, answered denied, answered with the registry, or unanswerable.
	 *
	 * It is returned rather than folded into `reading` because the two flags read
	 * it differently and both behaviours are pinned: the rail is OFF for a plane
	 * that ANSWERS without advertising `settings`, cached payload or not (its own
	 * arm, agent review round 1 R3 / QA round 1 Q-1, and
	 * `turn-collapse-behaviour.test.mjs`'s matrix), while the cross-session filter
	 * has never consulted it — an answered payload that says
	 * `hide_cross_session` is true keeps hiding. The reading below is the same fact
	 * for both; the arm belongs to the reader, and `DisplayPlane` states why
	 * "unknown" is its own state rather than part of "denied".
	 */
	plane: DisplayPlane;
};

/**
 * Read one display flag.
 *
 * THE `owed` TERM IS "AN ANSWER COULD STILL ARRIVE", in either leg: the capability
 * answer for a plane that has not spoken yet, or the registry read for a plane
 * that advertises it. That is the window in which painting the flag's effect and
 * taking it back is a flicker the app can choose to avoid — and it is bounded
 * twice over, by the query's own settle and by `DISPLAY_HOLD_BUDGET_MS`, so a
 * backend that never answers releases the hold rather than holding (agent review
 * round 1, R1: the deadline was NOT a bound, because a retried read keeps
 * `owed` true for up to 51 s and the pane showed nothing for all of it).
 *
 * THE BUDGET IS ARMED ONCE PER MOUNT AND LATCHED. A hold that could re-arm would
 * let a retry gap or a late answer re-blank a pane that had already painted —
 * the flicker in its worse direction. Once spent, the seed's own reading paints
 * (`displayFlagReading` step 4) and no later event can withhold the records
 * again; a background refetch (a save in the Settings page) therefore never
 * blanks a transcript that is already on screen.
 */
export function useDisplayFlag(key: string): DisplayFlagView {
	const capabilities = useDesktopCapabilities();
	const advertised = desktopFeatureEnabled(capabilities.data, "settings");
	const plane: DisplayPlane =
		capabilities.data !== undefined
			? advertised
				? "available"
				: "denied"
			: capabilities.isError
				? "failed"
				: "unknown";
	const settingsQuery = useQuery({
		...backendSettingsQueryOptions(),
		enabled: advertised,
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
	/*
	 * A `status === "pending"` read is the whole "still owed" fact, and it is
	 * deliberately NOT `fetchStatus`: a v5 retry dispatches its failure without
	 * touching `fetchStatus`, so the narrower term went false between attempts and
	 * the hold would have ended and re-armed inside one read (agent review round 1,
	 * R1's own citation). `pending` covers the disabled query too (a plane that has
	 * not answered yet), which is the state R2 asks for.
	 *
	 * `failureCount === 0` IS PART OF IT, and it is what makes a FAILING read stop
	 * holding. React-query retries inside the same `pending` status, so a read that
	 * throws on the first attempt keeps `status: "pending"` for the retry delay and
	 * the hold would have blanked the transcript for ~1 s (the review's own P6:
	 * blank samples from +116 ms to +886 ms). A read that has already failed is not
	 * an answer that is still coming; the seed's reading paints, and a later
	 * attempt that succeeds still replaces it.
	 */
	const owed =
		plane !== "denied" &&
		plane !== "failed" &&
		answer === undefined &&
		settingsQuery.status === "pending" &&
		settingsQuery.failureCount === 0;
	const [holdSpent, setHoldSpent] = useState(false);
	useEffect(() => {
		if (holdSpent || !owed || seed !== true) return;
		/*
		 * `window.setTimeout`, not the bare global: the renderer's own timer, and the
		 * one the rigs that stub window timers (the load-sequence rig does, so its
		 * deadline and poll timers never fire) can therefore hold still for a
		 * deterministic arm.
		 */
		const timer = window.setTimeout(
			() => setHoldSpent(true),
			DISPLAY_HOLD_BUDGET_MS,
		);
		return () => window.clearTimeout(timer);
	}, [holdSpent, owed, seed]);
	return {
		reading: displayFlagReading({ answer, seed, plane, owed, holdSpent }),
		seed,
		plane,
	};
}
