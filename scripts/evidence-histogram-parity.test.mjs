import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { frameHistogram } from "./check-evidence.mjs";
import {
	ALPHA_PROBE,
	compareFrame,
	frames,
	writeAlphaFrame,
} from "./evidence-histogram-parity.mjs";

/*
 * WHY THESE CASES EXIST, AND WHY THEY DO NOT ALL NEED IMAGEMAGICK.
 *
 * `scripts/evidence-histogram-parity.mjs` was written as the evidence for the
 * in-process decoder swap and wired to nothing, so nothing could refuse a
 * decoder drift - and review round 1 proved the cost of that: every committed
 * frame here is three-channel (0 of 9763 carry an `ALPH` chunk), the
 * four-channel branch had no sample that could reach it, and it was recovering
 * its key with a signed shift that printed `#-373738` for the mode. So the
 * always-on part of this file is the SHIPPED reader's own arithmetic on a frame
 * this test writes - no ImageMagick, no committed frame, runs on CI - and the
 * comparison against the replaced reader is the part that needs the control
 * installed (nothing in `.github/workflows/` installs it, which is why the rig
 * is a local instrument).
 *
 * The committed-frame case is here too because the reader's real input is a real
 * capture: a decode that returned nothing, or a coverage outside (0, 1], would
 * be caught by the guard's own verdict but is cheaper to read here.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const scratch = (t) => {
	const dir = mkdtempSync(join(tmpdir(), "histogram-parity-test-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
};

const available = spawnSync("magick", ["-version"]).status === 0;

test("the four-channel probe reads as its own mode, as a colour", async (t) => {
	const dir = scratch(t);
	const file = await writeAlphaFrame(dir);
	const mode = await frameHistogram(file);
	/*
	 * The three numbers the verdict is computed from, and the colour's SHAPE.
	 * The shape is the point: `#-373738` satisfied "a string" and was measured by
	 * `groundDistance` as a colour, so a mode that is not `#` followed by six
	 * hex digits has to fail here rather than downstream.
	 */
	assert.match(mode.hex, /^#[0-9A-F]{6}$/, `mode is not a colour: ${mode.hex}`);
	assert.equal(mode.hex, ALPHA_PROBE.hex);
	assert.equal(mode.count, ALPHA_PROBE.count);
	assert.equal(mode.total, ALPHA_PROBE.total);
});

test("a four-channel frame's RGB is not folded into its alpha", async (t) => {
	const dir = scratch(t);
	const file = await writeAlphaFrame(dir);
	/*
	 * The probe's two most common RGB values differ only in alpha. If the key
	 * dropped the alpha byte the two would merge into one 89-pixel mode; if it
	 * dropped the RGB the mode would be a shade of alpha. Both are wrong, and both
	 * are what a key that is not `rgb * 256 + alpha` produces.
	 */
	const { info } = await sharp(file)
		.raw()
		.toBuffer({ resolveWithObject: true });
	assert.equal(info.channels, 4);
	const mode = await frameHistogram(file);
	assert.equal(mode.count, 85);
	assert.notEqual(mode.count, 89);
});

test("the reader agrees with the replaced one where the control exists", async (t) => {
	if (!available) {
		/*
		 * BLOCKED, not passed: the claim is about agreement with a reader this
		 * host does not have. Printed rather than silently skipped so a reader of
		 * the log knows which half ran.
		 */
		t.skip(
			"magick is not installed, so the replaced reader cannot be run here",
		);
		return;
	}
	const dir = scratch(t);
	const file = await writeAlphaFrame(dir);
	const result = await compareFrame(file);
	assert.equal(result.fresh.hex, ALPHA_PROBE.hex, result.name);
	assert.ok(
		result.agree,
		`readers disagree on the probe: magick ${result.magick.hex} ${result.magick.count}/${result.magick.total} vs in-process ${result.fresh.hex} ${result.fresh.count}/${result.fresh.total}`,
	);
});

test("the rig itself runs, and reports its sample", async (t) => {
	if (!available) {
		t.skip("magick is not installed; the rig's comparison needs it");
		return;
	}
	/*
	 * The wiring check: the rig is a script an agent is expected to run, and the
	 * failure mode this catches is a rig that cannot start at all (a broken
	 * import, a moved flag) - which is invisible while nothing invokes it.
	 */
	const run = spawnSync(
		process.execPath,
		[join(ROOT, "scripts/evidence-histogram-parity.mjs"), "--frames", "1"],
		{ encoding: "utf8", timeout: 240000 },
	);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /plus 1 written 4-channel probe/);
	assert.match(run.stdout, /identical readings on 2\/2 frames/);
});

test("a committed frame decodes to a mode its theme could show", async (t) => {
	const [first] = frames(join(ROOT, "docs/evidence")).sort();
	assert.ok(first, "no committed frames found");
	const mode = await frameHistogram(first);
	assert.match(mode.hex, /^#[0-9A-F]{6}$/);
	assert.ok(mode.count > 0, `${first}: mode count ${mode.count}`);
	assert.ok(
		mode.coverage > 0 && mode.coverage <= 1,
		`${first}: coverage ${mode.coverage}`,
	);
	assert.ok(
		mode.total > mode.count,
		`${first}: a mode covering every pixel is the "uniform frame" failure, not a healthy read`,
	);
});
