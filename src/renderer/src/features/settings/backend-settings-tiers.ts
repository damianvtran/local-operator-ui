/**
 * Which registry keys belong to the everyday list, and which sit one click away.
 *
 * Why this exists. The Backend settings section ships 102 rows in 19 sections
 * (the audit that motivated this work measured the then-shipping 99 in 18, and
 * the counts moved with the backend rather than with this map), every section
 * open, which measured 10,896.5px of region on a 1380x900 window (12.1 screens)
 * and put 127 focusables into the tab order before a user had done anything. The
 * fix is a two-tier list, and a tier cannot be INFERRED:
 * `kind` is documented as "how a value is EDITED" (`settings_io.py:84-91`), not
 * who should edit it, and `is_default` is a value comparison (`:2215-2219`), so
 * a heuristic would either hide everything on a fresh install or hide nothing on
 * a working one — the one failure mode with no user-visible symptom. Hence a
 * curated map, authored as data, with a drift test as the detector.
 *
 * The resolution order is one-directional and fails closed:
 *
 *   1. the server's own field, when a future server carries one (`tier` on
 *      `SettingView`; this repo and `~/local-operator` release independently, so
 *      the client must be able to answer without it — the backend field is a
 *      fast-follow that REMOVES this map, never a prerequisite);
 *   2. `KEY_TIER`, this file;
 *   3. `SECTION_TIER`, for a key the curation missed in a section whose members
 *      agree;
 *   4. `advanced`.
 *
 * Step 4 is a lookup default rather than an inference: an unclassified key is
 * merely one click away, never silently promoted into the everyday list.
 *
 * Nothing here gates a write. Search reaches every key at every tier, and the
 * `Show advanced` filter is a view, not a permission.
 *
 * The authoring rule, stated so the next key can be judged rather than guessed:
 * a key is `core` iff its LABEL ALONE STATES THE CHOICE, with no help text
 * needed — a feature's own master switch, the new-conversation defaults, or a
 * control over the surface the user is looking at. Nothing whose value is a
 * tuning scalar, an allow/deny list, a URL, a budget or a price, and never the
 * cascade editor.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";

/** The two tiers a registry row can occupy. */
export type SettingTier = "core" | "advanced";

/**
 * The curated map, one line per registered key.
 *
 * It names EVERY key the wire can produce, deliberately: the drift test
 * (`scripts/backend-settings-tiers.test.mjs`) fails when the fixture gains a key
 * this map does not classify, and fails again when this map holds a key the
 * fixture no longer names — so a key added to the registry lands `advanced`
 * (step 4) and turns the test red until somebody decides which tier it belongs
 * to. A map that classified only the core keys could never tell "unclassified"
 * from "deliberately advanced", which is the whole detector.
 *
 * That detector reads the fixture, so it inherits the fixture's reach: a key the
 * fixture does not describe is a key no assertion here can see. The registry
 * itself is what closes that gap, and the same test reads it when one is
 * reachable (`scripts/backend-settings-registry.mjs`).
 */
export const KEY_TIER: Record<string, SettingTier> = {
	// model (3)
	hosting: "core",
	model_name: "core",
	model_effort: "core",
	// providers (3)
	"providers.openai.use_max_context_window": "advanced",
	"providers.openai.api": "advanced",
	"providers.anthropic.cache_ttl_1h_min_context_tokens": "advanced",
	// openrouter (14)
	"providers.openrouter.provider_affinity": "advanced",
	"providers.openrouter.sort": "advanced",
	"providers.openrouter.order": "advanced",
	"providers.openrouter.only": "advanced",
	"providers.openrouter.ignore": "advanced",
	"providers.openrouter.allow_fallbacks": "advanced",
	"providers.openrouter.require_parameters": "advanced",
	"providers.openrouter.data_collection": "advanced",
	"providers.openrouter.zdr": "advanced",
	"providers.openrouter.enforce_distillable_text": "advanced",
	"providers.openrouter.quantizations": "advanced",
	"providers.openrouter.max_price": "advanced",
	"providers.openrouter.preferred_min_throughput": "advanced",
	"providers.openrouter.preferred_max_latency": "advanced",
	// failover (10)
	"retry.enabled": "core",
	"retry.maxRetries": "advanced",
	"retry.baseDelayMs": "advanced",
	"retry.connectivityMaxRetries": "advanced",
	"retry.connectivityBackoffCapMs": "advanced",
	"retry.modelFallback": "advanced",
	"retry.usageAwareFallback": "advanced",
	"retry.usageAwareAccountPick": "advanced",
	"retry.usageReservePercent": "advanced",
	"retry.fallbackChains": "advanced",
	// appearance (13)
	/*
	 * `tui.theme` is `advanced`, and the reason is the authoring rule above
	 * rather than taste. Its label is "Theme", which in the DESKTOP surface
	 * reads as this app's own theme — the page above this one owns that with
	 * `ThemeSelector` — while the registry's help is the terminal's ("Colour
	 * ramp. /theme switches it live with an arrow-key preview."). A label that
	 * needs its help text to say which application it belongs to is not a label
	 * that states its choice, and §7 of the spec already records these 15 TUI
	 * rows as terminal-facing and tiered `advanced`; the map said `core`, so
	 * the code and the record disagreed (review round 1, m2).
	 */
	"tui.theme": "advanced",
	"display.shimmer": "advanced",
	"display.comfortable_rows": "advanced",
	"display.nerd_icons": "advanced",
	"display.heading_markers": "advanced",
	"display.terminal_title": "advanced",
	"display.images": "advanced",
	"display.notifications": "core",
	"display.notification_session_name": "advanced",
	"display.time_format": "advanced",
	"display.dock": "advanced",
	"tui.sidebar_visible": "advanced",
	"tui.sidebar_position": "advanced",
	// keymap (2)
	"keymap.new_session": "advanced",
	"keymap.resume": "advanced",
	// approvals (1)
	tool_approval_mode: "core",
	// session (6)
	auto_save_conversation: "core",
	"session.cleanup.enabled": "core",
	"session.cleanup.max_sessions": "advanced",
	"session.cleanup.max_inactive_days": "advanced",
	"session.cleanup.max_total_bytes": "advanced",
	"session.cleanup.remove_empty": "advanced",
	// runtime (2)
	"runtime.background_on_resume": "advanced",
	"runtime.unattended_gate_timeout": "advanced",
	// subagents (5)
	"subagents.max_running": "advanced",
	"subagents.model_choice": "advanced",
	"subagents.models.lo": "advanced",
	"subagents.models.med": "advanced",
	"subagents.models.hi": "advanced",
	// fork (2)
	"fork.mode": "core",
	"fork.cmux_placement": "advanced",
	// compaction (9)
	"compaction.enabled": "core",
	"compaction.strategy": "advanced",
	"compaction.threshold_percent": "advanced",
	"compaction.threshold_tokens": "advanced",
	"compaction.keep_recent_tokens": "advanced",
	"compaction.auto_continue": "advanced",
	"compaction.mid_turn_enabled": "advanced",
	"compaction.wire_bytes_budget": "advanced",
	"compaction.wire_bytes_trigger": "advanced",
	// web_tools (2)
	"web_search.enabled": "core",
	"web_fetch.enabled": "core",
	// web_search (6)
	"web_search.strategy": "advanced",
	"web_search.providers": "advanced",
	"web_search.timeout_seconds": "advanced",
	"web_search.searxng_endpoint": "advanced",
	"web_search.deepseek_evidence": "advanced",
	"web_search.read_enabled": "advanced",
	// web_fetch (9)
	"web_fetch.timeout_seconds": "advanced",
	"web_fetch.max_bytes": "advanced",
	"web_fetch.max_redirects": "advanced",
	"web_fetch.cache_ttl_seconds": "advanced",
	"web_fetch.allow_private": "advanced",
	"web_fetch.render_backend": "advanced",
	"web_fetch.enrich": "advanced",
	/* Both of these are judgements rather than fall-throughs, which is what the
	 * drift detector asks for when the registry gains a key: "Attempts per hop"
	 * is a tuning scalar (1-5, sharing the call's own timeout), and
	 * "Browser-profile retry" does not state its choice from its label alone —
	 * a reader cannot tell WHAT is retried until its help says so. */
	"web_fetch.max_attempts": "advanced",
	"web_fetch.blocked_retry": "advanced",
	// tools (1)
	"bash.shell": "advanced",
	// local_providers (10)
	"providers.lmstudio.base_url": "advanced",
	"providers.lmstudio.models": "advanced",
	"providers.ollama.base_url": "advanced",
	"providers.ollama.models": "advanced",
	"providers.vllm.base_url": "advanced",
	"providers.vllm.models": "advanced",
	"providers.llamacpp.base_url": "advanced",
	"providers.llamacpp.models": "advanced",
	"providers.openai-compatible.base_url": "advanced",
	"providers.openai-compatible.models": "advanced",
	// retired (3)
	conversation_length: "advanced",
	detail_length: "advanced",
	max_learnings_history: "advanced",
	/*
	 * `desktop` (1): "launch command" is a command LINE — a template with a
	 * `{session}` placeholder — and its label alone cannot say what is being
	 * launched or when it runs instead of app discovery. It is classified here
	 * rather than left to the fall-through deliberately: the section arrived with
	 * the registry three keys ahead of this map, and a key that lands `advanced`
	 * by accident is indistinguishable from one that lands there by decision
	 * (QA round 1, Q1 asked for the judgement, this is it).
	 */
	"desktop.launch_command": "advanced",
};

/**
 * The section fallback, for a key `KEY_TIER` does not classify.
 *
 * Only the sections whose members genuinely agree appear here. A section with a
 * split (compaction's master switch beside eight tuning keys) is deliberately
 * absent: falling back to `core` there would promote every tuning scalar in it,
 * which is the mislabel the authoring rule exists to prevent.
 */
export const SECTION_TIER: Record<string, SettingTier> = {
	model: "core",
	approvals: "core",
	web_tools: "core",
	/*
	 * A single-member section, and the only one here whose membership cannot
	 * split: everything in it describes how the desktop app is launched, and
	 * none of those keys will state their own choice from their label either.
	 * Named so the next key added to `desktop` is a decision rather than a
	 * fall-through — the same judgement the KEY_TIER line above records.
	 */
	desktop: "advanced",
};

/** The tier of one row: server, then key, then section, then `advanced`. */
export function tierFor(
	setting: Pick<BackendSetting, "key" | "section"> &
		Partial<Pick<BackendSetting, "tier">>,
): SettingTier {
	if (setting.tier === "core" || setting.tier === "advanced") {
		return setting.tier;
	}
	return KEY_TIER[setting.key] ?? SECTION_TIER[setting.section] ?? "advanced";
}

/**
 * Whether a section is open on arrival, before any interaction.
 *
 * A section opens iff at least half its rows are `core` — the spec's "each
 * closed except the core-heavy ones". Derived from the tier map rather than
 * listed a second time, so a re-tiered key moves the arrival layout with it
 * instead of leaving a hand-written list behind. On the shipping 102-key
 * registry this opens Model (3/3 core), Approvals (1/1), Fork (1/2) and Web tools
 * (2/2) — four sections and seven rows, whose height plus the 19 headers keeps the
 * arrival region inside its 1,600px budget. The other fifteen sections are closed
 * on arrival, including the one-member `desktop` section (0/1 core).
 */
export function opensOnArrival(
	rows: readonly Pick<BackendSetting, "key" | "section" | "tier">[],
): boolean {
	if (rows.length === 0) return false;
	const core = rows.filter((row) => tierFor(row) === "core").length;
	return core * 2 >= rows.length;
}

/**
 * What `Expand all` / `Collapse all` moves, as a function of whether a filter is
 * up.
 *
 * The two presses are not the same press, and conflating them was a defect in
 * both directions at once (UX round 2, U13 and U14; the same defect QA's round 2
 * filed as Q8, and proved new by running the identical sequence on the
 * pre-remediation tree):
 *
 *  - UNFILTERED the press is about the whole list, so it writes the reader's own
 *    `opened`/`closed` and leaves the FILTER's set EMPTY. It used to seed that set
 *    with "the sections holding core rows" — a query-shaped subset of a list no
 *    query was asking about — and the filtered view reads an entry there as "the
 *    reader shut this section", which is what suppresses the force-open a search
 *    performs. `Collapse all` then `provider` reported "35 results in 6 sections"
 *    with two matched sections collapsed and 30 rows rendered.
 *  - FILTERED the press is about the list on screen, so it writes the filter's set
 *    — which is cleared when the filter is, so the choice cannot outlive the query
 *    — and must NOT touch the reader's layout, or which sections are collapsed
 *    after the search clears is decided by a query already cleared (U14: after the
 *    press and a cleared query, Model was shut and three sections the query never
 *    touched were open).
 *
 * Exported for the same reason `opensOnArrival` is: the decision is pure, so the
 * behavior can be asserted from a unit test — and it is, in
 * `scripts/backend-settings-tiers.test.mjs`. That arm binds the DECISION, not
 * this file's caller, so `scripts/backend-settings-collapse.test.mjs` renders the
 * shipped component and drives the reader's real sequence (`Collapse all`, then
 * a query). An earlier version of this comment claimed the sequence was "not
 * reachable from this repository's renderer tests", which overstated the cost:
 * the repository already carried jsdom + React harnesses for other surfaces, and
 * with the handler reverted to its pre-fix inline form while this function stayed
 * exported and intact, the decision arm is 11/11 green while the rendered arm
 * fails 3/3 — the regression lived in the CALL (agent review round 3, M4).
 */
export function allOpenTargets(
	open: boolean,
	filtering: boolean,
	names: readonly string[],
): {
	layout: { opened: string[]; closed: string[] } | null;
	filter: string[];
} {
	if (filtering) return { layout: null, filter: open ? [] : [...names] };
	return {
		layout: { opened: open ? [...names] : [], closed: open ? [] : [...names] },
		filter: [],
	};
}
