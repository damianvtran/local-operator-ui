#!/usr/bin/env node
/**
 * The zone the capture path pins frames to, tested as a contract rather than
 * quoted as a constant.
 *
 * WHY THIS IS A TEST. The acceptance behind the pin is "the same story
 * captured under two host zones produces IDENTICAL frames", and nothing in CI
 * boots either rig, so the properties that make it true are pinned here: the
 * shipped zone is a literal (changing it re-zones every future capture
 * against every committed set), the pin OVERWRITES an ambient `TZ=` instead
 * of deferring to it, and the zone is spelled in exactly one place - this
 * module - with both rigs reading it from here and applying it. A second copy
 * of the literal, or a pin that merged the ambient value through, would each
 * re-introduce the exact defect the pin exists for (frames that move with the
 * machine) without failing anything that boots today.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EVIDENCE_TZ, pinnedEvidenceEnv } from "./evidence-tz.mjs";

/*
 * The files that must read the zone from this module rather than spell it,
 * each with the two wires its own source has to carry: the pin on the RIG's
 * own process (what re-zones the children that inherit its environment) and
 * the pin at the site that hands an environment to the runtime being
 * photographed (Chrome for the sweep, Electron for the driver).
 */
const CONSUMERS = [
	{
		file: "capture-evidence.mjs",
		application: [
			"process.env.TZ = EVIDENCE_TZ;",
			"pinnedEvidenceEnv(process.env)",
		],
	},
	{
		file: "renderer-driver.mjs",
		application: ["process.env.TZ = EVIDENCE_TZ;", "TZ: EVIDENCE_TZ"],
	},
];

test("the shipped zone is the literal the committed generations carry", () => {
	/*
	 * Pinned as a literal on purpose: the value reproduces the committed
	 * time-printing frames (docs/evidence/manifest.json's 2026-10-03 fold
	 * note is the receipt for the current one), so changing it must touch
	 * this file and its reason rather than ride in as a one-word edit.
	 */
	assert.equal(EVIDENCE_TZ, "America/New_York");
});

test("the pin overwrites an ambient zone, in a copy of the env", () => {
	const caller = { PATH: "/usr/bin", TZ: "Asia/Tokyo", KEEP: "1" };
	const pinned = pinnedEvidenceEnv(caller);

	assert.equal(pinned.TZ, EVIDENCE_TZ, "the ambient zone survived the pin");
	assert.equal(pinned.KEEP, "1");
	assert.equal(pinned.PATH, "/usr/bin");
	assert.equal(
		caller.TZ,
		"Asia/Tokyo",
		"the caller's object must not be mutated - a rig that built its env once must not re-zone itself by passing it through the helper",
	);
	// The default argument reads the process environment at CALL time.
	assert.equal(pinnedEvidenceEnv().TZ, EVIDENCE_TZ);
});

test("both capture rigs read the zone from here, apply it, and spell it nowhere else", () => {
	for (const { file, application } of CONSUMERS) {
		const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
		assert.ok(
			source.includes('from "./evidence-tz.mjs"'),
			`${file} does not read the zone from evidence-tz.mjs`,
		);
		assert.ok(
			!source.includes("America/New_York"),
			`${file} spells the zone itself; the literal lives in evidence-tz.mjs only`,
		);
		for (const wire of application) {
			assert.equal(
				source.split(wire).length - 1,
				1,
				`${file} no longer applies the pin exactly once (${wire})`,
			);
		}
	}
});
