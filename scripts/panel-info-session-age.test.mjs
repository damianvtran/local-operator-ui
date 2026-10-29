/**
 * `/info`'s stored rows: a STAMP is not an AGE.
 *
 *     node --test scripts/panel-info-session-age.test.mjs
 *
 * The panel painted a 56-year duration on every stopped session, because
 * `last_activity_s` arrives as the transcript file's mtime in epoch seconds
 * (`builtin.py::_sessions_list` puts `session_row.mtime` there) and the model
 * formatted that absolute number through `formatDuration`. The operator's fleet
 * report spells it `497932h ago` (the terminal's hours formatter); this panel's
 * own `formatDuration` spells the same value `20747d 4h ago`. Either way it is a
 * value that cannot be a duration at all, and neither spelling is left available
 * to a regression: the control below rebuilds the OLD expression from the same
 * formatter and asserts the row does not render it.
 *
 * The acceptance for this file is the operator's own repro: a stamp of
 * 1792555200 (2026-10-21T00:00:00-04:00) read at 05:00 local must render an age
 * of 5h. The clock is INJECTED (`sessionLineRows(lines, id, nowS)`) rather than
 * mocked globally, so every expectation below is arithmetic on one fixed pair of
 * numbers and cannot drift with the wall clock or the test's timezone.
 *
 * The states the change must distinguish, all here: a stamp with no stop
 * recorded, a stamp with a recorded stop (short reason, long measured reason,
 * empty token), no stamp at all, a zero stamp, and a LIVE row — which carries
 * `last_activity_s` too and must keep rendering uptime, because a stop line over
 * a running session would claim an end that has not happened.
 *
 * The two labels are part of the acceptance rather than decoration: `last
 * active …` beside `stopped …` is what tells a reader a session left no exit
 * record (design round 1, D1), and `reason:` is what tells them the token after
 * it came from the core (D2).
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * The bundle is a real file under `node_modules/.cache` for the reason
 * `panel-info-fleet.test.mjs` states: a `data:` URL cannot resolve a bare
 * specifier. React stays external; the model under test imports only formatters.
 */
const CACHE = join(ROOT, "node_modules/.cache/panel-info-session-age");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		jsx: "automatic",
		packages: "external",
		loader: { ".css": "empty" },
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@renderer": resolve("src/renderer/src"),
			"@features": resolve("src/renderer/src/features"),
		},
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const MODEL = "src/renderer/src/features/chat/pickers/panels/info-model.ts";
const { sessionLineRows, stampAge } = await bundleInto(
	"info-session-age-model",
	`export { sessionLineRows, stampAge } from "./${MODEL}";`,
);
/* The formatter the bug passed the raw stamp through, for the control below. */
const { formatDuration } = await bundleInto(
	"info-session-age-formatter",
	`export { formatDuration } from "./src/renderer/src/features/chat/pickers/panels/formatters.ts";`,
);

/** 2026-10-21T00:00:00-04:00 — the stamp from the operator's repro. */
const STAMP = 1_792_555_200;
/** 05:00 the same local morning, so the honest age is exactly five hours. */
const NOW = STAMP + 5 * 3600;

/*
 * Top-level, not inline: `useTopLevelRegex` is a warning rather than an error
 * here, but a file this change touches lands lint-clean (the rule exists because
 * a regex compiled inside a hot path is work repeated on every call).
 */
const EPOCH_DURATION_DAYS = /\b\d{4,}d\b/;
const STOP_CLAIM = /stopped/;
/*
 * The clause separator carries NON-BREAKING spaces (`\u00A0`) so the stop cell
 * cannot wrap with a dangling `·` (design round 1, D7). Asserted as the shipped
 * character rather than by normalising it away, because the character IS the fix.
 */
const SEP = "\u00A0·\u00A0";

/** One stored registry row, in the shape `info.get` sends. */
const storedLine = (over = {}) => ({
	pid: 79_100,
	kind: "tui",
	state: "stored",
	session_id: "c3d4e5f6a1b2",
	conversation_name: "",
	model_label: "",
	cwd: "~/workspace",
	uptime_s: 0,
	heartbeat_age_s: 4_200,
	rss_bytes: null,
	footprint_bytes: null,
	last_activity_s: null,
	pending: null,
	busy: false,
	detached: true,
	version: "0.20.1",
	source_ref: "",
	...over,
});

const uptimeOf = (line, nowS = NOW) =>
	sessionLineRows([line], "a1b2c3d4e5f6", nowS)[0].uptime;

test("an epoch stamp renders as an age, not as half a million hours", () => {
	const uptime = uptimeOf(storedLine({ last_activity_s: STAMP }));
	assert.equal(uptime, "last active 5h 0m ago");
	/*
	 * The BUG ITSELF, rebuilt from the same formatter: `formatDuration(stamp)`
	 * over the raw field. A future regression renders exactly this, so it is
	 * asserted as an absence by construction rather than by a magic string.
	 */
	assert.notEqual(uptime, `${formatDuration(STAMP)} ago`);
	assert.doesNotMatch(uptime, EPOCH_DURATION_DAYS);
});

test("the same stamp read a day later is a day older, not a new absolute", () => {
	assert.equal(
		uptimeOf(storedLine({ last_activity_s: STAMP }), NOW + 86_400),
		"last active 1d 5h ago",
	);
});

test("no stamp renders the unknown word, never a zero age", () => {
	assert.equal(uptimeOf(storedLine({ last_activity_s: null })), "unknown");
});

test("a recorded stop shows its own age and the raw reason token", () => {
	const uptime = uptimeOf(
		storedLine({
			last_activity_s: NOW - 7_500,
			stopped_at_s: NOW - 7_200,
			stop_reason: "idle-exit",
			stop_requested: false,
		}),
	);
	assert.equal(uptime, `stopped 2h 0m ago${SEP}reason: idle-exit`);
});

test("a recorded stop with no reason still claims only the stop", () => {
	assert.equal(
		uptimeOf(
			storedLine({
				last_activity_s: NOW - 2_000,
				stopped_at_s: NOW - 1_800,
				stop_reason: null,
			}),
		),
		"stopped 30m ago",
	);
});

test("no recorded stop keeps last activity as the only claim", () => {
	const uptime = uptimeOf(
		storedLine({ last_activity_s: NOW - 3 * 3600, stopped_at_s: null }),
	);
	assert.equal(uptime, "last active 3h 0m ago");
	assert.doesNotMatch(uptime, STOP_CLAIM);
});

test("an older backend that sends no stop fields at all is unchanged", () => {
	/*
	 * The base builder carries no stop keys at all — the older backend's shape.
	 * An ABSENT field and a `null` one reach the same decision here, which is why
	 * both are exercised.
	 */
	assert.equal(
		uptimeOf(storedLine({ last_activity_s: NOW - 600 })),
		"last active 10m ago",
	);
});

test("the core's long measured reason is kept whole behind the label", () => {
	const reason =
		"idle-exit (busy probe unusable for 3 samples: no heartbeat after 90s)";
	const uptime = uptimeOf(
		storedLine({ stopped_at_s: NOW - 60, stop_reason: reason }),
	);
	assert.equal(uptime, `stopped 1m ago${SEP}reason: ${reason}`);
});

test("the core's empty reason token is no reason, not an empty clause", () => {
	assert.equal(
		uptimeOf(storedLine({ stopped_at_s: NOW - 60, stop_reason: "" })),
		"stopped 1m ago",
	);
});

test("a LIVE row renders uptime even when it carries a stamp", () => {
	const uptime = uptimeOf(
		storedLine({
			state: "live",
			uptime_s: 8_400,
			last_activity_s: NOW - 2,
			/* Defensive: a stale stop field on a live row names no stop of this run. */
			stopped_at_s: NOW - 600,
			stop_reason: "idle-exit",
		}),
	);
	assert.equal(uptime, "2h 20m");
});

test("a stamp from the future clamps to zero rather than a negative age", () => {
	assert.equal(stampAge(NOW + 60, NOW), "0s");
	assert.equal(stampAge(null, NOW), null);
	assert.equal(stampAge(undefined, NOW), null);
});

test("a zero stamp is the never-recorded spelling, not January 1970", () => {
	assert.equal(stampAge(0, NOW), null);
	assert.equal(
		uptimeOf(storedLine({ last_activity_s: 0, stopped_at_s: 0 })),
		"unknown",
	);
});
