#!/usr/bin/env node
/**
 * The structural evidence gate's own falsifiability, on a synthetic checkout.
 *
 * Why every case is a MUTATION of one passing fixture: the gate's job is to
 * refuse, and a test that only runs it over the good tree proves it can print a
 * sentence. Each case starts from `fixture()` - a checkout where
 * `structureFailures` is empty - and breaks exactly one thing, so a case that
 * passes by accident (the failure arriving from a neighbouring assertion) is a
 * red test rather than a green one.
 *
 * The container list is pinned EQUAL to the sweep's, because the two spellings
 * must not drift: a container the sweep judges and this gate does not is a frame
 * that can be committed under a green structure, and the reverse refuses a file
 * the sweep does not treat as a frame.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import {
	EVIDENCE_PATH,
	FRAMES_PATH,
	FRAME_EXTENSIONS,
	PROOF_ARTEFACTS,
	structureFailures,
} from "./check-evidence-structure.mjs";
import { FRAME_CONTAINERS } from "./check-evidence.mjs";

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (dir, args) =>
	execFileSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});

/** One git read over a checkout, in the shape `structureFailures` takes. */
const reader = (dir) => (args) => {
	try {
		return execFileSync("git", ["-C", dir, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
};

const manifest = (overrides = {}) => ({
	head: "0".repeat(40),
	frames: 0,
	surfaces: 1,
	themes: 1,
	supplementary: [
		{
			path: "set-a",
			frames: 0,
			surfaces: 0,
			themes: 0,
			source: "declared at zero frames; no capture has been taken",
			why: "a declared absence is visible to the gate, an undeclared one is not",
			capturedAt: "2026-01-01T00:00:00.000Z",
		},
	],
	...overrides,
});

/**
 * A checkout whose structure holds: a tracked manifest with one zero-frame set
 * (the shipped `submit-latency` shape), the set's README, every named proof
 * artefact, and the runbook.
 */
const fixture = () => {
	const dir = mkdtempSync(join(tmpdir(), "lop-evidence-structure-"));
	scratch.push(dir);
	const write = (path, body = "x") => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), body);
	};
	git(dir, ["init", "--initial-branch=main", "-q"]);
	git(dir, ["config", "user.email", "fixture@example.invalid"]);
	git(dir, ["config", "user.name", "Fixture"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
	write(
		`${EVIDENCE_PATH}/manifest.json`,
		`${JSON.stringify(manifest(), null, 2)}\n`,
	);
	write(`${EVIDENCE_PATH}/set-a/README.md`, "# how these frames are taken\n");
	for (const path of PROOF_ARTEFACTS) write(path, "{}\n");
	write("AGENTS.md", "# fixture\n");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: the tracked evidence structure"]);
	return dir;
};

const failures = (dir) => structureFailures({ root: dir, read: reader(dir) });

test("the container this gate refuses is the one the sweep judges", () => {
	/*
	 * A SET comparison rather than an order one: the order decides nothing, and a
	 * container moved within the list is not a drift the gate's verdict turns on.
	 */
	assert.deepEqual(
		[...FRAME_EXTENSIONS].sort(),
		[...FRAME_CONTAINERS].sort(),
		"the structural gate's frame extensions and `check-evidence.mjs`'s FRAME_CONTAINERS have drifted: a container in one and not the other is a frame that commits under a green gate, or a refusal the sweep does not share",
	);
});

test("the passing fixture passes", () => {
	const dir = fixture();
	assert.deepEqual(failures(dir), []);
});

test("the shipped checkout's structure holds", () => {
	/*
	 * The real tree, at the head under review: this is the assertion CI's
	 * `evidence` job makes, run locally so a developer sees it in the suite too.
	 */
	assert.deepEqual(structureFailures(), []);
});

test("a committed frame is refused, in the tracked tree and in the ignored one", () => {
	const dir = fixture();
	writeFileSync(join(dir, `${EVIDENCE_PATH}/set-a/one.webp`), "x");
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-qm", "chore: a frame lands in the tracked tree"]);
	const tracked = failures(dir);
	assert.equal(tracked.length, 1);
	assert.match(tracked[0], /a frame is COMMITTED/);
	assert.match(tracked[0], /set-a\/one\.webp/);

	const frames = fixture();
	mkdirSync(join(frames, FRAMES_PATH, "set-a"), { recursive: true });
	writeFileSync(join(frames, `${FRAMES_PATH}/set-a/one.png`), "x");
	git(frames, ["add", "-A"]);
	git(frames, ["commit", "-qm", "chore: a force-add into the frames tree"]);
	const ignored = failures(frames);
	assert.equal(ignored.length, 1);
	assert.match(ignored[0], /must stay empty in git/);
});

test("a declared set owes provenance, a sound path and a count", () => {
	const dir = fixture();
	const broken = manifest({
		supplementary: [
			{
				path: "set-a",
				frames: 0,
				source: "the rig",
				capturedAt: "2026-01-01T00:00:00.000Z",
				// no `why`
			},
			{
				path: "../outside",
				frames: 0,
				source: "the rig",
				why: "declared",
				capturedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				path: "set-a",
				frames: -1,
				source: "the rig",
				why: "the same directory a second time",
				capturedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				path: "set-b",
				source: "the rig",
				why: "no count at all",
				capturedAt: "2026-01-01T00:00:00.000Z",
			},
		],
	});
	writeFileSync(
		join(dir, `${EVIDENCE_PATH}/manifest.json`),
		`${JSON.stringify(broken, null, 2)}\n`,
	);
	const out = failures(dir);
	assert.equal(out.length, 6, out.join("\n"));
	assert.match(out[0], /missing why/);
	assert.match(out[1], /is not a repository-relative path/);
	assert.match(out[2], /repeats the path declared at supplementary\[0\]/);
	assert.match(out[3], /`frames` as -1/);
	assert.match(out[4], /declares no non-negative integer/);
	assert.match(out[5], /set-b/);
});

test("a missing or unparsable manifest fails closed", () => {
	const missing = fixture();
	rmSync(join(missing, `${EVIDENCE_PATH}/manifest.json`));
	assert.match(failures(missing)[0], /manifest\.json is missing/);

	const unparsable = fixture();
	writeFileSync(join(unparsable, `${EVIDENCE_PATH}/manifest.json`), "{");
	assert.match(failures(unparsable)[0], /does not parse/);
});

test("a named proof artefact that stopped being tracked is refused", () => {
	const dir = fixture();
	const path = PROOF_ARTEFACTS[0];
	git(dir, ["rm", "--cached", "--quiet", path]);
	git(dir, ["commit", "-qm", "chore: untrack a proof artefact"]);
	const out = failures(dir);
	assert.equal(out.length, 1);
	assert.match(out[0], /the proof artefact is not tracked/);
	assert.match(out[0], new RegExp(path.replace(/[/.]/g, "\\$&")));
	// The file is still on disk, which is why the tracked check (not `existsSync`)
	// is the one that has to fail: an ignored leftover must not pass for evidence.
	assert.ok(existsSync(join(dir, path)));
});

test("a count that is not a number is refused", () => {
	const dir = fixture();
	writeFileSync(
		join(dir, `${EVIDENCE_PATH}/manifest.json`),
		`${JSON.stringify(manifest({ frames: "0" }), null, 2)}\n`,
	);
	const out = failures(dir);
	assert.equal(out.length, 1);
	assert.match(out[0], /`frames` is not a number/);
});

test("the runbook is part of the structure, because it says where the sweep went", () => {
	const dir = fixture();
	rmSync(join(dir, "AGENTS.md"));
	const out = failures(dir);
	assert.equal(out.length, 1);
	assert.match(out[0], /AGENTS\.md: missing/);
});

test("a git read that cannot answer is a failure, not a pass", () => {
	const dir = fixture();
	const out = structureFailures({ root: dir, read: () => null });
	assert.ok(
		out.some((line) => /git could not list docs\/evidence/.test(line)),
		"an unreadable git turned the tracked-frame assertion into a pass",
	);
});
