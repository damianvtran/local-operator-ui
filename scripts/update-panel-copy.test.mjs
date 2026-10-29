/**
 * THE UPDATE AND INSTALL PANEL SPEAKS THE APP'S LANGUAGE — and the release
 * notes it also shows do NOT.
 *
 * WHY THIS FILE EXISTS (i18n wave C1). These sentences are composed in the main
 * process, from runtime facts (a version, a byte size, a staged artifact), and
 * painted by the renderer's panel as the block's `message` / `remedy` / `heading`
 * verbatim. Keying them is what makes a French window carry a French refusal;
 * the assertions below drive the SHIPPED producers under a marker locale so a
 * key that is present but unwired fails here rather than looking translated.
 *
 * THE SECOND SUBJECT is the boundary: the release body GitHub returns is DATA
 * (a release owner's prose for one version), never catalogue copy. It is pinned
 * in both directions — the summariser returns the body untouched under a marker
 * locale, and the module that fetches it holds no catalogue lookup at all — so a
 * later sweep cannot "finish the job" by translating what a maintainer wrote.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export {
				installFailurePayload,
				installedBundleSealBlock,
			} from "./src/main/update-install";
			export { serverUpdateFailureRemedy } from "./src/main/server-update-copy";
			export { summariseReleaseBody } from "./src/main/server-release-notes";
			export {
				clearRegisteredCatalogues,
				registerCatalogue,
				t,
			} from "./src/i18n/messages";
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
	installFailurePayload,
	installedBundleSealBlock,
	serverUpdateFailureRemedy,
	summariseReleaseBody,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
	bundledEnglish,
	t,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Every marker value is `XX <key>`: a shape no English sentence has. */
function markerFor(keys) {
	return Object.fromEntries(keys.map((key) => [key, `XX ${key}`]));
}

function reset() {
	clearRegisteredCatalogues();
	setLocale("en");
}

test("both namespaces carry their English source", () => {
	const menubar = Object.keys(bundledEnglish).filter((key) =>
		key.startsWith("ui.shell.menubar."),
	);
	const panel = Object.keys(bundledEnglish).filter((key) =>
		key.startsWith("ui.updates.panel."),
	);
	assert.equal(menubar.length, 13);
	assert.equal(panel.length, 45);
	// The sentences the panel shows, byte-for-byte after keying: an edit here is
	// a copy change, and it should be a deliberate one.
	assert.equal(
		bundledEnglish["ui.updates.panel.artifact.remedy"],
		"Check for updates again to re-download the release.",
	);
	assert.equal(
		bundledEnglish["ui.updates.panel.launch.open.message"],
		"The downloaded update can't be launched by macOS, so it wasn't installed.",
	);
	assert.equal(
		bundledEnglish["ui.updates.panel.server.behind.remedy"],
		"This checkout is behind its remote, which is what `lop-update` refused to build from: bring the checkout up to date, and the next press here will build it.",
	);
});

test("the seal refusal renders in the active locale", () => {
	reset();
	const english = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"detail",
		"9.9.9",
		"update",
	);
	assert.equal(
		english.message,
		"This install of Local Operator can't be updated in place, so the update to version 9.9.9 was stopped before the app quit.",
	);
	assert.equal(
		english.remedy.text,
		"Quit Local Operator, then download a fresh copy and replace the app in Applications.",
	);

	const keys = [
		"ui.updates.panel.seal.update.message_version",
		"ui.updates.panel.seal.remedy",
		"ui.updates.panel.seal.startup.heading",
		"ui.updates.panel.seal.startup.message",
		"ui.updates.panel.dismiss.not_now",
	];
	registerCatalogue("xx", markerFor(keys));
	setLocale("xx");
	const translated = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"detail",
		"9.9.9",
		"update",
	);
	assert.equal(
		translated.message,
		"XX ui.updates.panel.seal.update.message_version",
	);
	assert.equal(translated.remedy.text, "XX ui.updates.panel.seal.remedy");

	const startup = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"detail",
		null,
		"startup",
	);
	assert.equal(startup.heading, "XX ui.updates.panel.seal.startup.heading");
	assert.equal(startup.message, "XX ui.updates.panel.seal.startup.message");
	assert.equal(startup.dismissLabel, "XX ui.updates.panel.dismiss.not_now");

	// The version is a VALUE, passed through ICU: the marker locale cannot hide
	// it, because the number is what the reader has to quote to support.
	reset();
	const named = installedBundleSealBlock(
		"/Applications/Local Operator.app",
		"detail",
		"1.2.3",
		"update",
	);
	assert.match(named.message, /1\.2\.3/);
});

test("a failed install reports both versions through the catalogue", () => {
	reset();
	const marker = { targetVersion: "0.44.0" };
	const cancelled = installFailurePayload(marker, "0.43.1", {
		cancelledByRelaunch: true,
	});
	assert.equal(
		cancelled.message,
		"The update to version 0.44.0 was cancelled because Local Operator was opened while the update was installing. Version 0.43.1 is still running.",
	);

	const keys = [
		"ui.updates.panel.failure.unfinished.message",
		"ui.updates.panel.failure.unfinished.remedy",
	];
	registerCatalogue("xx", markerFor(keys));
	setLocale("xx");
	const translated = installFailurePayload(marker, "0.43.1");
	assert.equal(
		translated.message,
		"XX ui.updates.panel.failure.unfinished.message",
	);
	assert.equal(
		translated.remedy.text,
		"XX ui.updates.panel.failure.unfinished.remedy",
	);
	// The facts still travel: the panel says which versions are in play.
	assert.equal(translated.targetVersion, "0.44.0");
	assert.equal(translated.attempts, 1);
	reset();
});

test("all three failed-server-update remedies follow the locale", () => {
	reset();
	assert.equal(
		serverUpdateFailureRemedy({ rebuildRoute: false, diagnosis: "" }),
		"Nothing was restarted: the build that was serving is the build still serving.",
	);
	registerCatalogue(
		"xx",
		markerFor([
			"ui.updates.panel.server.behind.remedy",
			"ui.updates.panel.server.rebuild.remedy",
			"ui.updates.panel.server.norestart.remedy",
		]),
	);
	setLocale("xx");
	assert.equal(
		serverUpdateFailureRemedy({
			rebuildRoute: true,
			diagnosis: "REFUSING to release a stale ref",
		}),
		"XX ui.updates.panel.server.behind.remedy",
	);
	assert.equal(
		serverUpdateFailureRemedy({ rebuildRoute: true, diagnosis: "other" }),
		"XX ui.updates.panel.server.rebuild.remedy",
	);
	assert.equal(
		serverUpdateFailureRemedy({ rebuildRoute: false, diagnosis: "other" }),
		"XX ui.updates.panel.server.norestart.remedy",
	);
	reset();
});

test("the parameterised sentences place their values, and keep their apostrophes", () => {
	reset();
	assert.equal(
		t("ui.updates.panel.disk.remedy", { size: "1.2 GB" }),
		"Free up about 1.2 GB, then check for updates again.",
	);
	assert.equal(
		t("ui.updates.panel.service.restart.message_version", {
			version: "0.44.0",
		}),
		"The server restarted but did not report version 0.44.0. See the update service log, then restart Local Operator.",
	);
	// An apostrophe is literal text here, not an ICU quote: English copy for a
	// refusal is full of them, and a formatter that swallowed one would report a
	// sentence nobody wrote.
	assert.match(
		t("ui.updates.panel.disk.message"),
		/^There isn't enough free disk space/,
	);
	assert.match(t("ui.updates.panel.launch.heading"), /couldn't be checked$/);
});

test("release notes are data: the body is never passed through the catalogue", async () => {
	// A release body a maintainer wrote for one version. It is prose in whatever
	// language they chose, and it must survive verbatim.
	const body =
		"## What changed\n\nBob says: `lop resume-click` now opens the right window.\n";
	registerCatalogue(
		"xx",
		markerFor(
			Object.keys(bundledEnglish).filter((k) => k.startsWith("ui.updates.")),
		),
	);
	setLocale("xx");
	const summary = summariseReleaseBody(body);
	assert.match(summary, /Bob says/);
	assert.doesNotMatch(summary, /^XX /);
	assert.ok(
		!summary.includes("XX ui.updates."),
		"the release body went through the catalogue",
	);

	// And the module that owns it holds no translator at all: a later sweep has
	// nothing to key here without deleting this pin first.
	const source = await readFile("src/main/server-release-notes.ts", "utf8");
	assert.doesNotMatch(source, /from "\.\.\/i18n/);
	assert.doesNotMatch(source, /\bt\("ui\./);
	reset();
});
