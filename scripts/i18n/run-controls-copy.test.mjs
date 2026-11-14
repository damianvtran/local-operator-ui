import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * S17d-2: the run panel's control-failure sentences and the wake-cancel
 * confirmation route through `ui.chat.run_controls`, so switching the interface
 * language leaves no English in them.
 *
 * Two properties, for two different readers:
 *
 * - English is BYTE-IDENTICAL to the literals the code produced before the keys
 *   existed (the strings below are copied from origin/main e2d980d217), through
 *   the repo's own render path (`t()` -> IntlMessageFormat), not a re-read of
 *   the JSON. The ICU traps live here: `{name}'s` must keep its apostrophe and
 *   the select must pick the quoted-head sentence only when a head exists.
 * - A registered probe locale actually reaches each surface, which is the
 *   difference between "keyed" and "still English in fr". It is read at call
 *   time, so a live locale switch repaints the next render with no memo.
 *
 * Failing-first: `S17D2_CONTROL_BASE=<sha> node --test <this file>` loads the
 * model and hooks from that commit instead; on origin/main it fails on the
 * probe-locale and hook-source assertions, because nothing there reads a key.
 */

const controlBase = process.env.S17D2_CONTROL_BASE;
const CONTROL_MODEL = /\/(wake|job)-controls-model\.ts$/;
const RUN_DETAILS = "src/renderer/src/features/chat/components/run-details";

const sourceOf = (path) =>
	controlBase
		? execFileSync("git", ["show", `${controlBase}:${path}`], {
				encoding: "utf8",
			})
		: readFileSync(path, "utf8");

const bundle = await build({
	plugins: controlBase
		? [
				{
					name: "pre-fix-model-control",
					setup(builder) {
						builder.onLoad({ filter: CONTROL_MODEL }, ({ path }) => ({
							contents: sourceOf(relative(process.cwd(), path)),
							loader: "ts",
						}));
					},
				},
			]
		: [],
	stdin: {
		contents: `
			export * as wake from "./${RUN_DETAILS}/wake-controls-model";
			export * as job from "./${RUN_DETAILS}/job-controls-model";
			export { DESKTOP_REFUSAL_PLACEHOLDER, DesktopControlError } from "@shared/api/local-operator/desktop-api";
			export { clearRegisteredCatalogues, registerCatalogue, setLocale, t } from "@shared/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});
const {
	wake,
	job,
	DESKTOP_REFUSAL_PLACEHOLDER,
	DesktopControlError,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
	t,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const NS = "ui.chat.run_controls.";

/* The pre-key literals, verbatim from origin/main e2d980d217. */
const ENGLISH = {
	"job.no_conversation": [{}, "There is no conversation to cancel a job on."],
	/* S17d-3: the job cancel's two refusal sentences, verbatim from a114b6d102. */
	"job.cancel_failed": [{}, "Could not cancel the job."],
	"job.not_found": [{}, "not cancelled — the provider no longer knows the job"],
	"monitor.no_conversation": [
		{},
		"There is no conversation to cancel a monitor on.",
	],
	"monitor.cancel_failed": [{}, "Could not cancel the monitor."],
	"wake.no_conversation": [{}, "There is no conversation to cancel a wake on."],
	"wake.cancel_failed": [{}, "Could not cancel the wake."],
	"wake.already_gone": [{}, "This wake is already gone."],
	"wake_confirm.title": [{}, "Cancel this wake?"],
	"wake_confirm.title_named": [{ name: "Aida" }, "Cancel Aida's check-in?"],
	"wake_confirm.message": [
		{ subject: "head", head: "Daily digest" },
		"“Daily digest” will not fire again, and nothing re-creates it. The conversation stays.",
	],
	"wake_confirm.message_named": [
		{ subject: "other", head: "", name: "Aida" },
		"This wake will not fire again, and nothing re-creates it. Aida's own cadence is unaffected.",
	],
	"wake_confirm.action": [{}, "Cancel wake"],
	"wake_confirm.action_named": [{}, "Cancel check-in"],
};

const withLocale = (locale, catalogue, body) => {
	registerCatalogue(locale, catalogue);
	setLocale(locale);
	try {
		body();
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
};

test("every run_controls key renders today's English byte for byte", () => {
	setLocale("en");
	const catalogue = JSON.parse(
		readFileSync(`src/i18n/catalogues/en/${NS}json`, "utf8"),
	);
	assert.deepEqual(
		Object.keys(catalogue).sort(),
		Object.keys(ENGLISH)
			.map((k) => NS + k)
			.sort(),
		"the namespace carries exactly the twelve S17d-2 keys and the two S17d-3 job keys",
	);
	for (const [key, [args, english]] of Object.entries(ENGLISH))
		assert.equal(t(NS + key, args), english, key);
});

test("the wake confirmation's model keeps its English across every branch", () => {
	setLocale("en");
	assert.equal(wake.wakeConfirmTitle(true, "Aida"), "Cancel Aida's check-in?");
	assert.equal(wake.wakeConfirmTitle(false, "Aida"), "Cancel this wake?");
	assert.equal(wake.wakeConfirmActionLabel(true), "Cancel check-in");
	assert.equal(wake.wakeConfirmActionLabel(false), "Cancel wake");
	const sentence = (named, head) =>
		wake.wakeConfirmSentence({ named, name: "Aida", head });
	assert.equal(
		sentence(true, "4-hourly"),
		"“4-hourly” will not fire again, and nothing re-creates it. Aida's own cadence is unaffected.",
	);
	assert.equal(
		sentence(true, ""),
		"This wake will not fire again, and nothing re-creates it. Aida's own cadence is unaffected.",
	);
	assert.equal(
		sentence(false, "4-hourly"),
		"“4-hourly” will not fire again, and nothing re-creates it. The conversation stays.",
	);
	assert.equal(
		sentence(false, ""),
		"This wake will not fire again, and nothing re-creates it. The conversation stays.",
	);
	assert.equal(
		wake.wakeRefusalSentence({ code: "wake_not_found" }),
		"This wake is already gone.",
	);
});

test("a registered locale reaches every wake-confirmation string at call time", () => {
	const probe = Object.fromEntries(
		Object.keys(ENGLISH).map((k) => [NS + k, `FR[${k}]`]),
	);
	probe[`${NS}wake_confirm.title_named`] = "FR[title_named]{name}";
	probe[`${NS}wake_confirm.message`] =
		"{subject, select, head {FR[message]«{head}»} other {FR[message]}}";
	probe[`${NS}wake_confirm.message_named`] =
		"{subject, select, head {FR[message_named]«{head}»{name}} other {FR[message_named]{name}}}";
	withLocale("fr", probe, () => {
		assert.equal(wake.wakeConfirmTitle(true, "Aida"), "FR[title_named]Aida");
		assert.equal(
			wake.wakeConfirmTitle(false, "Aida"),
			"FR[wake_confirm.title]",
		);
		assert.equal(
			wake.wakeConfirmActionLabel(true),
			"FR[wake_confirm.action_named]",
		);
		assert.equal(wake.wakeConfirmActionLabel(false), "FR[wake_confirm.action]");
		assert.equal(
			wake.wakeConfirmSentence({ named: false, name: "Aida", head: "x" }),
			"FR[message]«x»",
		);
		assert.equal(
			wake.wakeConfirmSentence({ named: true, name: "Aida", head: "" }),
			"FR[message_named]Aida",
		);
		assert.equal(
			wake.wakeRefusalSentence({ code: "wake_not_found" }),
			"FR[wake.already_gone]",
		);
	});
	// Switching back repaints the next call: nothing was captured at load.
	assert.equal(wake.wakeConfirmTitle(false, "Aida"), "Cancel this wake?");
});

/*
 * The three hooks are thin React Query wrappers whose sentences are built inside
 * `mutationFn` / the failure branch, i.e. at the moment of failure, so the
 * current locale applies with no memo to invalidate. Running them needs a React
 * tree and a failing mutation for no added signal; the property that matters is
 * that each sentence is a `t()` read of its key and no English literal is left.
 */
test("the job, monitor and wake hooks read their failure sentences from keys", () => {
	const HOOKS = {
		"use-job-controls.ts": ["job.no_conversation"],
		"use-monitor-controls.ts": [
			"monitor.no_conversation",
			"monitor.cancel_failed",
		],
		"use-wake-controls.ts": ["wake.no_conversation", "wake.cancel_failed"],
	};
	for (const [file, keys] of Object.entries(HOOKS)) {
		const source = sourceOf(`${RUN_DETAILS}/${file}`);
		for (const key of keys) {
			assert.match(
				source,
				new RegExp(`t\\("${(NS + key).replaceAll(".", "\\.")}"\\)`),
				`${file} reads ${key}`,
			);
			assert.ok(
				!source.includes(`"${ENGLISH[key][1]}"`),
				`${file} no longer carries "${ENGLISH[key][1]}"`,
			);
		}
	}
});

/*
 * S17d-3: the job cancel's refusal sentence. `refusalDetail` is what the pane
 * body renders inside the confirmation card, so driving it with the transport's
 * own error shapes is driving the surface's text. Two sentences, two paths:
 * a placeholder-only 404 (the unknown-job class) speaks the frozen not_found
 * phrase, and an error that is not authored copy falls to the generic fallback.
 * An authored sentence (the engine's own words) must still win untouched.
 */
test("the job cancel's refusal sentences keep their English byte for byte", () => {
	setLocale("en");
	const bare = new DesktopControlError(404, DESKTOP_REFUSAL_PLACEHOLDER);
	assert.equal(
		job.refusalDetail(bare),
		"not cancelled — the provider no longer knows the job",
	);
	assert.equal(job.jobCancelNotFoundCopy(), job.refusalDetail(bare));
	assert.equal(
		job.refusalDetail(new TypeError("fetch failed")),
		"Could not cancel the job.",
	);
	assert.equal(
		job.refusalDetail(
			new DesktopControlError(409, "job j1 was not cancelled (status: done)"),
		),
		"job j1 was not cancelled (status: done)",
	);
});

test("a registered locale reaches the job cancel's refusal sentences at call time", () => {
	const probe = Object.fromEntries(
		Object.keys(ENGLISH).map((k) => [NS + k, `FR[${k}]`]),
	);
	withLocale("fr", probe, () => {
		assert.equal(
			job.refusalDetail(
				new DesktopControlError(404, DESKTOP_REFUSAL_PLACEHOLDER),
			),
			"FR[job.not_found]",
		);
		assert.equal(
			job.refusalDetail(new TypeError("fetch failed")),
			"FR[job.cancel_failed]",
		);
		// The engine's own sentence is never rewritten by the UI's locale.
		assert.equal(
			job.refusalDetail(new DesktopControlError(409, "engine words")),
			"engine words",
		);
	});
	assert.equal(
		job.refusalDetail(new TypeError("fetch failed")),
		"Could not cancel the job.",
	);
});
