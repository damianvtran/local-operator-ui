/**
 * The option lists the settings comboboxes show, as pure functions.
 *
 * Pure and separate from the component because these are the rules the feature
 * is judged on and they are the ones most likely to be wrong: what a row stores
 * versus what it shows, which rows a `hosting` narrows to, and what happens
 * when the narrowing matches nothing. `scripts/model-setting-options.test.mjs`
 * asserts all of them directly over hand-built payloads, so a regression here
 * is a failing test rather than a list that quietly came back empty.
 *
 * Three things are deliberately NOT decided here:
 *
 * - which MATCHER filters the list. That is the component's single filter, and
 *   replacing it with the TUI's `rank_rows` would mean porting 40 lines of
 *   heuristics about which number in a model id is the version;
 * - the stored shape. Each kind's id is decided by
 *   `backend-setting-combos.ts`'s map; this module only builds the rows;
 * - the group LABELS the backend does not own.
 */

import { providerReadiness } from "@features/providers/provider-labels";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import type { SearchableOption } from "@shared/components/ui/searchable-select";
import type { ComboKind } from "./backend-setting-combos";

/**
 * The catalogue fields these builders read.
 *
 * Deliberately narrower than the wire payload: everything here is a rule
 * someone can check, and a builder that depended on the whole
 * `DesktopModelCatalogue` would be asserting over fields it never looks at.
 */
export type CatalogueModelRow = {
	provider: string;
	model_id: string;
	/** The `provider/model` form the wire carries. Never re-derived by hand: a
	 * model id may itself contain a `/` (`anthropic/claude-opus-5` on
	 * `openrouter`), which is exactly where a naive join and the backend's own
	 * `partition("/")` disagree. */
	selector: string;
	label?: string;
	connected: boolean;
	aggregated?: boolean;
};

export type CatalogueInput =
	| {
			models?: readonly CatalogueModelRow[];
			credentials_known?: boolean;
	  }
	| undefined;

/**
 * The one group a listing whose credential store could not be read gets.
 *
 * `credentials_known === false` means every row's `connected` is the listing's
 * own default — "show everything rather than claim the user owns no models" —
 * so the state is unknown for every row and badging one would be a claim the
 * payload does not support. The chat picker already has this third group; using
 * its wording keeps the two surfaces describing one unknown the same way.
 */
export const SIGN_IN_UNKNOWN_GROUP = "Sign-in state unknown";

/**
 * The heading for a stored value no listing contains.
 *
 * Its own heading rather than a neighbour's, so a rescued row can never split
 * or duplicate the heading of a group it is not really in.
 */
export const CURRENT_VALUE_GROUP = "Current value";

/** The two states a known-credentials listing distinguishes. */
const SIGNED_IN_GROUP = "Signed in";
const NEEDS_SIGN_IN_GROUP = "Needs sign-in";

/**
 * A provider id as the sub-line writes it.
 *
 * Sentence case, because the sub-line sits beside `Signed in` and
 * `Needs sign-in` and one lowercase prefix among them reads as a different kind
 * of fact rather than the same one (design N1). The id is all the CATALOGUE
 * carries - the registry holds a display name, but it is a second fetch this
 * row does not make, and inventing a table of names here would be a second
 * source of truth for them.
 */
const providerLabel = (provider: string): string =>
	provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : provider;

/**
 * The order the provider groups are drawn in, which is the usable-first order
 * and not the registry's own.
 *
 * It has to be fixed here because the registry interleaves its buckets: the
 * probe against a real backend returns twelve sign-in providers, then the five
 * local servers, then four more sign-in providers — so bucketing in first-seen
 * order would print "Needs sign-in" twice around the middle group.
 */
const PROVIDER_GROUP_ORDER = [
	"Ready to use",
	"Needs a running server",
	"Needs sign-in",
] as const;

/**
 * The whole login registry as combobox rows, in registry order within a group.
 *
 * **The list is never filtered by credential.** `hosting` is where a user names
 * the provider they intend to boot on, which may be one they have not logged
 * into yet; constraining it to current credentials would hide exactly the
 * choice they are reaching for. The credential state is SHOWN — as the group
 * heading and as the row's sub-line — which is what the shipped
 * `providerReadiness` classifier exists for: `configured` is true for the local
 * providers unconditionally, so a "Connected" badge would claim a connection to
 * servers that are not running.
 */
export function providerOptions(
	providers: readonly DesktopProvider[],
): SearchableOption[] {
	const buckets = new Map<string, SearchableOption[]>(
		PROVIDER_GROUP_ORDER.map((group) => [group, []]),
	);
	for (const provider of providers) {
		const readiness = providerReadiness(provider);
		const bucket = buckets.get(readiness.group);
		if (!bucket) continue;
		bucket.push({
			id: provider.id,
			name: provider.name,
			description: readiness.label,
			group: readiness.group,
		});
	}
	return PROVIDER_GROUP_ORDER.flatMap((group) => buckets.get(group) ?? []);
}

/**
 * The two-rung comparator, and why the list is not just the backend's order.
 *
 * 1. **usable before not-usable** — a model with no credential cannot run, and
 *    it is the thing a user is looking past;
 * 2. **the effective hosting's own provider first** — when the field stores a
 *    bare model id, the id has to come from the provider that will serve it;
 * 3. otherwise the order the listing sent, because within one provider that is
 *    the best signal available and not ours to invent.
 *
 * `Array.prototype.sort` is stable, so rung 3 is the absence of a rule rather
 * than a tie-breaker that has to be written.
 *
 * Rung 2 is stated for completeness of the design's comparator and is currently
 * unreachable through these builders: `model_name`'s list is narrowed to the
 * hosting's own rows before it can matter, and the subagent tiers name their
 * provider in the value they store so they pass no hosting at all. It is kept
 * because it is the rule of record and because a future row that lists without
 * scoping needs it; `scripts/model-setting-options.test.mjs` asserts it directly
 * rather than through the builders, so the assertion does not imply a shipped
 * path that does not exist.
 */
export function compareModelRows(
	a: CatalogueModelRow,
	b: CatalogueModelRow,
	hosting: string,
): number {
	if (a.connected !== b.connected) return a.connected ? -1 : 1;
	const aIsHome = hosting !== "" && a.provider === hosting;
	const bIsHome = hosting !== "" && b.provider === hosting;
	if (aIsHome !== bIsHome) return aIsHome ? -1 : 1;
	return 0;
}

/** Buckets that keep first-seen order, so no comparator has to own group order. */
function bucketBy<T>(rows: readonly T[], keyOf: (row: T) => string) {
	const buckets = new Map<string, T[]>();
	for (const row of rows) {
		const key = keyOf(row);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(row);
		else buckets.set(key, [row]);
	}
	return buckets;
}

/**
 * Which rows the model list may offer.
 *
 * For `model_name` the list is narrowed to the effective `hosting`, because
 * `bootstrap.py` reads the two keys independently and hands both to
 * `configure_model`: a model id from a provider you are not hosting on is an id
 * that provider does not own. `subagents.models.*` is not narrowed — that value
 * names its own provider, so there is no hosting to narrow by.
 *
 * **The narrowing is a mapping we do not own, so it degrades to a longer list
 * and never to an empty one.** Both fallbacks are load-bearing:
 *
 * 1. an effective hosting that matches no row's provider — a local server that
 *    is down, an id the catalogue spells differently, an empty hosting — shows
 *    the WHOLE catalogue, because an empty list in a settings field reads as
 *    broken;
 * 2. the current value is always listed, even when the narrowing excluded it,
 *    because a stored-but-unknown model rendered as a blank field is a lie the
 *    user cannot debug.
 */
export function scopedModelRows(
	catalogue: CatalogueInput,
	options: { kind: ComboKind; hosting: string },
): CatalogueModelRow[] {
	const all = [...(catalogue?.models ?? [])];
	if (options.kind !== "model") return all;
	const hosting = options.hosting.trim();
	if (!hosting) return all;
	const narrowed = all.filter((row) => row.provider === hosting);
	return narrowed.length > 0 ? narrowed : all;
}

/**
 * The rows for one model-bearing setting, in the order they are drawn.
 *
 * Grouping differs by kind, and the difference is the stored shape rather than
 * taste: `model_name` stores a bare id, so the disambiguating fact is the
 * provider and the useful grouping is the sign-in state; the subagent tiers
 * already name their provider, so the provider IS the heading. The comparator
 * is applied inside a bucket, so a heading can never be split by a sort.
 */
export function modelOptions(
	catalogue: CatalogueInput,
	options: { kind: ComboKind; hosting: string; current: string },
): SearchableOption[] {
	const known = catalogue?.credentials_known !== false;
	const rows = scopedModelRows(catalogue, options);

	const signInGroup = (row: CatalogueModelRow): string => {
		if (!known) return SIGN_IN_UNKNOWN_GROUP;
		return row.connected ? SIGNED_IN_GROUP : NEEDS_SIGN_IN_GROUP;
	};
	const groupOf = (row: CatalogueModelRow): string =>
		options.kind === "provider-model" ? row.provider : signInGroup(row);

	/*
	 * The sort runs BEFORE the bucketing for the `model` kind, so the sign-in
	 * groups come out usable-first; for the subagent kind the buckets are the
	 * providers and their order is the listing's, with the comparator ordering
	 * the rows inside each.
	 */
	const ordered =
		options.kind === "provider-model"
			? rows
			: [...rows].sort((a, b) => compareModelRows(a, b, options.hosting));

	const out: SearchableOption[] = [];
	for (const [, bucket] of bucketBy(ordered, groupOf)) {
		const sorted =
			options.kind === "provider-model"
				? [...bucket].sort((a, b) => compareModelRows(a, b, options.hosting))
				: bucket;
		for (const row of sorted) {
			out.push({
				// `model_name` stores the BARE id; the subagent tiers store the
				// selector. The shown name is the selector in both cases, which is
				// what disambiguates the two catalogue entries that can share one
				// model id (a direct provider and an aggregator).
				id: options.kind === "model" ? row.model_id : row.selector,
				name: row.selector,
				description:
					options.kind === "provider-model"
						? known
							? row.connected
								? "Signed in"
								: "Needs sign-in"
							: undefined
						: `${providerLabel(row.provider)}${row.aggregated ? ", aggregated" : ""}${
								known && !row.connected ? ", no credential" : ""
							}`,
				group: groupOf(row),
			});
		}
	}

	out.push(...currentValueRows(rows, catalogue, options));
	return out;
}

/**
 * What the model list says about the scope it is in, or null when there is
 * nothing to say.
 *
 * The narrowing itself is right (`scopedModelRows` above): a bare model id is
 * resolved against `hosting` at boot. What was missing was the sentence - the
 * list is narrowed with nothing on screen saying so, so a user who types a
 * model they know and reads "Nothing matches that model" concludes the app does
 * not have it, when the real reason is a scope they were never told about
 * (UX round 1, U2). And when the narrowing CANNOT map the hosting it silently
 * becomes the whole catalogue, where a model from another provider is pickable
 * for a field that stores a bare id (U3): 7 of 17 providers in the reviewed
 * environment have no catalogue rows at all, so that state is ordinary rather
 * than exotic.
 *
 * Two states, one line each, and the distinction is the point: a list that IS
 * scoped says WHICH provider it is for, and a list whose scope could not be
 * resolved says so in the user's own terms rather than leaving them to infer it
 * from row prefixes.
 */
export function modelScopeNotice(
	options: { kind: ComboKind; hosting: string; hostingLabel?: string },
	catalogue: CatalogueInput,
): string | null {
	// The subagent tiers store a selector, so their list is not narrowed by
	// anything and has no scope to state.
	if (options.kind !== "model") return null;
	const hosting = options.hosting.trim();
	// No hosting is not a scope that failed; it is no scope at all, and a line
	// about it would be noise on a field the user has not filled in yet.
	if (!hosting) return null;
	// A scope line is a statement ABOUT a list, so it needs one. Before the
	// first fetch lands there is nothing to be scoped and nothing to say - the
	// same rule as the list's own empty state, which must not claim an outcome
	// a query has not produced.
	const rows = catalogue?.models ?? [];
	if (rows.length === 0) return null;
	const name = options.hostingLabel ?? providerLabel(hosting);
	const known = rows.some((row) => row.provider === hosting);
	return known
		? `Models for ${name}`
		: `No models listed for ${name}. Showing all models.`;
}

/**
 * The row that keeps a stored value visible when no listing contains it.
 *
 * Two different situations arrive here and both must render rather than blank:
 * a model configured before its provider was resynced, and a value that was
 * never a catalogue id at all (this repository's own configured fixture holds
 * `model_name: "deepseek/deepseek-chat"`, a selector-shaped value the key is
 * documented not to hold). A blank field for a set key is the one outcome that
 * leaves a user nothing to work with.
 *
 * The rescued row never claims a fact the payload does not carry: with no
 * catalogue row behind it, it has no sign-in state, no price and no context
 * window, so it is labelled as a custom value and grouped under its own
 * heading.
 */
function currentValueRows(
	scoped: readonly CatalogueModelRow[],
	catalogue: CatalogueInput,
	options: { kind: ComboKind; hosting: string; current: string },
): SearchableOption[] {
	const current = options.current.trim();
	if (!current) return [];
	/*
	 * Matched on the STORED value, which is bare for `model_name` and a selector
	 * for the tiers — the same shape the ids above were built from, so a value
	 * that is on screen is never rescued twice. Tested against the SCOPED list
	 * rather than the whole catalogue on purpose: a row the hosting narrowing
	 * excluded is exactly the case this function exists for, and asking the
	 * catalogue instead would call it present and leave the field without it.
	 */
	const stored = (row: CatalogueModelRow) =>
		options.kind === "model" ? row.model_id : row.selector;
	if (scoped.some((row) => stored(row) === current)) return [];
	/*
	 * Prefer a real row when the catalogue HAS one that the narrowing excluded:
	 * its provider, its selector and its credential state are facts we were
	 * given, and inventing them would be worse than the narrowing that hid it.
	 * When there is no such row the value is genuinely unknown to this listing.
	 */
	const real = (catalogue?.models ?? []).find((row) => stored(row) === current);
	return [
		{
			id: current,
			name: real?.selector ?? current,
			description: real
				? `${providerLabel(real.provider)}${
						catalogue?.credentials_known === false
							? ""
							: real.connected
								? ", signed in"
								: ", no credential"
					}`
				: options.kind === "model"
					? "Custom model"
					: "Custom value",
			group: CURRENT_VALUE_GROUP,
		},
	];
}

/**
 * The option a field shows for its own draft, so the component is always handed
 * a `selected` that matches what is on screen.
 *
 * The stored value wins over the label: for `model_name` the field shows the
 * selector of whichever row carries the stored bare id, and a value that
 * appears in no option is shown as itself. Returning null for an empty draft is
 * what makes the placeholder visible on a row that is unset.
 *
 * `preferredName` is the shown name of the row the user JUST picked, and it is
 * needed because a bare id is not unique: a direct provider and an aggregator
 * can carry one model id (`anthropic/claude-opus-5` and
 * `openrouter/anthropic/claude-opus-5` both store `claude-opus-5`), so the first
 * id match can be a different row than the one clicked and the field's text
 * visibly swaps under the user a moment after the pick (review round 1, R1-5).
 * The stored value is never affected - only which of two rows with that value is
 * shown - so an unknown name falls back to the first match rather than hiding
 * the value.
 */
export function selectedOption(
	options: readonly SearchableOption[],
	value: string,
	preferredName?: string,
): SearchableOption | null {
	const wanted = value.trim();
	if (!wanted) return null;
	const matches = options.filter((option) => option.id === wanted);
	if (preferredName) {
		const picked = matches.find((option) => option.name === preferredName);
		if (picked) return picked;
	}
	return matches[0] ?? { id: wanted, name: wanted };
}
