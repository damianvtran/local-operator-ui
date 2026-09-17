/*
 * The registry, read from the backend that owns it.
 *
 * WHY THIS FILE EXISTS. The committed fixture
 * (`scripts/fixtures/backend-settings-registry*.json`) is the ONLY description of
 * the settings registry this repository has, and until now nothing derived it: it
 * was authored from one `settings_io.SETTINGS` at one moment and hand-tweaked
 * afterwards. That is how it came to describe 99 keys in 18 sections while the
 * released server the desktop app talks to served 102 in 19 — and the tier drift
 * test, which reads the fixture, could not see the difference, because a fixture
 * is not evidence about a wire it does not describe (QA round 1, Q1).
 *
 * So the fixture gets a lineage. Two things use this module:
 *
 *   1. `scripts/derive-backend-settings-fixture.mjs` writes both committed
 *      states straight from the registry, so regenerating them is one command
 *      rather than an archaeology exercise;
 *   2. `scripts/backend-settings-tiers.test.mjs` asserts the committed fixture
 *      against the registry itself — key set and section list — so the drift
 *      test can fail on a registry the fixture does not describe, which is the
 *      one failure it existed to catch and could not.
 *
 * WHAT IS DERIVED, AND WHAT IS ADDED. Every field of the projection is
 * `server/routes/settings.py::_view`'s own output, called rather than
 * reimplemented, so a label, a help sentence, a `default` or an enum's choices
 * cannot disagree with the wire. Three fields that file does NOT project —
 * `warning`, `placeholder`, `gated_by` — are copied from the registered
 * `Setting` when it carries them, because the fixture models the projection the
 * additive backend change (local-operator!1188) will send; the released server
 * drops all three and the UI reads them as optional. Keeping them here is what
 * lets the story frames show the intended rendering. It is also why a frame is
 * not evidence that the shipped wire carries them: that is QA's round against a
 * running server, and the comment says so at the call sites too.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The writes that turn the fresh projection into the committed configured one.
 *
 * Data rather than a script, so "what is the configured state" is one readable
 * list instead of the difference between two JSON files. Every value goes
 * through the registry's own `write_setting`, which is also what makes the
 * fixture's `is_default` a REGISTRY judgement: `is_default` compares the stored
 * value against the shipped default (`settings_io.is_default`), so a key written
 * to exactly its default stays `is_default: true` — which is the intended
 * reading, not a gap in the list below. `tool_approval_mode` and
 * `session.cleanup.enabled` are kept deliberately for that reason.
 *
 * `tui.theme` is written as `light` rather than an app palette name: the value
 * has to be one the REGISTRY binds, and the app's own palette names are not in
 * `settings_io`'s choice list.
 */
export const CONFIGURED_WRITES = [
	["hosting", "openrouter"],
	["model_name", "deepseek/deepseek-chat"],
	["model_effort", "high"],
	["providers.openrouter.sort", "price"],
	["providers.openrouter.order", ["deepseek", "groq"]],
	["retry.maxRetries", 5],
	["tui.theme", "light"],
	["tool_approval_mode", "ask"],
	["session.cleanup.enabled", false],
	["session.cleanup.max_sessions", 50],
	["subagents.max_running", 6],
	["compaction.enabled", false],
	["web_search.enabled", false],
	["web_search.providers", ["searxng", "duckduckgo"]],
];

/**
 * The cascade the configured state carries.
 *
 * The cascade editor renders one editor per CHAIN, so an empty chain map renders
 * no editor at all — the two committed fixtures used to carry `{}`, which left
 * the registry's only `cascade` key unrenderable in every frame and in every
 * story. One chain is enough for the editor to exist, which is what the dirty /
 * saving / failed states drive.
 */
export const CONFIGURED_CHAINS = {
	openrouter: ["openrouter/deepseek/deepseek-chat"],
};

/**
 * The fields the projection does not send yet, copied from the registry.
 *
 * Named here rather than inlined so the sentence above stays true of one list:
 * adding a fourth additive field is a change to this array and the Python below.
 */
const ADDITIVE_FIELDS = ["warning", "placeholder", "gated_by"];

/*
 * The projection, taken from the backend's own manager.
 *
 * An inline program rather than a file in the backend repository: this is a
 * READ of `settings_io`, and a read that has to be installed into another repo
 * is one that goes stale in that repo. The config directory is a fresh temp dir
 * because `ConfigManager` creates a `config.yml` on construction — the operator's
 * own configuration must never be opened, let alone written, by a fixture
 * derivation.
 */
const PROJECTION_PROGRAM = `
import json, shutil, sys, tempfile
from pathlib import Path

from local_operator import settings_io
from local_operator.config import ConfigManager
from local_operator.server.routes.settings import _view

# The same three additive fields the committed fixture models; see the module
# docstring for why they are here and not on the wire.
ADDITIVE = ${JSON.stringify(ADDITIVE_FIELDS)}

def project(manager):
    settings = []
    for setting in settings_io.SETTINGS:
        # _view is the wire's own serializer, called rather than reimplemented.
        view = _view(manager, setting).model_dump()
        for field in ADDITIVE:
            value = getattr(setting, field, None)
            if value:
                view[field] = value
        settings.append(view)
    return {
        "sections": [
            {
                "name": section.name,
                "title": section.title,
                "scope": section.scope.value,
                "description": section.description,
            }
            for section in settings_io.SECTIONS
        ],
        "settings": settings,
    }

plan = json.load(sys.stdin)
root = Path(tempfile.mkdtemp(prefix="lo-registry-"))
try:
    fresh = project(ConfigManager(root / "fresh"))
    configured = ConfigManager(root / "configured")
    for key, value in plan["writes"]:
        settings_io.write_setting(configured, settings_io.resolve_key(key), value)
    if plan["chains"]:
        settings_io.write_chains(configured, plan["chains"])
    configured = project(configured)
finally:
    shutil.rmtree(root, ignore_errors=True)

sys.stdout.write("---REGISTRY---" + json.dumps({"fresh": fresh, "configured": configured}))
`;

/** The marker the program prints before its payload, to survive stray output. */
const MARKER = "---REGISTRY---";

/**
 * Every interpreter that could be carrying a backend, in the order they are
 * tried.
 *
 * The RELEASED runtime comes before any checkout, and that order is the whole
 * point of this list: the desktop app talks to whatever `lop serve` the operator
 * has installed, so the registry worth deriving from is the one that `lop-update`
 * last built — not whichever commit a worktree happens to sit on. Measured here:
 * the checkout at `~/local-operator` was three keys and one section BEHIND the
 * installed runtime, which is exactly how the fixture came to describe a registry
 * nobody was serving (QA round 1, Q1).
 *
 * An explicit variable wins over both, because a caller naming an interpreter is
 * stating which backend it means — a worktree mid-change, or a version under
 * test.
 */
function interpreters() {
	const roots = [
		process.env.LOCAL_OPERATOR_BACKEND_ROOT,
		join(homedir(), "local-operator"),
	].filter(Boolean);
	return [
		process.env.LOCAL_OPERATOR_BACKEND_PYTHON,
		join(
			homedir(),
			".local",
			"share",
			"uv",
			"tools",
			"local-operator",
			"bin",
			"python",
		),
		...roots.map((root) => join(root, ".venv", "bin", "python")),
	].filter(Boolean);
}

/**
 * The registry's projection, or `null` when no backend can be reached.
 *
 * `null` is a first-class answer rather than a thrown error: this is read by a
 * test that has to run on a machine with no backend checkout (CI does), and by
 * a script whose whole job is to say so. The thrown case is reserved for a
 * backend that IS there and refuses to answer, which is a defect rather than an
 * absence.
 */
export function readRegistryProjection({
	writes = CONFIGURED_WRITES,
	chains = CONFIGURED_CHAINS,
} = {}) {
	const plan = JSON.stringify({ writes, chains });
	const attempted = [];
	for (const interpreter of interpreters()) {
		if (!existsSync(interpreter)) continue;
		attempted.push(interpreter);
		const result = spawnSync(interpreter, ["-c", PROJECTION_PROGRAM], {
			input: plan,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		if (result.status !== 0) continue;
		const at = (result.stdout ?? "").indexOf(MARKER);
		if (at === -1) continue;
		return {
			interpreter,
			...JSON.parse(result.stdout.slice(at + MARKER.length)),
		};
	}
	if (attempted.length > 0) {
		throw new Error(
			`a backend interpreter was found (${attempted.join(", ")}) but none could read the registry`,
		);
	}
	return null;
}
