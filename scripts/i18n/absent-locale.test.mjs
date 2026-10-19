import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSENT_LOCALE, withAbsentLocale } from "./absent-locale.mjs";

/*
 * THE HELPER'S OWN CONTRACT, not the runtime's.
 *
 * The fallback behaviour it is used to assert lives in `src/i18n/messages.ts` and
 * is covered by the activation tests that consume this helper. What can only be
 * wrong here is the helper itself: the tag it registers under, whether the switch
 * actually happened, and whether the restore returns the PREVIOUS locale rather
 * than a hardcoded `en` (the five hand-repaired call sites all restored `en`,
 * which is what made them work only by accident of test order).
 */

/** A stand-in for the runtime namespace; records, never formats. */
function fakeI18n(start = "en") {
	const state = {
		locale: start,
		registered: new Map(),
		switches: [],
	};
	return {
		state,
		currentLocale: () => state.locale,
		setLocale: (locale) => {
			state.locale = locale;
			state.switches.push(locale);
		},
		registerCatalogue: (locale, messages) => {
			state.registered.set(locale, { ...messages });
		},
	};
}

test("withAbsentLocale switches to the synthetic tag, registers the fixture, and restores the previous locale", () => {
	const i18n = fakeI18n("fr");
	const restore = withAbsentLocale(i18n, {
		"ui.example.present": "Fixture copy",
	});

	assert.equal(i18n.currentLocale(), ABSENT_LOCALE);
	assert.deepEqual(i18n.state.registered.get(ABSENT_LOCALE), {
		"ui.example.present": "Fixture copy",
	});

	restore();
	// The point of the restore: back to the locale the test found, not to `en`.
	assert.equal(i18n.currentLocale(), "fr");
	assert.deepEqual(i18n.state.switches, [ABSENT_LOCALE, "fr"]);
});

test("an empty fixture registers no keys, which is how a no-catalogue fallback is asserted", () => {
	const i18n = fakeI18n();
	const restore = withAbsentLocale(i18n);

	assert.equal(i18n.currentLocale(), ABSENT_LOCALE);
	assert.deepEqual(i18n.state.registered.get(ABSENT_LOCALE), {});
	restore();
	assert.equal(i18n.currentLocale(), "en");
});

test("the tag cannot collide with a shipped catalogue", () => {
	const catalogues = join(
		import.meta.dirname,
		"..",
		"..",
		"src",
		"i18n",
		"catalogues",
	);
	const shipped = readdirSync(catalogues, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	// A shipped tag is a real BCP-47 tag; `xx` is unassigned (the private-use
	// mechanisms are the `x-` singleton subtag and the `qaa`-`qtz` range), so the
	// probe occupies no real locale. If a catalogue ever appeared under this name
	// the tag's whole premise — that it is permanently absent — would be false,
	// and every fallback assertion using it would silently become a translation
	// assertion.
	assert.ok(
		shipped.length > 0,
		"the catalogues directory must list shipped tags",
	);
	assert.ok(
		!shipped.includes(ABSENT_LOCALE),
		`${ABSENT_LOCALE} must never ship a catalogue; shipped tags: ${shipped.join(", ")}`,
	);
	assert.match(ABSENT_LOCALE, /^xx-/);
	assert.ok(
		shipped.every((tag) => !tag.startsWith("xx")),
		"no shipped tag may start with the probe's unassigned prefix",
	);
});
