/**
 * The one place a draft's `@` tokens are asked about, so the chip's decoration
 * and the composer's atomic delete cannot disagree about which spans resolve.
 *
 * WHY IT IS A HOOK RATHER THAN A PROBE PER CALLER. Two surfaces read the answer —
 * the chip layer, which paints a fill behind every resolving token, and the
 * composer's key handler, which takes a whole token on one Backspace at its edge
 * — and a second probe would be a second request per keystroke on the composer's
 * own keystroke path, with two answers that can differ by the width of a round
 * trip. One owner, one answer.
 *
 * RESOLUTION IS THE MAIN PROCESS'S (`probe-files`), never re-implemented here:
 * that call already resolves symlinks with `statSync` and already applies the one
 * path rule including `~` and cwd-relative joining, so the chip and the batch the
 * harness builds on submit cannot disagree about which file `@src/app.py` names.
 *
 * WHAT THE ANSWER CARRIES, and the one thing it deliberately does not:
 *
 *   - `exists` is what makes a token a chip, and `isFile` distinguishes a file
 *     from a directory — both facts the probe already answered for the Files
 *     panel.
 *   - `outsideWorkspace` is the containment verdict, computed in main against the
 *     same resolved paths the harness's approval gate compares
 *     (`directory-listing.ts`). It exists because the chip states ONE thing its
 *     absence cannot: this reference will ask for approval. What it does NOT
 *     cover is the harness's deny-list (`.env`, `.pem`, `.ssh/…`), which is
 *     backend state in the module that owns it and therefore not something this
 *     process may re-spell — a `.env` inside the workspace chips plainly and
 *     raises its card at submit, which is the honest half of the trade the design
 *     direction names.
 *     THE GAP IS REACHABLE WITH THE MOUSE, not only by typing a deny-listed path:
 *     the picker's exclusions are dotfiles and `PRUNE_NAMES`, which is the
 *     harness's LISTING vocabulary rather than its gate — `id_rsa`,
 *     `credentials`, `server.pem` and `prod.env` are offered as ordinary rows, and
 *     accepting one writes a plain chip over a path whose `read` raises a
 *     "may hold secrets" card (review round 1, N1). Stated here because a
 *     disclosure that describes the gap as a typing-only case understates it.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_PROBE_PATHS } from "../../../../../shared/desktop-contract";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import {
	type AtResolved,
	atChipSpans,
	atProjectName,
} from "../components/at-contract";
import { type AtSpan, atTokenSpans } from "../components/at-token";

/**
 * How long a draft may keep changing before the batch is asked.
 *
 * Longer than the picker's listing debounce because this probe runs on EVERY
 * keystroke of a draft that holds a token, including the many that only extend a
 * path which cannot resolve yet — the common case here is a miss, and a miss is
 * what the debounce collapses.
 */
export const AT_RESOLVE_DEBOUNCE_MS = 120;

/** The probe bridge, as this module uses it. Absent outside Electron. */
type ProbeBridge = {
	probeFiles: (
		paths: string[],
		cwd?: string,
	) => Promise<
		{
			input: string;
			exists: boolean;
			isFile: boolean;
			outsideWorkspace?: boolean;
		}[]
	>;
};

export type AtResolution = {
	/** Every candidate token in the draft, in order. */
	spans: AtSpan[];
	/** The spans that are chips, keyed by their `start:end`. */
	resolved: ReadonlyMap<string, AtResolved>;
};

export function useAtResolution({
	text,
	cwd,
	enabled = false,
}: {
	text: string;
	cwd?: string;
	/**
	 * Whether a mention expands at all — see `UseAtPickerArgs.enabled` for the two
	 * states this folds and why it fails closed. FALSE HERE MEANS NO SPANS: no
	 * probe is issued, no fill is painted AND the atomic delete is inert, because
	 * the delete asks this hook which tokens are chips.
	 *
	 * A CHIP ALREADY IN THE BOX WITHDRAWS WHEN THE TURN STARTS, and that is the
	 * intended half of the same rule rather than an oversight (UX round 2, U14).
	 * The flag's two false states are not alike here: while a turn is in flight the
	 * next Enter is a STEER, the steer path bypasses `Session.prompt`, and an
	 * `@path` in one is inert prose the harness never expands — so the fill would be
	 * asserting an expansion that will not happen, which is the exact claim this
	 * gate exists to refuse, and a fill is not less of a claim because the user
	 * typed the token a second earlier. Two consequences follow from the same
	 * expression and both are the honest reading: the fill goes, and the atomic
	 * Backspace stops taking the whole token, because the text IS prose for the
	 * length of that turn. What does NOT change is the user's sentence — not one
	 * character of the draft is touched, and the fill reappears, measured from the
	 * same text, when the turn ends. The alternative (keep painting the spans the box
	 * last had) would leave a chip on screen claiming a reference the model will not
	 * receive, which is the one thing this whole feature refuses to do.
	 */
	enabled?: boolean;
}): AtResolution {
	const spans = useMemo(
		() => (enabled ? atTokenSpans(text) : []),
		[text, enabled],
	);

	/*
	 * The cache, keyed by the path as typed, holding only POSITIVE answers.
	 *
	 * Negatives are deliberately not cached: a partial path misses on every
	 * keystroke, and caching those would be the cheap win — but it would also keep
	 * a file the user just created from ever chipping, because nothing about the
	 * draft would change to invalidate the entry. So a hit is remembered (a
	 * resolved path stays resolved for this composer's lifetime, which is what
	 * makes the atomic delete's answer cheap and stable) and a miss is asked again
	 * on the next pass, at one batched request per debounce.
	 */
	const cache = useRef(
		new Map<string, { exists: boolean; outside: boolean }>(),
	);
	const cacheCwd = useRef<string | undefined>(cwd);
	const [facts, setFacts] = useState<
		ReadonlyMap<string, { exists: boolean; outside: boolean }>
	>(new Map());

	/*
	 * THE PROJECT ARM (UX round 1, U1). A `project:` token's fact is not a path
	 * fact — `probe-files` answers "no such file" for every one of them, so an
	 * accepted project reference painted no chip and read as a typo in the one
	 * language this composer has for "this reference resolves" — and it is not
	 * this process's to invent either: the backend's classifier resolves
	 * `@project:<name>` when a project of that name EXISTS, which is the fact
	 * the store is asked for here, from the same `projects.list` op the picker
	 * speaks.
	 *
	 * TWO THINGS THE STORE'S OWN RULE SETS. Names are matched
	 * case-insensitively, because that is the store's uniqueness rule and what
	 * the backend's `_project_for_query` matches on — a chip that only matched
	 * the exact spelling would under-claim a reference the backend resolves.
	 * And a miss is never cached, the same rule the file probe states below: a
	 * project created while the composer is open must chip on the next pass
	 * rather than never.
	 *
	 * THE CAPABILITY GATES THE REQUEST, not the paint: on a backend below the
	 * version no `projects.list` is dialled at all, and a `project:` token is
	 * what it was before this arm existed — prose unless a file happens to
	 * share the name, which is the fallback the classifier itself documents.
	 */
	const capabilities = useDesktopCapabilities();
	const projectsEnabled = desktopFeatureEnabled(
		capabilities.data,
		"projects",
		1,
	);
	/** The names (lowercased) the store answered with; a miss is re-asked. */
	const projectNames = useRef(new Set<string>());

	/*
	 * The batch, sorted and de-duplicated so an identical draft is an identical
	 * request, and capped at the probe's own per-call limit (`MAX_PROBE_PATHS`).
	 * Past the cap the excess is left UNDECORATED rather than chunked: the harness
	 * itself refuses more than about 215 uniform tokens, so a draft over 64
	 * resolvable references is already outside what expansion will carry, and
	 * decorating the first 64 while saying nothing about the rest is the honest
	 * half-measure rather than a silent second request storm.
	 */
	const paths = useMemo(() => {
		const unique = new Set<string>();
		for (const span of spans) {
			if (span.path) unique.add(span.path);
			if (unique.size >= MAX_PROBE_PATHS) break;
		}
		return [...unique];
	}, [spans]);
	const pathsKey = paths.join("\n");

	/*
	 * The draft's project references, by lowercased NAME — the same fact the
	 * store's own lookups use. Derived from `paths`, so `pathsKey` is still the
	 * effect's one identity for "the draft's reference set changed".
	 */
	const wantedProjects = useMemo(() => {
		const names = new Set<string>();
		for (const path of paths) {
			const name = atProjectName(path);
			if (name) names.add(name.toLowerCase());
		}
		return [...names];
	}, [paths]);

	/*
	 * The facts `atChipSpans` reads, assembled from both halves: the file
	 * probe's positive answers, and a project reference whose name the store
	 * answered for. Keyed by the path AS TYPED (`project:Docs-Sweep` and
	 * `project:docs-sweep` are two spans over one project).
	 */
	const buildFacts = () => {
		const merged = new Map(cache.current);
		if (projectNames.current.size === 0) return merged;
		for (const path of paths) {
			const name = atProjectName(path);
			if (name && projectNames.current.has(name.toLowerCase())) {
				merged.set(path, { exists: true, outside: false });
			}
		}
		return merged;
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: the request is keyed by `pathsKey`, the batch's own identity (`wantedProjects` rides it), and `projectsEnabled` because the project arm may only dial the store once the capability says the surface exists; `paths`/`wantedProjects` are arrays rebuilt every render and listing them would re-run the request with nothing changed.
	useEffect(() => {
		const api = (window as unknown as { api?: Partial<ProbeBridge> }).api;
		/*
		 * A MOVED WORKING DIRECTORY INVALIDATES EVERY ANSWER IN THE CACHE
		 * (review round 1, M1).
		 *
		 * The answers are RELATIVE — `@src/app.py` is a different file under a
		 * different cwd — and the composer is not remounted when the session's
		 * directory moves (`chat-content.tsx` passes no `key`; `cwd` arrives as a
		 * prop), so the ref survived the move and the effect's `missing.length === 0`
		 * short-circuit re-set the OLD map without ever asking again. Reproduced:
		 * a draft whose file exists under `/A` kept its chip after the session moved
		 * to `/B`, where the path does not exist — the chip outliving the file it
		 * names, which is the one thing the design's rule ("the chip <=> the token
		 * resolves") exists to make impossible. The stale `outside` verdict travelled
		 * with it, so a chip could be plain over a path the gate would card.
		 *
		 * Cleared rather than keyed: the cache exists to make a RE-ASK cheap inside
		 * one workspace, and a keyed map would keep every workspace's answers alive
		 * in a composer that has one cwd at a time. The facts are cleared with it
		 * because they are the same answers one render later — leaving them would
		 * paint the moved workspace from the old one for the debounce window.
		 */
		if (cacheCwd.current !== cwd) {
			cacheCwd.current = cwd;
			cache.current.clear();
			/* Project answers are not relative to the working directory, so they
			 * survive the move; only the file half is invalidated. */
			setFacts(buildFacts());
		}
		if (!enabled || paths.length === 0) {
			/* Nothing in this draft is a reference — or the turn in flight made
			 * every token prose — so no fill may paint and an answered map is
			 * dropped rather than kept one state longer than its claim. */
			setFacts((current) => (current.size > 0 ? new Map() : current));
			return;
		}
		if (typeof api?.probeFiles !== "function" && wantedProjects.length === 0) {
			// No bridge for files and no project reference to ask the store
			// about: nothing this pass can learn, so the answers already
			// painted stand (and a project hit stays a chip).
			setFacts((current) => (current.size > 0 ? buildFacts() : current));
			return;
		}
		const missing = paths.filter((path) => !cache.current.has(path));
		const unknownProjects = projectsEnabled
			? wantedProjects.filter((name) => !projectNames.current.has(name))
			: [];
		if (missing.length === 0 && unknownProjects.length === 0) {
			// Every reference in this draft has been answered before, so the pass costs
			// one render and no request: the common case on the keystroke path once a
			// mention has been typed and the user is editing around it.
			setFacts(buildFacts());
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			const fileArm =
				missing.length > 0 && typeof api?.probeFiles === "function"
					? api
							.probeFiles(missing, cwd)
							.then((answers) => {
								if (cancelled) return;
								for (const answer of answers) {
									if (!answer.exists) continue;
									cache.current.set(answer.input, {
										exists: true,
										// `outsideWorkspace` is absent when main could not ask (no
										// workspace root), and an unanswerable question is NOT "outside":
										// a chip painted for it would warn about a path the gate may
										// never ask about. The card at submit is unaffected either way.
										outside: answer.outsideWorkspace === true,
									});
								}
							})
							.catch(() => {
								// A probe that failed says nothing about whether the path exists, so
								// the decoration simply does not change. Losing the previous fills
								// because a stat call threw would be the worse failure.
							})
					: Promise.resolve();
			const projectArm =
				unknownProjects.length > 0
					? desktopResult<{ projects: DesktopProject[] }>({
							op: "projects.list",
						})
							.then((result) => {
								if (cancelled) return;
								for (const project of result.projects) {
									const name = project.name.toLowerCase();
									if (unknownProjects.includes(name)) {
										projectNames.current.add(name);
									}
								}
							})
							.catch(() => {
								// A store that did not answer says nothing about whether the
								// project exists — the same rule the file probe states above, and
								// the raw reason is the picker's to log on its own arm.
							})
					: Promise.resolve();
			void Promise.allSettled([fileArm, projectArm]).then(() => {
				if (cancelled) return;
				setFacts(buildFacts());
			});
		}, AT_RESOLVE_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [pathsKey, cwd, projectsEnabled]);

	const resolved = useMemo(() => atChipSpans(spans, facts), [spans, facts]);
	return { spans, resolved };
}
