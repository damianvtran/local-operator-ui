import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Execute the shipped formatter, not a second implementation of ICU grammar.
const bundle = await build({
	stdin: {
		contents: 'export { t, setLocale } from "./src/i18n";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { t, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
setLocale("en");

test("waiting durations keep the existing English units and composition", () => {
	assert.equal(
		t("ui.common.updates.wait.seconds", { seconds: 1 }),
		"Waiting 1 second so far",
	);
	assert.equal(
		t("ui.common.updates.wait.seconds", { seconds: 12 }),
		"Waiting 12 seconds so far",
	);
	assert.equal(
		t("ui.common.updates.wait.minutes", { minutes: 1 }),
		"Waiting 1 minute so far",
	);
	assert.equal(
		t("ui.common.updates.wait.minutes_seconds", { minutes: 2, seconds: 1 }),
		"Waiting 2 minutes 1 second so far",
	);
});

test("remaining sessions agree with singular and plural pronouns", () => {
	assert.equal(
		t("ui.common.updates.completion.sessions", { count: 1, countText: "1" }),
		"1 session is still running the old build; it will move onto the new build when it next stops or goes idle.",
	);
	assert.equal(
		t("ui.common.updates.completion.sessions", { count: 3, countText: "3" }),
		"3 sessions are still running the old build; they will move onto the new build when they next stop or go idle.",
	);
});

for (const count of [0, 1, 2, 1000]) {
	test(`counted attempt/session/unit nouns at ${count}`, () => {
		assert.equal(
			t("ui.common.updates.check_for_updates_button.detail", {
				attempts: count,
				attemptsText: String(count),
			}),
			` (${count} attempt${count === 1 ? "" : "s"})`,
		);
		assert.equal(
			t("ui.common.updates.wait.seconds", { seconds: count }),
			`Waiting ${count} second${count === 1 ? "" : "s"} so far`,
		);
		assert.equal(
			t("ui.common.updates.wait.minutes", { minutes: count }),
			`Waiting ${count} minute${count === 1 ? "" : "s"} so far`,
		);
		assert.equal(
			t("ui.common.updates.wait.minutes_seconds", {
				minutes: count,
				seconds: count,
			}),
			`Waiting ${count} minute${count === 1 ? "" : "s"} ${count} second${count === 1 ? "" : "s"} so far`,
		);
		assert.equal(
			t("ui.common.updates.completion.sessions", {
				count,
				countText: String(count),
			}),
			count === 1
				? "1 session is still running the old build; it will move onto the new build when it next stops or goes idle."
				: `${count} sessions are still running the old build; they will move onto the new build when they next stop or go idle.`,
		);
	});
}

test("provider-dependent offline copy keeps its existing two distinct clauses", () => {
	const provider = t("ui.common.connection.provider.requires", {
		provider: "Radient",
	});
	assert.equal(
		t("ui.common.connection.connectivity_banner.you_are_offline", {
			detail: provider,
		}),
		"You are offline. Your configured hosting provider (Radient) requires an internet connection.",
	);
	assert.equal(
		t("ui.common.connection.connectivity_banner.you_are_offline", {
			detail: t(
				"ui.common.connection.connectivity_banner.this_app_s_updates_require",
			),
		}),
		"You are offline. This app's updates require an internet connection.",
	);
});
