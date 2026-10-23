/**
 * ENFORCEMENT: no route computes its own titlebar inset.
 *
 * The seam the operator reported three times was always one mechanism wearing a
 * new name: something outside the shell added a top inset for the 32px lane.
 * The first fixes moved the number between the lane row and a route's own
 * padding; the third fix made the lane a transparent overlay and put the ONLY
 * inset in a shared utility (`panel-top-pad`), with `--panel-top-pad` published
 * by the shell. This file is what keeps a fourth spelling from arriving:
 *
 *   - `chat-layout.tsx` may declare `--panel-top-pad` from `--chrome-strip-h`;
 *   - `styles/index.css` may define the two utilities;
 *   - no other file may spell `pt-[var(--chrome-strip-h)]`,
 *     `pt-[var(--panel-top-pad…)]`, a literal `pt-[32px]`, or a matching
 *     `paddingTop`/`padding-top` declaration.
 *
 * THE ALLOWLIST IS BY FILE, NOT BY CALL SITE. A route that reaches the inset
 * through a new Tailwind utility, an inline style or a CSS variable of its own
 * still fails here; a panel that needs the pad wears the shared class. Stories
 * are NOT exempt from the clamp - they may simulate `--chrome-strip-h: 32px`
 * on the frame (that is the instrument), but a story that pads a panel by hand
 * would let a broken story certify the product.
 *
 * Named after the rule it enforces, so a later reader meets the contract in the
 * test list before meeting the code that depends on it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const SOURCE_ROOT = join(ROOT, "src");
const SHELL = "src/renderer/src/shared/components/common/chat-layout.tsx";
const STYLES = "src/renderer/src/styles/index.css";

const readSource = (path) => readFileSync(join(ROOT, path), "utf8");

const sourceFiles = () =>
	readdirSync(SOURCE_ROOT, { recursive: true })
		.filter(
			(name) =>
				name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css"),
		)
		.map((name) => relative(ROOT, join(SOURCE_ROOT, name)));

/**
 * The two spellings that ARE the contract. Everything else that names the
 * strip's height as a top inset is the defect under a new name.
 */
const FORBIDDEN = [
	{
		pattern: /pt-\[var\(--chrome-strip-h\)\]/,
		rule: "`pt-[var(--chrome-strip-h)]` - the lane is the shell's, so a route must wear `panel-top-pad`",
	},
	{
		pattern: /pt-\[var\(--panel-top-pad/,
		rule: "`pt-[var(--panel-top-pad…)]` - the shared `panel-top-pad` utility IS that declaration",
	},
	{
		pattern: /paddingTop:\s*[^,}\n]*(?:chrome-strip-h|panel-top-pad)/,
		rule: "an inline `paddingTop` reading the strip - panels pad through the shared utility, never an inline style",
	},
	{
		pattern: /padding-top:\s*[^;\n]*(?:chrome-strip-h|panel-top-pad)/,
		rule: "a raw `padding-top` reading the strip - only the stylesheet's utility may declare it",
	},
	{
		pattern: /pt-\[32px\]|paddingTop:\s*32\b/,
		rule: "the strip's literal 32px as a route inset - the number is `--chrome-strip-h`, and the utility is what reads it",
	},
	{
		pattern:
			/mt-\[var\(--panel-top-pad|marginTop:\s*[^,}\n]*(?:chrome-strip-h|panel-top-pad)/,
		rule: "a raw margin/`mt-` reading the panel pad - `panel-scroll` is the one scroll-region variant",
	},
];
const ALLOWED_FILES = new Set([SHELL, STYLES]);

test("no route computes its own titlebar inset", () => {
	const offenders = [];
	for (const path of sourceFiles()) {
		if (ALLOWED_FILES.has(path)) continue;
		const source = readSource(path);
		for (const { pattern, rule } of FORBIDDEN) {
			if (pattern.test(source)) offenders.push(`${path}: ${rule}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`a route or panel spells its own top inset instead of using the shared panel contract:\n${offenders.join("\n")}`,
	);
});

test("the shared contract is present exactly where it is allowed", () => {
	const shell = readSource(SHELL);
	assert.match(
		shell,
		/"--panel-top-pad": "var\(--chrome-strip-h\)"/,
		"the shell must publish the strip's height to the route content; without it `panel-top-pad` resolves to 0 and every panel's first row sits under the traffic lights",
	);
	const styles = readSource(STYLES);
	assert.match(
		styles,
		/@utility panel-top-pad \{/,
		"the one pad utility must exist in the stylesheet",
	);
	assert.match(
		styles,
		/@utility panel-flush \{/,
		"the one flush-root utility must exist in the stylesheet",
	);
});

test("the retired pad marker cannot return", () => {
	for (const path of sourceFiles()) {
		assert.doesNotMatch(
			readSource(path),
			/data-chrome-pad-top/,
			`${path} uses the retired per-route pad marker: its replacement is the shared panel utility, and the attribute was the flushTop era's second spelling`,
		);
	}
});
