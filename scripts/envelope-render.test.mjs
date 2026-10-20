import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/** Source-anchoring reads files rather than bundling them; see AGENTS.md. */
const read = (path) => readFileSync(path, "utf8");
void read;

/*
 * Count ICU parses without touching production code. `intl-messageformat`
 * assigns `getAst` per INSTANCE (not on the prototype), so a prototype spy
 * cannot see it; wrapping the constructor does. Every `new IntlMessageFormat`
 * is one parse-plus-argument-walk, which is exactly what the cache test counts.
 */
const countingIntlMessageFormat = {
	name: "counting-intl-messageformat",
	setup(build) {
		build.onResolve({ filter: /^intl-messageformat$/ }, () => ({
			path: "counting-intl-messageformat",
			namespace: "counting-intl",
		}));
		build.onLoad({ filter: /.*/, namespace: "counting-intl" }, () => ({
			contents: `
				import { createRequire } from "node:module";
				const require = createRequire(import.meta.url);
				const real = require("intl-messageformat");
				export const IntlMessageFormat = class extends real.IntlMessageFormat {
					constructor(...args) {
						super(...args);
						globalThis.__imfParses = (globalThis.__imfParses ?? 0) + 1;
					}
				};
				export default real.default;
			`,
			loader: "js",
		}));
	},
};

/*
 * CAUSE 3: the render path for backend-originated `{code, params, text}`.
 *
 * WHAT THESE TESTS ARE FOR. The defect is not "the sentence is in English" — it
 * is that the adapter never consulted the catalogue at all, so a registered
 * translation of a `wire.*` identity could not reach the screen, and the client
 * could not distinguish an identity it knows from one it does not. Every test
 * below therefore drives the SHIPPED adapters (`publicationProse`,
 * `publicationErrorFromBody`, `desktopResult`) and asserts the catalogue
 * sentence, not an English literal: a test written against English copy passes
 * on the defect.
 *
 * The discriminating assertion is the same shape three times: with a French
 * fixture registered for a known identity, the adapter must return the FRENCH
 * sentence even though the payload's `text` is a perfectly good English one.
 * On the code before this change all of those returned `text`, which is the
 * before/after the report quotes.
 *
 * Machine behaviour is asserted alongside the words: status, refusal category
 * and `retry_after_ms` come from the body and may not move because a
 * translation did or did not happen (design §6, last paragraph).
 */
const bundle = await build({
	stdin: {
		contents: `
			export { desktopResult, DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export {
				publicationErrorFromBody,
				publicationProse,
			} from "./src/renderer/src/shared/api/local-operator/publication-errors";
			export {
				clearRegisteredCatalogues,
				registerCatalogue,
				setLocale,
				t,
			} from "./src/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	plugins: [countingIntlMessageFormat],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});

const bundlePath = new URL("./_envelope-render.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);

const {
	DesktopControlError,
	clearRegisteredCatalogues,
	publicationErrorFromBody,
	publicationProse,
	registerCatalogue,
	setLocale,
	t,
	desktopResult,
} = mod;

/**
 * A fixture identity and its French translation.
 *
 * Deliberately a FIXTURE, per design §7: "Use an isolated fixture translation
 * to prove rendering before real content translation." The 148-key content lane
 * is explicitly out of scope here, so nothing in this file depends on a
 * production translation existing.
 */
const RUNTIME_ID = "wire.errors.desktop.runtime_unreachable";
const RUNTIME_FR =
	"Le propriétaire de la session est indisponible ({owner}). Reconnectez-vous avant de réessayer.";
const RUNTIME_EN =
	"Session owner is unavailable. Reconnect and reconcile before retrying.";

registerCatalogue("fr", { [RUNTIME_ID]: RUNTIME_FR });
setLocale("fr");

/** A desktop IPC stand-in, since production has no network stack in this path. */
function stubDesktopAnswer(status, body) {
	globalThis.window = {
		api: { desktop: { request: async () => ({ status, body }) } },
	};
}

async function refusalFrom(answer) {
	stubDesktopAnswer(answer.status, answer.body);
	try {
		await desktopResult({ op: "settings.list" });
	} catch (error) {
		return error;
	}
	throw new Error("desktopResult resolved a non-2xx answer");
}

test("a known identity renders the catalogue with params, not the supplied text", () => {
	// The identity is known to the active runtime, so this is the catalogue's
	// sentence. `text` is present and fluent — the old adapter returned it, which
	// is the defect. Preferring it here would reproduce the bug inside the fix.
	const prose = publicationProse({
		detail: {
			code: "runtime_busy",
			message_code: RUNTIME_ID,
			params: { owner: "Damian" },
			text: RUNTIME_EN,
		},
	});
	assert.equal(
		prose,
		"Le propriétaire de la session est indisponible (Damian). Reconnectez-vous avant de réessayer.",
	);
	assert.notEqual(prose, RUNTIME_EN);
});

test("`message_code` outranks `code` as the render identity", () => {
	// `code` stays the machine category (`runtime_busy`); `message_code` is the
	// catalogue key the producer had to override it with (design §3).
	const refused = publicationErrorFromBody(503, {
		detail: {
			code: "name_taken",
			message_code: RUNTIME_ID,
			params: { owner: "Damian" },
			text: RUNTIME_EN,
			details: { owned_by_caller: true },
		},
	});
	assert.ok(
		refused,
		"the established publication code must still type the refusal",
	);
	assert.equal(refused.code, "name_taken");
	assert.equal(
		refused.message,
		"Le propriétaire de la session est indisponible (Damian). Reconnectez-vous avant de réessayer.",
	);
});

test("an unknown identity falls back to the wire's own text", () => {
	// A backend newer than this runtime: its sentence is the compatibility lane,
	// and dropping it would leave the reader with nothing (§6, rows 1 and 5).
	const text = "A newer backend explained this refusal in its own sentence.";
	const prose = publicationProse({
		detail: { code: "wire.errors.future.not_in_this_build", text },
	});
	assert.equal(prose, text);
});

test("a known identity with missing params shows the client generic, never the wire text", () => {
	// `{owner}` cannot be substituted. §6 requires the client's own error plus an
	// identity diagnostic here — falling back to the fluent English sentence
	// would make a version mismatch look like a normal message, and would leak
	// the placeholder if anyone rendered the source.
	const prose = publicationProse({
		detail: {
			code: "runtime_busy",
			message_code: RUNTIME_ID,
			params: {},
			text: RUNTIME_EN,
		},
	});
	assert.equal(
		prose,
		t("ui.common.errors.error_boundary.something_went_wrong"),
	);
	assert.notEqual(prose, RUNTIME_EN);
	assert.ok(!prose.includes("{owner}"), "no placeholder may reach the screen");
	assert.ok(!prose.includes(RUNTIME_ID), "no raw key may reach the screen");
});

test("desktopResult renders the sentence while status, code and retry stay the body's", async () => {
	const error = await refusalFrom({
		status: 503,
		body: {
			detail: {
				code: "runtime_busy",
				message_code: RUNTIME_ID,
				params: { owner: "Damian" },
				text: RUNTIME_EN,
				retryable: true,
				retry_after_ms: 2000,
			},
		},
	});
	assert.ok(error instanceof DesktopControlError);
	assert.equal(
		error.status,
		503,
		"the status is the transport's, not the renderer's",
	);
	assert.equal(
		error.code,
		"runtime_busy",
		"the machine category must not be replaced",
	);
	assert.equal(
		error.retryAfterMs,
		2000,
		"retry timing must not follow localization",
	);
	assert.equal(
		error.message,
		"Le propriétaire de la session est indisponible (Damian). Reconnectez-vous avant de réessayer.",
	);
});

test("desktopResult with malformed params keeps the machine fields and shows the generic", async () => {
	const error = await refusalFrom({
		status: 503,
		body: {
			detail: {
				code: "runtime_busy",
				message_code: RUNTIME_ID,
				params: {},
				text: RUNTIME_EN,
				retryable: true,
				retry_after_ms: 2000,
			},
		},
	});
	assert.equal(error.status, 503);
	assert.equal(error.code, "runtime_busy");
	assert.equal(error.retryAfterMs, 2000);
	assert.equal(
		error.message,
		t("ui.common.errors.error_boundary.something_went_wrong"),
	);
	assert.notEqual(error.message, RUNTIME_EN);
});

test("an identity the runtime does not know still reaches a desktop reader as text", async () => {
	// The older-client/newer-backend direction on the IPC path.
	const text =
		"This backend's own sentence for a refusal this build does not know.";
	const error = await refusalFrom({
		status: 409,
		body: { detail: { code: "some_future_category", text } },
	});
	assert.equal(error.message, text);
	assert.equal(error.status, 409);
});

test("with NO catalogue registered a wire identity falls back to text, never the key", async () => {
	// The state on `main` today: no wire.* catalogue is bundled or registered.
	// A known-to-the-producer identity must therefore degrade to the envelope's
	// own sentence — never to the raw key, which would be worse than the English
	// it replaced.
	clearRegisteredCatalogues();
	setLocale("fr");
	const text = "The runtime could not be reached.";
	const error = await refusalFrom({
		status: 503,
		body: { detail: { code: "wire.errors.desktop.runtime_unreachable", text } },
	});
	console.log("[zero-catalogue, no params]", JSON.stringify(error.message));
	assert.equal(error.message, text);
	assert.notEqual(error.message, "wire.errors.desktop.runtime_unreachable");
});

test("with NO catalogue registered, supplied params do not turn text into a key", async () => {
	clearRegisteredCatalogues();
	setLocale("fr");
	const text = "The runtime could not be reached.";
	const error = await refusalFrom({
		status: 503,
		body: {
			detail: {
				code: "wire.errors.desktop.runtime_unreachable",
				params: { model: "x" },
				text,
			},
		},
	});
	console.log(
		"[zero-catalogue, params {model:x}]",
		JSON.stringify(error.message),
	);
	assert.equal(error.message, text);
	assert.notEqual(error.message, "wire.errors.desktop.runtime_unreachable");
});

test("an unknown message_code does not fall back to code as a key", () => {
	// `message_code ?? code` is a SINGLE choice (§3): when the supplied render
	// identity is unknown, the payload's `text` is the lane — `code` is a machine
	// category and must not be guessed at as a catalogue key. `code` here is a
	// key this runtime DOES know, so a `message_code || code` regression would
	// render its catalogue sentence instead of the wire text.
	const text = "A newer backend's own sentence.";
	const prose = publicationProse({
		detail: {
			code: "ui.common.errors.error_boundary.something_went_wrong",
			message_code: "wire.errors.future.not_in_this_build",
			text,
		},
	});
	assert.equal(prose, text);
	assert.notEqual(
		prose,
		t("ui.common.errors.error_boundary.something_went_wrong"),
	);
});

test("an empty catalogue entry is malformed, never a blank refusal", () => {
	registerCatalogue("fr", { "wire.test.blank": "   " });
	const prose = publicationProse({
		detail: { code: "wire.test.blank", text: RUNTIME_EN },
	});
	assert.equal(
		prose,
		t("ui.common.errors.error_boundary.something_went_wrong"),
	);
	assert.notEqual(prose, "");
	assert.notEqual(prose, RUNTIME_EN);
});

test("a plural and a bare use of the same argument keep the numeric check", () => {
	// One name, two AST nodes: the plural (number) comes first and the bare
	// interpolation (scalar) after it. A last-wins map let the scalar downgrade
	// the check, so "abc" rendered "NaN éléments (valeur : abc)" instead of the
	// malformed branch. Rank is scalar < date < number and never downgrades.
	registerCatalogue("fr", {
		"wire.test.plural_and_bare":
			"{count, plural, one {# élément} other {# éléments}} (valeur : {count})",
	});
	const generic = t("ui.common.errors.error_boundary.something_went_wrong");
	for (const value of ["abc", null, true]) {
		assert.equal(
			publicationProse({
				detail: {
					code: "wire.test.plural_and_bare",
					params: { count: value },
					text: "English wire",
				},
			}),
			generic,
			`count=${String(value)} must stay malformed after the bare use`,
		);
	}
	assert.equal(
		publicationProse({
			detail: {
				code: "wire.test.plural_and_bare",
				params: { count: 2 },
				text: "English wire",
			},
		}),
		"2 éléments (valeur : 2)",
	);
});

test("the ICU argument walk is cached with the formatter, not repeated per t()", () => {
	// The AST Map used to be rebuilt on every lookup (262 -> 702 ns, 2.7x). The
	// cache key is (locale, message), so two renders of one message must parse and
	// walk it ONCE; `getAst` is the only reader of the parsed AST.
	registerCatalogue("fr", { "wire.test.cache_probe": "Sonde {n, number}" });
	globalThis.__imfParses = 0;
	assert.equal(t("wire.test.cache_probe", { n: 1 }), "Sonde 1");
	assert.equal(t("wire.test.cache_probe", { n: 2 }), "Sonde 2");
	assert.equal(
		globalThis.__imfParses,
		1,
		"one parse/argument walk for one message",
	);
});

test("a plural argument that is not a finite number is malformed, not 'NaN'", () => {
	// `IntlMessageFormat` COERCES: "abc" -> NaN, null -> 0, true -> 1. Accepting
	// those would paint a fabricated sentence, which is exactly what §6's
	// malformed branch exists to prevent (review round 1, MAJOR-1).
	registerCatalogue("fr", {
		"wire.test.count": "{count, plural, one {# élément} other {# éléments}}",
		"wire.test.number": "Valeur : {n, number}",
	});
	const generic = t("ui.common.errors.error_boundary.something_went_wrong");
	for (const value of ["abc", null, true, {}, 3]) {
		const prose = publicationProse({
			detail: {
				code: "wire.test.count",
				params: { count: value },
				text: "English wire",
			},
		});
		if (value === 3) {
			assert.equal(prose, "3 éléments", "a valid number still renders");
		} else {
			assert.equal(prose, generic, `count=${String(value)} must be malformed`);
		}
	}
	assert.equal(
		publicationProse({
			detail: {
				code: "wire.test.number",
				params: { n: "abc" },
				text: "English wire",
			},
		}),
		generic,
	);
});

test("teardown", () => {
	// Locale is process-global; leaving it pinned to fr would affect any test
	// that imports this bundle afterwards in the same run.
	clearRegisteredCatalogues();
	setLocale("en");
	globalThis.window = undefined;
});
