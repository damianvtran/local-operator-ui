/**
 * Projects labels, remote-session clauses and project refusal codes follow the
 * ACTIVE locale, read AFTER the modules were imported.
 *
 *     node --test scripts/i18n-projects-remote-literals.test.mjs
 *
 * WHY THIS SUITE EXISTS (i18n slice a, 2026-11-25; the operator's contract:
 * "switching to `fr` must leave NO English anywhere in the interface"):
 *
 * - P1: `PROGRESS_STALE_LABEL`, `NO_TEAM_LABEL` and `PROJECT_NOT_MOVED_COPY`
 *   were module-level constants read from the bundled English at import - the
 *   same import-time freeze as the status options (E1). They are now
 *   `progressStaleLabel()`, `noTeamLabel()` and `projectNotMovedCopy()`.
 * - R1: `chat-remote.ts` returned English literals (`on <device>`,
 *   `unreachable · …`, `it did not answer`, `another device`) that the sidebar
 *   flyout AND the row's `sr-only` accessible name read in every language.
 * - R2: the flyout's `openedByNote` appended an English ` in “…”` and a Latin
 *   `, ` to the translated attribution. That helper lives inside the
 *   nine-thousand-line sidebar component no suite can execute, so it is
 *   pinned on source, like `scripts/i18n/chat-header-sidebar-copy.test.mjs`.
 * - C1: `project_invalid`, `project_store_busy` and `project_schema_newer`
 *   showed the backend's English sentence on the create sheet and the inline
 *   editors. They are now mapped by machine CODE.
 *
 * HOW THE IMPORT-TIME BUG IS REPRODUCED: the bundle loads while the store is
 * English (as in the app before negotiation) and only THEN is the locale
 * switched. Keys the shipped fr catalogue already carries (P1) are compared
 * with it; the NEW keys have no translation yet (the translator round adds
 * them), so a marker catalogue is registered for fr and the assertion is that
 * the marker - not English - comes back. A value captured at load, or an
 * English literal, cannot produce the marker.
 *
 * WHAT IT DOES NOT PROVE: pixels, or the repaint itself (the call sites read
 * these during render in components subscribed via `useI18nLocale()`; that
 * reactivity is pinned by `scripts/i18n/locale-reactivity.test.mjs`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * as model from "./src/renderer/src/features/projects/project-model";',
			'export * as refusals from "./src/renderer/src/features/projects/project-refusals";',
			'export * as remote from "./src/renderer/src/features/chat/chat-remote";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { setLocale, currentLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared/i18n": resolve("src/i18n/index.ts"),
		"@shared": resolve("src/renderer/src/shared"),
	},
});
const {
	model,
	refusals,
	remote,
	DesktopControlError,
	setLocale,
	currentLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const catalogue = (locale, ns) =>
	JSON.parse(
		readFileSync(resolve(`src/i18n/catalogues/${locale}/${ns}.json`), "utf8"),
	);
const frProjects = catalogue("fr", "ui.projects");

/*
 * Read through the call-time API when it exists, else the old constant: on the
 * pre-fix code the failure is then an assertion about ENGLISH (the defect),
 * not a TypeError about a missing export.
 */
const read = (fn, constant) =>
	typeof model[fn] === "function" ? model[fn]() : model[constant];

/* Markers for the keys the translators have not reached yet (see header). */
const MARKERS = {
	"ui.chat.sidebar_notes.remote_another_device": "FR-autre-appareil",
	"ui.chat.sidebar_notes.remote_on_device": "FR-sur {device}",
	"ui.chat.sidebar_notes.remote_on_device_network":
		"FR-sur {device} / {network}",
	"ui.chat.sidebar_notes.remote_unreachable_no_answer": "FR-injoignable",
	"ui.chat.sidebar_notes.remote_unreachable_reason": "FR-injoignable: {reason}",
	"ui.projects.project_refusals.project_invalid": "FR-invalide",
	"ui.projects.project_refusals.project_store_busy": "FR-occupe",
	"ui.projects.project_refusals.project_schema_newer": "FR-plus-recent",
};

assert.match(currentLocale(), /^en\b/, "the bundle loads before any switch");

afterEach(() => {
	clearRegisteredCatalogues();
	setLocale("en");
});

const toFrench = () => {
	setLocale("fr");
	registerCatalogue("fr", MARKERS);
};

test("P1: module-level projects labels follow a switch to fr made after import", () => {
	assert.equal(read("progressStaleLabel", "PROGRESS_STALE_LABEL"), "Stale");
	assert.equal(read("noTeamLabel", "NO_TEAM_LABEL"), "No team");
	toFrench();
	assert.equal(
		read("progressStaleLabel", "PROGRESS_STALE_LABEL"),
		frProjects["ui.projects.project_model.stale"],
	);
	assert.equal(
		read("noTeamLabel", "NO_TEAM_LABEL"),
		frProjects["ui.projects.project_model.no_team"],
	);
	assert.equal(
		read("projectNotMovedCopy", "PROJECT_NOT_MOVED_COPY"),
		frProjects[
			"ui.projects.project_model.the_project_was_not_moved_try_again_or_open_it_to_change_its_stat"
		],
	);
});

const row = (over = {}) => ({
	session_id: "aaaaaaaaaaaa",
	locality: "remote",
	owner_device: "dev-123456",
	owner_device_name: "cloud-node-1",
	...over,
});

test("R1: remote-session clauses are English in en and keyed in fr", () => {
	/* English is byte-identical to the literals it replaces. */
	assert.equal(
		remote.remoteClause(row(), "damian-mesh"),
		"on cloud-node-1 · damian-mesh",
	);
	assert.equal(remote.remoteClause(row(), null), "on cloud-node-1");
	assert.equal(
		remote.remoteUnreachableClause(row({ reachable: false })),
		"unreachable · it did not answer",
	);
	assert.equal(
		remote.remoteUnreachableClause(
			row({ reachable: false, unreachable_reason: "link down 4m ago" }),
		),
		"unreachable · link down 4m ago",
	);
	assert.equal(
		remote.remoteDeviceLabel(row({ owner_device: "", owner_device_name: "" })),
		"another device",
	);

	toFrench();
	assert.equal(
		remote.remoteClause(row(), "damian-mesh"),
		"FR-sur cloud-node-1 / damian-mesh",
	);
	assert.equal(remote.remoteClause(row(), null), "FR-sur cloud-node-1");
	assert.equal(
		remote.remoteUnreachableClause(row({ reachable: false })),
		"FR-injoignable",
	);
	assert.equal(
		remote.remoteUnreachableClause(
			row({ reachable: false, unreachable_reason: "link down 4m ago" }),
		),
		"FR-injoignable: link down 4m ago",
		"the wire's reason rides verbatim inside the translated clause",
	);
	assert.equal(
		remote.remoteDeviceLabel(row({ owner_device: "", owner_device_name: "" })),
		"FR-autre-appareil",
	);
	assert.equal(remote.remoteUnreachableClause(row({ reachable: true })), "");
});

test("R2: the flyout's opened-by note has no English fragment or ASCII joiner", () => {
	const source = readFileSync(
		resolve("src/renderer/src/features/chat/components/chat-sidebar.tsx"),
		"utf8",
	);
	const start = source.indexOf("const openedByNote = ");
	assert.ok(start > 0, "openedByNote exists");
	const body = source.slice(start, source.indexOf("};", start));
	assert.doesNotMatch(body, /` in “/, "no English ` in “…”` fragment");
	assert.doesNotMatch(body, /`, \$\{/, "no literal ', ' joiner");
	assert.match(body, /listSeparator\(\)/);
	assert.match(body, /ui\.chat\.sidebar_notes\.opened_by_named_in/);
	assert.match(body, /ui\.chat\.sidebar_notes\.opened_by_anonymous_in/);
});

const refusal = (code, message) =>
	new DesktopControlError(
		code === "project_store_busy" ? 503 : 409,
		message,
		undefined,
		code,
	);

const CODED = [
	["project_invalid", "invalid tag 'Bad Tag'", "FR-invalide"],
	[
		"project_store_busy",
		"timed out waiting for the project registry lock",
		"FR-occupe",
	],
	[
		"project_schema_newer",
		"project 'x' was written by schema 3",
		"FR-plus-recent",
	],
];

test("C1: create and edit refusals are mapped by code, never shown as the backend's English", () => {
	toFrench();
	for (const [code, english, marker] of CODED) {
		const error = refusal(code, english);
		assert.equal(
			refusals.projectCreateErrorCopy(error),
			marker,
			`create: ${code}`,
		);
		assert.equal(
			refusals.projectWriteErrorCopy(error),
			marker,
			`edit: ${code}`,
		);
	}
});

test("C1: an unmapped code keeps today's fallback (the message as written)", () => {
	toFrench();
	const error = refusal("project_something_new", "some backend sentence");
	assert.equal(refusals.projectCreateErrorCopy(error), "some backend sentence");
	assert.equal(refusals.projectWriteErrorCopy(error), "some backend sentence");
	/* An inherited name is wire data, not a mapping. */
	const proto = refusal("constructor", "proto sentence");
	assert.equal(refusals.projectCreateErrorCopy(proto), "proto sentence");
});
