/**
 * Tests for `ledger-assemble.mjs` (the ledger WRITER) and the rules it shares with
 * `ledger-check.mjs` (`ledger-rules.mjs`).
 *
 * WHY EACH CASE EXISTS. A writer is only trustworthy if it can be made to refuse.
 * Every refusal below is driven by mutating ONE thing in an otherwise-valid
 * fixture, so a failure is attributable to exactly that rule; the controls prove
 * the unmutated fixture assembles and that what the tool writes is a row the gate
 * accepts (the writer and the gate must agree - that is why the rules are shared).
 *
 * Fixtures are synthetic trees under the OS temp dir; nothing here touches the
 * repo's own ledger, catalogues or `i18n/receipts/`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	Refusal,
	assemble,
	receiptIdentity,
	resultSupportedBy,
} from "./ledger-assemble.mjs";
import { checkLedger } from "./ledger-check.mjs";
import {
	countFindings,
	isPlaceholderInstance,
	supportedStatus,
	validateAuditSet,
} from "./ledger-rules.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");

const EN = `${JSON.stringify({ "demo.words.hello": "Hello, {name}!", "demo.words.plain": "plain" }, null, "\t")}\n`;
const FR = `${JSON.stringify({ "demo.words.hello": "Bonjour, {name} !", "demo.words.plain": "simple" }, null, "\t")}\n`;
const FILE = "src/i18n/catalogues/fr/demo.words.json";
const MODEL = "test/model-1";

/** A receipt that names the bytes on disk, with the given findings. */
function receiptFor({
	instance = "run-aaaaaaaa",
	status = "passed",
	findings = [],
	extra = {},
} = {}) {
	return {
		auditor: "i18n-auditor",
		model: MODEL,
		instance,
		namespace: "demo.words",
		status,
		sha256: { fr: sha(FR), en: sha(EN) },
		findings,
		...extra,
	};
}

function buildTree() {
	const root = mkdtempSync(join(tmpdir(), "i18n-assemble-"));
	for (const [locale, text] of [
		["en", EN],
		["fr", FR],
	]) {
		const dir = join(root, "src", "i18n", "catalogues", locale);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "demo.words.json"), text);
	}
	mkdirSync(join(root, "receipts-in"), { recursive: true });
	return root;
}

const writeReceipt = (root, name, body) => {
	const path = join(root, "receipts-in", name);
	writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
	return path;
};

const ledgerOf = (root) =>
	JSON.parse(readFileSync(join(root, "i18n", "ledger.json"), "utf8"));

function run(root, overrides = {}) {
	const instance = overrides.auditorInstance ?? "run-aaaaaaaa";
	const receipt =
		overrides.receipt ??
		writeReceipt(root, `${instance}.json`, receiptFor({ instance }));
	return assemble({
		repo: root,
		locale: "fr",
		file: FILE,
		auditorInstance: instance,
		auditorModel: MODEL,
		result: "clean",
		receipt,
		translatorAgent: "i18n-translator",
		translatorModel: "test/translator",
		date: "2026-10-14",
		...overrides,
	});
}

function withTree(fn) {
	const root = buildTree();
	try {
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function refusal(fn, pattern) {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof Refusal, `expected a Refusal, got ${error}`);
		assert.match(error.message, pattern);
		return true;
	});
}

/* ------------------------------ controls ------------------------------ */

test("CONTROL: a clean receipt assembles an audited row the GATE accepts", () => {
	withTree((root) => {
		const out = run(root);
		// One valid, passing, independent audit supports `audited`: that is the
		// GATE's rule (the two-audit policy for high-visibility namespaces is a
		// programme rule the ledger does not encode). The tool must not invent a
		// stricter status than the gate would accept, nor a laxer one.
		assert.equal(out.status, "audited");
		const ledger = ledgerOf(root);
		const row = ledger.entries[0];
		// Hashes are DERIVED from the files, not supplied.
		assert.equal(row.source_sha256, sha(EN));
		assert.equal(row.target_sha256, sha(FR));
		assert.deepEqual(row.auditors[0].findings, {
			blocker: 0,
			major: 0,
			minor: 0,
			nit: 0,
		});
		assert.equal(row.auditors[0].instance, "run-aaaaaaaa");
		// The receipt travelled into the repo, and the row records its hash.
		const copy = join(root, row.auditors[0].receipt);
		assert.ok(existsSync(copy), "the receipt is copied under i18n/receipts/");
		assert.equal(row.auditors[0].receipt_sha256, sha(readFileSync(copy)));
		// The gate agrees with the writer.
		const { failures } = checkLedger({ repo: root });
		assert.deepEqual(failures, []);
	});
});

test("CONTROL: a status is `audited` only when the auditors support it", () => {
	withTree((root) => {
		run(root);
		const second = run(root, {
			auditorInstance: "run-bbbbbbbb",
			result: "clean-with-findings",
			receipt: writeReceipt(
				root,
				"b.json",
				receiptFor({
					instance: "run-bbbbbbbb",
					findings: [
						{ severity: "MINOR", key: "demo.words.plain" },
						{ sev: "NIT", key: "demo.words.hello" },
					],
				}),
			),
		});
		assert.equal(second.status, "audited");
		assert.deepEqual(ledgerOf(root).entries[0].auditors[1].findings, {
			blocker: 0,
			major: 0,
			minor: 1,
			nit: 1,
		});
		assert.deepEqual(checkLedger({ repo: root }).failures, []);
	});
});

test("CONTROL: re-running with the SAME receipt is idempotent (one audit, not two)", () => {
	withTree((root) => {
		run(root);
		run(root);
		assert.equal(ledgerOf(root).entries[0].auditors.length, 1);
	});
});

/* ------------------------------ refusals ------------------------------ */

test("NEGATIVE: a missing receipt is refused and nothing is written", () => {
	withTree((root) => {
		refusal(
			() => run(root, { receipt: join(root, "receipts-in", "nope.json") }),
			/does not exist/,
		);
		assert.equal(
			existsSync(join(root, "i18n", "ledger.json")),
			false,
			"no ledger written",
		);
	});
});

test("NEGATIVE: a receipt that is not JSON is refused", () => {
	withTree((root) => {
		refusal(
			() => run(root, { receipt: writeReceipt(root, "bad.json", "{not json") }),
			/not readable JSON/,
		);
	});
});

test("NEGATIVE: a stale hash - the receipt audited different bytes - is refused", () => {
	withTree((root) => {
		const stale = receiptFor();
		stale.sha256.fr = sha("an older translation");
		refusal(
			() => run(root, { receipt: writeReceipt(root, "stale.json", stale) }),
			/does not name the target bytes on disk/,
		);
		const staleEnglish = receiptFor();
		staleEnglish.sha256.en = sha("an older source");
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "stale-en.json", staleEnglish),
				}),
			/does not name the English source bytes on disk/,
		);
	});
});

test("NEGATIVE: a result the receipt does not support is refused (result/status mismatch)", () => {
	withTree((root) => {
		// changes_requested receipt, operator claims clean: can never become audited.
		const rejected = writeReceipt(
			root,
			"rej.json",
			receiptFor({
				instance: "run-cccccccc",
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-cccccccc",
					receipt: rejected,
					result: "clean",
				}),
			/is not supported by the receipt/,
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-cccccccc",
					receipt: rejected,
					result: "clean-with-findings",
				}),
			/is not supported by the receipt/,
		);
		// A `passed` receipt that records a MAJOR cannot be labelled clean-with-findings.
		const hidden = writeReceipt(
			root,
			"hid.json",
			receiptFor({
				instance: "run-dddddddd",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-dddddddd",
					receipt: hidden,
					result: "clean-with-findings",
				}),
			/the receipt says passed but its findings include a blocker\/major/,
		);
		// Findings but labelled plain clean.
		const minors = writeReceipt(
			root,
			"min.json",
			receiptFor({
				instance: "run-eeeeeeee",
				findings: [{ severity: "MINOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-eeeeeeee",
					receipt: minors,
					result: "clean",
				}),
			/supports clean-with-findings/,
		);
	});
});

test("NEGATIVE: a changes_requested receipt is recorded honestly and the row is NEVER audited", () => {
	withTree((root) => {
		const rejected = writeReceipt(
			root,
			"rej.json",
			receiptFor({
				instance: "run-cccccccc",
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		const out = run(root, {
			auditorInstance: "run-cccccccc",
			receipt: rejected,
			result: "changes_requested",
		});
		assert.equal(out.status, "changes_requested");
		// ...so the gate refuses to ship it.
		const { failures } = checkLedger({ repo: root });
		assert.ok(
			failures.some(
				(f) =>
					f.includes("not a passing result") || f.includes('not "audited"'),
			),
			JSON.stringify(failures),
		);
	});
});

test("NEGATIVE: a duplicate instance with a DIFFERENT receipt is refused", () => {
	withTree((root) => {
		run(root);
		const other = receiptFor({
			instance: "run-aaaaaaaa",
			findings: [{ severity: "MINOR", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "other.json", other),
					result: "clean-with-findings",
				}),
			// TWO guards cover this and the first to fire wins: the receipt copy is
			// named by its instance, so a different file at that name trips the
			// immutable-evidence guard before the row-level one is reached.
			/already exists with different content|already recorded .* with a different receipt/,
		);
	});
});

test("NEGATIVE: the ROW-level guard refuses a different receipt on a recorded instance even with no copy on disk", () => {
	withTree((root) => {
		run(root);
		// Remove the in-repo copy so the immutable-evidence guard cannot fire; the
		// row itself still remembers the instance and the receipt hash.
		rmSync(join(root, "i18n", "receipts", "run-aaaaaaaa.json"));
		const other = receiptFor({
			instance: "run-aaaaaaaa",
			findings: [{ severity: "MINOR", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "other2.json", other),
					result: "clean-with-findings",
				}),
			/already recorded .* with a different receipt/,
		);
	});
});

test("NEGATIVE: a placeholder instance is refused (the receipt that names itself 'scratchpad')", () => {
	withTree((root) => {
		const receipt = writeReceipt(
			root,
			"ph.json",
			receiptFor({ instance: "scratchpad" }),
		);
		refusal(
			() => run(root, { auditorInstance: "scratchpad", receipt }),
			/missing or a placeholder/,
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "x",
					receipt: writeReceipt(
						root,
						"short.json",
						receiptFor({ instance: "x" }),
					),
				}),
			/missing or a placeholder/,
		);
	});
});

test("NEGATIVE: --auditor-instance must be the receipt's own instance", () => {
	withTree((root) => {
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-zzzzzzzz",
					receipt: writeReceipt(
						root,
						"r.json",
						receiptFor({ instance: "run-aaaaaaaa" }),
					),
				}),
			/not the --auditor-instance/,
		);
	});
});

test("NEGATIVE: --auditor-model must match the receipt's model", () => {
	withTree((root) => {
		refusal(
			() => run(root, { auditorModel: "some/other-model" }),
			/names model/,
		);
	});
});

test("NEGATIVE: a receipt with no findings field is refused (absent is not zero)", () => {
	withTree((root) => {
		const body = receiptFor();
		body.findings = undefined;
		refusal(
			() => run(root, { receipt: writeReceipt(root, "nof.json", body) }),
			/no `findings` field/,
		);
	});
});

test("NEGATIVE: a finding with no recognisable severity is refused, never dropped", () => {
	withTree((root) => {
		const body = receiptFor({
			findings: [{ severity: "CRITICAL!!", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "sev.json", body),
					result: "clean-with-findings",
				}),
			/not countable/,
		);
	});
});

test("NEGATIVE: an incomplete locale file is refused (a dropped key must not hide behind fallback)", () => {
	withTree((root) => {
		const dropped = `${JSON.stringify({ "demo.words.hello": "Bonjour, {name} !" }, null, "\t")}\n`;
		writeFileSync(join(root, FILE), dropped);
		const body = receiptFor();
		body.sha256.fr = sha(dropped);
		refusal(
			() => run(root, { receipt: writeReceipt(root, "d.json", body) }),
			/not key-complete against English \(1 missing/,
		);
	});
});

test("NEGATIVE: a new row without a translator is refused", () => {
	withTree((root) => {
		refusal(
			() => run(root, { translatorAgent: undefined }),
			/--translator-agent/,
		);
	});
});

test("NEGATIVE: the source locale and a path outside the catalogue tree are refused", () => {
	withTree((root) => {
		refusal(
			() =>
				run(root, {
					locale: "en",
					file: "src/i18n/catalogues/en/demo.words.json",
				}),
			/source locale/,
		);
		refusal(
			() => run(root, { file: "../elsewhere/demo.words.json" }),
			/catalogue/,
		);
	});
});

test("NEGATIVE: an existing receipt copy is never overwritten with different content", () => {
	withTree((root) => {
		run(root);
		// Tamper with the in-repo copy, then ask for the same instance again.
		const copy = join(root, ledgerOf(root).entries[0].auditors[0].receipt);
		writeFileSync(copy, '{"tampered":true}');
		refusal(() => run(root), /already exists with different content/);
	});
});

/* ------------------------- staleness and history ------------------------- */

test("a file edited after its audit moves the old audits to `superseded` and restarts the row", () => {
	withTree((root) => {
		run(root);
		const edited = `${JSON.stringify({ "demo.words.hello": "Salut, {name} !", "demo.words.plain": "simple" }, null, "\t")}\n`;
		writeFileSync(join(root, FILE), edited);
		const body = receiptFor({ instance: "run-ffffffff" });
		body.sha256.fr = sha(edited);
		const out = run(root, {
			auditorInstance: "run-ffffffff",
			receipt: writeReceipt(root, "new.json", body),
		});
		assert.equal(out.stale, true);
		const row = ledgerOf(root).entries[0];
		assert.equal(row.target_sha256, sha(edited));
		assert.equal(
			row.auditors.length,
			1,
			"only the audit of the NEW bytes counts",
		);
		assert.equal(row.auditors[0].instance, "run-ffffffff");
		assert.equal(row.superseded.length, 1, "the old audit is kept as history");
		assert.equal(row.superseded[0].target_sha256, sha(FR));
	});
});

/* ------------------- the GATE's new rules (shared module) ------------------- */

const GOOD = {
	agent: "i18n-auditor",
	result: "clean",
	instance: "run-aaaaaaaa",
	findings: { blocker: 0, major: 0, minor: 0, nit: 0 },
	receipt: "i18n/receipts/run-aaaaaaaa.json",
	receipt_sha256: "a".repeat(64),
};

test("GATE M2: a passing audit that records a MAJOR or BLOCKER fails, whatever its label says", () => {
	for (const severity of ["blocker", "major"]) {
		const failures = validateAuditSet(
			[
				{
					...GOOD,
					result: "clean-with-findings",
					findings: { ...GOOD.findings, [severity]: 1, minor: 1 },
				},
			],
			"i18n-translator",
			"fr/x",
		);
		assert.ok(
			failures.some((f) => f.includes(severity.toUpperCase())),
			JSON.stringify(failures),
		);
	}
});

test("GATE M2: a result label that disagrees with its counts fails in both directions", () => {
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, result: "clean-with-findings" }],
			"t",
			"fr/x",
		).some((f) => f.includes('use "clean"')),
	);
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, findings: { ...GOOD.findings, minor: 2 } }],
			"t",
			"fr/x",
		).some((f) => f.includes('use "clean-with-findings"')),
	);
});

test("GATE M2: an audit with no severity counts fails (the label alone is self-attested)", () => {
	const { findings, ...noCounts } = GOOD;
	assert.ok(
		validateAuditSet([noCounts], "t", "fr/x").some((f) =>
			f.includes("severity counts"),
		),
	);
});

test("GATE M3: a placeholder instance, a missing receipt hash, and a tampered in-repo receipt all fail", () => {
	assert.ok(
		validateAuditSet([{ ...GOOD, instance: "scratchpad" }], "t", "fr/x").some(
			(f) => f.includes("placeholder"),
		),
	);
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, receipt_sha256: undefined }],
			"t",
			"fr/x",
		).some((f) => f.includes("receipt_sha256")),
	);
	withTree((root) => {
		run(root);
		run(root, {
			auditorInstance: "run-bbbbbbbb",
			receipt: writeReceipt(
				root,
				"b.json",
				receiptFor({ instance: "run-bbbbbbbb" }),
			),
		});
		assert.deepEqual(checkLedger({ repo: root }).failures, []);
		const path = join(root, ledgerOf(root).entries[0].auditors[0].receipt);
		writeFileSync(path, '{"tampered":true}');
		assert.ok(
			checkLedger({ repo: root }).failures.some((f) =>
				f.includes("no longer matches its recorded receipt_sha256"),
			),
			"the gate re-hashes in-repo receipts",
		);
		rmSync(path);
		assert.ok(
			checkLedger({ repo: root }).failures.some((f) =>
				f.includes("is not in the repo"),
			),
		);
	});
});

test("GATE: two auditors sharing an instance still fail", () => {
	assert.ok(
		validateAuditSet([GOOD, { ...GOOD }], "t", "fr/x").some((f) =>
			f.includes("share one `instance`"),
		),
	);
});

/* ------------------------------ unit pieces ------------------------------ */

test("placeholder detection: stock words and short ids are placeholders, a 12-hex session id is not", () => {
	for (const value of [
		"scratchpad",
		"Session",
		"unknown",
		"",
		"abc",
		undefined,
		null,
		42,
	]) {
		assert.equal(isPlaceholderInstance(value), true, String(value));
	}
	for (const value of ["340d8507700f", "run-aaaaaaaa"]) {
		assert.equal(isPlaceholderInstance(value), false, value);
	}
});

test("severity counting reads both spellings, ignores INFO, and errors on the unknown", () => {
	const { counts, errors } = countFindings([
		{ severity: "MAJOR" },
		{ sev: "Minor" },
		{ severity: "nit" },
		{ sev: "INFO" },
		{ severity: "BLOCKER" },
	]);
	assert.deepEqual(counts, { blocker: 1, major: 1, minor: 1, nit: 1 });
	assert.deepEqual(errors, []);
	assert.equal(countFindings([{ severity: "weird" }]).errors.length, 1);
});

test("a findings OBJECT keyed by severity (the shape one real receipt uses) is counted", () => {
	withTree((root) => {
		const body = receiptFor({ instance: "run-gggggggg" });
		body.findings = {
			BLOCKER: [],
			MAJOR: [],
			MINOR: [{ key: "demo.words.plain" }],
			NIT: [],
		};
		const out = run(root, {
			auditorInstance: "run-gggggggg",
			receipt: writeReceipt(root, "o.json", body),
			result: "clean-with-findings",
		});
		assert.deepEqual(out.audit.findings, {
			blocker: 0,
			major: 0,
			minor: 1,
			nit: 0,
		});
	});
});

test("receipt identity: instance/model/verdict are read from the shapes auditors really write", () => {
	assert.deepEqual(
		receiptIdentity({ instance: "i", model: "m", status: "passed" }),
		{ instance: "i", model: "m", status: "passed" },
	);
	assert.deepEqual(
		receiptIdentity({
			auditor: { agent: "a", instance: "i2", actual_model: "m2" },
			result: "clean",
		}),
		{ instance: "i2", model: "m2", status: "passed" },
	);
	assert.equal(
		receiptIdentity({ result: "changes_requested" }).status,
		"changes_requested",
	);
	assert.equal(receiptIdentity({ status: "who knows" }).status, undefined);
});

test("a multi-namespace receipt is scoped per namespace and a finding that names none is refused", () => {
	withTree((root) => {
		const body = receiptFor({ instance: "run-hhhhhhhh" });
		body.namespaces = {
			"demo.words": {
				status: "passed",
				sha256: { fr: sha(FR), en: sha(EN) },
				findings: [{ severity: "MINOR", key: "demo.words.plain" }],
			},
			"demo.other": {
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.other.x" }],
			},
		};
		body.findings = undefined;
		const out = run(root, {
			auditorInstance: "run-hhhhhhhh",
			receipt: writeReceipt(root, "m.json", body),
			result: "clean-with-findings",
		});
		assert.deepEqual(
			out.audit.findings,
			{ blocker: 0, major: 0, minor: 1, nit: 0 },
			"the other namespace's MAJOR does not leak in",
		);
	});
	withTree((root) => {
		const body = receiptFor({
			instance: "run-iiiiiiii",
			findings: [{ severity: "MAJOR", key: "unattributable" }],
		});
		body.namespaces = {
			"demo.words": { status: "passed", sha256: { fr: sha(FR), en: sha(EN) } },
			"demo.other": {},
		};
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-iiiiiiii",
					receipt: writeReceipt(root, "m2.json", body),
					result: "clean-with-findings",
				}),
			/names no namespace/,
		);
	});
});

/*
 * ONE audit run covering several namespaces is ONE receipt file with a
 * `namespaces` block per namespace, each naming its OWN two hashes. The tool is
 * invoked once per namespace against the same file; the in-repo copy is written
 * once and verified identical on every later call (immutable evidence).
 */
function multiTree() {
	const root = buildTree();
	const second = [
		"demo.more",
		`${JSON.stringify({ "demo.more.a": "A" }, null, "\t")}\n`,
		`${JSON.stringify({ "demo.more.a": "Un" }, null, "\t")}\n`,
	];
	writeFileSync(join(root, "src/i18n/catalogues/en/demo.more.json"), second[1]);
	writeFileSync(join(root, "src/i18n/catalogues/fr/demo.more.json"), second[2]);
	return { root, second };
}

const multiReceipt = ({ crossed = false, second }) => {
	const own = {
		"demo.words": { fr: sha(FR), en: sha(EN) },
		"demo.more": { fr: sha(second[2]), en: sha(second[1]) },
	};
	if (crossed)
		[own["demo.words"], own["demo.more"]] = [
			own["demo.more"],
			own["demo.words"],
		];
	return {
		auditor: "i18n-auditor",
		model: MODEL,
		instance: "run-multi-0001",
		status: "passed",
		namespaces: {
			"demo.words": {
				status: "passed",
				sha256: own["demo.words"],
				findings: [],
			},
			"demo.more": {
				status: "passed",
				sha256: own["demo.more"],
				findings: [{ severity: "MINOR", key: "demo.more.a" }],
			},
		},
	};
};

test("ONE receipt file covers several namespaces: assembled once per namespace, one copy in the repo", () => {
	const { root, second } = multiTree();
	try {
		const receipt = writeReceipt(root, "multi.json", multiReceipt({ second }));
		const base = { auditorInstance: "run-multi-0001", receipt };
		const a = run(root, { ...base, file: FILE });
		const b = run(root, {
			...base,
			file: "src/i18n/catalogues/fr/demo.more.json",
			result: "clean-with-findings",
		});
		assert.equal(a.status, "audited");
		assert.equal(b.status, "audited");
		assert.deepEqual(
			b.audit.findings,
			{ blocker: 0, major: 0, minor: 1, nit: 0 },
			"each row counts only its own namespace's findings",
		);
		assert.deepEqual(a.audit.findings, {
			blocker: 0,
			major: 0,
			minor: 0,
			nit: 0,
		});
		assert.equal(
			a.audit.receipt_sha256,
			b.audit.receipt_sha256,
			"both rows point at the same receipt content",
		);
		assert.deepEqual(readdirSync(join(root, "i18n", "receipts")), [
			"run-multi-0001.json",
		]);
		assert.deepEqual(
			checkLedger({ repo: root }).failures,
			[],
			"the gate accepts both rows",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("NEGATIVE: a namespace cannot borrow another namespace's hashes inside one receipt", () => {
	const { root, second } = multiTree();
	try {
		// Every hash on disk appears somewhere in this receipt, but each namespace's
		// block names the OTHER namespace's bytes: nothing was audited at its own.
		const receipt = writeReceipt(
			root,
			"crossed.json",
			multiReceipt({ crossed: true, second }),
		);
		refusal(
			() =>
				run(root, { auditorInstance: "run-multi-0001", receipt, file: FILE }),
			/does not name the (target|English source) bytes on disk/,
		);
		assert.equal(
			existsSync(join(root, "i18n", "ledger.json")),
			false,
			"nothing written",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("resultSupportedBy and supportedStatus never promote beyond the evidence", () => {
	assert.equal(
		resultSupportedBy("changes_requested", {
			blocker: 0,
			major: 0,
			minor: 0,
			nit: 0,
		}),
		"changes_requested",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 1, minor: 0, nit: 0 }),
		"changes_requested",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 0, minor: 0, nit: 1 }),
		"clean-with-findings",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 0, minor: 0, nit: 0 }),
		"clean",
	);
	assert.equal(supportedStatus([], "t", "fr/x"), "pending");
	assert.equal(
		supportedStatus([{ ...GOOD, result: "changes_requested" }], "t", "fr/x"),
		"changes_requested",
	);
	assert.equal(supportedStatus([GOOD], "t", "fr/x"), "audited");
});

test("NEGATIVE: malformed findings cannot disappear or downgrade a severity bucket", () => {
	for (const findings of [
		null,
		"clean",
		0,
		{},
		{ MAJOR: {} },
		{ MAJRO: [] },
		{ MAJOR: [null] },
		{ MAJOR: [{ severity: "NIT" }] },
		[{ severity: "NIT", sev: "MAJOR" }],
	]) {
		withTree((root) => {
			const receipt = writeReceipt(
				root,
				"malformed.json",
				receiptFor({ findings }),
			);
			refusal(() => run(root, { receipt }), /findings|severity|finding/);
			assert.equal(existsSync(join(root, "i18n/ledger.json")), false);
		});
	}
});

test("NEGATIVE: a single namespace block cannot borrow global hashes or hash substrings", () => {
	for (const block of [
		{ status: "passed", findings: [] },
		{
			status: "passed",
			findings: [],
			hashes: [`prefix${sha(FR)}`, `${sha(EN)}suffix`],
		},
	]) {
		withTree((root) => {
			const receipt = writeReceipt(
				root,
				"borrowed.json",
				receiptFor({ extra: { namespaces: { "demo.words": block } } }),
			);
			refusal(() => run(root, { receipt }), /no valid English source hash/);
		});
	}
});

test("NEGATIVE: receipt instances cannot escape their destination directory", () => {
	for (const instance of [
		"../escape",
		"aaaaaa/../../escape",
		"aaaaaa\\escape",
		" abcdef",
		"abcdef ",
	]) {
		withTree((root) => {
			const receipt = writeReceipt(
				root,
				"unsafe.json",
				receiptFor({ instance }),
			);
			refusal(
				() => run(root, { receipt, auditorInstance: instance }),
				/placeholder/,
			);
		});
	}
});

test("NEGATIVE: a missing model cannot be supplied by a command-line assertion", () => {
	withTree((root) => {
		const body = receiptFor();
		body.model = undefined;
		refusal(
			() => run(root, { receipt: writeReceipt(root, "no-model.json", body) }),
			/model/,
		);
	});
});

test("NEGATIVE: an instance collision in another namespace is refused without its receipt copy", () => {
	withTree((root) => {
		run(root);
		const ledger = ledgerOf(root);
		ledger.entries[0].namespace = "other.words";
		writeFileSync(join(root, "i18n/ledger.json"), JSON.stringify(ledger));
		rmSync(join(root, ledger.entries[0].auditors[0].receipt));
		const changed = receiptFor({ extra: { note: "different bytes" } });
		refusal(
			() => run(root, { receipt: writeReceipt(root, "changed.json", changed) }),
			/different receipt/,
		);
	});
});

/* These child processes run the actual writer CLI and read-only gate API, not
 * duplicated semantic checks. Receipt bytes are snapshotted before every probe;
 * the gate must refuse forged claims and the writer must leave the tree intact.
 */
function writerCommand(root, overrides = {}) {
	const options = {
		repo: root,
		locale: "fr",
		file: FILE,
		auditorInstance: "run-aaaaaaaa",
		auditorModel: MODEL,
		result: "clean",
		receipt: join(root, "i18n/receipts/run-aaaaaaaa.json"),
		translatorAgent: "i18n-translator",
		translatorModel: "test/translator",
		...overrides,
	};
	const flags = {
		auditorInstance: "auditor-instance",
		auditorModel: "auditor-model",
		translatorAgent: "translator-agent",
		translatorModel: "translator-model",
	};
	const argv = [new URL("./ledger-assemble.mjs", import.meta.url).pathname];
	for (const [key, value] of Object.entries(options))
		if (value !== undefined) argv.push(`--${flags[key] ?? key}`, value);
	return spawnSync(process.execPath, argv, {
		cwd: root,
		encoding: "utf8",
		env: { HOME: root, TMPDIR: root, PATH: process.env.PATH },
		timeout: 5000,
	});
}
function gateCommand(root) {
	const code = `import {checkLedger} from ${JSON.stringify(new URL("./ledger-check.mjs", import.meta.url).href)}; const out=checkLedger({repo:process.argv[1]});console.log(JSON.stringify(out));process.exit(out.failures.length?1:0);`;
	return spawnSync(
		process.execPath,
		["--input-type=module", "-e", code, root],
		{
			cwd: root,
			encoding: "utf8",
			env: { HOME: root, TMPDIR: root, PATH: process.env.PATH },
			timeout: 5000,
		},
	);
}

const INTEGRITY_CASES = [
	[
		"row-only clean/zero forgery over a real MAJOR receipt",
		(ctx) => {
			ctx.body.status = "changes_requested";
			ctx.body.findings = [{ severity: "MAJOR", key: "demo.words.plain" }];
		},
	],
	[
		"row model mismatch",
		({ row }) => {
			row.auditors[0].model = "forged/model";
		},
	],
	[
		"row instance mismatch",
		({ row }) => {
			row.auditors[0].instance = "forged-instance";
		},
	],
	[
		"row agent mismatch",
		({ row }) => {
			row.auditors[0].agent = "forged-agent";
		},
	],
	[
		"stale English receipt despite updating the row hash",
		({ root, row }) => {
			const bytes = JSON.stringify({
				"demo.words.hello": "New English, {name}!",
				"demo.words.plain": "plain",
			});
			writeFileSync(
				join(root, "src/i18n/catalogues/en/demo.words.json"),
				bytes,
			);
			row.source_sha256 = sha(bytes);
		},
	],
	[
		"stale target receipt despite updating the row hash",
		({ root, row }) => {
			const bytes = JSON.stringify({
				"demo.words.hello": "Nouveau, {name} !",
				"demo.words.plain": "simple",
			});
			writeFileSync(join(root, FILE), bytes);
			row.target_sha256 = sha(bytes);
		},
	],
	[
		"wrong namespace",
		({ body }) => {
			body.namespace = "demo.other";
		},
	],
	[
		"missing namespace",
		({ body }) => {
			body.namespace = undefined;
		},
	],
	[
		"missing namespace block",
		({ body }) => {
			body.namespaces = {};
		},
	],
	[
		"multi-block global hash borrowing",
		({ body }) => {
			body.namespaces = {
				"demo.words": { status: "passed", findings: [] },
				"demo.other": { status: "passed", sha256: body.sha256, findings: [] },
			};
		},
	],
	[
		"cross-borrowed source and target hash roles",
		({ body }) => {
			body.sha256 = { en: sha(FR), fr: sha(EN) };
		},
	],
	[
		"different receipt locale",
		({ body }) => {
			body.locale = "es";
		},
	],
	[
		"missing auditor agent",
		({ body }) => {
			body.auditor = undefined;
		},
	],
	[
		"empty auditor identity",
		({ body }) => {
			body.auditor = {};
		},
	],
	[
		"ambiguous auditor identity",
		({ body }) => {
			body.auditor = { agent: "i18n-auditor", model: "different/model" };
		},
	],
	[
		"ambiguous hash aliases",
		({ body }) => {
			body.fr_sha256 = sha("different");
		},
	],
	[
		"duplicate namespace JSON member",
		(ctx) => {
			ctx.body.namespaces = {
				"demo.words": {
					status: "passed",
					sha256: ctx.body.sha256,
					findings: [],
				},
			};
			ctx.raw = JSON.stringify(ctx.body).replace(
				'"namespaces":{',
				'"namespaces":{"demo.words":{},',
			);
		},
	],
	[
		"duplicate identity JSON member",
		(ctx) => {
			ctx.raw = JSON.stringify(ctx.body).replace(
				'"instance":',
				'"instance":"different-instance","instance":',
			);
		},
	],
	[
		"duplicate hash JSON member",
		(ctx) => {
			ctx.raw = JSON.stringify(ctx.body).replace(
				'"fr":',
				`"fr":"${sha("different")}","fr":`,
			);
		},
	],
];
for (const [label, change] of INTEGRITY_CASES) {
	test(`REAL gate + writer refuse: ${label} (immutable receipt)`, () => {
		withTree((root) => {
			run(root);
			const ledger = ledgerOf(root);
			const row = ledger.entries[0];
			const body = receiptFor();
			const ctx = { root, row, body };
			change(ctx);
			const bytes = ctx.raw ?? JSON.stringify(body);
			const receipt = join(root, "i18n/receipts/run-aaaaaaaa.json");
			writeFileSync(receipt, bytes);
			row.auditors[0].receipt_sha256 = sha(bytes);
			writeFileSync(join(root, "i18n/ledger.json"), JSON.stringify(ledger));
			const before = readFileSync(join(root, "i18n/ledger.json"));
			const gate = gateCommand(root);
			const writer = writerCommand(root);
			assert.equal(gate.status, 1, `${label}: ${gate.stdout} ${gate.stderr}`);
			assert.equal(
				writer.status,
				2,
				`${label}: ${writer.stdout} ${writer.stderr}`,
			);
			assert.deepEqual(readFileSync(receipt), Buffer.from(bytes));
			assert.deepEqual(readFileSync(join(root, "i18n/ledger.json")), before);
			console.log(
				`integrity: ${label}: gate=${gate.status} writer=${writer.status} receipt+ledger=unchanged`,
			);
		});
	});
}

test("REAL writer refuses omitted translator model on a new row", () => {
	withTree((root) => {
		const receipt = writeReceipt(root, "new.json", receiptFor());
		const out = writerCommand(root, { receipt, translatorModel: undefined });
		assert.equal(out.status, 2, out.stderr);
		assert.match(out.stderr, /translator-model/);
		assert.equal(existsSync(join(root, "i18n/ledger.json")), false);
	});
});

test("REAL writer + gate accept two distinct current full/delta provenance records", () => {
	withTree((root) => {
		for (const [instance, scope] of [
			["full-aaaaaaaa", "full audit"],
			["delta-bbbbbbbb", "delta audit against full-aaaaaaaa"],
		]) {
			const body = receiptFor({ instance, extra: { scope } });
			const receipt = writeReceipt(root, `${instance}.json`, body);
			const out = writerCommand(root, {
				receipt,
				auditorInstance: instance,
				scope,
			});
			assert.equal(out.status, 0, out.stderr);
		}
		const out = gateCommand(root);
		assert.equal(out.status, 0, out.stdout + out.stderr);
		assert.deepEqual(
			ledgerOf(root).entries[0].auditors.map((a) => a.scope),
			["full audit", "delta audit against full-aaaaaaaa"],
		);
	});
});

test("REAL self-audit remains pending; omitted agent cannot manufacture independence", () => {
	for (const missing of [false, true]) {
		withTree((root) => {
			const body = receiptFor({
				extra: { auditor: missing ? undefined : { agent: "i18n-translator" } },
			});
			const receipt = writeReceipt(root, "identity.json", body);
			const out = writerCommand(root, { receipt });
			assert.equal(out.status, missing ? 2 : 0, out.stderr);
			if (missing)
				assert.equal(existsSync(join(root, "i18n/ledger.json")), false);
			else {
				assert.equal(ledgerOf(root).entries[0].status, "pending");
				assert.equal(gateCommand(root).status, 1);
			}
		});
	}
});
