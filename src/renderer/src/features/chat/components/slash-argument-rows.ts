/**
 * Argument-list rows for the composer's slash popup, and the two formatters
 * that describe a model.
 *
 * The row shaping lives here rather than in the popup component so the popup
 * stays presentational and every rule below is unit-testable without React.
 * The formatters are verbatim ports of `local_operator/tui/widgets/model_picker.py`
 * (`format_window` `:161-176`, `format_price_pair` `:209-259`, `_trim_price`
 * `:277-...`), so the two hosts cannot drift: the TUI's price column and this
 * one have to say the same thing about the same model.
 *
 * The row vocabulary mirrors the TUI's `ArgumentChoice` (`autocomplete.py:88`):
 * a name, a prose description, and a machine-voice DETAIL column pinned to the
 * trailing edge. Detail is STATE, not explanation — "128k · $3/15",
 * "signed in", "role" — because the two columns answer different questions:
 * what this thing IS versus where it stands right now.
 */

import { activeModelForDefault } from "../pickers/model-default-settings";
import { effortDisplay } from "../session-status/session-model";
import { pyTrim } from "./slash-token";

/** The row a list renders. Mirrors `ArgumentChoice`. */
export type ArgumentRow = {
	value: string;
	name: string;
	description?: string;
	/** Trailing machine-voice detail: "128k · $3/15", "role", "usage-based". */
	detail?: string;
	/**
	 * Spellings that FIND this row without changing what it writes.
	 *
	 * The TUI's `ArgumentChoice.aliases`, and the reason it exists there is the
	 * whole reason it exists here: `matchChoices` scores against name AND aliases
	 * but always DISPLAYS `name` (`slash-rank.ts`), so an alias buys RANK and not
	 * reachability. For `/rename` that is the difference between a user who types
	 * the bare word `refresh` seeing an exact-1000 hit and one who sees the row
	 * rank as a near-miss against its own flag spelling. It never writes the
	 * alias: `completionFor` writes `value`, and `rename --refresh` is a refresh
	 * on the backend while `rename refresh` happens to be one too — but the row's
	 * job is to teach the spelling the help text advertises.
	 *
	 * Optional, and omitted on every other row on purpose: this file shapes rows
	 * from backend payloads that carry no aliases, and inventing an empty array
	 * for them would be a fact about the source the source does not state (round 1
	 * NIT-2's rule about the two source halves, one field over).
	 */
	aliases?: readonly string[];
	/** Paints `detail` in the danger tint. */
	alert?: boolean;
	current?: boolean;
};

/** A direct operation in an argument list, never a catalogue value to complete. */
export type ArgumentActionRow = {
	kind: "action";
	id: "model-default";
	name: string;
	description: string;
	/** The current session model the action will persist, absent when unavailable. */
	model: { provider: string; model_id: string } | null;
	/** Pointer feedback differs from the descriptive detail because it names the gesture. */
	clickText: string;
	disabled: boolean;
};

/**
 * Show the machine-default action only for its exact command argument.
 *
 * It is deliberately not sent through the model catalogue matcher: `default` is
 * an operation, not a model identity, and must never become composer text that
 * needs a second Enter. A missing current model remains visible as an explanation
 * instead of promising a write the session cannot perform.
 */
export function modelDefaultActionRow(
	query: string,
	activeModel: { provider?: unknown; model_id?: unknown } | null | undefined,
	wholeCommand: boolean,
	paneHasSession: boolean,
): ArgumentActionRow | null {
	if (query !== "default" || !wholeCommand || !paneHasSession) return null;
	const model = activeModelForDefault(
		activeModel
			? {
					provider: asText(activeModel.provider),
					model_id: asText(activeModel.model_id),
				}
			: null,
	);
	const provider = model?.provider ?? "";
	const modelId = model?.model_id ?? "";
	return {
		kind: "action",
		id: "model-default",
		name: "Set current model as default",
		description: model
			? `Save the current model (${provider}/${modelId}) as the default for new sessions.`
			: "No active session model is available to save.",
		model,
		clickText: model
			? "Click sets the current model as the default for new sessions."
			: "A session model is required before this action can save a default.",
		disabled: model === null,
	};
}

/** A direct action runs only on an acting gesture and only when it can act. */
export function shouldRunArgumentAction(
	row: ArgumentActionRow,
	run: boolean,
): boolean {
	return run && !row.disabled;
}

/**
 * Where an argument list's rows come from.
 *
 * The two halves are named separately because they are two KINDS of source and
 * one name for both is how a reader comes to believe every id is a backend
 * route (round 1 NIT-2).
 *
 * `BackendArgumentSource` is a `commands.entities` command id, pinned against
 * `desktop_catalogues.py:262-305` by `scripts/slash-row-format.test.mjs` — the
 * route answers exactly `model`, `effort`, `approvals`, `team` and `agent`, and
 * a stale id would silently render an empty list rather than fail.
 *
 * `RendererArgumentSource` is the half with no backend route, and it now holds
 * two sources that are the same KIND of thing for two different reasons:
 *
 *   - `theme` is filled from the same `@shared/themes` table `/theme`'s dialog
 *     reads, so there is no second theme vocabulary.
 *   - `title-refresh` is a STATIC list of flag spellings (`TITLE_REFRESH_ROWS`)
 *     rather than anything derived from a payload. It exists because `/rename`
 *     takes free text, and free text cannot be offered from a list — the app
 *     does not know what a conversation should be called — so the list's whole
 *     job is to teach the ONE non-typing thing the command accepts. The
 *     backend's `commands.entities` route has no row for it and never will (an
 *     entity list is a set of things to choose BETWEEN; a flag vocabulary is
 *     not), which is exactly why this is a renderer source and not a sixth
 *     backend id.
 */
export type BackendArgumentSource =
	| "model"
	| "effort"
	| "approvals"
	| "team"
	| "agent";
export type RendererArgumentSource = "theme" | "title-refresh";
export type ArgumentSource = BackendArgumentSource | RendererArgumentSource;

/**
 * The sources that answer WITHOUT a session and WITHOUT a backend round trip.
 *
 * One set rather than a pair of `source === "theme"` comparisons in the hook that
 * fills the rows (`slash-commands.tsx`): that comparison is what decided both
 * whether to run the entity query at all and which empty state to print, and a
 * second renderer-local source added without touching both would query the
 * backend for a list it does not serve and then report "not reported yet" about
 * a list nothing was asked to report.
 *
 * Membership is a fact about WHERE the rows come from, not about which command
 * uses the source, so it lives beside the source union rather than in a command
 * list.
 */
export const RENDERER_LOCAL_SOURCES: ReadonlySet<ArgumentSource> = new Set([
	"theme",
	"title-refresh",
]);

/** Whether this source's rows are available with no session and no transport. */
export function isRendererLocalSource(
	source: ArgumentSource | undefined,
): boolean {
	return source !== undefined && RENDERER_LOCAL_SOURCES.has(source);
}

/**
 * Sources whose rows are a FLAG vocabulary, and which therefore appear ONLY when
 * the typed text actually matches a row.
 *
 * A catalogue source (`model`, `effort`, `theme`) answers an UNMATCHED query with
 * its whole list or its empty-state sentence: "show me everything there is" is a
 * sensible thing to ask of a list of THINGS, and the `effort` cold-owner sentence
 * is a fact the user needs. A flag list is the opposite shape. Its rows are not a
 * set of things to choose among, they are SPELLINGS of one thing, so a list with
 * no row to offer has nothing to say and nothing to open: with one row, an empty
 * list is a list that has already chosen.
 *
 * That distinction is what keeps `/rename`'s two behaviours apart, and it is not
 * cosmetic. The desktop presents a BARE `/rename` as a FORM (`RenamePicker`, the
 * dispatcher's presentation for empty args), and bare `/rename ` + Enter has to
 * keep opening it. A flag list that opened on the empty query would complete the
 * word to `--refresh` instead — measured on the real component, which is what this
 * rule was written from — and the form would become unreachable by the gesture
 * that has always opened it. The same condition is what keeps a TITLE out of the
 * list: `/rename quarterly review` matches no flag, so no list is drawn over the
 * sentence the user is naming their conversation with.
 *
 * This is a DESKTOP rule with no TUI counterpart, and the terminal's behaviour is
 * NOT the thing to restore: there the row is printed under the cursor and
 * `/title ` + Enter is a refresh, while here it is the form. Same row, two hosts,
 * two answers — which is why the rule lives beside the source union rather than in
 * a command-name check at the call site.
 */
export const FLAG_LIST_SOURCES: ReadonlySet<ArgumentSource> = new Set([
	"title-refresh",
]);

/**
 * The words a FLAG list's rows answer to, per source — the vocabulary its
 * selection rule reads.
 *
 * `TITLE_REFRESH_ROWS` states which spelling is WRITTEN and which merely FINDS
 * the row; this set states which spellings the command's backend HONOURS as the
 * flag, which is what `flagTokenSelects` needs to decide whether Enter may act
 * on the token a user typed. They are deliberately different lists: `--auto` is
 * honoured and not offered (see `TITLE_REFRESH_ROWS`' own comment on why the
 * accept-set is a tolerance and the row list a recommendation), so an Enter on
 * `--auto` acts even though no row advertises it.
 *
 * Derived from `session/naming.py`'s `TITLE_REFRESH_FLAGS` / `TITLE_REFRESH_WORDS`
 * verbatim, case-folded the way `parse_title_arg` case-folds its comparison
 * (`.casefold()` there, `toLowerCase()` here — the two agree for every ASCII word
 * in this vocabulary, which is the only kind the vocabulary contains).
 */
export const FLAG_VOCABULARY: Partial<
	Record<ArgumentSource, ReadonlySet<string>>
> = {
	"title-refresh": new Set([
		"refresh",
		"update",
		"retitle",
		"--refresh",
		"--auto",
		"--update",
		"--retitle",
	]),
};

/**
 * Whether a typed argument token NAMES a flag this list's source acts on.
 *
 * THE RULE THE OPERATOR'S REPORT TURNED INTO A DATA-LOSS FIX. The first version
 * of this feature drew the row for any query the matcher could reach it with —
 * which is every SUBSEQUENCE of `--refresh`, i.e. `-`, `-f`, `-es`, `ref`, `r` —
 * and the single-survivor arm of `isUnambiguous` then RAN it on Enter. So
 * `/rename -fresh`, `/rename fresh`, `/rename ref` and `/rename re` all
 * dispatched `rename --refresh`, where the base tree set that literal title: a
 * one-word title beginning with a hyphen, or one that happens to share letters
 * with `refresh`, was silently converted into a provider call that also RELEASED
 * the user's own name. Measured on the built app by the QA pass (`/rename fresh`,
 * `ref`, `refr`, `re`, `es`, `resh`, `refreh`, `r` all sent `--refresh`).
 *
 * So the token must be accepted by the BACKEND's own rule rather than by the
 * matcher's reach: `parse_title_arg` acts only on a BARE flag whose whole,
 * whitespace-free, case-folded text is in the vocabulary. Three consequences,
 * each one a case the review rounds measured:
 *
 *   - `refresh` and `--refresh` act (full spellings).
 *   - `ref`, `-f`, `r` and every other PREFIX do not — the list may offer to
 *     COMPLETE them, but Enter completes instead of running.
 *   - `-fresh`, `fresh`, `re` and every other near-miss do not, because they are
 *     not in the vocabulary at all — so a one-word title that merely looks like
 *     the flag stays a title, which is the property the first version broke.
 *
 * Whitespace is the load-bearing half and mirrors `parse_title_arg`'s own split:
 * a `--`-leading token with prose after it is a TITLE (and a bare `--` is the
 * option terminator, also a title), so `/rename - Q3 review` and
 * `/rename -- draft` are untouched by this feature at either end.
 *
 * `undefined`/`""` query answers FALSE: an empty argument is the FORM's state,
 * not a flag, which is the same reason `slashRunAllowed` refuses to run on an
 * empty query.
 */
export function flagTokenSelects(
	source: ArgumentSource | undefined,
	query: string,
): boolean {
	const vocabulary = source ? FLAG_VOCABULARY[source] : undefined;
	if (!vocabulary) return false;
	const token = pyTrim(query);
	if (!token) return false;
	if (token.includes(" ") || token.includes("\t")) return false;
	return vocabulary.has(token.toLowerCase());
}

/**
 * Whether a typed argument is FLAG-SHAPED: a bare token that could still become
 * a flag, so the row may be drawn over it.
 *
 * This is the DRAW half of the rule above, and it is deliberately wider than
 * `flagTokenSelects`: the point of the list is to be found while the user is
 * still typing, so `-`, `--`, `r`, `ref` must all offer the row even though only
 * `refresh`/`--refresh` act on Enter. `acts` says which of the two questions is
 * being asked, because they look alike and are not:
 *
 *   - drawing asks "could this text still become this flag?" — a non-empty,
 *     whitespace-free token that is a PREFIX of a vocabulary spelling.
 *   - acting asks "is this text the flag?" — `flagTokenSelects`, whole-token.
 *
 * A PREFIX IS THE WHOLE OF THE DRAW RULE, and it is narrower than the matcher on
 * purpose — that narrowing IS the fix. The first version left the draw to
 * `matchChoices`, whose scorer is a SUBSEQUENCE matcher, so `-fresh` was a
 * subsequence of `--refresh` and drew the row; Enter's single-survivor arm then
 * ran it and the typed title was gone. Every spelling the row exists for is a
 * prefix of one it writes (`-`, `--`, `r`, `re`, `ref`, `refresh`), so the
 * subsequence tail bought nothing here and cost a data-loss case. `-f` and `-es`
 * are subsequences that were also dropped, deliberately: they are not what any
 * spelling of this flag looks like being typed.
 *
 * The whitespace test is the other half of the same narrowing and mirrors
 * `parse_title_arg`'s own split: `/rename quarterly review` and
 * `/rename - Q3 review` contain a space, so no row is drawn and the list cannot
 * narrow a title down to a flag. `-fresh` has no space and could never have been
 * excluded by it — which is why the prefix rule, not the whitespace rule, is what
 * closes that case.
 *
 * The whitespace test is INLINED rather than a module constant, deliberately: a
 * second separator class in the composer path is exactly what
 * `slash-token.test.mjs`'s F4-1 guard exists to refuse — this file's rows are
 * strings and the ONE Python-whitespace definition is `slash-token.ts`'s. The
 * test is written as `indexOf(" ")` rather than a class so adding it cannot
 * re-open that hole, and a tab inside a flag's spelling is not a case worth a
 * shared export.
 */
export function flagTokenDraws(
	source: ArgumentSource | undefined,
	query: string,
): boolean {
	const vocabulary = source ? FLAG_VOCABULARY[source] : undefined;
	if (!vocabulary) return false;
	const token = pyTrim(query);
	if (!token || token.includes(" ") || token.includes("\t")) return false;
	const lowered = token.toLowerCase();
	for (const spelling of vocabulary) {
		if (spelling.startsWith(lowered)) return true;
	}
	return false;
}

/**
 * Whether this source may draw a list at all when its query matched no row.
 *
 * The ONE question the popup's phase derivation needs, so the rule that keeps
 * `/rename `'s form reachable and a title out of a flag list is asked in a named
 * place rather than inlined as a set membership at the render site. `true` for
 * every source but the flag vocabularies, which is why an undefined source (no
 * inline list at all) answers `true` — the caller's own `inline` check is what
 * decides whether a list exists.
 */
export function showsUnmatchedList(
	source: ArgumentSource | undefined,
): boolean {
	return source === undefined || !FLAG_LIST_SOURCES.has(source);
}

/**
 * The popup's one-word name for each argument list, and for the command list.
 *
 * Lives beside the source union so a new source cannot be added without the
 * label being decided: the record is exhaustive over `ArgumentSource`, so a
 * seventh source is a type error here rather than a list that renders under the
 * previous subject's name (round 1 D3 / UX U3). Sentence case, like every other
 * label in the app.
 */
export const ARGUMENT_SOURCE_LABEL: Record<ArgumentSource, string> = {
	model: "Models",
	effort: "Effort",
	approvals: "Approvals",
	team: "Teams",
	agent: "Agents",
	theme: "Themes",
	/*
	 * `/rename`'s list, and why it is not called "Titles".
	 *
	 * Every other label names the KIND of thing the rows are — models, themes,
	 * teams. This list's rows are not a kind of title; they are spelling OPTIONS
	 * for one flag, and a title is precisely what the list does NOT contain (it
	 * cannot: a title is free text). "Titles" would promise a chooser of
	 * conversations' names that the list does not offer, which is the label
	 * lying about the list's subject — the failure the exhaustive record exists to
	 * prevent, reached from the other direction. "Options" is what the rows are,
	 * and it keeps the plural-noun shape of its siblings.
	 */
	"title-refresh": "Options",
};

/**
 * `400k` / `1.0m` / `""` when unknown.
 *
 * Empty rather than a placeholder: the column is right-aligned, so a blank
 * leaves the cell empty while a dash would draw the eye to the one row with
 * nothing to say. `tokens <= 0` is unknown (the backend's own convention: `-1`
 * means unknown and `0` also does, normalised once in `CatalogueEntry` so this
 * layer must not re-decide it).
 */
export function formatWindow(tokens: number): string {
	if (!(tokens > 0)) return "";
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}m`.replace(".0m", "m");
	}
	if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
	return String(tokens);
}

/**
 * Prices without trailing noise: `3`, `0.6`, `15`, `18.8`, `0.075`.
 *
 * Rounding is not free here. A flat two decimals printed `$0.07` for `0.075` —
 * a 6.7% under-quote on exactly the cheap models a user picks BECAUSE of the
 * price — and `$19` for `18.75`, which reads as a real quoted price the
 * provider does not charge. So: one decimal above ten, and THREE SIGNIFICANT
 * FIGURES below it, which is a relative bound and therefore says the same thing
 * about a $5 model and a $0.05 one.
 */
/** Trailing padding a rendered decimal does not need. */
const TRAILING_ZEROS = /0+$/;
const TRAILING_DOT = /\.$/;

export function trimPrice(value: number): string {
	if (value === Math.trunc(value)) return String(Math.trunc(value));
	if (value >= 10) return value.toFixed(1);
	const exponent = Math.floor(Math.log10(Math.abs(value)));
	const decimals = Math.max(0, 2 - exponent);
	return value
		.toFixed(decimals)
		.replace(TRAILING_ZEROS, "")
		.replace(TRAILING_DOT, "");
}

/**
 * `$3/15` per million, `free` (a stated pair of zeroes), `usage-based` for a
 * meta-route, else `""`.
 *
 * FOUR states, and the split matters. A provider that quotes no pricing is NOT
 * free — treating a missing price as zero would advertise a paid model as free,
 * which is the one error in this column a user would act on. So an absent price
 * (a negative sentinel) is blank, only a genuine pair of zeroes says `free`,
 * and a router says `usage-based`. `routed` is checked FIRST because it is a
 * statement about the endpoint rather than about a number, so it cannot be
 * outvoted by a zero a stale listing happens to quote.
 */
export function formatPricePair(
	input: number,
	output: number,
	routed: boolean,
): string {
	if (routed) return "usage-based";
	if (!(input >= 0) || !(output >= 0)) return "";
	if (input === 0 && output === 0) return "free";
	return `$${trimPrice(input)}/${trimPrice(output)}`;
}

type ModelEntity = {
	provider?: unknown;
	model_id?: unknown;
	selector?: unknown;
	value?: unknown;
	label?: unknown;
	connected?: unknown;
	aggregated?: unknown;
	routed?: unknown;
	context_window?: unknown;
	input_price?: unknown;
	output_price?: unknown;
};

type ProfileEntity = {
	value?: unknown;
	name?: unknown;
	description?: unknown;
	kind?: unknown;
	members?: unknown;
};

type ValueEntity = { value?: unknown };

const asText = (value: unknown): string =>
	typeof value === "string" ? value : "";

const asNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : -1;

/**
 * `/rename`'s argument list: the ONE row the command takes besides free text.
 *
 * THE GAP THIS CLOSES. The composer offered `/rename` no argument list at all,
 * so typing `-`, `--` or `ref` suggested nothing, and a user had to know the flag
 * and spell it in full from memory. The backend has honoured the flag all along
 * (`session/naming.py`'s `TITLE_REFRESH_FLAGS` / `TITLE_REFRESH_WORDS`), and the
 * TERMINAL host has always listed it (`tui/app.py`: one `ArgumentChoice`), so the
 * desktop was the only surface that taught nothing.
 *
 * THE ROW IS `--refresh`, and its alias is the bare `refresh` — the TUI's own
 * choice, taken over rather than re-derived. `refresh` is NOT a second row: a
 * row is a THING to choose, and `--refresh` and `refresh` are two spellings of
 * one action, so a second row would offer the same outcome twice and make the
 * list look like it had two options. The alias buys RANK instead
 * (`matchChoices`: scored on name AND aliases, displayed as `name`), so a user
 * who already learned the bare word scores an exact 1000 rather than the fuzzy
 * subsequence that `refresh` earns against `--refresh`.
 *
 * WHY THE OTHER TWO SPELLINGS ARE DELIBERATELY NOT ROWS. The vocabulary the
 * backend honours is wider than the vocabulary any surface may OFFER:
 * `--update`/`--retitle`/`update`/`retitle` are accepted so that a near-miss is
 * never silently stored as a title (the prefix rule in `parse_title_arg`, and
 * its own comment says why the prefix makes the failure worse rather than
 * better), which is a reason to HONOUR a spelling and not a reason to advertise
 * it. `--auto` is the same class and is additionally not in the help text
 * (`"Name this conversation, or /title --refresh"`), so a row for it would be
 * the app teaching a synonym its own documentation does not mention. A row is a
 * recommendation; the parser's accept-set is a tolerance. Offering `update`
 * beside `refresh` would turn one action into three advertised choices.
 *
 * THEY ARE ALIASES INSTEAD, WHICH IS THE ROUND-1 ANSWER TO U3. "Not a row" was
 * being read as "unreachable", and the UX round was right that a user who knows
 * the word `update` (from another tool, or from the backend's own refusal
 * message) should be able to FIND this row while typing it. An alias does exactly
 * that and nothing more: `matchChoices` scores against name AND aliases but
 * displays `name`, so `update` reaches the row, the row goes on teaching
 * `--refresh`, and the rendered list still offers ONE choice — no second row, no
 * wider description, and the `~55`-cell wrap budget the verbatim TUI sentence
 * sits inside is untouched. It also keeps the host's promise that what is
 * DISPLAYED is what is written: a pick of the row writes `--refresh`, which the
 * backend honours, whatever word found it.
 *
 * `--auto` is in neither the aliases nor the rows, deliberately: it is the one
 * spelling with no bare twin, so it cannot be reached by typing a word a user
 * already knows — it can only be learned from this list, and this list is not the
 * place to learn it (see above). A user who types it anyway is HONOURED by the
 * backend (`flagTokenSelects` carries it), which is the correct asymmetry.
 *
 * The DESCRIPTION and DETAIL are the TUI's own strings, verbatim, so the two
 * hosts say the same thing about the same flag: the description states the call
 * and the detail states the RELEASE — that a refresh hands the name back to
 * automatic naming is the surprising half, and this row is the last surface
 * before it runs.
 *
 * `value` is what a pick WRITES and what a run SENDS (`completionFor`), and it
 * is the flag form — the shape every other command taught — matching `name` here
 * because this row has no separate selector to carry.
 */
export const TITLE_REFRESH_ROWS: readonly ArgumentRow[] = [
	{
		value: "--refresh",
		name: "--refresh",
		description: "Re-read the conversation and name it again",
		detail: "resumes auto-naming",
		aliases: ["refresh", "update", "retitle", "--update", "--retitle"],
	},
];

/**
 * The rows a FLAG list hands its caller, as FRESH objects every call.
 *
 * `[...TITLE_REFRESH_ROWS]` is NOT this, and the difference is a real one rather
 * than tidiness: a shallow copy shares the row OBJECTS, so a caller that wrote
 * `rows[0].current = true` (the argument-list code does exactly that shape of
 * edit for the model/effort lists) would mutate the module constant and every
 * later render would see it. The table above is `readonly` to say the rows are
 * not a caller's to change; a copy that shares them does not honour that.
 *
 * The copy is per-call rather than `structuredClone`-deep for the reason the
 * argument list is re-derived per render anyway: the objects are four primitive
 * fields, so a spread IS the whole depth, and `aliases` is a frozen-looking
 * literal no code path writes to.
 */
export function titleRefreshRows(): ArgumentRow[] {
	return TITLE_REFRESH_ROWS.map((row) => ({
		...row,
		aliases: row.aliases ? [...row.aliases] : undefined,
	}));
}

/** The row's own selector, in the one spelling the wire and the picker share. */
function modelSelectorOf(row: ModelEntity): string {
	const selector = asText(row.selector) || asText(row.value);
	if (selector) return selector;
	const provider = asText(row.provider);
	const modelId = asText(row.model_id);
	return provider && modelId ? `${provider}/${modelId}` : "";
}

/**
 * Shape a `commands.entities` payload into rows, discriminated on `command`.
 *
 * `current` is the payload's own `current` field for `model`, `effort`,
 * `approvals` and `theme`, and the canonical session's `active_team` /
 * `active_agent` for the profile commands. That split is deliberate: the
 * response's `current` for `team` is the resolved ORG CHART and for `agent` the
 * profile DETAIL, and both are only populated when `name` is passed
 * (`desktop_catalogues.py:283-300`) because they belong to the dialog's detail
 * pane, not to a one-line row. Reading them here would mark every row as
 * current on a response that happens to carry a chart.
 */
export function argumentRows(
	command: ArgumentSource,
	entities: readonly unknown[],
	current: unknown,
): ArgumentRow[] {
	switch (command) {
		case "model": {
			const selected = (current ?? null) as {
				provider?: unknown;
				model_id?: unknown;
			} | null;
			const selectedSelector = selected
				? `${asText(selected.provider)}/${asText(selected.model_id)}`
				: "";
			return entities.map((raw) => {
				const row = raw as ModelEntity;
				const value = modelSelectorOf(row);
				/*
				 * The route carries no `credentials_known` — that flag lives on
				 * `models.catalogue` — so an unresolved credential store cannot
				 * be told apart from a readable one here. The rule is applied as
				 * written: only an explicit `false` suppresses the caveat, and
				 * the per-row `connected` this route does send is already
				 * resolved on the store's own thread.
				 */
				const description = [
					asText(row.provider),
					row.aggregated ? "aggregated" : "",
					row.connected === false ? "no credential" : "",
				]
					.filter(Boolean)
					.join(", ");
				const detail = [
					formatWindow(asNumber(row.context_window)),
					formatPricePair(
						asNumber(row.input_price),
						asNumber(row.output_price),
						row.routed === true,
					),
				]
					.filter(Boolean)
					.join(" · ");
				return {
					value,
					name: asText(row.label) || asText(row.model_id),
					description,
					detail: detail || undefined,
					current: Boolean(selectedSelector) && selectedSelector === value,
				};
			});
		}
		case "team":
		case "agent":
			return entities.map((raw) => {
				const row = raw as ProfileEntity;
				const value = asText(row.value) || asText(row.name);
				return {
					value,
					name: asText(row.name) || value,
					description: asText(row.description),
					// The TUI's own row detail for these lists is the profile
					// KIND (role/specialist) — the fact a user picks a hat by. A
					// team row carries none, so its detail column is empty rather
					// than an invented count.
					detail: asText(row.kind) || undefined,
					current: Boolean(current) && current === value,
				};
			});
		case "effort":
			return entities.map((raw) => {
				const value = asText((raw as ValueEntity).value);
				// The NAME is the title-cased human form, matching the strip's chip
				// and the `/effort` picker modal; `value` stays the raw rung the
				// command is sent. Without this the SAME backend list rendered
				// lowercase in this popup and Title Case in the modal - the exact
				// drift `effortDisplay` exists to prevent (review round 1, minor 1).
				return {
					value,
					name: effortDisplay(value),
					current: current === value,
				};
			});
		case "approvals":
			return entities.map((raw) => {
				const value = asText((raw as ValueEntity).value);
				return { value, name: value, current: current === value };
			});
		case "theme":
			return entities.map((raw) => {
				const row = raw as ProfileEntity;
				const value = asText(row.value);
				return {
					value,
					name: asText(row.name) || value,
					description: asText(row.description),
					current: current === value,
				};
			});
		/*
		 * The one case that ignores its inputs, and the comment says so rather than
		 * leaving a reader to wonder whether `entities` is a bug.
		 *
		 * `title-refresh`'s rows are a FIXED vocabulary — the spellings the backend
		 * honours — so there is nothing to read: no route serves them, `entities` is
		 * always `[]` (the hook does not even run the query for this source) and
		 * `current` has no meaning (a flag is not "selected" the way a model is).
		 * Returning a fresh array rather than the constant itself keeps the module's
		 * one contract — every branch hands back rows the caller owns — and the copy
		 * is one row, once per render of a popup that is already re-deriving its
		 * matches on that render.
		 */
		case "title-refresh":
			return titleRefreshRows();
	}
}
