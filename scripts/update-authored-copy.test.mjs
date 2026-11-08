/**
 * KEYED UPDATE-SERVICE MESSAGES ARE AUTHORED COPY IN EVERY LOCALE (PR #1760,
 * design round 1, D1).
 *
 * WHY THIS FILE EXISTS. The update toast decides whether a `backend-update-error`
 * message is a sentence for a person or machine output with `isAuthoredSentence`
 * in `update-error-copy.ts`: at least four SPACE-separated words, at most 400
 * characters, and no status-code-shaped number. English always passes. The
 * translations this PR ships do not: zh-CN has no spaces between words, fr
 * "environ 450 Mo" reads as an HTTP 450, and the fr fleet refusals run past the
 * length cap. The toast then said "the update check could not complete; the app
 * will retry" over a refusal that was no check and would not retry, with the real
 * reason in the monospace Details block.
 *
 * THE FIX IS AT THE SOURCE: the update service knows which payloads it composed
 * from catalogue keys, so it marks them (`authored` on `BackendUpdateErrorReport`)
 * and the renderer skips the guess. A caught value (`getaddrinfo ENOTFOUND ...`)
 * carries no mark and keeps the classifier.
 *
 * WHAT IS PROVEN
 * 1. For every shipped locale (read from `i18n/languages.json`, not a hand list)
 *    and every keyed message the service can emit, the marked path returns the
 *    message as the sentence with no machine detail, no retry action and never
 *    the "check incomplete" headline.
 * 2. NEGATIVE CONTROL: the unmarked path (what the toast did before the fix, the
 *    marked branch being purely additive) reproduces the defect on the exact
 *    messages the designer measured - zh-CN disk_space, fr disk_space, fr fleet
 *    "unknown" - so a green row above cannot be a probe that cannot fail.
 * 3. Machine output keeps the classifier in en: raw electron-updater errors,
 *    `ERR_` codes, status codes and stack-shaped text still come out as the
 *    stage/check sentence with the machine's own words under it.
 * 4. A STATIC GUARD on `update-service.ts` (not importable without an Electron
 *    fixture): every `backend-update-error` payload whose message is catalogue
 *    copy carries `authored`, the two that carry a caught error do not, and every
 *    `message` key the service references is in the enumeration below, so a new
 *    keyed message cannot ship unmarked or untested.
 * 5. `not_installed` ("sentence") splits at the first blank line (the installer's
 *    error after it is machine voice) while the fleet refusals ("message") keep
 *    their blank line between two authored paragraphs.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export {
				serverUpdateFailureReason,
				updateErrorCopy,
				updateErrorMessage,
			} from "./src/renderer/src/shared/utils/update-error-copy";
			export { serverUpdateFailureSentence } from "./src/main/server-update-copy";
			export { fleetDrainRefusalSentence } from "./src/main/backend/fleet-drain";
			export { setupFailureCause } from "./src/main/backend/setup-failure-causes";
			export { clearRegisteredCatalogues, registerCatalogue, t } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
			export { bundledCatalogues } from "./src/i18n/keys.gen";
		`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".json": "json" },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	serverUpdateFailureReason,
	updateErrorCopy,
	serverUpdateFailureSentence,
	fleetDrainRefusalSentence,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
	bundledCatalogues,
	t,
} = mod;

const manifest = JSON.parse(await readFile("i18n/languages.json", "utf8"));
// `en` is the source language and is not a manifest row; it is swept too, because
// the marked path must be the identity there as well.
const shipped = [
	"en",
	...manifest.languages
		.filter((row) => row.status === "supported")
		.map((row) => row.code),
];

/** The reader-facing "check incomplete" headline in the ACTIVE locale. */
const checkIncomplete = () => t("ui.common.updates.error.check_incomplete");

/**
 * Every keyed message the service can send on `backend-update-error`, as
 * `[label, key-or-builder]`. Parameters use the values that stress the
 * classifier: 450 MB (fr "450 Mo" matched the HTTP-status alternative), a
 * five-digit process group, a version.
 */
const MESSAGES = [
	[
		"release_publishing",
		() =>
			t("ui.updates.service.release_publishing.message", {
				version: "0.54.44",
			}),
	],
	[
		"check_unavailable",
		() => t("ui.updates.panel.service.check_unavailable.message"),
	],
	["version_unknown", () => t("ui.updates.service.version_unknown.message")],
	[
		"attempt_running unknown age",
		() =>
			t("ui.updates.service.attempt_running.message_unknown_age", {
				group: "4242",
			}),
	],
	[
		"attempt_running moments",
		() =>
			t("ui.updates.service.attempt_running.message_moments", {
				group: "4242",
			}),
	],
	[
		"attempt_running 1 minute",
		() =>
			t("ui.updates.service.attempt_running.message_minutes", {
				minutes: 1,
				group: "4242",
			}),
	],
	[
		"attempt_running 7 minutes",
		() =>
			t("ui.updates.service.attempt_running.message_minutes", {
				minutes: 7,
				group: "4242",
			}),
	],
	["already_running", () => t("ui.updates.service.already_running.message")],
	[
		"install_not_found",
		() => t("ui.updates.service.install_not_found.message"),
	],
	["no_restart", () => t("ui.updates.service.no_restart.message")],
	[
		"no_restart_properly",
		() => t("ui.updates.service.no_restart_properly.message"),
	],
	[
		"restart (target)",
		() =>
			t("ui.updates.panel.service.restart.message_version", {
				version: "0.54.44",
			}),
	],
	["restart", () => t("ui.updates.panel.service.restart.message")],
	["no_backend", () => t("ui.updates.panel.service.no_backend.message")],
	["no_server", () => t("ui.updates.panel.service.no_server.message")],
	[
		"start_mode_unknown",
		() => t("ui.updates.service.start_mode_unknown.message"),
	],
	[
		"no_server_reference",
		() => t("ui.updates.service.no_server_reference.message"),
	],
	[
		"release_unreadable",
		() => t("ui.updates.service.release_unreadable.message"),
	],
	[
		"disk_space 450/120",
		() =>
			t("ui.updates.service.disk_space.message", { needed: 450, free: 120 }),
	],
	[
		"disk_space 1536/812",
		() =>
			t("ui.updates.service.disk_space.message", { needed: 1536, free: 812 }),
	],
	...[
		["busy, none named", { because: "busy", waitedMs: 600_000, busy: [] }],
		[
			"busy, 2 named",
			{
				because: "busy",
				waitedMs: 600_000,
				busy: [
					{ name: "alpha", sessionId: "a" },
					{ name: "beta", sessionId: "b" },
				],
			},
		],
		[
			"busy, 5 named",
			{
				because: "busy",
				waitedMs: 540_000,
				busy: ["a", "b", "c", "d", "e"].map((n) => ({ name: n, sessionId: n })),
			},
		],
		[
			"unknown, unreadable",
			{ because: "unknown", waitedMs: 600_000, busy: [] },
		],
		[
			"unknown, credentials refused",
			{
				because: "unknown",
				waitedMs: 600_000,
				busy: [],
				credentialsRefused: true,
			},
		],
	].map(([label, outcome]) => [
		`fleet ${label}`,
		() => fleetDrainRefusalSentence({ kind: "refused", ...outcome }),
	]),
	...[true, false].flatMap((rebuildRoute) =>
		[
			{ ran: false, exitCode: null },
			{ ran: true, exitCode: 2 },
			{ ran: true, exitCode: 0 },
		].flatMap((run) =>
			[true, false].map((groupSurvived) => [
				`server failure ${rebuildRoute ? "rebuild" : "global"} ran=${run.ran} exit=${run.exitCode} survived=${groupSurvived}`,
				() =>
					serverUpdateFailureSentence({
						rebuildRoute,
						...run,
						groupSurvived,
						diagnosis: groupSurvived ? "pip: resolver output" : "",
						target: "0.54.44",
						after: "0.54.40",
						before: "0.54.40",
						updateCommand: rebuildRoute ? "lop-update" : null,
					}),
			]),
		),
	),
];

/** `not_installed` is "sentence": the installer's error follows a blank line. */
const NOT_INSTALLED_TAIL = "Error: ENOSPC: no space left on device, write";
const notInstalled = () =>
	`${t("ui.updates.service.not_installed.message")}\n\n${NOT_INSTALLED_TAIL}`;

function useLocale(locale) {
	clearRegisteredCatalogues();
	if (locale !== "en") registerCatalogue(locale, bundledCatalogues[locale]);
	setLocale(locale);
}

test("the manifest ships the locales this test sweeps", () => {
	assert.ok(shipped.length >= 8, shipped.join(","));
	assert.ok(
		shipped.includes("zh-CN") && shipped.includes("fr"),
		shipped.join(","),
	);
	assert.ok(MESSAGES.length >= 37, `${MESSAGES.length} enumerated messages`);
});

for (const locale of shipped) {
	test(`${locale}: every keyed message is the sentence when the producer marks it authored`, () => {
		useLocale(locale);
		const demotedHeadline = checkIncomplete();
		for (const [label, build] of MESSAGES) {
			const message = build();
			assert.ok(message.trim().length > 0, `${locale}/${label} is empty`);
			const copy = updateErrorCopy(message, { authored: "message" });
			assert.equal(copy.sentence, message.trim(), `${locale}/${label}`);
			assert.equal(
				copy.detail,
				null,
				`${locale}/${label} grew a Details block`,
			);
			assert.equal(copy.action, null, `${locale}/${label} grew a retry action`);
			assert.notEqual(copy.sentence, demotedHeadline, `${locale}/${label}`);
			// The shared reason (run panel, banner) for a CHECK-phase report.
			assert.equal(
				serverUpdateFailureReason({
					message,
					phase: "check",
					authored: "message",
				}),
				message.trim(),
				`${locale}/${label} (check-phase reason)`,
			);
		}
	});

	test(`${locale}: not_installed keeps its sentence at reading weight and the installer error as Details`, () => {
		useLocale(locale);
		const copy = updateErrorCopy(notInstalled(), { authored: "sentence" });
		assert.equal(copy.sentence, t("ui.updates.service.not_installed.message"));
		assert.equal(copy.detail, NOT_INSTALLED_TAIL);
		assert.equal(copy.action, null);
		// No blank line, no tail: the whole message is the sentence.
		const bare = updateErrorCopy(
			t("ui.updates.service.not_installed.message"),
			{ authored: "sentence" },
		);
		assert.equal(bare.detail, null);
	});

	test(`${locale}: a blank line inside an authored "message" stays in the sentence (fleet refusals)`, () => {
		useLocale(locale);
		const refusal = fleetDrainRefusalSentence({
			kind: "refused",
			because: "unknown",
			waitedMs: 600_000,
			busy: [],
		});
		assert.ok(
			refusal.includes("\n\n"),
			"fixture: the refusal has two paragraphs",
		);
		const copy = updateErrorCopy(refusal, { authored: "message" });
		assert.equal(copy.sentence, refusal.trim());
		assert.equal(copy.detail, null);
	});
}

/**
 * NEGATIVE CONTROL. The messages the designer measured, run through the path the
 * toast took before the fix (no mark). The headline must be the demoted one: if
 * the heuristic ever starts passing these (or the probe stops reaching it) this
 * fails, and the sweep above no longer proves what it says.
 */
test("negative control: without the mark the D1 messages are demoted to the check-incomplete headline", () => {
	const cases = [
		[
			"zh-CN",
			"disk_space",
			() =>
				t("ui.updates.service.disk_space.message", { needed: 1536, free: 812 }),
		],
		[
			"zh-CN",
			"already_running",
			() => t("ui.updates.service.already_running.message"),
		],
		[
			"zh-CN",
			"attempt_running",
			() =>
				t("ui.updates.service.attempt_running.message_moments", {
					group: "4242",
				}),
		],
		[
			"fr",
			"disk_space",
			() =>
				t("ui.updates.service.disk_space.message", { needed: 450, free: 120 }),
		],
		[
			"fr",
			"fleet unknown",
			() =>
				fleetDrainRefusalSentence({
					kind: "refused",
					because: "unknown",
					waitedMs: 600_000,
					busy: [],
				}),
		],
		[
			"fr",
			"fleet unknown (credentials)",
			() =>
				fleetDrainRefusalSentence({
					kind: "refused",
					because: "unknown",
					waitedMs: 600_000,
					busy: [],
					credentialsRefused: true,
				}),
		],
	];
	for (const [locale, label, build] of cases) {
		useLocale(locale);
		const message = build();
		const before = updateErrorCopy(message);
		assert.equal(
			before.sentence,
			checkIncomplete(),
			`${locale}/${label}: not demoted - the control no longer reproduces D1`,
		);
		assert.equal(before.detail, message.trim(), `${locale}/${label}`);
		const after = updateErrorCopy(message, { authored: "message" });
		assert.equal(after.sentence, message.trim(), `${locale}/${label}`);
		assert.equal(after.detail, null, `${locale}/${label}`);
	}
	// And the English counterpart passed all along: this was a translation defect.
	useLocale("en");
	const english = t("ui.updates.service.disk_space.message", {
		needed: 450,
		free: 120,
	});
	assert.equal(updateErrorCopy(english).sentence, english);
});

test("machine output is still classified as machine output (unmarked, en)", () => {
	useLocale("en");
	const machine = [
		"net::ERR_INTERNET_DISCONNECTED",
		"net::ERR_CONNECTION_REFUSED",
		"getaddrinfo ENOTFOUND pypi.org",
		"Cannot find latest.yml in the latest release artifacts (https://github.com/o/r/releases/download/v1/latest.yml): HttpError: 404",
		"HTTP 404",
		"HttpError: 500 Internal Server Error",
		"Error: ENOENT: no such file or directory, open '/x/y.json'",
		"ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
		"Cannot parse releases feed: Unable to find latest version on GitHub (https://github.com/o/r/releases.atom), please ensure a production release exists: HttpError: 404",
	];
	for (const message of machine) {
		const copy = updateErrorCopy(message);
		const raw = message.trim();
		assert.notEqual(
			copy.sentence,
			raw,
			`${JSON.stringify(raw)} was shown raw at reading weight`,
		);
		assert.notEqual(
			copy.detail,
			null,
			`${JSON.stringify(raw)} lost the machine's own words`,
		);
	}
	// A mark on a caught value is the producer's contract; absent, nothing changes.
	assert.equal(updateErrorCopy("net::ERR_TIMED_OUT").action, "check");
});

/** The `backend-update-error` send bodies in update-service.ts, comments stripped. */
async function serviceSends() {
	const source = await readFile("src/main/update-service.ts", "utf8");
	const out = [];
	const opener =
		/(?:sendToRenderer|webContents\.send)\(\s*"backend-update-error",\s*\{/g;
	for (let match = opener.exec(source); match; match = opener.exec(source)) {
		let depth = 1;
		let index = match.index + match[0].length;
		const start = index;
		while (depth > 0) {
			const char = source[index++];
			if (char === "{") depth++;
			else if (char === "}") depth--;
		}
		out.push(
			source
				.slice(start, index - 1)
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, ""),
		);
	}
	return { source, sends: out };
}

test("static guard: keyed payloads carry `authored`, caught-value payloads do not", async () => {
	const { sends } = await serviceSends();
	assert.ok(sends.length >= 20, `found ${sends.length} sends`);
	let caught = 0;
	for (const body of sends) {
		const message = /\bmessage(?::\s*([^\n]*))?/.exec(body)?.[0] ?? "";
		const isCaught = body.includes(
			"stripErrorPrefixes((error as Error).message)",
		);
		const mark = /\bauthored:\s*"(message|sentence)"/.exec(body)?.[1];
		if (isCaught) {
			caught++;
			assert.equal(
				mark,
				undefined,
				`a caught value is marked authored: ${message}`,
			);
		} else {
			assert.ok(
				mark,
				`a keyed backend-update-error is not marked authored: ${message.slice(0, 100)}`,
			);
		}
		// "sentence" is for the one payload that welds the installer's error on.
		if (mark === "sentence") {
			assert.match(
				body,
				/not_installed\.message/,
				"only not_installed appends machine output",
			);
		}
	}
	assert.equal(
		caught,
		2,
		"the check-phase and update-phase caught-value sends",
	);
});

test("static guard: every message key the service sends is in the enumeration", async () => {
	const { source } = await serviceSends();
	const keys = new Set(
		[
			...source.matchAll(
				/\bt\(\s*"(ui\.updates\.(?:panel\.)?service\.[a-z0-9_.]+\.message[a-z_]*)"/g,
			),
		].map((m) => m[1]),
	);
	assert.ok(keys.size >= 18, `${keys.size} message keys`);
	useLocale("en");
	const probe = new Set(
		MESSAGES.map(([, build]) => build()).concat(notInstalled()),
	);
	for (const key of keys) {
		const sentinel = t(key, {
			version: "0.54.44",
			group: "4242",
			minutes: 7,
			needed: 450,
			free: 120,
		});
		// attempt_running/restart variants are enumerated; compare by rendered text.
		assert.ok(
			[...probe].some((text) => text.startsWith(sentinel.split("\n")[0])),
			`${key} is sent by update-service.ts but not enumerated in MESSAGES`,
		);
	}
});
