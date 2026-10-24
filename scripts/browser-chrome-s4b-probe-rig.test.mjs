import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const SOURCE = readFileSync(
	new URL("./browser-chrome-s4b-probe.mjs", import.meta.url),
	"utf8",
);
const HISTORY_CALL = "await historyScene({ shot, framesDir: FRAMES });";
const EXPECTED_ERROR =
	"history scene: H2 search: address row did not take focus";
const H2_SEARCH = /H2 search/;
const PENDING_HISTORY_ROW = /\| (?:H\d+|R2-notices) \|[^\n]*\| pending \|/;
const VISUAL_STATES_ERROR = /visual-states-error/;

test("a forced H2 raise failure exits nonzero without a pending history matrix", () => {
	/*
	 * Execute the probe's REAL visual-states catch, outer catch and matrix writer,
	 * with only the expensive boot/scene prefix replaced by a deterministic throw.
	 * S5's permanent row must report a focus failure at its named step, not fall
	 * through to "no address input" and a pending cascade. A source regex cannot
	 * distinguish an inner rethrow from an outer catch that swallows it, so the
	 * child process is the discriminating exit-and-matrix boundary.
	 */
	assert.ok(SOURCE.includes(HISTORY_CALL));
	const scratch = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "s4b-rig-exit-"),
	);
	try {
		let probe = SOURCE.replace(
			'const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");',
			`const ROOT = ${JSON.stringify(ROOT)};`,
		);
		for (const module of [
			"chrome-keychain.mjs",
			"notifications-off.mjs",
			"telemetry-off.mjs",
		]) {
			probe = probe.replace(
				`from "./${module}"`,
				`from "file://${join(ROOT, "scripts", module)}"`,
			);
		}
		const tailStart = probe.indexOf("let bootHandle = null;");
		const historyAt = probe.indexOf(HISTORY_CALL, tailStart);
		assert.ok(tailStart >= 0 && historyAt > tailStart);
		const stub = `let bootHandle = null;
try {
	const FRAMES = join(OUT, "frames");
	mkdirSync(FRAMES, { recursive: true });
	const identity = {};
	const rest = null;
	const restPage = null;
	const restBand = { bandPx: 0, stripBottom: 69, pageTop: 69, stripHeight: 37, intruders: [], dockPresentAtRest: false };
	const open = null;
	const openPage = null;
	const after = null;
	const afterPage = null;
	const childViewport = null;
	const states = {};
	const cdp = { close() {} };
	const pageCdp = { close() {} };
	try {
		throw new HistorySceneRigError(${JSON.stringify(EXPECTED_ERROR)});
`;
		probe = `${probe.slice(0, tailStart)}${stub}${probe.slice(historyAt + HISTORY_CALL.length)}`;
		const probePath = join(scratch, "probe.mjs");
		const out = join(scratch, "out");
		mkdirSync(out, { recursive: true });
		writeFileSync(probePath, probe);
		const result = spawnSync(process.execPath, [probePath, "--out", out], {
			cwd: ROOT,
			encoding: "utf8",
			timeout: 30_000,
		});
		assert.equal(result.error, undefined);
		assert.equal(
			result.status,
			1,
			`expected fatal exit 1; stdout=${result.stdout}\nstderr=${result.stderr}`,
		);
		const matrixPath = join(out, "matrix.md");
		assert.ok(
			existsSync(matrixPath),
			`matrix missing; stdout=${result.stdout}\nstderr=${result.stderr}`,
		);
		const matrix = readFileSync(matrixPath, "utf8");
		assert.match(`${result.stdout}${result.stderr}${matrix}`, H2_SEARCH);
		assert.doesNotMatch(
			matrix,
			PENDING_HISTORY_ROW,
			"no unexecuted history/notice row may leak into a normal pending matrix",
		);
		assert.doesNotMatch(matrix, VISUAL_STATES_ERROR);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
