/**
 * THE UPDATE FLOW'S REMAINING ENGLISH IS KEYED (i18n slice S1).
 *
 * WHY THIS FILE EXISTS. `update-panel-copy.test.mjs` proved the panel's
 * `message`/`remedy`/`heading` follow the locale. What it did not reach was the
 * sentences the main process hands the renderer on OTHER channels: the
 * `backend-update-error` reasons written in `update-service.ts`, the two
 * development-mode notes, the held-back-update refusal, the failed-server-update
 * sentence, the in-flight install message, the affirmation the check button
 * paints, and the setup cause appended to a failed publish. Each used to be an
 * English literal, so a French window read a French heading over an English
 * reason - the exact failure the operator reported ("some of the toast
 * notifications like the update notification ... are not translated").
 *
 * WHAT IS PROVEN, and what deliberately is not:
 *
 * 1. EVERY NEW KEY IS PINNED, byte for byte, to the sentence it replaced, so
 *    keying cannot change the English a user already reads. An edit here is a
 *    copy change and should be a deliberate one.
 * 2. THE PRODUCERS RESOLVE THROUGH `t()`. Under a marker locale (`xx`, values
 *    shaped `XX <key>`, a form no English sentence has - the same device
 *    `update-panel-copy.test.mjs` uses) every producer returns catalogue copy
 *    and NONE of the English it used to return. A key that exists but is not
 *    wired fails here rather than looking translated.
 * 3. A STATIC GUARD ON `update-service.ts`, which cannot be imported without an
 *    Electron fixture: no `backend-update-error` payload may carry a quoted or
 *    templated `message`, and the two dev-mode sends must pass `t(...)`.
 * 4. TECHNICAL TOKENS TRAVEL AS VALUES: versions, process groups, commands and
 *    exit codes are placeholders, so a translator cannot alter them.
 *
 * NOT PROVEN HERE: a real translation. This file probes with a marker locale so a
 * wired-but-untranslated key cannot look translated. The seven shipped locales
 * carry the translations in the same PR (audit trail: docs/i18n/update-flow-
 * provenance.md), and `scripts/i18n/update-flow-translation.test.mjs` pins that
 * each of the 49 values differs from English in every shipped locale.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export {
				installInFlightPayload,
				resolveGlobalInstallPlan,
			} from "./src/main/update-install";
			export { serverUpdateFailureSentence } from "./src/main/server-update-copy";
			export { fleetDrainRefusalSentence } from "./src/main/backend/fleet-drain";
			export { SETUP_FAILURE_CAUSES, setupFailureCause } from "./src/main/backend/setup-failure-causes";
			export { updateCheckAffirmation, upToDateAffirmation } from "./src/main/update-check-verdict";
			export { clearRegisteredCatalogues, registerCatalogue, t } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
			export { bundledEnglish } from "./src/i18n/keys.gen";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	installInFlightPayload,
	resolveGlobalInstallPlan,
	serverUpdateFailureSentence,
	fleetDrainRefusalSentence,
	SETUP_FAILURE_CAUSES,
	setupFailureCause,
	updateCheckAffirmation,
	upToDateAffirmation,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
	bundledEnglish,
	t,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Every English sentence these keys replaced, in the form `t()` must still return. */
const PINNED = {
	"ui.updates.status.dev_mode.app":
		"Application is running in development mode. Updates are disabled.",
	"ui.updates.status.dev_mode.backend":
		"Backend updates are disabled in development mode.",
	"ui.updates.status.up_to_date": "The application and server are up to date",
	"ui.updates.service.release_publishing.message":
		"A new server release ({version}) is still publishing, so no update was offered yet. Check again in a few minutes.",
	"ui.updates.service.version_unknown.message":
		"The installed server version could not be determined, so no update was offered. Restart the app to try again.",
	"ui.updates.service.already_running.message":
		"A server update is already running. Let it finish before starting another.",
	"ui.updates.service.install_not_found.message":
		"The global install could not be found on this machine, so the update did not run. See the update service log.",
	"ui.updates.service.no_restart.message":
		"The server was updated but the backend did not restart. Restart Local Operator to run the new version.",
	"ui.updates.service.no_restart_properly.message":
		"The server was updated but the backend did not restart properly. Restart Local Operator to run the new version.",
	"ui.updates.service.start_mode_unknown.message":
		"The app could not tell how this server was started, so it did not update it. See the update service log.",
	"ui.updates.service.no_server_reference.message":
		"The app has no server to update right now. Restart Local Operator and try again.",
	"ui.updates.service.release_unreadable.message":
		"The app could not read which release to install, so it left its server environment alone. Check the connection and try again.",
	"ui.updates.service.not_installed.message":
		"The server update did not install, so the environment serving this app was left as it was.",
	"ui.updates.service.global.app_owned.remedy":
		"This server is running from Local Operator's own managed environment, which no package manager owns - so there is no terminal command that can update it correctly. The app can only update a server it started itself: stop this one, then start Local Operator again and let it start its own.",
	"ui.updates.service.install_in_flight.message":
		"Version {version} can't finish installing while Local Operator is open — keeping it open cancels the install. Quit and leave it closed until the app opens again by itself.",
};

/** The `update-service.ts` keys (not importable here) and their rendered English. */
const SERVICE_RENDERED = [
	[
		"ui.updates.service.release_publishing.message",
		{ version: "0.54.44" },
		"A new server release (0.54.44) is still publishing, so no update was offered yet. Check again in a few minutes.",
	],
	[
		"ui.updates.service.attempt_running.message_unknown_age",
		{ group: "4242" },
		"A server update this app started at a time that could not be read is still running (process group 4242), so a second one will not be started beside it. If that update is no longer responding, the update service log says what it was doing.",
	],
	[
		"ui.updates.service.attempt_running.message_moments",
		{ group: "4242" },
		"A server update this app started moments ago is still running (process group 4242), so a second one will not be started beside it. If that update is no longer responding, the update service log says what it was doing.",
	],
	[
		"ui.updates.service.attempt_running.message_minutes",
		{ minutes: 1, group: "4242" },
		"A server update this app started 1 minute ago is still running (process group 4242), so a second one will not be started beside it. If that update is no longer responding, the update service log says what it was doing.",
	],
	[
		"ui.updates.service.attempt_running.message_minutes",
		{ minutes: 7, group: "4242" },
		"A server update this app started 7 minutes ago is still running (process group 4242), so a second one will not be started beside it. If that update is no longer responding, the update service log says what it was doing.",
	],
	[
		"ui.updates.service.disk_space.message",
		{ needed: 1536, free: 812 },
		"The server update needs about 1536 MB of free space on this disk, and 812 MB is free, so the app left the environment serving this app alone. Free some space and try again.",
	],
];

function reset() {
	clearRegisteredCatalogues();
	setLocale("en");
}

/** Register `xx` so EVERY update-flow key reads `XX <key>`, then switch to it. */
function useMarkerLocale() {
	const keys = Object.keys(bundledEnglish).filter(
		(key) =>
			key.startsWith("ui.updates.") ||
			key.startsWith("ui.installer.setup_cause."),
	);
	registerCatalogue(
		"xx",
		Object.fromEntries(keys.map((key) => [key, `XX ${key}`])),
	);
	setLocale("xx");
}

test("every pinned sentence is the English the user already read", () => {
	reset();
	for (const [key, english] of Object.entries(PINNED)) {
		assert.equal(bundledEnglish[key], english, key);
	}
	for (const [key, params, english] of SERVICE_RENDERED) {
		assert.equal(t(key, params), english, key);
	}
});

/**
 * Whether the text after `message:` is English the author typed rather than
 * catalogue copy. A template that OPENS with a `t(...)` interpolation is the
 * composed-seam shape (`${t(...)}${cause}...`) and is not a literal.
 */
const isEnglishLiteral = (value) =>
	/^["`]/.test(value) && !value.startsWith("`${t(");

/** Everything but the `XX <key>` markers; empty means no English survived. */
const withoutMarkers = (text) =>
	text.replace(/XX ui\.[a-z0-9_.]+/g, "").replace(/\s+/g, "");

test("the literal guard catches a literal (negative control)", () => {
	assert.equal(isEnglishLiteral('"The update failed."'), true);
	assert.equal(isEnglishLiteral("`The update to ${v} failed.`,"), true);
	assert.equal(isEnglishLiteral('t("ui.updates.panel.service.x"),'), false);
	assert.equal(isEnglishLiteral('`${t("ui.k")}${cause}`,'), false);
	assert.equal(isEnglishLiteral("failureMessage,"), false);
});

test("update-service.ts sends no English literal on backend-update-error or the dev-mode channels", async () => {
	const source = await readFile("src/main/update-service.ts", "utf8");
	// Every payload that reaches the renderer as `backend-update-error`.
	const sends = [
		...source.matchAll(
			/(?:sendToRenderer|webContents\.send)\(\s*"backend-update-error",\s*\{([\s\S]{0,4000}?)\n\t*\}\s*\)/g,
		),
	];
	assert.ok(
		sends.length >= 20,
		`found ${sends.length} backend-update-error sends`,
	);
	for (const [, body] of sends) {
		// Strip block comments so a quoted word inside prose cannot read as a value.
		const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
		const message = /\bmessage:\s*([^\n]*)/.exec(stripped)?.[1]?.trim();
		if (message === undefined) continue; // shorthand `message,`
		assert.equal(
			isEnglishLiteral(message),
			false,
			`a backend-update-error message is a literal: ${message.slice(0, 80)}`,
		);
	}
	// The two development-mode notes.
	for (const channel of ["update-dev-mode", "backend-update-dev-mode"]) {
		const pattern = new RegExp(`"${channel}",\\s*([^\\n]+)`);
		const arg = pattern.exec(source)?.[1];
		assert.ok(arg, `${channel} send not found`);
		assert.match(arg, /^t\("ui\.updates\.status\.dev_mode\./, channel);
	}
});

/**
 * Every `message:` / `remedy:` / `detail:` property in the main-process update
 * files whose value is an English literal, as `{ line, key, value }`.
 *
 * WHY THIS EXISTS (review M1). The guard above only reads
 * `backend-update-error` payloads, so the install plan's `remedy: "..."` - which
 * reaches the reader as `remedy: plan.remedy` and as the message of
 * `backend-update-manual-required` - sat outside it as a bare English sentence.
 * The property name is what the reader-bound shapes share, so the guard keys on
 * it wherever it appears in these two files rather than on one channel name.
 *
 * A value on the NEXT line (`remedy:\n\t"..."`, the shape prettier gives a long
 * sentence) is followed. Comment-only lines are skipped so prose that mentions
 * `remedy:` cannot read as a property.
 */
function literalProperties(source) {
	const lines = source.split("\n");
	const found = [];
	const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
	for (let index = 0; index < lines.length; index += 1) {
		if (isCommentLine(lines[index])) continue;
		const match = /^\s*(message|remedy|detail)\s*:\s*(.*)$/.exec(lines[index]);
		if (!match) continue;
		let value = match[2].trim();
		let at = index;
		while (value === "" && at + 1 < lines.length) {
			at += 1;
			if (isCommentLine(lines[at])) continue;
			value = lines[at].trim();
		}
		if (isEnglishLiteral(value)) {
			found.push({ line: at + 1, key: match[1], value });
		}
	}
	return found;
}

/**
 * The literals that are English BY DESIGN, each with the reason. `remedy` and
 * `message` have NO entries: those are sentences the reader is meant to
 * understand, so they are keyed or the test fails. What is left is the `detail`
 * support records - the text behind "Copy details" - which carries paths,
 * versions, shas and byte counts for whoever reads a bug report; the operator's
 * rule allows technical tokens as a named exception, and a translated sha
 * comparison is not support-friendly. `startsWith` is matched against the
 * source text after `detail: `, so a NEW literal does not ride an old entry.
 */
const SUPPORT_RECORD = "Copy-details diagnostics: paths, versions, shas, sizes";
const ENGLISH_BY_DESIGN = [
	[
		"src/main/update-service.ts",
		"detail",
		"`No staged artifact",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-service.ts",
		"detail",
		"`${artifactPath}: ${String(error)}`",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-service.ts",
		"detail",
		"`The app started this server itself",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`codesign --verify",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${appBundlePath}: ${detail}`",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${name} has no matching entry",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${name} is ${input.actualSize} bytes",
		SUPPORT_RECORD,
	],
	["src/main/update-install.ts", "detail", "`${name} sha512", SUPPORT_RECORD],
	[
		"src/main/update-install.ts",
		"detail",
		"`Install needs ${formatGiB(needed)}",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${facts.artifactName} carries no",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${facts.artifactName} claims",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`Install started ${startedText}",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`Install started ${installStartedText(marker)}",
		SUPPORT_RECORD,
	],
	[
		"src/main/update-install.ts",
		"detail",
		"`${detail}${",
		"The installer fallback scaffold (installer slice): the support detail plus its `What happened:` lead-in, appended to the keyed remedy",
	],
];

test("the property guard flags a remedy/message/detail literal and follows a wrapped value (negative control)", () => {
	const flagged = (source) => literalProperties(source).map((f) => f.key);
	assert.deepEqual(flagged('\t\tremedy: "Do the thing.",'), ["remedy"]);
	assert.deepEqual(flagged('\t\tremedy:\n\t\t\t"Do the thing.",'), ["remedy"]);
	assert.deepEqual(flagged("\t\tmessage: `Update ${v} failed.`,"), ["message"]);
	assert.deepEqual(flagged('\t\tmessage:\n\t\t\t// why\n\t\t\t"Failed.",'), [
		"message",
	]);
	assert.deepEqual(flagged("\t\tdetail: `at ${path}`,"), ["detail"]);
	// Keyed, composed and shorthand shapes are not literals.
	assert.deepEqual(flagged('\t\tremedy: t("ui.updates.service.x"),'), []);
	assert.deepEqual(flagged('\t\tmessage: `${t("ui.k")} ${cause}`,'), []);
	assert.deepEqual(flagged("\t\tremedy: plan.remedy,"), []);
	assert.deepEqual(flagged('\t\t// remedy: "prose in a comment"'), []);
	assert.deepEqual(flagged('\t * remedy: "prose in a docblock"'), []);
});

test("update-service.ts and update-install.ts carry no English remedy/message/detail literal outside the named by-design list", async () => {
	const used = new Set();
	for (const file of [
		"src/main/update-service.ts",
		"src/main/update-install.ts",
	]) {
		const source = await readFile(file, "utf8");
		const literals = literalProperties(source);
		for (const { line, key, value } of literals) {
			const index = ENGLISH_BY_DESIGN.findIndex(
				([entryFile, entryKey, prefix]) =>
					entryFile === file && entryKey === key && value.startsWith(prefix),
			);
			assert.notEqual(
				index,
				-1,
				`${file}:${line} ${key} is an English literal that reaches the UI - key it with t(), or add it to ENGLISH_BY_DESIGN with a reason: ${value.slice(0, 90)}`,
			);
			used.add(index);
		}
	}
	// A stale allowlist entry would let that literal come back unnoticed.
	ENGLISH_BY_DESIGN.forEach((entry, index) =>
		assert.ok(
			used.has(index),
			`ENGLISH_BY_DESIGN entry matches nothing: ${entry[2]}`,
		),
	);
});

test("the update-service keys the static guard relies on all exist", async () => {
	const source = await readFile("src/main/update-service.ts", "utf8");
	const used = new Set(
		[
			...source.matchAll(
				/\bt\(\s*"(ui\.updates\.(?:panel|service|status)\.[a-z0-9_.]+)"/g,
			),
		].map((match) => match[1]),
	);
	assert.ok(used.size >= 20, `${used.size} update keys referenced`);
	for (const key of used) {
		assert.ok(key in bundledEnglish, `${key} is referenced but not bundled`);
	}
});

test("under a non-English locale the producers return catalogue copy and no English", () => {
	reset();
	// English control: the same calls read English, so a pass below means a
	// change of locale and not an always-empty probe.
	const english = installInFlightPayload(
		{ targetVersion: "0.44.0", artifactPath: "/tmp/a.zip", startedAt: null },
		"0.43.1",
	);
	assert.match(english.message, /can't finish installing/);

	useMarkerLocale();

	// The in-flight install message: the version is a value, the sentence is copy.
	const inFlight = installInFlightPayload(
		{ targetVersion: "0.44.0", artifactPath: "/tmp/a.zip", startedAt: null },
		"0.43.1",
	);
	assert.equal(
		inFlight.message,
		"XX ui.updates.service.install_in_flight.message",
	);
	assert.equal(inFlight.targetVersion, "0.44.0");

	// The check button's affirmation, via the verdict rule that earns it.
	assert.equal(upToDateAffirmation(), "XX ui.updates.status.up_to_date");
	assert.equal(
		updateCheckAffirmation({ app: "current", server: "current" }),
		"XX ui.updates.status.up_to_date",
	);
	assert.equal(
		updateCheckAffirmation({ app: "available", server: "current" }),
		null,
	);

	// The failed-server-update sentence: all four headlines and every optional arm.
	const failure = (overrides) =>
		serverUpdateFailureSentence({
			rebuildRoute: false,
			ran: true,
			exitCode: 0,
			groupSurvived: false,
			diagnosis: "",
			target: "0.55.0",
			after: "0.54.9",
			before: "0.54.9",
			updateCommand: null,
			...overrides,
		});
	const arms = [
		failure({ ran: false }),
		failure({ exitCode: 1 }),
		failure({ rebuildRoute: true }),
		failure({ groupSurvived: true, diagnosis: "x" }),
		failure({ rebuildRoute: true, updateCommand: "/opt/lop-update" }),
	];
	for (const sentence of arms) {
		assert.match(sentence, /^XX ui\.updates\.service\.server_failure\./);
		// Every English fragment that used to be spliced in is gone.
		assert.equal(withoutMarkers(sentence), "", sentence);
	}

	// The held-back update: both arms and the credentials variant.
	const refusal = (outcome) =>
		fleetDrainRefusalSentence({
			kind: "refused",
			waitedMs: 120_000,
			busy: [],
			credentialsRefused: false,
			...outcome,
		});
	const busy = [1, 2, 3, 4, 5].map((n) => ({
		sessionId: `s${n}`,
		name: `Session ${n}`,
		kind: "tui",
		liveState: "running",
	}));
	for (const sentence of [
		refusal({ because: "unknown" }),
		refusal({ because: "unknown", credentialsRefused: true }),
		refusal({ because: "busy" }),
		refusal({ because: "busy", busy }),
	]) {
		assert.match(sentence, /^XX ui\.updates\.service\.fleet\./);
		assert.equal(withoutMarkers(sentence), "", sentence);
	}

	// The install-kind remedies the by-hand panel shows.
	const remedy = (identity, sourceRebuild) =>
		resolveGlobalInstallPlan({ identity, sourceRebuild }).remedy;
	const remedies = [
		remedy({ path: "/x/local-operator", editable: true }),
		remedy({ path: "/x/pipx/venvs/local-operator/bin/local-operator" }),
		remedy({ path: "/x/local-operator", venvPrefix: "/x" }),
		remedy({ path: "/x/local-operator" }),
	];
	for (const text of remedies) {
		assert.match(text, /^XX ui\.updates\.service\.global\./);
		assert.equal(withoutMarkers(text), "", text);
	}

	// The setup cause appended to a failed publish: every row of the table.
	assert.equal(SETUP_FAILURE_CAUSES.length, 7);
	for (const [, key] of SETUP_FAILURE_CAUSES) {
		assert.match(key, /^ui\.installer\.setup_cause\./);
		assert.ok(key in bundledEnglish, `${key} is not bundled`);
		assert.equal(t(key), `XX ${key}`);
	}
	// And the lookup itself, on the machine's own words, resolves the key.
	for (const [raw, key] of [
		["ENOSPC: no space left on device", "disk_full"],
		["Could not find a version that satisfies the requirement", "unreachable"],
		["Another Local Operator instance is preparing the backend", "locked"],
		["ENOENT: no such file or directory", "file_missing"],
	]) {
		assert.equal(
			setupFailureCause(new Error(raw)),
			`XX ui.installer.setup_cause.${key}`,
			raw,
		);
	}
	assert.equal(setupFailureCause(new Error("something unrelated")), null);
	reset();
});

test("technical tokens are placeholders, not translatable text", () => {
	reset();
	const sentence = serverUpdateFailureSentence({
		rebuildRoute: true,
		ran: true,
		exitCode: 137,
		groupSurvived: true,
		diagnosis: "",
		target: null,
		after: null,
		before: null,
		updateCommand: "/opt/bin/lop-update",
	});
	// The command, the exit code and the pointer all arrive intact.
	assert.match(sentence, /`lop-update` exited 137\./);
	assert.match(sentence, /run `\/opt\/bin\/lop-update` yourself/);
	// The release number and the minutes are values handed to ICU.
	assert.match(
		t("ui.updates.service.install_in_flight.message", { version: "0.44.0" }),
		/^Version 0\.44\.0 /,
	);
	assert.match(
		fleetDrainRefusalSentence({
			kind: "refused",
			because: "busy",
			waitedMs: 60_000,
			busy: [
				{ sessionId: "s1", name: "Ledger", kind: "tui", liveState: "running" },
			],
			credentialsRefused: false,
		}),
		/^1 session is still running a turn on this machine: Ledger\.\n\nThe app waited 1 minute for them/,
	);
});
