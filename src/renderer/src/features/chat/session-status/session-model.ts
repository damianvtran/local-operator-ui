/**
 * What the strip calls the model, and what it calls the effort level.
 *
 * Ported from the TUI band's two answers to the same questions:
 *
 *   - the model's name: `LocalOperatorApp._apply_frontend_state`
 *     (`local_operator/tui/app.py:7969-7975`), which passes the EFFECTIVE
 *     spec's `display_name` as `model_name` and
 *     `FrontendSessionState.effective_model_label`
 *     (`local_operator/session/frontend_state.py:1677`) as `model_label`
 *   - the effort level: `_effort_label` (`local_operator/tui/app.py:36508`)
 *
 * ## Why the EFFECTIVE spec and not the selected one
 *
 * `_effort_label`'s own docstring: a fallback target may clamp the chosen
 * level to its own ladder, so the segment's one job is to name the level in
 * force on the model that is actually answering. The same argument applies to
 * the name — a session that has failed over to another provider must say which
 * provider is answering, not which one was picked.
 *
 * The two existing pickers read `selected_model`, and that is correct for
 * them: `/model` and `/effort` CHANGE the selection, so they must show what
 * they are about to change. Reading a different field here is deliberate, not
 * an inconsistency.
 *
 * ## What would make this mirror wrong
 *
 * `_effort_label`'s three-state rule changing. Today: an explicit level wins;
 * a ladder with no level set reads `auto`, which is the word `/effort auto`
 * uses, so the strip and the command share one vocabulary; a model that
 * reasons with no ladder at all reads `reasoning`, which is all that can
 * honestly be said about it; and a non-reasoning model renders nothing, which
 * is what makes the segment's presence informative.
 */

import { t } from "@shared/i18n";
import type {
	CanonicalEffectiveAccessState,
	CanonicalFrontendState,
	CanonicalModel,
	CanonicalModelAccess,
} from "../../../../../shared/desktop-session-contract";
import type { RadientSessionIssue } from "../../../shared/hooks/use-radient-session-issue";

export type ModelIdentity = {
	/** What the chip prints: the human name if resolution found one, else the id. */
	name: string;
	/** `provider/model_id` — what the tooltip prints, and what `/model` matches on. */
	selector: string;
};

/**
 * Providers that RESELL models rather than serving them.
 *
 * Mirrors `AGGREGATOR_PROVIDERS` (`local_operator/providers/registry.py`), read
 * by `_resells` (`model/naming.py:234-244`). Kept as a literal rather than
 * derived from the wire because nothing on the desktop contract carries it, and
 * a three-element frozenset that has not changed is cheaper to mirror than to
 * discover. What would make this mirror wrong: a fourth aggregator shipping in
 * the registry without this list learning about it - in which case the chip
 * over-names that one provider's routes, which is the pre-round-3 behaviour
 * rather than a new failure.
 */
const AGGREGATOR_PROVIDERS = new Set(["openrouter", "radient", "radient-key"]);

/**
 * The ROUTER ids an aggregator serves — the synthetic meta-models whose id is a
 * single word (`auto`) rather than a vendor-scoped slug.
 *
 * Mirrors `AGGREGATOR_ROUTER_MODEL_IDS` (`local_operator/model/registry.py`),
 * read by `_ROUTER_NAMES` (`model/naming.py`). A router is the one id an
 * aggregator does NOT resell — it is the route itself — so it has a name of its
 * own to state rather than one that has to say which vendor's weights answer,
 * which is why the aggregator refusal below does not apply to it.
 */
const AGGREGATOR_ROUTER_MODEL_IDS = new Set(["auto", "openrouter/auto"]);

/**
 * What a router prints. TITLE CASE (`Auto`, not `auto`) because this heads the
 * band's model segment beside other human names (`Claude Opus 5`); a lowercase
 * `auto` there reads as the raw id it started from. The SELECTOR the rest of the
 * app identifies the model by is unchanged — the chip's tooltip still prints
 * `radient/auto`.
 */
const ROUTER_DISPLAY_NAME = "Auto";

/**
 * The bare tail of a selector: what the band falls back to when it will not
 * name a model. `openrouter/openai/gpt-5-mini` -> `gpt-5-mini`.
 */
function bareId(selector: string): string {
	return selector.slice(selector.lastIndexOf("/") + 1) || selector;
}

/**
 * Whether a "name" is just the id handed back.
 *
 * Mirrors `_echoes_id` (`model/naming.py:247-256`) exactly, including the
 * vendor-scoped form: an endpoint with no display metadata answers with the key
 * it was asked about, and promoting that spends the whole honesty budget to
 * render the string it started from.
 */
function echoesId(name: string, modelId: string): boolean {
	return name === modelId || name === bareId(modelId);
}

/**
 * The model's human name and its full selector.
 *
 * ## The rule, and why it is this rule
 *
 * The band does not print `display_name`. It prints
 * `format_model_label(selector, short=True, name=...)` (`status_line.py:814`,
 * called at `:1686`), which routes through `model_label` and REFUSES a name it
 * cannot vouch for, falling back to the bare id. Round 2 measured the cost of
 * missing that: for an aggregator route the chip printed `OpenAI: GPT-5 Mini`
 * where the band prints `gpt-5-mini` and the picker lists the selector -
 * 445 of 563 live catalogue rows disagreed with the picker the chip opens
 * (Q3/R8/U9).
 *
 * `display_name` is `ModelInfo.name`, which is the raw LISTING name and the
 * *input* to curation, not its output. So the refusals have to be mirrored
 * here, in the order `_unambiguous_name` applies them:
 *
 * 1. **A reseller gets no name at all** (`_resells`, `naming.py:214-219`).
 *    Every aggregator resells the same models - 398 of ~400 names are shared
 *    between the two shipped ones - so no listing name can say which route is
 *    answering, and the route is what differs in price and quota.
 * 2. **A name that echoes the id is not a name** (`_echoes_id`).
 * 3. **`Unknown` is the placeholder's identity, not a model's** - the shipped
 *    registry's own word for a listing that left the name blank.
 *
 * Otherwise the listing name stands, which is what a direct provider's row is.
 *
 * ## What is deliberately NOT mirrored, and why
 *
 * `model_label`'s two remaining steps both need the shipped registry index,
 * which this app does not have and must not guess at:
 *
 * - **Qualifier dropping** (`Claude Opus 4.5 (2025-11-01)` -> `Claude Opus
 *   4.5`) is only safe because `_names_one` re-checks the shortened form for
 *   ambiguity afterwards. Dropping blindly collapses 5 distinct model pairs in
 *   the shipped registry onto a shared string - `Claude 3.7 Sonnet` would name
 *   both `-20250219` and `-latest` - which is precisely the ambiguity the band
 *   refuses. Measured, not assumed.
 * - **The width fallback** (`_ID_MARGIN`) exists because the band competes for
 *   cells on one terminal row. This strip wraps and truncates with an ellipsis,
 *   so it has no such budget and the longer name is the more informative one.
 *
 * Both omissions make the chip print a name the band SHORTENS, never one the
 * band REFUSED. Measured against the real `format_model_label` over the shipped
 * registry plus its aggregator-routed variants: 347 of 354 rows identical, the
 * 7 differences all of that shape, and 236/236 on aggregator routes where round
 * 2 found 0/445. `scripts/session-status.test.mjs` pins the count.
 *
 * The at-the-source fix is a backend-provided safe label on the wire: the
 * naming policy lives in Python and owns the registry index, so a
 * `display_label` field beside `display_name` would let this function collapse
 * to one read. Proposed in the PR; not something the desktop can do alone.
 */
/**
 * `provider/model_id` for a spec, or null when EITHER half is missing.
 *
 * The one place the app decides what NAMES a model, because it is the string
 * three surfaces compare:
 *
 *   - the status band's reading and the picker's description, where an empty
 *     half must name NOTHING rather than interpolate — a spec whose model_id
 *     was blank rendered "This session runs /." (design D9);
 *   - the picker's `current` row, which compares it against each row's own
 *     selector;
 *   - the canonical session handle's pending-model reconciliation, which drops
 *     an optimistic paint when the owner's own spec produces this string.
 *
 * `modelIdentity` is deliberately NOT built on this: its empty-provider case
 * still labels the model by its bare id, which is the right thing to PRINT and
 * the wrong thing to COMPARE. Same two fields, two questions.
 *
 * A non-string `model_id` (an older or damaged frame) is treated as absent,
 * matching `modelIdentity`'s own type guard rather than stringifying it.
 */
export function modelSelector(
	model: CanonicalModel | null | undefined,
): string | null {
	if (!model) return null;
	const provider = typeof model.provider === "string" ? model.provider : "";
	if (!provider) return null;
	const id = typeof model.model_id === "string" ? model.model_id : "";
	if (!id) return null;
	return `${provider}/${id}`;
}

export function modelIdentity(
	model: CanonicalModel | null | undefined,
): ModelIdentity | null {
	if (!model || typeof model.model_id !== "string" || !model.model_id)
		return null;
	const provider = typeof model.provider === "string" ? model.provider : "";
	const selector = provider ? `${provider}/${model.model_id}` : model.model_id;
	const display =
		typeof model.display_name === "string" ? model.display_name.trim() : "";
	const refused =
		AGGREGATOR_PROVIDERS.has(provider) ||
		!display ||
		echoesId(display, model.model_id) ||
		display.toLowerCase() === "unknown";
	/*
	 * The router lookup is gated on BOTH halves of the hosting, exactly as
	 * `_model_label` does (`model/naming.py:248-254`), and the provider gate is
	 * load-bearing rather than defensive: `auto` is a router id ONLY behind an
	 * aggregator, while on `ollama/auto` — or any local or vendor server a user
	 * happens to name `auto` — the same word is an ordinary model. An id-only
	 * lookup renamed it (measured on the Python side: `ollama/auto` went from
	 * rendering `Ollama` to rendering `Auto`), which is the collision the
	 * provider gate exists to prevent. It also outranks `refused`, since an
	 * aggregator's own listing name is refused for every other id it resells.
	 */
	const router =
		AGGREGATOR_PROVIDERS.has(provider) &&
		AGGREGATOR_ROUTER_MODEL_IDS.has(model.model_id);
	return {
		name: router ? ROUTER_DISPLAY_NAME : refused ? bareId(selector) : display,
		selector,
	};
}

/**
 * Which spec each of the band's two readings is drawn from, while a pick is
 * unconfirmed.
 *
 * ## Why the two readings come from different specs
 *
 * The user's own paint OUTRANKS the owner for the IDENTITY reading: a switch
 * that pays a cold runtime bind measures 1.1-4.2 s, and the one thing the user
 * asked is whether their choice registered (latency U1).
 *
 * It must NOT outrank the effort reading. The paint is assembled from the picked
 * ROW (`destination-pickers.tsx`), which carries a provider, a model_id and a
 * display name and nothing else — `reasoning_efforts` is absent, so
 * `effortState` answers `null` (an absent ladder, not an empty one) and the chip
 * VANISHES for the whole pending window, then reflows back in when it returns.
 * That is the class this file already refuses: a cold snapshot ships the label
 * `unknown` rather than nothing, because rendering nothing is a claim. The
 * in-force spec is also the honest reading for that window — the session is
 * still running the model it was running, and the level in force is that
 * model's.
 */
export function bandReadings(
	frontend: CanonicalFrontendState | null | undefined,
	pendingModel: CanonicalModel | null,
): { identity: CanonicalModel | null; effort: CanonicalModel | null } {
	// `selected_model` is the fallback for an owner that reports no effective
	// spec (nothing has run yet), which is the state a fresh session is in.
	const inForce = frontend?.effective_model ?? frontend?.selected_model ?? null;
	return { identity: pendingModel ?? inForce, effort: inForce };
}

/** The fast dial's three states; `null` is "nothing to report" (not OFF). */
export type FastModeState = "on" | "off" | null;

/**
 * The fast dial, read off ONE spec for every surface that shows it: the
 * strip's badge and the `/fast` row's right-edge slot both call this. The
 * CALLER picks the spec, and the two call sites pick differently inside an
 * unconfirmed model switch — the chip's path passes `pendingModel ?? inForce`
 * (`bandReadings` above), the row the spec in force — so in that window the
 * two describe different specs, each truthful; outside it they read the same
 * fields.
 *
 * Mirrors `_fast_label` (defined in `local_operator/tui/app.py`; its word is
 * what `tui/widgets/status_line.py`'s `fast` segment paints): a model that does
 * not report the tier (`supports_fast_mode !== true`) gets NOTHING — the segment's
 * presence is the message there, and an `off` would claim a dial the model does
 * not have. Only a model that HAS the tier can be on or off, and "not on" is
 * the same fact from the spec's `false` and from a frame that omits the flag
 * (the backend clamps `fast_mode` to `supports_fast_mode` — `providers/
 * failover.py:2715` — so it is never true where the tier is absent).
 */
export function fastModeState(
	model: CanonicalModel | null | undefined,
): FastModeState {
	if (model?.supports_fast_mode !== true) return null;
	return model.fast_mode === true ? "on" : "off";
}

/**
 * The rungs a spec carries, in the spec's own order, or an empty list when it
 * carries none.
 *
 * Deliberately NOT `effortState`: that answers "what does the chip read",
 * including the metadata-absent branch that synthesises `unknown` for a cold
 * snapshot. This answers "which rows can a picker offer", which for a DRAFT pane
 * must be the wire's own list and nothing else — a draft's picker is a pure read
 * of the preview, so it cannot offer a rung the resolution did not name (R5 of
 * the wire contract). One definition, so the chip and the dialog agree about
 * what the ladder is.
 */
export function effortLadder(
	model: CanonicalModel | null | undefined,
): string[] {
	if (!Array.isArray(model?.reasoning_efforts)) return [];
	return model.reasoning_efforts.filter(
		(rung): rung is string => typeof rung === "string" && rung !== "",
	);
}

/**
 * The level a spec REPORTS it will run with no rung chosen, or `null` when it
 * reports none.
 *
 * Deliberately NOT `effortState`'s `label`, for the reason `effortLadder` gives
 * for not being `effortState` either: that function answers "what does the chip
 * read", where a synthesised category word IS the honest answer - `auto` for a
 * model with a ladder and no level in force, `reasoning` for a reasoning model
 * that exposes no rungs, `unknown` for a snapshot carrying no metadata at all.
 * A sentence that NAMES a level a conversation will run at cannot use any of
 * them: they are states of a reading, not levels, and one in a level slot is
 * the category noun the strip's own copy already refuses (`effortState`'s
 * `auto` branch records that history). Only the two fields that carry a level
 * are read here, so a spec that reports neither gets `null` - which the caller
 * answers with "No effort level is set on it" rather than a word nobody chose
 * (review round 4 F4's residual slot, filed again in round 5).
 *
 * Lowercased and trimmed, matching `effortState`: this is prose about a level,
 * not a value the wire will be asked about, so it needs no ladder spelling.
 */
export function effortLevel(
	model: CanonicalModel | null | undefined,
): string | null {
	if (!model) return null;
	for (const field of [
		model.reasoning_effort,
		model.reasoning_default_effort,
	]) {
		if (typeof field === "string" && field.trim())
			return field.trim().toLowerCase();
	}
	return null;
}

/**
 * The sentence that explains why the effort chip shows a level the user did
 * not choose, or `null` when the choice is the level in force.
 *
 * WHY THIS EXISTS (operator report, 2026-10-21): a session set to `Max` showed
 * `High` after a message with no explanation. The chip reads the EFFECTIVE spec
 * on purpose (see this file's header), and a fallback route serving at its own
 * level is a correct `High`. But a correct value with no reason looks like the
 * dial moving on its own. The backend already states the reason
 * (`effort_displacement`, the same sentence the TUI prints as a notice). Until
 * now no desktop surface read it.
 *
 * The backend composes `note` once, so every client says the same words. The
 * sentence is never re-derived from `chosen`/`effective`. One substitution is
 * made: the two `provider/model_id` labels inside it are replaced with the
 * models' own `display_name` when the frame carries one for that exact pair
 * (design review: a raw slug beside the model chip's curated name reads as a
 * second vocabulary for one model). The pair must match exactly, so a name is
 * never put on a model it does not describe. A frame that carries a block
 * without a usable `note`, or an older host that sends nothing, is `null`: no
 * claim, and the chip renders exactly as before.
 */
export function effortDisplacementNote(
	frontend: CanonicalFrontendState | null | undefined,
): string | null {
	const block = frontend?.effort_displacement;
	const raw = block?.note;
	if (typeof raw !== "string" || !raw.trim()) return null;
	const labels = new Map<string, string>();
	for (const spec of [frontend?.effective_model, frontend?.selected_model]) {
		const name =
			typeof spec?.display_name === "string" ? spec.display_name.trim() : "";
		if (!spec || !name || !spec.provider || !spec.model_id) continue;
		const slug = `${spec.provider}/${spec.model_id}`;
		if (slug !== block?.serving && slug !== block?.selected) continue;
		labels.set(slug, name);
	}
	if (!labels.size) return raw.trim();
	// Match whole identifiers in ONE pass (review R1): `p/m` must never eat
	// `p/m-mini`, and a display name containing another slug is prose, not a
	// second substitution target. Sentence punctuation delimits the producer's
	// identifiers; a dot inside a model id is not a delimiter.
	const escaped = [...labels.keys()]
		.sort((a, b) => b.length - a.length)
		.map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const occurrences = new RegExp(
		`(^|[\\s(])(${escaped.join("|")})(?=$|[\\s;,)\\]}]|\\.(?=\\s|$))`,
		"g",
	);
	return raw
		.trim()
		.replace(
			occurrences,
			(_match, before, slug) => `${before}${labels.get(slug)}`,
		);
}

/**
 * The rung the conversation CHOSE while a displacement is in force, or `null`.
 *
 * The `/effort` picker marks the rung it would change. Its live reading is the
 * EFFECTIVE spec (the status chip's field, so the two agree after a switch).
 * While a fallback serves at another level, though, that reading is the level
 * in force (`High`), not the selection (`Max`). The picker then ticked a rung
 * the user never picked, and re-picking `Max` looked like a change. The
 * backend's `chosen` is the conversation's own choice, so it outranks the live
 * reading exactly while a displacement is published.
 */
export function effortChosenRung(
	frontend: CanonicalFrontendState | null | undefined,
): string | null {
	const chosen = frontend?.effort_displacement?.chosen;
	return typeof chosen === "string" && chosen.trim()
		? chosen.trim().toLowerCase()
		: null;
}

/**
 * The effort LEVEL's title-cased human form for a value slot.
 *
 * The chip and the `/effort` picker print a level beside the model name, and
 * the model chip already reads `Auto` (not `auto`) after the router-name fix.
 * A value column of capitalised names with a lowercase `high`/`auto` beside
 * them reads as a raw wire token rather than a name, so the two columns are
 * cased alike. `Auto` in particular now names a real, SENT level on the
 * Radient router route, so it belongs beside `Claude Opus 5`, not `claude-opus-5`.
 *
 * ONLY THE LEVELS ARE CASED. `effortState` also returns two STATE words that are
 * not levels at all - `unknown` (a cold snapshot that has not reported yet) and
 * `reasoning` (a reasoning model that exposes no rungs) - and they read the same
 * way the rest of this file's prose reads: `Reasoning effort: unknown.` and
 * `Reasoning effort: reasoning.` Title-casing those turns the aria sentence into
 * nonsense (`Reasoning effort: Reasoning.`), so a word outside the level
 * vocabulary passes through untouched rather than being cased by its first
 * letter. The vocabulary is exactly what `/effort` accepts plus the `auto`
 * sentinel, which is what makes the boundary the LEVEL rather than an arbitrary
 * word list.
 *
 * DISPLAY ONLY. The value this describes is unchanged: `reasoning_effort` goes
 * on the wire lowercase, the picker's `value` and its `current` comparison stay
 * the raw rung, and nothing MATCHES on this string. One owner for the casing,
 * so the chip and the picker cannot drift into casing the same word two ways.
 */
export function effortDisplay(level: string): string {
	const trimmed = level.trim();
	if (!trimmed) return trimmed;
	const known: Record<string, string> = {
		auto: "Auto",
		none: "None",
		minimal: "Minimal",
		low: "Low",
		medium: "Medium",
		high: "High",
		xhigh: "xHigh",
		max: "Max",
	};
	// A non-level word (`unknown`, `reasoning`, or a rung this file does not
	// know) is returned as-is: it is a state or an unfamiliar token, not a level.
	return known[trimmed.toLowerCase()] ?? trimmed;
}

export type EffortState = {
	/** The word the chip prints. */
	label: string;
	/**
	 * Whether clicking should open `/effort`.
	 *
	 * False when the model has no ladder to pick from. The chip then renders as
	 * a plain label rather than a button: a control that opens a picker with
	 * nothing in it is a dead control, and the branding contract's answer to a
	 * control that cannot succeed is not to render one (see the composer's
	 * read-only working-directory chip for the same rule).
	 */
	adjustable: boolean;
	/**
	 * Whether the LADDER itself is known, as opposed to the level in force.
	 *
	 * Distinct from `adjustable` because the two answer different questions and
	 * round 2 showed what conflating them costs: a cold owner's chip is
	 * adjustable (opening it is how the spec resolves) while its ladder is
	 * unknown, and a fixed-effort model's ladder is known to be empty while the
	 * chip is not adjustable. Only this flag may decide whether the picker's
	 * rung list has anything to add.
	 */
	knownLadder: boolean;
	/**
	 * Whether the LEVEL on the chip is a fact about the model, as opposed to the
	 * synthesised `unknown` a cold snapshot produces.
	 *
	 * Distinct from `knownLadder`, which is about the RUNGS: a spec can report
	 * an explicit level while carrying no ladder, and that level is known. A
	 * surface that must not print a level nobody has (a draft, which has no
	 * owner to resolve one) asks this rather than either of the other two flags.
	 */
	levelKnown: boolean;
	/** Why the level reads the way it does, for the tooltip. */
	detail: string;
};

/**
 * Whether this spec is UNRESOLVED, as opposed to describing a model with
 * nothing to report.
 *
 * An owner that has not yet resolved its model answers with a selector and
 * nothing else: no `display_name`, `reasoning: false`, `reasoning_efforts: []`.
 * A genuine non-reasoning model never matches, because it still carries a
 * `display_name`. That distinction is the whole difference between "not known
 * yet" and "this model has no levels", and every surface that reads an empty
 * ladder needs it.
 *
 * Exported because the `/effort` PICKER needs the same test. It was deriving a
 * capability claim from an unresolved read - telling the user a four-rung model
 * "has no adjustable effort" and to "pick a reasoning model with /model first"
 * - which is exactly the inference removed from `reconcileEffort` one file over
 * (UX round 3, U12). One predicate, so the chip and the picker cannot disagree
 * about what an empty ladder means; a second copy would be the defect this
 * consolidates.
 *
 * A session that has not chosen a model at all reports an EMPTY selector and
 * has no effort to be unknown about - it is silent, not amnesiac. Verified
 * against the real cold-session capture in
 * `scripts/fixtures/session-status-capture.json`.
 */
export function specUnresolved(
	model: CanonicalModel | null | undefined,
): boolean {
	if (!model) return false;
	const explicit =
		typeof model.reasoning_effort === "string"
			? model.reasoning_effort.trim()
			: "";
	const fallbackDefault =
		typeof model.reasoning_default_effort === "string"
			? model.reasoning_default_effort.trim()
			: "";
	return (
		typeof model.model_id === "string" &&
		model.model_id !== "" &&
		!explicit &&
		!fallbackDefault &&
		!model.reasoning &&
		Array.isArray(model.reasoning_efforts) &&
		model.reasoning_efforts.length === 0 &&
		typeof model.display_name === "string" &&
		model.display_name.trim() === ""
	);
}

/**
 * The model the EFFORT QUERY keys on, read THROUGH THE HOLD - the same
 * `frontend ?? heldFrontend` fallback the strip and the destination pickers
 * paint from (task-17, F3).
 *
 * WHY IT IS ONE FUNCTION rather than two reads at the call site: reading only
 * `frontend` made every GAP look like the unresolved -> resolved edge the
 * effort query invalidates for - a gap drops `frontend` to null (the
 * authoritative snapshot is gone until its replacement lands), so the model
 * read as `null` for the whole gap and the next snapshot restored it, one
 * null -> model transition per reconnect, each spending a `commands.entities`
 * round trip to prove nothing had changed (measured: one refetch per
 * gap->snapshot cycle). The hold is dropped by every terminal state and by a
 * real session change, so the fallback cannot keep a stale model alive past
 * the point where the pane stops describing a stream. Exported, and asserted
 * in `scripts/session-status.test.mjs`, so the next surface that keys a query
 * on the model reads the same rule instead of re-deriving it from `frontend`.
 */
export function effortQueryModel(
	frontend: CanonicalFrontendState | null | undefined,
	heldFrontend: CanonicalFrontendState | null | undefined,
): string | null {
	const spec = (frontend ?? heldFrontend)?.effective_model;
	return specUnresolved(spec) ? null : (spec?.model_id ?? null);
}

/**
 * `_effort_label`, plus the older-backend degradation the TUI never needs.
 *
 * The TUI reads a live `ModelSpec` object and can rely on every field being
 * present. This reads a JSON dump from an owner that may predate
 * `reasoning_efforts` / `reasoning_default_effort` entirely, so `undefined` is
 * a fourth state the Python has no equivalent for: the ladder is not empty,
 * it is UNKNOWN. An unknown ladder cannot justify the word `auto` (which
 * asserts a ladder exists), so the fallback is the model's default level when
 * the owner sent one and nothing at all when it did not — the same rule the
 * rest of this strip follows, that a missing field degrades to an honest
 * silence rather than to a guess.
 */
export function effortState(
	model: CanonicalModel | null | undefined,
): EffortState | null {
	if (!model) return null;
	const explicit =
		typeof model.reasoning_effort === "string"
			? model.reasoning_effort.trim().toLowerCase()
			: "";
	const ladder = Array.isArray(model.reasoning_efforts)
		? model.reasoning_efforts.filter((rung) => typeof rung === "string")
		: null;
	const fallbackDefault =
		typeof model.reasoning_default_effort === "string"
			? model.reasoning_default_effort.trim().toLowerCase()
			: "";
	/*
	 * The spec is a real dump in which every metadata field is simultaneously
	 * empty - which is a cold snapshot, not a model.
	 *
	 * The test is PRESENT-AND-EMPTY, never absent. `ModelSpec.model_dump()`
	 * emits every field, so a spec that came off the wire always carries
	 * `display_name` as a string and `reasoning_efforts` as an array: the key
	 * being missing entirely means an owner that predates the field, which is a
	 * different case with a different honest answer below. This is the same
	 * absent-vs-empty distinction this function already draws for the ladder,
	 * applied to the rest of the metadata.
	 *
	 * A genuine non-reasoning model never matches, because it still has a
	 * `display_name`.
	 */
	const metadataAbsent = specUnresolved(model);

	if (explicit)
		return {
			label: explicit,
			// An explicit level came from somewhere, so a ladder exists even when
			// this dump does not carry one: the owner's own `/effort` is the
			// authority on what else it could be set to.
			adjustable: ladder === null || ladder.length > 0,
			// Known only when this dump actually carried the rungs.
			knownLadder: Boolean(ladder && ladder.length > 0),
			levelKnown: true,
			detail:
				ladder && ladder.length > 0
					? `Reasoning effort. This model offers ${ladder.join(", ")}.`
					: "Reasoning effort for this session.",
		};

	if (ladder && ladder.length > 0)
		return {
			// The same word `/effort auto` uses for this state, so the strip and
			// the command share one vocabulary. It used to read `reasoning` in the
			// TUI, which is a category noun in a value slot and looked like a
			// sixth level.
			label: "auto",
			adjustable: true,
			knownLadder: true,
			levelKnown: true,
			detail: `No level is set, so this model runs at its own default${
				fallbackDefault ? ` (${fallbackDefault})` : ""
			}. It offers ${ladder.join(", ")}.`,
		};

	/*
	 * Ladder present and EMPTY, on a spec that carries no metadata at all.
	 *
	 * A COLD SNAPSHOT is the case: `GET /sessions/{id}` answers with a selector
	 * and nothing else - `display_name: ""`, `reasoning: false`,
	 * `reasoning_efforts: []` - for a model that in fact has a full ladder. Round
	 * 1 shipped that as "no ladder", so after every reload the effort chip
	 * vanished until the next turn ran (U1). Rendering nothing is a claim, and
	 * there it was the false one - the same argument this file already makes
	 * about refusing to spell an unknown ladder `auto`.
	 *
	 * `metadataAbsent` is how the two are told apart: a genuine no-ladder model
	 * arrives through `refresh_from_session` with a real `display_name`, so an
	 * empty ladder NEXT TO an empty name is a snapshot that has not been told
	 * rather than a model with nothing to tell.
	 */
	if (metadataAbsent)
		return {
			label: "unknown",
			/*
			 * ADJUSTABLE, despite knowing nothing.
			 *
			 * Round 1 made this inert on the reasoning that a chip should not
			 * offer what it cannot describe. Round 2 showed the cost: this is the
			 * state every app start begins in, `/effort low` succeeds in it, and
			 * an inert chip left the picker - which resolves the spec by asking
			 * the owner - reachable only by typing the command the chip exists to
			 * replace (U8/U10).
			 *
			 * An unresolved ladder is not an absent one, so the honest control is
			 * the one that can find out. The copy says so rather than naming
			 * rungs it does not know.
			 */
			adjustable: true,
			// The whole point of this branch: the ladder is NOT known.
			knownLadder: false,
			// The level itself is synthesised, not reported: this branch exists
			// because the spec carries no metadata at all. A surface with no owner
			// to resolve one (a draft) must render nothing rather than this word.
			levelKnown: false,
			/*
			 * Promises only what the click delivers. Round 2 said "run /effort",
			 * round 3 said "open this to see the levels now" - and opening the
			 * chip is a READ (`desktop_catalogues.py:270-273`), so it cannot
			 * resolve the spec and the picker had nothing to show. Setting a rung
			 * is the one act that resolves it, so that is what the sentence names
			 * (UX round 3, U12).
			 */
			detail:
				"This session has not reported its reasoning effort yet. It appears after the next turn, or run /effort <level> to set one now.",
		};
	// Ladder present and EMPTY: a reasoning model with no rungs to choose from.
	if (ladder && model.reasoning)
		return {
			label: "reasoning",
			adjustable: false,
			// The spec DID carry the ladder; it is empty. That is knowledge, and
			// it is the only source entitled to make this control read-only.
			knownLadder: true,
			levelKnown: true,
			detail:
				"This model reasons, but exposes no effort levels to choose between.",
		};

	// Ladder UNKNOWN (an owner that predates the field). The default level is
	// the only honest thing left to show, and it is not adjustable from here
	// because nothing on this wire says what the rungs are.
	if (ladder === null && fallbackDefault)
		return {
			label: fallbackDefault,
			adjustable: false,
			knownLadder: false,
			levelKnown: true,
			detail:
				"The level this model runs at by default. This backend does not report which other levels it accepts.",
		};

	// Non-reasoning, or an old backend with nothing to say. Rendering nothing
	// is what makes the chip's presence informative.
	return null;
}

/**
 * Fold the picker's live rung list into the chip's reading.
 *
 * ## What round 2 proved, and why this is not the round-1 rule inverted
 *
 * Round 1's rule was "the picker's list wins, because it is the source that
 * acts". That premise was wrong, and the evidence is in the backend:
 * `command-entities?command=effort` reads `remote.model.reasoning_efforts`
 * (`server/routes/desktop_catalogues.py:270-273`) and `/effort <rung>`
 * validates against `spec.reasoning_efforts` on the SAME owner spec
 * (`serving.py:1977-1991`). They are one field read at two times, not a policy
 * and a mirror of it. So an empty list does not mean "every value will be
 * refused" - it means the owner has not resolved its spec yet, and setting a
 * rung is itself what resolves it.
 *
 * Treating empty as a refusal made the chip inert on every cold owner - the
 * first state every user meets - while telling them "this model runs at a fixed
 * reasoning effort; no other level can be set for it" about a model with four
 * rungs, which `/effort low` then set successfully (round 2, U8). That is a
 * confident falsehood where round 1 merely had an over-offer, and it survived a
 * full turn and 25s; only a reload cleared it.
 *
 * ## The rule now
 *
 * An empty list is EVIDENCE OF NOTHING and is treated that way: the chip keeps
 * its own reading, because the stream's spec is the fresher fact and the only
 * one either side can act on. The list is consulted only when it is non-empty,
 * where it genuinely adds information the stream may lack - a rung the owner
 * accepts that this dump did not carry - and then it makes the chip adjustable
 * rather than less so.
 *
 * The read-only form is therefore reached the way it always should have been:
 * from the SPEC saying a reasoning model exposes no rungs (`effortState`), not
 * from an absence in a second source. Nothing here overwrites `detail`, which
 * is what made the honest-unknown copy unreachable (round 2, U10).
 */
export function reconcileEffort(
	state: EffortState | null,
	entities: readonly unknown[] | undefined,
): EffortState | null {
	if (!state) return null;
	if (!entities || entities.length === 0) return state;
	// Nothing to add when the spec already named the ladder: the stream is the
	// authority on the reading, and this list would only restate it.
	if (state.knownLadder) return state;
	const rungs = entities
		.map((row) =>
			typeof row === "object" && row !== null && "value" in row
				? String((row as { value: unknown }).value)
				: "",
		)
		.filter(Boolean);
	if (rungs.length === 0) return state;
	return {
		...state,
		adjustable: true,
		detail: `Reasoning effort. This model offers ${rungs.join(", ")}.`,
	};
}

/**
 * The selected provider's access reading, or `null` when no status is needed.
 *
 * ## What this reads, and the two silences
 *
 * The runtime publishes `model_access` beside `selected_model` (see
 * `CanonicalModelAccess`): a session's model is pinned in its journal and can
 * outlive the credential that once made it runnable, and this is the one
 * field that states the consequence. Core #2342 adds `effective_state`, so
 * borrowed access, owner convergence and expiry are NOT local sign-out.
 * Eligible permission stays unverified; only the serving runtime can publish
 * effective borrowed access. Historical expiry is never bearer permission.
 *
 * For an OLD host without that field:
 *   - `ok` is the healthy case and renders nothing;
 *   - an ABSENT field is a host that predates the contract, and silence there
 *     must not be read as "signed out" - the same rule the Radient verdict
 *     reads `unknown` under (`use-radient-session-issue`). A nag invented from
 *     an older backend's silence would be a claim the frame does not make.
 *
 * ## The label fallback
 *
 * `label` is the provider's human name for the sentence ("Anthropic (Claude
 * Pro/Max)" reads better than `anthropic`), but it is display metadata and
 * may arrive empty; the sentence still has to name something, so it falls
 * back to the provider id. The PROVIDER (id) is what the Connect action
 * needs, so it is never the label that travels to `openConnect`.
 *
 * A frame is untrusted wire data, so a field that is not a string is treated
 * as not published rather than stringified - `"[object Object]"` in the
 * sentence would be worse than silence.
 */
export type ModelAccessReading = {
	/** Provider id - what the Connect action opens. */
	provider: string;
	/** The provider's human name for the sentence; never empty. */
	label: string;
	state?: "signed_out" | "temporarily_unavailable";
	/** Native access is the serving host's observation, never inferred from a holder row. */
	effectiveState?: CanonicalEffectiveAccessState;
	owner?: string;
	observedAt?: number;
	lastGrantAt?: number;
	lastGrantExpiresAt?: number;
	/** Only an explicitly local serving catalogue row can authorize the local Connect callback. */
	connectHere?: boolean;
};

export function modelAccessReading(
	frontend: CanonicalFrontendState | null | undefined,
	servingLocality?: "local" | "remote",
): ModelAccessReading | null {
	const access: CanonicalModelAccess | null | undefined =
		frontend?.model_access;
	if (access && typeof access.effective_state === "string") {
		const provider = wireWords(access.provider);
		if (!provider) return null;
		const selectedProvider = wireWords(frontend?.selected_model?.provider);
		if (selectedProvider && selectedProvider !== provider) return null;
		const states: readonly CanonicalEffectiveAccessState[] = [
			"local",
			"pending",
			"eligible_borrow_unverified",
			"effective_borrow",
			"expired",
			"withdrawn",
			"owner_unavailable",
			"device_bound",
			"absent",
		];
		// A future state cannot be promoted from the old coarse `ok` field.
		// Keep it pending until the reader understands its access guarantee.
		const effectiveState = states.includes(
			access.effective_state as CanonicalEffectiveAccessState,
		)
			? (access.effective_state as CanonicalEffectiveAccessState)
			: "pending";
		if (effectiveState === "local") return null;
		// This concerns the SELECTED provider even when a different fallback is
		// serving. Never rewrite that selection or hide an owner's outage behind
		// the fallback's local login. The old-host branch below is unchanged.
		return {
			...(effectiveState === "absent"
				? { connectHere: servingLocality === "local" }
				: {}),
			provider,
			label: wireWords(access.label) || provider,
			effectiveState,
			owner:
				wireWords(access.owner_label) ||
				wireWords(access.owner_device) ||
				"the owner device",
			observedAt: epochSeconds(access.observed_at),
			lastGrantAt: epochSeconds(access.last_grant_at),
			lastGrantExpiresAt: epochSeconds(access.last_grant_expires_at),
		};
	}
	if (
		!access ||
		(access.state !== "signed_out" &&
			access.state !== "temporarily_unavailable")
	)
		return null;
	const provider = typeof access.provider === "string" ? access.provider : "";
	if (!provider) return null;
	// A partial fallback frame can retain the primary route's older claim.
	// Hide that obsolete accusation; this makes NO claim that the effective
	// route is authenticated and never changes the selected primary identity.
	const servingProvider = frontend?.effective_model?.provider;
	if (servingProvider && servingProvider !== provider) return null;
	const label =
		typeof access.label === "string" && access.label.trim() !== ""
			? access.label
			: provider;
	return access.state === "temporarily_unavailable"
		? { provider, label, state: access.state }
		: { provider, label };
}

/** Use only the matching catalogue's published locality, never peer/owner labels. */
export function modelAccessLocality(
	rows: readonly { session_id: string; locality?: unknown }[],
	sessionId: string | undefined,
): "local" | "remote" | undefined {
	if (!sessionId) return undefined;
	const locality = rows.find((row) => row.session_id === sessionId)?.locality;
	return locality === "local" || locality === "remote" ? locality : undefined;
}

/** The composer decision, exercised with its real sessionStatus context contract. */
export function composerModelAccessReading(
	status:
		| {
				frontend: CanonicalFrontendState | null;
				draft?: boolean;
				servingLocality?: "local" | "remote";
		  }
		| undefined,
): ModelAccessReading | null {
	return status && status.draft !== true
		? modelAccessReading(status.frontend, status.servingLocality)
		: null;
}

function wireWords(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function epochSeconds(value: unknown): number | undefined {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 8.64e12
		? value
		: undefined;
}

function accessTime(value: number): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value * 1000));
}

/**
 * One sentence/action register for the actual band and contract tests. Owner
 * resolution states never offer a second OAuth entrance: the runtime repairs
 * them on the next request. Device-bound sign-in belongs on the serving device,
 * which this generic Connect callback cannot target safely.
 *
 * `effective_borrow` proves resolved access, not a local login. This keyless
 * contract does not publish credential kind, so neither an OAuth subscription
 * nor an API key is inferred from the provider's display label.
 */
export function modelAccessPresentation(access: ModelAccessReading): {
	title: string;
	description: string;
	history: string;
	tone: "warning" | "neutral";
	canConnect: boolean;
	canSwitchModel: boolean;
} {
	const { label, effectiveState } = access;
	const owner = access.owner || "the owner device";
	const readings: Record<CanonicalEffectiveAccessState, [string, string]> = {
		local: [
			`${label} access available`,
			"This session uses its own provider access.",
		],
		pending: [
			`Checking ${label} access`,
			"Access has not converged yet. The next request checks the owner automatically; no additional sign-in is needed here.",
		],
		eligible_borrow_unverified: [
			`Checking access from ${owner}`,
			`This session may borrow ${label} access, but it has not resolved it yet. The next request verifies ${owner} automatically.`,
		],
		effective_borrow: [
			`${label} access from ${owner}`,
			"The runtime resolved borrowed access for this session. Every new request checks the owner again.",
		],
		expired: [
			`Fresh ${label} access needed`,
			`The last borrowed grant expired, but borrowing permission is still present. The next request asks ${owner} for fresh access automatically.`,
		],
		withdrawn: [
			`${label} access needs attention`,
			"The owner cannot currently provide borrowed access, or borrowing permission is unavailable. Restore owner access or permission before retrying, or choose another model.",
		],
		owner_unavailable: [
			`${owner} cannot provide access`,
			`This session could not resolve ${label} access from ${owner}. Previous access cannot be reused. Retry after owner access is restored, or choose another model.`,
		],
		device_bound: [
			`${label} needs a device sign-in`,
			"This login cannot be borrowed. Sign in on the device running this session, or choose another model.",
		],
		absent: [
			`No ${label} access`,
			access.connectHere === true
				? "The serving device has no effective provider access for this session. Connect an account or choose another model."
				: "The device running this session has no effective provider access. Sign in or restore access on that device, or choose another model.",
		],
	};
	const legacyUnavailable = access.state === "temporarily_unavailable";
	const [title, description] = effectiveState
		? readings[effectiveState]
		: [
				legacyUnavailable
					? t("ui.chat.session_status.temporarily_unavailable", { label })
					: t("ui.chat.session_status.not_signed_in", { label }),
				legacyUnavailable
					? t("ui.chat.session_status.temporarily_unavailable_description")
					: t("ui.chat.session_status.not_signed_in_description", {
							label,
						}),
			];
	const context: string[] = [];
	if (effectiveState && access.observedAt !== undefined) {
		context.push(`Last checked: ${accessTime(access.observedAt)}.`);
	}
	if (effectiveState && access.lastGrantAt !== undefined) {
		context.push(`Last resolved: ${accessTime(access.lastGrantAt)}.`);
	}
	if (effectiveState && access.lastGrantExpiresAt !== undefined) {
		context.push(
			`Recorded grant expiry: ${accessTime(access.lastGrantExpiresAt)}.`,
		);
	}
	if (
		effectiveState &&
		(access.lastGrantAt !== undefined ||
			access.lastGrantExpiresAt !== undefined)
	) {
		context.push("History only; not permission to reuse access.");
	}
	return {
		title,
		description,
		history: context.join(" "),
		tone: effectiveState === "effective_borrow" ? "neutral" : "warning",
		canConnect: effectiveState
			? effectiveState === "absent" && access.connectHere === true
			: !legacyUnavailable,
		canSwitchModel: effectiveState !== "effective_borrow",
	};
}

/**
 * The states where the Radient callout IS the sign-in: it offers it
 * (`needs-sign-in`), is running it (`signing-in`), or offers its retry
 * (`settled` with `canRetry`).
 *
 * WHY THE SET IS THIS NARROW (design round 2, D7). The band yields to the
 * callout (R1-6) so one missing sign-in reads as one block — and yielding takes
 * the band's `Switch model` with it, which the callout does not offer in any
 * state. That is the right trade exactly while the callout carries the remedy
 * itself: its `Sign in to Radient` button, its `Retry`, or a flow already in
 * flight. In the states that offer no sign-in action — `settled` refusals
 * (`sign-in-active`, `no-browser-flow`: a pointer and a dismissal, nothing to
 * press toward a sign-in) and `input-required` — the band stays, because
 * there its two exits are the only ones on screen.
 */
export function radientCalloutOwnsTheSignIn(
	issue: RadientSessionIssue,
): boolean {
	return (
		issue.kind === "needs-sign-in" ||
		issue.kind === "signing-in" ||
		(issue.kind === "settled" && issue.canRetry)
	);
}

/**
 * Whether the model-access band yields to the Radient callout (agent review
 * round 1, R1-6; narrowed by design round 2, D7).
 *
 * The two standing blocks can name the SAME missing sign-in: a `radient/auto`
 * session whose connector verdict says sign-in is required AND whose
 * `model_access` says `signed_out` for `radient` would stack the callout and
 * the band, each offering its own entrance to the same remedy
 * (`radientIssue.start` vs `openConnect`). The callout is the more specific
 * half — it names the connector, polls its state and starts that sign-in — so
 * the band yields while the callout OWNS the sign-in
 * (`radientCalloutOwnsTheSignIn` states which states those are, and why the
 * refusals are not among them). Any other provider cannot collide with the
 * Radient connector, so this is the whole of the rule.
 */
/** Borrowed/owner states are not the connector's local sign-in problem. */
export function modelAccessOwnsRadientStatus(
	access: ModelAccessReading | null,
): boolean {
	return (
		access?.provider === "radient" &&
		access.effectiveState !== undefined &&
		(access.effectiveState !== "absent" || access.connectHere !== true)
	);
}

export function bandYieldsToRadientIssue(
	access: {
		provider: string;
		effectiveState?: CanonicalEffectiveAccessState;
		connectHere?: boolean;
	},
	radientCalloutOwnsTheSignIn: boolean,
): boolean {
	return (
		radientCalloutOwnsTheSignIn &&
		access.provider === "radient" &&
		(access.effectiveState === undefined ||
			(access.effectiveState === "absent" && access.connectHere === true))
	);
}
