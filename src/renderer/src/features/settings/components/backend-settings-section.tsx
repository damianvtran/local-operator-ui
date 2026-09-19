/**
 * The full backend settings registry as searchable, typed editors.
 *
 * One destination for every registered key: a top filter bar, then the sections
 * in the registry's own order (which is a stated priority claim,
 * `settings_io.py:281-288`), each carrying its scope once and holding rows that
 * state themselves instead of repeating their scope.
 *
 * The orchestrator owns everything the rows must agree about, and that is the
 * point of this rewrite:
 *
 * - THE TIER. The registry is 102 keys in 19 sections and every one of them used
 *   to ship expanded, which measured 10,896px of region (12.1 screens at
 *   1380x900, on the 99-key registry this rewrite was measured against) before a
 *   reader had done anything. `tierFor` decides which keys a
 *   reader meets on arrival and which sit one click away, and nothing is hidden
 *   at any tier: the `approvals` section is within the core list, every
 *   `warning` clause renders on its row at whatever tier that row occupies,
 *   search reaches every key at every tier, and the AI cannot gate a write.
 * - THE DRAFTS. A draft lives here, not in the row, for three reasons that are
 *   all the same reason: the page has to be able to count unsaved changes, save
 *   them all, and survive a section being collapsed — none of which a row-local
 *   `useState` can do, because collapsing unmounts the row. The save MODEL is
 *   untouched (draft plus an explicit Save, per kind).
 * - THE OPEN STATE, including the two ways it is forced: a search force-opens
 *   the sections it lands in (it used to be able to hide its own matches behind a
 *   closed header and say nothing), and a `?setting=` deep link opens the
 *   section AND the tier its target lives in before it focuses it.
 */

import {
	BACKEND_PAIRING_SENTENCE,
	backendLoadErrorMessage,
} from "@shared/api/local-operator/backend-error";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button } from "@shared/components/ui";
import { useQuery } from "@tanstack/react-query";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DaemonPairingCause } from "../../../../../shared/backend-status";
import { pairingHasRemedy } from "../../../../../shared/backend-status";
import {
	type SettingTier,
	allOpenTargets,
	opensOnArrival,
	tierFor,
} from "../backend-settings-tiers";
import { BackendSettingRow, type SettingGate } from "./backend-setting-row";
import {
	type SettingDraft,
	draftFromSetting,
	editOutcome,
	isDraftDirty,
} from "./backend-settings-drafts";
import { SettingsFilterBar } from "./settings-filter-bar";
import { SettingsGroupHeader } from "./settings-group-header";

export const backendSettingsKeys = {
	all: ["desktop", "settings"] as const,
};

/** Human-readable scope tags. The backend emits enum values; the words on the
 * header answer "when does this take effect", not "what enum is it". */
/*
 * Keyed on what the backend ACTUALLY emits (`Scope` in `settings_io.py`
 * serializes to spaced lowercase), not on the enum's Python member names. The
 * previous map used `new_launch` / `restart`, which matched nothing, so two of
 * three badges fell through to the raw value and printed a bare "new sessions"
 * beside a sentence-case "Takes effect immediately" (design D3).
 */
const SCOPE_LABELS: Record<string, string> = {
	live: "Takes effect immediately",
	"new launch": "Takes effect the next time the app starts",
	"new sessions": "Takes effect for new conversations",
};

type BackendSettingsSectionProps = {
	/** Key to reveal and focus, from a /settings navigation target. */
	focusKey?: string | null;
	/** Initial search filter, e.g. "web-search" from /search. */
	initialFilter?: string;
};

/**
 * How many animation frames a reveal-and-focus waits for its row to exist.
 *
 * A deep link has to open a tier and a section before the row is in the DOM, and
 * how many frames that takes is a property of what else is on the page. A
 * deadline is the honest bound: it either finds the row or gives up and leaves
 * the reader where the state actually put them, rather than scrolling to a
 * position that was measured before the layout settled.
 */
const FOCUS_ATTEMPTS = 40;

/** Fold the two separators the registry and its callers disagree about. */
/*
 * Registry keys use underscores (`web_search.enabled`) while the words around
 * them are written with hyphens, so `/search`'s own deep link ("web-search")
 * matched 0 of 73 settings and the section rendered its empty state (UX U4).
 * Folding both separators to one made the two spellings the same search, for
 * the deep link and for anyone typing; the DOT is folded for the other half of
 * the same defect — a reader who names a setting they can see on screen
 * (`session.cleanup.max_sessions`) got "No settings match this search." for
 * `cleanup max`, because 43 of the 102 keys are dotted and the section's own
 * words became unreachable once they crossed one. A sentence is worth reading;
 * a key is worth being able to find.
 */
const fold = (value: string) => value.toLowerCase().replace(/[-_.]/g, " ");

/**
 * Main's pairing cause, read from the BRIDGE the app already has.
 *
 * WHY NOT `useServerHealth()` (measured): that hook's module chain reaches
 * `shared/config/app-config.ts`, which reads `import.meta.env` at module scope -
 * Vite defines it in the app and nothing defines it under esbuild, so importing
 * the hook failed `scripts/backend-settings-collapse.test.mjs` at MODULE LOAD with
 * "Cannot convert undefined or null to object" before a single render. The status
 * this surface needs is one bridge call, and reading it here keeps the Settings
 * bundle's dependencies the ones it already had. A bridge that is absent (a
 * browser-dev renderer) leaves the cause null, which is exactly the previous
 * behaviour: the composed load-error sentence.
 */
function usePairingCause(): DaemonPairingCause | null {
	const [cause, setCause] = useState<DaemonPairingCause | null>(null);
	useEffect(() => {
		const backend = window.api?.backend;
		if (!backend?.getStatus) return;
		let live = true;
		const read = async () => {
			try {
				const status = await backend.getStatus();
				if (!live) return;
				const pairing = status?.pairing;
				setCause(
					pairing && !pairing.available ? (pairing.cause ?? "unpaired") : null,
				);
			} catch {
				// A status read that fails says nothing about pairing, and a surface
				// may not invent a cause it was not given.
			}
		};
		void read();
		const off = backend.onStatusChange?.(() => void read());
		return () => {
			live = false;
			off?.();
		};
	}, []);
	return cause;
}

export const BackendSettingsSection: FC<BackendSettingsSectionProps> = ({
	focusKey,
	initialFilter = "",
}) => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");
	const [filter, setFilter] = useState(initialFilter);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [modifiedOnly, setModifiedOnly] = useState(false);
	const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});
	const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
	const [errors, setErrors] = useState<Record<string, string | null>>({});
	const [savingAll, setSavingAll] = useState(false);
	/** Sections the reader opened or closed themselves, over the arrival layout. */
	const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
	const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
	/**
	 * Sections the reader closed in the FILTERED view: the same question, asked
	 * about a different list.
	 *
	 * A search force-opens the sections it matched, which is the fix for the old
	 * blocker (a collapsed section used to hide its own matches) and has to stay:
	 * the reader's pre-search collapse is a choice about the full list, and a query
	 * is a request to see what matched. But a click on a header WHILE that query is
	 * live has to do something honest — the trigger used to flip its `aria-expanded`
	 * and chevron while every matched row stayed on screen, and the click was
	 * deferred rather than dropped, so clearing the search then collapsed a section
	 * the reader never collapsed in the unfiltered view (UX round 1, U1).
	 *
	 * Two sets, because the two gestures are not the same gesture: this one is the
	 * search's, it is cleared when the search is, and it therefore cannot leak into
	 * the reader's own layout. Collapsing here hides the rows immediately; clearing
	 * the search puts the pre-search layout back, which is what the already-verified
	 * `search-restores-user-layout` requires.
	 */
	const [filterClosed, setFilterClosed] = useState<ReadonlySet<string>>(
		new Set(),
	);
	/**
	 * The last `?setting=` value that has been revealed.
	 *
	 * A ref holding the last HANDLED KEY rather than a one-shot boolean: the
	 * boolean made a second deep link in one mount a dead no-op (the flag was
	 * already true), so every palette row click after the first left the reader
	 * looking at the section with the target off screen and nothing moving.
	 */
	const handledFocusKey = useRef<string | null>(null);
	/**
	 * The last `?setting=` value whose row has actually been REACHED.
	 *
	 * Separate from `handledFocusKey` because the two answer different questions:
	 * "has this navigation been actioned?" and "has the reader's cursor arrived?".
	 * Collapsing them is what broke the filtered deep link (UX round 1, U2).
	 */
	const revealedFocusKey = useRef<string | null>(null);

	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled,
		staleTime: 10_000,
	});

	const settings = settingsQuery.data;

	/**
	 * Seed drafts from the server, and re-seed a draft that is no longer dirty.
	 *
	 * The asymmetry is the whole contract: a refetch must never overwrite what
	 * the reader typed (which is what makes a draft survive a failed save and a
	 * background refetch), but a draft that already equals the server's value is
	 * not an edit and has to follow the server — otherwise a successful save
	 * would leave the row reading as unsaved forever.
	 */
	useEffect(() => {
		if (!settings) return;
		setDrafts((current) => {
			let changed = false;
			const next = { ...current };
			for (const setting of settings.settings) {
				const existing = current[setting.key];
				if (!existing) {
					next[setting.key] = draftFromSetting(setting);
					changed = true;
					continue;
				}
				if (isDraftDirty(setting, existing)) continue;
				const seeded = draftFromSetting(setting);
				if (
					seeded.value !== existing.value ||
					seeded.cascadeBase !== existing.cascadeBase
				) {
					next[setting.key] = seeded;
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}, [settings]);

	const isModified = useCallback(
		(setting: BackendSetting) =>
			!setting.is_default ||
			isDraftDirty(setting, drafts[setting.key] ?? draftFromSetting(setting)),
		[drafts],
	);

	/**
	 * The `hosting` this page will boot on, which is the value the model rows
	 * narrow their list by.
	 *
	 * DRAFT-AWARE on purpose, including while the draft is unsaved: the two keys
	 * are read independently at boot, so a model picked against the stored
	 * hosting and then saved beside an edited hosting names a model the new
	 * provider does not own. The draft's value is the same string shape the model
	 * builder compares against `provider`, which is why `draftFromSetting` is the
	 * one converter used here rather than a second serialization.
	 *
	 * An empty string means the user cleared the row to unsaved, and the builder
	 * treats that as "unknown hosting" and widens to the whole catalogue rather
	 * than narrowing to nothing.
	 */
	const effectiveHosting = useMemo(() => {
		const hosting = (settings?.settings ?? []).find(
			(setting) => setting.key === "hosting",
		);
		if (!hosting) return "";
		return (drafts.hosting ?? draftFromSetting(hosting)).value;
	}, [settings, drafts]);

	/**
	 * The rows the current filter, tier and chips admit.
	 *
	 * THE TIER APPLIES ONLY TO THE UNFILTERED LIST. A search reaches every key at
	 * every tier, and so does `Modified` — both of those ask a question about the
	 * whole registry, and answering it with "no settings match" while eight keys
	 * match is the defect this surface shipped with (a search that can hide its
	 * own matches behind a collapsed header, one tier down). The tier is a view of
	 * the list, never a gate on a question: it shapes what a reader browses, and
	 * the moment they name something, they get it.
	 */
	const matching = useMemo(() => {
		if (!settings) return [];
		const needle = fold(filter.trim());
		const asking = needle.length > 0 || modifiedOnly;
		return settings.settings.filter((setting) => {
			if (!asking && tierFor(setting) === "advanced" && !showAdvanced) {
				return false;
			}
			if (modifiedOnly && !isModified(setting)) return false;
			if (!needle) return true;
			return fold(
				[
					setting.label,
					setting.help,
					setting.key,
					setting.section,
					setting.warning ?? "",
				].join(" "),
			).includes(needle);
		});
	}, [settings, filter, showAdvanced, modifiedOnly, isModified]);

	const filtering = filter.trim().length > 0 || modifiedOnly;

	/**
	 * The sections that are open, and how each one got there.
	 *
	 * A filter SUSPENDS the reader's own choices and force-opens what it landed
	 * in; clearing it restores the reader's own layout rather than "everything
	 * open", so the two sets are not reset on a filter change at all — they persist
	 * across a search, which is what makes a collapse survive one.
	 */
	const sections = useMemo(() => settings?.sections ?? [], [settings]);
	const rowsForSection = useCallback(
		(name: string) =>
			(settings?.settings ?? []).filter((s) => s.section === name),
		[settings],
	);
	const matchingForSection = (name: string) =>
		matching.filter((setting) => setting.section === name);

	/**
	 * The open state of one section: the reader's choice, or the filter's.
	 *
	 * A filter SUSPENDS the reader's own choices and force-opens what it landed in;
	 * clearing it restores the reader's OWN layout rather than "everything open" —
	 * so `opened`/`closed` are not reset on a filter change at all, which is what
	 * makes a collapse survive a search. The only thing a filter adds is its own
	 * `filterClosed` set (see above).
	 */
	const isOpen = (name: string) =>
		opened.has(name)
			? true
			: closed.has(name)
				? false
				: opensOnArrival(rowsForSection(name));

	/**
	 * Record a header click in the UNFILTERED list: the reader's own layout.
	 *
	 * While a filter is up the click is the filter's business instead, and is
	 * routed to `filterClosed` at the call site — it must not write these sets,
	 * because that is how a search came to rewrite the reader's layout behind
	 * their back (UX round 1, U1: the click was recorded while all the matched rows
	 * stayed on screen, and clearing the search then collapsed a section the reader
	 * never collapsed in the unfiltered view).
	 */
	const setOpen = (name: string, open: boolean) => {
		setOpened((current) => {
			const next = new Set(current);
			if (open) next.add(name);
			else next.delete(name);
			return next;
		});
		setClosed((current) => {
			const next = new Set(current);
			if (open) next.delete(name);
			else next.add(name);
			return next;
		});
	};

	/**
	 * Record a header click in the FILTERED list, which is a different question.
	 *
	 * The collapse takes effect on this render — the chevron, `aria-expanded` and
	 * the rows agree — and it lasts exactly as long as the search does.
	 */
	const setFilteredOpen = (name: string, open: boolean) => {
		setFilterClosed((current) => {
			const next = new Set(current);
			if (open) next.delete(name);
			else next.add(name);
			return next;
		});
	};

	const setAllOpen = (open: boolean) => {
		const names = sections
			.filter((section) => open || matchingForSection(section.name).length > 0)
			.map((section) => section.name);
		/*
		 * Which of the two sets this press moves — and which it must keep out of —
		 * depends on what is on screen. `allOpenTargets` carries the reasoning and
		 * the two defects that conflating them caused (UX round 2, U13/U14; QA
		 * round 2, Q8).
		 */
		const targets = allOpenTargets(open, filtering, names);
		if (targets.layout) {
			setOpened(new Set(targets.layout.opened));
			setClosed(new Set(targets.layout.closed));
		}
		setFilterClosed(new Set(targets.filter));
	};

	// The filter's own collapse state is the filter's: it goes when the filter
	// does. Deliberately not on every keystroke — a reader who pushes a noisy match
	// group aside and then refines the SAME query should not have it spring back.
	useEffect(() => {
		if (!filter.trim()) setFilterClosed(new Set());
	}, [filter]);

	/** The gate for a row, when the wire says one exists. */
	const gateFor = useCallback(
		(setting: BackendSetting): SettingGate | null => {
			const key = setting.gated_by;
			if (!key || !settings) return null;
			const gate = settings.settings.find((row) => row.key === key);
			return {
				key,
				label: gate?.label ?? key,
				// The gate is the SERVER's value: a switch that has been flipped but
				// not saved has not enabled anything yet.
				on: gate?.value === true || gate?.value === "true",
			};
		},
		[settings],
	);

	const markSaving = useCallback(
		(key: string, value: boolean) =>
			setSavingKeys((current) => ({ ...current, [key]: value })),
		[],
	);
	const setError = useCallback(
		(key: string, message: string | null) =>
			setErrors((current) => ({ ...current, [key]: message })),
		[],
	);

	/**
	 * Write one row's draft, and re-seed it from the server that has just accepted it.
	 *
	 * The re-seed is the save path's half of a contract `resetRow` already keeps,
	 * and without it the row LIES about a write that landed: `isDraftDirty`
	 * returns true unconditionally while `cascadeBase !== null` (a chain edit has
	 * no comparable server value until it is submitted), so a cascade draft stayed
	 * dirty forever — the row kept its `Save`, `Use default` and changed dot, the
	 * page kept saying "1 unsaved change", `Save all` re-submitted the same write,
	 * and the only way to clear the false state was `Use default`, which discards
	 * the edit that had already been saved (review round 1, M1; QA round 1, Q3,
	 * reproduced end to end against a real backend).
	 *
	 * The refetch stays the authority for the VALUE; this only puts the draft back
	 * in agreement with it. A draft the reader changed while the write was in
	 * flight is left alone — the row is disabled while `saving`, but the refetch
	 * outlives that flag, so the comparison is what makes this safe rather than
	 * the timing.
	 */
	const saveRow = useCallback(
		async (setting: BackendSetting) => {
			const draft = drafts[setting.key];
			if (!draft) return false;
			const outcome = editOutcome(setting, draft);
			if (!outcome.ok) {
				setError(setting.key, outcome.error);
				return false;
			}
			markSaving(setting.key, true);
			setError(setting.key, null);
			try {
				await desktopResult(outcome.request);
				markSaving(setting.key, false);
				const refreshed = await settingsQuery.refetch();
				const fresh = refreshed.data?.settings.find(
					(candidate) => candidate.key === setting.key,
				);
				if (fresh) {
					setDrafts((current) => {
						const live = current[setting.key];
						const untouched =
							live &&
							live.value === draft.value &&
							live.cascadeBase === draft.cascadeBase;
						if (!untouched) return current;
						return { ...current, [setting.key]: draftFromSetting(fresh) };
					});
				}
				return true;
			} catch (error) {
				markSaving(setting.key, false);
				setError(
					setting.key,
					error instanceof Error
						? error.message
						: "The setting could not be saved.",
				);
				return false;
			}
		},
		[drafts, settingsQuery, markSaving, setError],
	);

	/**
	 * Put a row back to the registry's default.
	 *
	 * The draft is re-seeded from the default as part of the same interaction:
	 * `Use default` used to write immediately while the row kept showing the
	 * reader's draft, so the row and the server disagreed on screen with nothing
	 * admitting it.
	 */
	const resetRow = useCallback(
		async (setting: BackendSetting) => {
			markSaving(setting.key, true);
			setError(setting.key, null);
			try {
				await desktopResult({ op: "settings.reset", key: setting.key });
				setDrafts((current) => ({
					...current,
					[setting.key]: draftFromSetting({
						...setting,
						value: setting.default,
						is_default: true,
					}),
				}));
				markSaving(setting.key, false);
				await settingsQuery.refetch();
			} catch (error) {
				markSaving(setting.key, false);
				setError(
					setting.key,
					error instanceof Error
						? error.message
						: "The setting could not be reset.",
				);
			}
		},
		[settingsQuery, markSaving, setError],
	);

	const dirtySettings = useMemo(
		() =>
			(settings?.settings ?? []).filter((setting) =>
				isDraftDirty(setting, drafts[setting.key] ?? draftFromSetting(setting)),
			),
		[settings, drafts],
	);

	const saveAll = async () => {
		setSavingAll(true);
		for (const setting of dirtySettings) {
			// Sequential on purpose: these are writes to one YAML file behind one
			// lock, and firing 14 of them at once is how a merge conflict becomes
			// an intermittent failure instead of a slow success.
			await saveRow(setting);
		}
		setSavingAll(false);
	};

	const discardAll = () => {
		if (!settings) return;
		setDrafts((current) => {
			const next = { ...current };
			for (const setting of settings.settings) {
				next[setting.key] = draftFromSetting(setting);
			}
			return next;
		});
		setErrors({});
	};

	/**
	 * A /settings navigation target reveals its section AND its tier.
	 *
	 * The order is the contract: the row does not exist in the DOM until the
	 * section is open, and an advanced key's row does not exist until the tier is
	 * shown either. Doing it the other way round is how a deep link "succeeds"
	 * while leaving the reader looking at a closed header.
	 *
	 * This effect owns the NAVIGATION only. Focusing is a second effect below, and
	 * the split is the fix for a defect this one carried: it also held the reveal
	 * loop, and its dependency list includes `filter` — which it clears itself
	 * when the destination does not match the active query. `setFilter("")`
	 * re-runs the effect, React runs the cleanup first, and the cleanup cancelled
	 * the pending reveal before the row could exist; the re-run then returned early
	 * on `handledFocusKey` and nothing else ever tried. So the ONE case the
	 * comment below promises to handle — a deep link that has to clear a search —
	 * was the case that did nothing at all: the field cleared, 0px moved, focus
	 * stayed in the search box (UX round 1, U2).
	 */
	useEffect(() => {
		if (!focusKey || !settings) return;
		if (handledFocusKey.current === focusKey) return;
		const target = settings.settings.find((s) => s.key === focusKey);
		if (!target) return;
		handledFocusKey.current = focusKey;

		if (tierFor(target) === "advanced") setShowAdvanced(true);
		// A filter that the destination does not match would leave the row
		// unmounted, so the deep link wins over it: the navigation named a key,
		// and a key that cannot be seen is not a destination.
		const needle = fold(filter.trim());
		const matchesQuery =
			!needle ||
			fold(
				[target.label, target.help, target.key, target.section].join(" "),
			).includes(needle);
		if (!matchesQuery) setFilter("");
		setModifiedOnly(false);
		setOpened((current) => new Set(current).add(target.section));
		setClosed((current) => {
			const next = new Set(current);
			next.delete(target.section);
			return next;
		});
	}, [focusKey, settings, filter]);

	/**
	 * Whether the deep link's destination is actually on screen yet.
	 *
	 * The reveal loop is waiting for a row to EXIST, and a row exists only when
	 * three things agree: the registry has the key, the filter admits it, and — if
	 * it is an advanced key — the tier is showing. Expressing that as one derived
	 * value is what replaced a retry loop keyed on frame counts, and it is also
	 * what makes the loop survive the navigation effect above clearing the filter:
	 * the earlier version keyed the loop on `filter` directly, so React ran its
	 * cleanup (cancelling the pending frame) the moment `setFilter("")`
	 * committed, and the re-run bailed on the already-handled key — leaving the one
	 * path the navigation effect exists to serve (`?setting=web_search.enabled`
	 * under a live search) doing nothing at all (UX round 1, U2).
	 */
	const destinationReady = useMemo(() => {
		if (!focusKey || !settings) return false;
		const target = settings.settings.find((s) => s.key === focusKey);
		if (!target) return false;
		if (tierFor(target) === "advanced" && !showAdvanced) return false;
		const needle = fold(filter.trim());
		if (!needle) return true;
		return fold(
			[target.label, target.help, target.key, target.section].join(" "),
		).includes(needle);
	}, [focusKey, settings, filter, showAdvanced]);

	/**
	 * Close the distance: focus the named row's control once it is on screen.
	 *
	 * Keyed on `destinationReady` rather than on the filter, so a filter-clearing
	 * re-run RESTARTS the loop instead of cancelling it with nothing left to try.
	 */
	useEffect(() => {
		if (!destinationReady || !focusKey) return;
		if (revealedFocusKey.current === focusKey) return;
		let frame = 0;
		let attempts = 0;
		const step = () => {
			const row = document.querySelector<HTMLElement>(
				`[data-setting-key="${CSS.escape(focusKey)}"]`,
			);
			// Scoped to the row's CONTROL SLOT. Unscoped, this selector matched the
			// row's `Use default`/`Save` buttons first — they precede the control in
			// document order — so an off-default row was focused on its reset button
			// rather than on its field (review round 1, n4).
			//
			// The ROW is the fallback for a destination that has no control to focus.
			// A retired or redacted row renders a bare `<span>` in that slot, so the
			// slot selector matched nothing, the loop burned every attempt, and —
			// because the scroll sits in the success branch — the named row was not
			// even scrolled to. That is exactly the population the `readonly` fix
			// created, and `buildSettingKeyItems` offers those keys in the palette
			// without a `kind` filter, so it is reachable in the shipped flow (review
			// round 2, M1). `tabIndex = -1` makes a non-interactive destination
			// focusable without adding it to the tab order.
			const el =
				row?.querySelector<HTMLElement>(
					`[data-setting-control] :is(input, textarea, select, button[role="switch"], button)`,
				) ?? row;
			if (el) {
				if (el === row) el.tabIndex = -1;
				el.focus();
				el.scrollIntoView({ block: "center" });
				revealedFocusKey.current = focusKey;
				return;
			}
			attempts += 1;
			if (attempts < FOCUS_ATTEMPTS) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [destinationReady, focusKey]);

	if (capabilities.data && !enabled) {
		return (
			<Alert variant="warning">
				Searchable settings need a newer Local Operator server. Update the
				server and restart the app to manage these settings here.
			</Alert>
		);
	}

	/*
	 * This query is `enabled` only once capabilities negotiate, and a DISABLED
	 * React Query reports `isLoading: false` with no data -- so while
	 * capabilities are still in flight, and permanently once they FAIL, this
	 * section fell through the loading gate into its error branch. It then
	 * rendered its own hand-written "the backend may need an update", the one
	 * remedy that cannot fix an unreachable or unauthenticated server, directly
	 * beneath a banner saying the opposite. Gating on the capabilities query
	 * too is what makes the states below mean what they say.
	 */
	if (settingsQuery.isLoading || capabilities.isLoading) {
		return (
			<div className="flex h-40 items-center justify-center">
				<Spinner size="lg" label="Loading settings" />
			</div>
		);
	}

	// Whichever query actually failed carries the status worth classifying:
	// capabilities failing is why this one never ran, so its error is the real
	// diagnosis rather than the absence of data it produced downstream.
	//
	// Only when it left NO data behind, though. React Query keeps `data` and
	// `error` set together after a failed refetch of a query that had already
	// succeeded, so a capabilities error is not by itself evidence that this
	// section has nothing to render. Treating it as fatal regardless replaced a
	// fully-loaded page with an error banner on any background refetch failure
	// -- reachable by alt-tabbing back after `staleTime` (60s) lapses.
	const loadError =
		(capabilities.data ? null : capabilities.error) ?? settingsQuery.error;
	if (loadError || !settings) {
		const retrying = capabilities.isFetching || settingsQuery.isFetching;
		/*
		 * WHAT THIS SURFACE MAY SAY, and what it may offer.
		 *
		 * WHY IT ASKS MAIN RATHER THAN COMPOSING ITS OWN SENTENCE (UX round 2 and 3,
		 * U2): with the app-managed remedy gone, this panel still printed "The Local
		 * Operator server is not answering." over a daemon that IS answering - the
		 * band two lines above names the true cause - and its Retry cannot change a
		 * plane another program governs or an install older than the handshake. So
		 * the sentence is the pairing table's for the cause main published, and the
		 * control is withheld where no act exists, by the same predicate the banner
		 * and the pane use.
		 */
		const pairingCause = usePairingCause();
		const pairingSentence = pairingCause
			? BACKEND_PAIRING_SENTENCE[pairingCause]
			: null;
		const remedy = pairingHasRemedy(pairingCause);
		return (
			<Alert variant="warning">
				<div className="flex items-center justify-between gap-3">
					{/* Same classifier, same remedy sentence as the compatibility banner
					    and the providers grid. Nothing about this surface makes its
					    diagnosis of the server different from theirs. */}
					<span>
						{pairingSentence ??
							backendLoadErrorMessage(
								"Your settings could not be loaded.",
								loadError,
							)}
					</span>
					{/* `isFetching` on both, because either query may be the one
					    in flight; an errored query keeps `status: "error"` through its
					    refetch, so without this the click changes nothing on screen. */}
					{remedy && (
						<Button
							variant="secondary"
							size="sm"
							className="shrink-0"
							onClick={() => {
								// Retry what actually broke. On the gated path capabilities are
								// the fault and the reason this query never ran, so re-asking
								// only the gated query would re-fail against the same unfixed
								// cause without ever retrying it.
								if (capabilities.isError) void capabilities.refetch();
								else void settingsQuery.refetch();
							}}
							disabled={retrying}
						>
							{retrying ? "Retrying" : "Retry"}
						</Button>
					)}
				</div>
			</Alert>
		);
	}

	const tierCounts = settings.settings.reduce(
		(counts, setting) => {
			counts[tierFor(setting)] += 1;
			return counts;
		},
		{ core: 0, advanced: 0 } as Record<SettingTier, number>,
	);

	const matchSections = new Set(matching.map((setting) => setting.section))
		.size;

	return (
		<div className="flex flex-col gap-4">
			<SettingsFilterBar
				query={filter}
				onQueryChange={setFilter}
				matchCount={filter.trim() ? matching.length : null}
				matchSections={matchSections}
				coreCount={tierCounts.core}
				advancedCount={tierCounts.advanced}
				modifiedCount={settings.settings.filter(isModified).length}
				modifiedOnly={modifiedOnly}
				onModifiedOnlyChange={setModifiedOnly}
				showAdvanced={showAdvanced}
				onShowAdvancedChange={setShowAdvanced}
				onExpandAll={() => setAllOpen(true)}
				onCollapseAll={() => setAllOpen(false)}
				unsavedCount={dirtySettings.length}
				savingAll={savingAll}
				onSaveAll={() => void saveAll()}
				onDiscardAll={discardAll}
			/>

			{filtering && matching.length === 0 && (
				// ONE statement, and it is the live region's. The centred pair this
				// replaces said the same thing twice — `0 results in 0 sections` under
				// the field AND this sentence with a `Clear search` button that carried
				// the same accessible name as the field's own ✕ — so the button went
				// with the duplicate (design round 1, D11). The sentence stays: it is
				// the only thing that speaks to a reader looking at the list rather
				// than at the bar, and it names the way out that is actually there.
				<div className="flex flex-col items-center py-6 text-center">
					<p className="text-body-sm text-ink-muted">
						No settings match this search. Clear the search field to see every
						setting again.
					</p>
				</div>
			)}

			<div className="flex flex-col gap-1">
				{/*
				 * Every section renders, in registry order, even the ones whose rows
				 * the tier filter is holding back: the index of 19 headers is the
				 * readable map of the registry, and a section that vanished when its
				 * rows were filtered would be a section the reader cannot find. A
				 * header whose rows are all advanced says how many it is holding.
				 *
				 * The gap between sections is 4px, one step of the ramp, and the reason
				 * is arithmetic rather than taste: at 16px, eighteen of them cost 288px
				 * of the arrival region's budget on their own, and a 40px header followed
				 * by its rows is already a clear break. An open section keeps 12px under
				 * its last row, so the next header does not crowd it.
				 */}
				{sections.map((section) => {
					const rows = matchingForSection(section.name);
					const allRows = rowsForSection(section.name);
					/*
					 * The advanced split is stated whenever it is TRUE, including with the tier
					 * revealed — which used to be the one moment it vanished: `Show advanced`
					 * set this to 0, so `10 settings · 9 advanced` became a bare `10 settings`
					 * and the distinction the whole model is built on disappeared exactly while
					 * the reader was exploring it (design round 1, D5). A filter still blanks
					 * it, for a reason that outlives the fix: a filtered header counts MATCHES,
					 * and "9 advanced" beside "3 results" would be counting two different
					 * things in one line.
					 */
					const advancedHeld = filtering
						? 0
						: allRows.filter((setting) => tierFor(setting) === "advanced")
								.length;
					// A filter hides a section entirely: leaving 19 headers standing
					// over a search that matched four of them is the "immensely long
					// scroll" this surface is being fixed for, one tier down.
					if (filtering && rows.length === 0) return null;
					const open = filtering
						? rows.length > 0 && !filterClosed.has(section.name)
						: isOpen(section.name);
					return (
						<section
							key={section.name}
							data-settings-section={section.name}
							data-open={open}
							className="flex flex-col"
						>
							{/*
							 * `key` carries the open state because `Disclosure` is
							 * deliberately uncontrolled: a forced-open is a remount, not
							 * an `open` prop (`backend-settings-tiers`' callers never add
							 * one). Only the header is remounted — rows are rendered by
							 * this component, so a collapse cannot take a draft with it.
							 */}
							<SettingsGroupHeader
								key={`${section.name}:${open ? "open" : "closed"}`}
								title={section.title}
								rowCount={rows.length}
								advancedCount={advancedHeld}
								scope={SCOPE_LABELS[section.scope]}
								modified={allRows.some(isModified)}
								defaultOpen={open}
								onOpenChange={(next) =>
									filtering
										? setFilteredOpen(section.name, next)
										: setOpen(section.name, next)
								}
							/>
							<div hidden={!open} className="flex flex-col pb-3">
								{section.description && (
									<p className="px-1 pb-1 text-meta text-ink-dim">
										{section.description}
									</p>
								)}
								{rows.length === 0 ? (
									// An open section with nothing in it, said out loud
									// rather than rendered as an empty box. The reveal is
									// the bar's own control, offered where the reader
									// noticed the absence — and its label names the COUNT and
									// its own scope, because the bar above carries a control
									// with the same two words for the whole registry (design
									// round 1, D6: "two doors, one phrase"). The sentence
									// dropped its own count so the number is stated once.
									<div className="flex items-center gap-2 px-1 py-2">
										<p className="text-body-sm text-ink-muted">
											{advancedHeld > 0
												? "Advanced settings are hidden here."
												: "Nothing in this section matches."}
										</p>
										{advancedHeld > 0 && (
											<Button
												variant="secondary"
												size="sm"
												onClick={() => setShowAdvanced(true)}
											>
												Show {advancedHeld} advanced
											</Button>
										)}
									</div>
								) : (
									rows.map((setting: BackendSetting) => (
										<BackendSettingRow
											key={setting.key}
											setting={setting}
											draft={drafts[setting.key] ?? draftFromSetting(setting)}
											tier={tierFor(setting)}
											gate={gateFor(setting)}
											effectiveHosting={effectiveHosting}
											saving={Boolean(savingKeys[setting.key])}
											error={errors[setting.key] ?? null}
											onDraftChange={(draft) =>
												setDrafts((current) => ({
													...current,
													[setting.key]: draft,
												}))
											}
											onSave={() => void saveRow(setting)}
											onReset={() => void resetRow(setting)}
										/>
									))
								)}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
};
