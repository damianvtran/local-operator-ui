import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import {
	blankComments,
	MOCK_KEYCHAIN_SWITCH,
	withMockKeychain,
} from "./chrome-keychain.mjs";

/**
 * Every headless Chrome this repo launches gets the mock-keychain switch.
 *
 * Why a table the test walks rather than a case per rig. The switch is applied
 * by hand at each launch site, and a rig added next month - or a second
 * `spawn(CHROME, …)` inside one of today's - is silently unguarded, which is
 * how the alert this change exists for reached the operator's screen in the
 * first place. The failure this file prevents is a person reading
 * `chrome-keychain.mjs` and `AGENTS.md` while one rig does not route its argv
 * through the helper.
 *
 * The shape follows this repo's own precedents: `notification-spawn-sites.
 * test.mjs` scans for the calls that start Electron and requires each to be
 * named in its table, and `python-bytecode-cache.test.mjs` does the same for
 * child-process sites. Like those, it is a TEXT scan, so what it can see is
 * bounded and the bound is worth stating plainly rather than implying (round 1,
 * R1-2): it sees `.mjs`/`.js`/`.cjs` files under the roots below, a command
 * token that says `chrome`, and a call spelled `spawn(`, `exec(`,
 * `execFile(`, `spawnSync(`, `execSync(`, `execFileSync(` (a namespace prefix,
 * `cp.spawn(`, included). A rig that is a `.ts` file, that lives outside those
 * three roots, or that starts the browser through a name that does not say
 * `chrome` is NOT caught here - which is why AGENTS.md names the same bound
 * instead of promising that any new rig is caught.
 */
const SPAWN_NAMES = [
	"spawn",
	"spawnSync",
	"exec",
	"execSync",
	"execFile",
	"execFileSync",
];

/**
 * The comment blanker the scan below runs on. It lives in `./chrome-keychain.mjs`
 * rather than here because it must be exported to be tested and it is the piece
 * of this scan that has been wrong twice (rounds 1 and 2); the tests at the
 * bottom of this file pin it, which is what round 3 asked for (R3-1).
 */

/** Splits an argument list on its top-level commas. */
function splitArguments(text) {
	const parts = [];
	let depth = 0;
	let quote = null;
	let current = "";
	for (const ch of text) {
		if (quote) {
			current += ch;
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			current += ch;
			continue;
		}
		if ("([{".includes(ch)) depth += 1;
		if (")]}".includes(ch)) depth -= 1;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}

/**
 * The directories whose `.mjs`/`.js`/`.cjs` files are scanned, and how deeply.
 *
 * The three `docs/evidence/<surface>/harness/` rigs are scanned recursively, to
 * any depth under `harness/`, because their docstrings say they drive Chrome
 * "exactly the way `scripts/capture-evidence.mjs` does - same private
 * `--headless=new` profile under the system temp dir, same DevTools websocket",
 * and a rig that is runnable reproduces whatever it is missing however old the
 * frames beside it are. They are not in `scripts/`, which is why the walk is
 * recursive rather than the flat readdir the sibling notification scan uses.
 * The depth bound used to be exactly one level (round 1, R1-2).
 */
const SCAN_ROOTS = [
	{ dir: "scripts", recursive: false },
	{ dir: "bin", recursive: false },
	{ dir: "docs/evidence", recursive: true, harnessOnly: true },
];

function scanFiles() {
	const files = [];
	for (const root of SCAN_ROOTS) {
		if (!existsSync(root.dir)) continue;
		for (const name of readdirSync(root.dir, { recursive: true })) {
			const rel = join(root.dir, String(name)).split(sep).join("/");
			if (!/\.(mjs|js|cjs)$/.test(rel)) continue;
			if (!existsSync(rel) || !statSync(rel).isFile()) continue;
			// A flat root is flat: a nested path comes back with a separator in it,
			// and only `scripts/`'s own files are rigs.
			if (!root.recursive && name.includes(sep)) continue;
			// Any depth under `harness/` inside a per-surface evidence directory: the
			// frames' own rigs, not the surface's other notes and stubs.
			if (
				root.harnessOnly &&
				!/^docs\/evidence\/[^/]+\/harness\//.test(rel)
			) {
				continue;
			}
			files.push(rel);
		}
	}
	return files;
}

/**
 * Every spawn-ish call site in the scanned trees, with the balanced text of its
 * argument list, classified by what it starts.
 *
 * A site is a CHROME site when the command it starts is the browser, however
 * the file names it: `CHROME` is the spelling every rig uses today, and a
 * literal `…/Google Chrome` path is the other. An Electron site is never one of
 * these - the app is spawned by name in the rigs that boot it, and the browser
 * those rigs drive is a `BrowserView` rather than an external Chrome.
 */
function findSpawnSites() {
	const sites = [];
	for (const file of scanFiles()) {
		const raw = readFileSync(file, "utf8");
		const source = blankComments(raw);
		const found = [];
		for (const name of SPAWN_NAMES) {
			/*
			 * A namespace prefix is allowed - `cp.spawn(CHROME, …)` is the same site as
			 * `spawn(CHROME, …)` (round 1, R1-2). It also matches `someRegExp.exec(`,
			 * which is not a child process at all; that costs nothing here, because a
			 * site only matters when the command it starts says `chrome`.
			 */
			for (const match of source.matchAll(
				new RegExp(`(?<![\\w.])(?:[A-Za-z_$][\\w$]*\\.)?${name}\\s*\\(`, "g"),
			)) {
				found.push({ name, at: match.index });
			}
		}
		found.sort((a, b) => a.at - b.at);
		const seen = {};
		for (const site of found) {
			seen[site.name] = (seen[site.name] ?? 0) + 1;
			let depth = 0;
			let end = source.indexOf("(", site.at);
			for (; end < source.length; end += 1) {
				if (source[end] === "(") depth += 1;
				else if (source[end] === ")" && (depth -= 1) === 0) break;
			}
			const text = raw.slice(source.indexOf("(", site.at) + 1, end);
			const [command = ""] = splitArguments(text);
			sites.push({
				file,
				line: raw.slice(0, site.at).split("\n").length,
				name: site.name,
				index: seen[site.name],
				text,
				command: command.trim(),
				chrome: /\bchrome\b/i.test(command),
			});
		}
	}
	return sites;
}

/**
 * The reason each rig launches Chrome, so the table records WHAT is being
 * photographed rather than only that a line was added.
 *
 * `args` is asserted against the spawn's own argument text, which is the half a
 * per-file grep cannot show: the point is that the argv handed to THIS launch
 * came through `withMockKeychain`, not that the file mentions the helper
 * somewhere. The import is resolved against the file's own directory, because
 * three of the twelve rigs live under `docs/evidence/<surface>/harness/` and
 * reach the helper by a relative path of their own - a typo in one of those
 * would otherwise be found by nobody until the rig ran.
 */
function guarded(file, name, index, why) {
	return {
		file,
		name,
		index,
		why,
		args: /withMockKeychain\(/,
	};
}

const CHROME_LAUNCH_SITES = [
	guarded(
		"scripts/capture-evidence.mjs",
		"spawn",
		1,
		"the Storybook sweep across all twelve themes, which is the rig behind the committed frames",
	),
	guarded(
		"scripts/chat-alignment-geometry.mjs",
		"spawn",
		1,
		"measures the transcript's horizontal geometry from the live DOM",
	),
	guarded(
		"scripts/click-proof.mjs",
		"spawn",
		1,
		"clicks a pending `ask` gate's option to prove it is a real control",
	),
	guarded(
		"scripts/composer-alert-geometry.mjs",
		"spawn",
		2,
		"measures the composer's alert region at a narrow width; its first spawn is the vite server that serves the page",
	),
	guarded(
		"scripts/diff-body-evidence.mjs",
		"spawn",
		1,
		"photographs a diff body taken from a real durable transcript",
	),
	guarded(
		"scripts/draft-pick-evidence.mjs",
		"spawn",
		1,
		"a historical, unvalidated capture driver - still runnable, so its browser is still the operator's",
	),
	guarded(
		"scripts/scroll-paging-evidence.mjs",
		"spawn",
		1,
		"photographs scroll-driven history paging in the real renderer",
	),
	guarded(
		"scripts/session-switch-latency.mjs",
		"spawn",
		1,
		"measures a session switch phase by phase",
	),
	guarded(
		"scripts/slash-enter-proof.mjs",
		"spawn",
		1,
		"plays the composer's slash-popup gestures with real key events and presses, and records what the composer dispatched",
	),
	guarded(
		"scripts/usage-real-evidence.mjs",
		"spawn",
		1,
		"captures the shipped /usage view against real provider data",
	),
	guarded(
		"docs/evidence/desktop-413/harness/capture-413.mjs",
		"spawn",
		1,
		"photographs the oversize-message frames from the real chat surface",
	),
	guarded(
		"docs/evidence/desktop-413/harness/capture-q7.mjs",
		"spawn",
		1,
		"drives the Q-7 slash-command trap through the real composer",
	),
	guarded(
		"docs/evidence/session-load-recovery/harness/capture.mjs",
		"spawn",
		1,
		"photographs the chat surface while its session stream is refused",
	),
];

const key = (row) => `${row.file}#${row.name}#${row.index}`;

/** The helper every rig must import, and the one spelling of its specifier. */
const HELPER = resolve("scripts/chrome-keychain.mjs");
const IMPORT = /import \{ withMockKeychain \} from "([^"]+)";/;

test("every Chrome launch site in scripts/, bin/ and the evidence harnesses is named, and it routes its argv through the helper", () => {
	const sites = findSpawnSites();
	const chrome = sites.filter((site) => site.chrome);
	const rows = new Map(CHROME_LAUNCH_SITES.map((row) => [key(row), row]));

	const unlisted = chrome.filter((site) => !rows.has(key(site)));
	assert.deepEqual(
		unlisted.map(
			(site) =>
				`${site.file}:${site.line} ${site.name} #${site.index}: ${site.command.slice(0, 60)}`,
		),
		[],
		"these start Chrome and are not named in CHROME_LAUNCH_SITES. A new rig fails here on purpose: its browser is the thing that reaches the operator's keychain",
	);

	const stale = CHROME_LAUNCH_SITES.filter(
		(row) => !chrome.some((site) => key(site) === key(row)),
	);
	assert.deepEqual(
		stale.map(key),
		[],
		"CHROME_LAUNCH_SITES names a Chrome launch that is no longer there; remove the row with the call, so the table stays a description of the tree",
	);

	for (const site of chrome) {
		const row = rows.get(key(site));
		const where = `${site.file}:${site.line} ${site.name} #${site.index}`;
		assert.match(
			site.text,
			row.args,
			`${where} must pass its argv through withMockKeychain (${row.why})`,
		);
		const source = readFileSync(join(process.cwd(), site.file), "utf8");
		const specifier = source.match(IMPORT);
		assert.ok(specifier, `${where} must import withMockKeychain (${row.why})`);
		assert.equal(
			resolve(dirname(site.file), specifier[1]),
			HELPER,
			`${where} imports ${specifier[1]}, which does not resolve to scripts/chrome-keychain.mjs (${row.why})`,
		);
	}

	// The scan's own reach, pinned the way `window-mode.test.mjs` pins its
	// recursion: a scan that silently matched nothing would pass every assertion
	// above while guarding nothing at all.
	assert.ok(
		chrome.length >= 12,
		`the scan found ${chrome.length} Chrome launch sites; the repo has at least the nine capture/geometry rigs and the three evidence harnesses`,
	);
	assert.equal(
		chrome.length,
		CHROME_LAUNCH_SITES.length,
		"every Chrome launch site is a named row",
	);
});

test("the switch is spelled in exactly one module", () => {
	/*
	 * A rig that typed the flag by hand would drift the day the switch it needs
	 * is something else, and the point of the helper is that one spelling has
	 * one meaning. The module that defines it is the only file allowed to carry
	 * it; this file names the exported constant instead.
	 */
	const carriers = scanFiles().filter((file) =>
		readFileSync(file, "utf8").includes(MOCK_KEYCHAIN_SWITCH),
	);
	assert.deepEqual(
		carriers,
		["scripts/chrome-keychain.mjs"],
		"the mock-keychain switch must be spelled only in scripts/chrome-keychain.mjs; take it from MOCK_KEYCHAIN_SWITCH instead",
	);
});

test("withMockKeychain appends the switch once and returns the same array", () => {
	const args = ["--headless=new", "--no-sandbox"];
	const same = withMockKeychain(args);
	assert.equal(
		same,
		args,
		"call sites wrap their literal inline, so the array is the one handed back",
	);
	assert.deepEqual(args, [
		"--headless=new",
		"--no-sandbox",
		MOCK_KEYCHAIN_SWITCH,
	]);

	withMockKeychain(args);
	assert.deepEqual(
		args,
		["--headless=new", "--no-sandbox", MOCK_KEYCHAIN_SWITCH],
		"a rig that names the switch itself must not get it twice",
	);
});

/*
 * The fixture text for the blanker tests is ASSEMBLED rather than written
 * literally, because the scan in this file reads this file too: a string holding
 * `spawn(CHROME, […])` is a chrome site to that scan, and a fixture is not a
 * launch. The scan found these four lines as unlisted sites the first time they
 * were written out in full, which is the scan working as intended.
 */
const SPWAN_CALL = `spawn${"(CHROME, [])"}`;
const SPWAN_CALL_WITH_ARGV = `spawn${'(CHROME, ["--headless=new"])'};`;

test("the comment blanker preserves offsets, and does not mistake code for comments", () => {
	/*
	 * Round 3, R3-1: the round-2 fix had no fixture - reverting the escape guard
	 * still produced an identical scan result and the suite stayed green - so the
	 * blanker is exported and pinned here directly. Offsets come first: the site
	 * finder slices the raw text by index, so a blanker that changed the length
	 * would silently mis-report every line after the change.
	 */
	const code = `${SPWAN_CALL_WITH_ARGV};`;
	const source = [
		'const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";',
		"const t = `a\\`b`;",
		`// this comment mentions ${SPWAN_CALL} and must not be a site`,
		code,
		"",
	].join("\n");
	const blanked = blankComments(source);

	assert.equal(blanked.length, source.length, "every offset must still index the raw text");
	assert.equal(
		blanked.split("\n").length,
		source.split("\n").length,
		"newlines survive, so line numbers do too",
	);
	assert.equal(blanked.split("\n")[2].trim(), "", "the comment is blanked");
	assert.equal(blanked.split("\n")[3], code, "code below it is untouched");
});

test("a call inside a template is seen, and one inside a comment is not", () => {
	assert.match(
		blankComments(`const x = \`\${${SPWAN_CALL}}\`;`),
		/spawn\(CHROME/,
		"template content is copied through, so a call inside an interpolation still counts as a site",
	);
	assert.doesNotMatch(
		blankComments(`// ${SPWAN_CALL}`),
		/spawn\(CHROME/,
		"a call named only in a comment is not a site",
	);
});
