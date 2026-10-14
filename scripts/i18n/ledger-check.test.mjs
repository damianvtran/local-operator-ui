import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { checkLedger } from "./ledger-check.mjs";

/*
 * NEGATIVE CONTROLS for the ledger gate.
 *
 * A gate that cannot fail on the states it exists to refuse is decoration, so
 * every case below builds a synthetic tree, breaks it in exactly one way, and
 * requires `checkLedger` to name that break. The successful case is the control:
 * the same fixture, unbroken, must pass — otherwise a gate that fails everything
 * would look correct here.
 *
 * The controls are the ones the acceptance list names: a dropped key, a removed
 * namespace, an empty locale, a locale claimed but absent, a stale source hash
 * and a stale target hash, plus the passing full control.
 */

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Severity counts of a clean audit, and a stand-in receipt hash (the gate only checks it is a sha256). */
const NO_FINDINGS = { blocker: 0, major: 0, minor: 0, nit: 0 };
const RECEIPT_SHA = "a".repeat(64);

/** A minimal, COMPLETE and correctly-audited tree for one locale/namespace. */
function buildTree({ mutate } = {}) {
	const root = mkdtempSync(join(tmpdir(), "i18n-ledger-"));
	const enDir = join(root, "src", "i18n", "catalogues", "en");
	const frDir = join(root, "src", "i18n", "catalogues", "fr");
	mkdirSync(enDir, { recursive: true });
	mkdirSync(frDir, { recursive: true });

	const enText = `${JSON.stringify(
		{
			"demo.words.hello": "Hello, {name}!",
			"demo.words.files": "{count, plural, one {# file} other {# files}}",
			"demo.words.plain": "plain text",
		},
		null,
		"\t",
	)}\n`;
	const frText = `${JSON.stringify(
		{
			"demo.words.hello": "Bonjour, {name} !",
			"demo.words.files": "{count, plural, one {# fichier} other {# fichiers}}",
			"demo.words.plain": "texte simple",
		},
		null,
		"\t",
	)}\n`;
	writeFileSync(join(enDir, "demo.words.json"), enText);
	writeFileSync(join(frDir, "demo.words.json"), frText);

	const ledger = {
		schema: 1,
		entries: [
			{
				locale: "fr",
				namespace: "demo.words",
				source_sha256: sha256(enText),
				target_sha256: sha256(frText),
				translator: {
					agent: "i18n-translator",
					model: "test",
					date: "2026-10-13",
				},
				auditors: [
					{
						agent: "i18n-auditor",
						model: "test",
						date: "2026-10-13",
						result: "clean",
						instance: "audit-run-aaaa",
						findings: NO_FINDINGS,
						receipt_sha256: RECEIPT_SHA,
					},
				],
				status: "audited",
			},
		],
	};
	mkdirSync(join(root, "i18n"), { recursive: true });
	const writeLedger = (value) =>
		writeFileSync(
			join(root, "i18n", "ledger.json"),
			`${JSON.stringify(value, null, "\t")}\n`,
		);
	writeLedger(ledger);

	mutate?.({ root, enDir, frDir, enText, frText, ledger, writeLedger });
	return root;
}

function withTree(options, run) {
	const root = buildTree(options);
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("CONTROL: a complete, fresh, independently audited locale PASSES", () => {
	withTree({}, (root) => {
		const { failures, checked } = checkLedger({ repo: root });
		assert.deepEqual(failures, [], "the unbroken fixture must pass");
		assert.equal(checked, 1);
	});
});

test("NEGATIVE: one dropped key fails (a fallback must not hide a gap)", () => {
	withTree(
		{
			mutate: ({ frDir }) => {
				writeFileSync(
					join(frDir, "demo.words.json"),
					`${JSON.stringify({ "demo.words.hello": "Bonjour, {name} !" }, null, "\t")}\n`,
				);
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("missing")),
				`a dropped key must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: a removed namespace fails (shipped file, no entry)", () => {
	withTree(
		{
			mutate: ({ writeLedger, ledger }) => {
				writeLedger({ ...ledger, entries: [] });
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("shipped without a ledger entry")),
				`an unclaimed shipped namespace must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: an empty locale fails on completeness", () => {
	withTree(
		{
			mutate: ({ frDir }) => {
				writeFileSync(join(frDir, "demo.words.json"), "{}\n");
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("missing")),
				`an empty locale must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: a locale claimed but absent fails", () => {
	withTree(
		{
			mutate: ({ root }) => {
				rmSync(join(root, "src", "i18n", "catalogues", "fr"), {
					recursive: true,
					force: true,
				});
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("does not exist")),
				`an absent claimed locale must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: a stale SOURCE hash fails (the English moved since translation)", () => {
	withTree(
		{
			mutate: ({ writeLedger, ledger }) => {
				writeLedger({
					...ledger,
					entries: [{ ...ledger.entries[0], source_sha256: "0".repeat(64) }],
				});
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("stale source_sha256")),
				`a stale source hash must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: a stale TARGET hash fails (the file changed since it was audited)", () => {
	withTree(
		{
			mutate: ({ writeLedger, ledger }) => {
				writeLedger({
					...ledger,
					entries: [{ ...ledger.entries[0], target_sha256: "0".repeat(64) }],
				});
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("stale target_sha256")),
				`a stale target hash must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: an unaudited status fails", () => {
	withTree(
		{
			mutate: ({ writeLedger, ledger }) => {
				writeLedger({
					...ledger,
					entries: [{ ...ledger.entries[0], status: "translated" }],
				});
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("unaudited locale must not ship")),
				`an unaudited locale must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: an auditor who IS the translator fails (independence)", () => {
	withTree(
		{
			mutate: ({ writeLedger, ledger }) => {
				writeLedger({
					...ledger,
					entries: [
						{
							...ledger.entries[0],
							auditors: [
								{ agent: "i18n-translator", model: "test", date: "2026-10-13" },
							],
						},
					],
				});
			},
		},
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("must be independent")),
				`a self-audited locale must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

/*
 * F2 (code review round 1): the gate used to read only `status` and the agent
 * name, so a recorded FAILED audit and a second audit that was the same run
 * both passed. Each case below mutates ONE field of the control fixture, so a
 * failure is attributable to exactly that rule.
 */
const withAuditors = (auditors) => ({
	mutate: ({ writeLedger, ledger }) => {
		writeLedger({
			...ledger,
			entries: [{ ...ledger.entries[0], auditors }],
		});
	},
});
const audit = (overrides = {}) => ({
	agent: "i18n-auditor",
	model: "test",
	date: "2026-10-13",
	result: "clean",
	instance: "audit-run-aaaa",
	findings: NO_FINDINGS,
	receipt_sha256: RECEIPT_SHA,
	...overrides,
});

test("NEGATIVE: a failed audit result cannot back an audited entry", () => {
	withTree(withAuditors([audit({ result: "fail" })]), (root) => {
		const { failures } = checkLedger({ repo: root });
		assert.ok(
			failures.some((f) => f.includes("not a passing result")),
			`a failed result must fail; got ${JSON.stringify(failures)}`,
		);
	});
});

test("NEGATIVE: an auditor with no recorded result fails", () => {
	withTree(withAuditors([audit({ result: undefined })]), (root) => {
		const { failures } = checkLedger({ repo: root });
		assert.ok(
			failures.some((f) => f.includes("not a passing result")),
			`a missing result must fail; got ${JSON.stringify(failures)}`,
		);
	});
});

test("CONTROL: a clean-with-findings audit (MINOR/NIT recorded, not churned) PASSES", () => {
	withTree(
		withAuditors([
			audit({
				result: "clean-with-findings",
				findings: { ...NO_FINDINGS, minor: 2, nit: 1 },
			}),
		]),
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.deepEqual(
				failures,
				[],
				"a passing audit with recorded minors passes",
			);
		},
	);
});

test("CONTROL: findings remediated, then a clean re-audit by a distinct run, PASSES", () => {
	withTree(
		withAuditors([
			audit({
				result: "clean-with-findings",
				instance: "audit-run-aaaa",
				findings: { ...NO_FINDINGS, minor: 1 },
			}),
			audit({ result: "clean", instance: "audit-run-bbbb" }),
		]),
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.deepEqual(
				failures,
				[],
				"a remediated then re-audited entry passes",
			);
		},
	);
});

test("NEGATIVE: two audits that share one instance are not two audits", () => {
	withTree(
		withAuditors([
			audit({ instance: "audit-run-aaaa" }),
			audit({ instance: "audit-run-aaaa" }),
		]),
		(root) => {
			const { failures } = checkLedger({ repo: root });
			assert.ok(
				failures.some((f) => f.includes("share one `instance`")),
				`a repeated instance must fail; got ${JSON.stringify(failures)}`,
			);
		},
	);
});

test("NEGATIVE: an auditor with no instance id fails", () => {
	withTree(withAuditors([audit({ instance: undefined })]), (root) => {
		const { failures } = checkLedger({ repo: root });
		assert.ok(
			failures.some((f) => f.includes("has no `instance`")),
			`a missing instance must fail; got ${JSON.stringify(failures)}`,
		);
	});
});

test("the REAL repository's ledger passes (the shipped fr/ui.settings entry)", () => {
	/*
	 * The one case that reads the actual tree rather than a fixture. It is here so
	 * that the gate cannot pass its own synthetic controls while failing on the
	 * repository it ships in.
	 */
	const repo = join(import.meta.dirname, "..", "..");
	const { failures, checked } = checkLedger({ repo });
	assert.ok(
		checked >= 1,
		"the repository ledger must carry at least one entry",
	);
	assert.deepEqual(
		failures,
		[],
		`the repository ledger must be clean: ${failures.join("; ")}`,
	);
});
