import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"CustomEvent",
	"MutationObserver",
	"localStorage",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
	unobserve() {}
};
// Fail on React's real loop diagnostic instead of letting an unbounded update
// chain exhaust the test process. This guard is not a substitute for a settled row.
const realError = console.error;
console.error = (...args) => {
	if (String(args[0]).includes("Maximum update depth"))
		throw new Error("canonical profile row entered a render loop");
	realError(...args);
};
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const bundled = await build({
	stdin: {
		contents: `
export {ProfileToolRowUnderTest} from './src/renderer/src/features/chat/canonical/canonical-transcript';
export {applyEvent,EMPTY_TRANSCRIPT} from './src/renderer/src/features/chat/canonical/transcript-reducer';
export {profileRevertStatusCache} from './src/renderer/src/features/chat/canonical/profile-revert-status';
export {profileRevertLatch} from './src/renderer/src/features/chat/canonical/profile-revert-latch';
export * from './src/renderer/src/features/mesh/profile-action-golden';
`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	plugins: [
		{
			name: "expose-real-canonical-row-without-changing-production-export",
			setup(build) {
				build.onLoad({ filter: /canonical-transcript\.tsx$/ }, (args) => ({
					contents: `${readFileSync(args.path, "utf8")}\nexport {ToolRow as ProfileToolRowUnderTest};`,
					loader: "tsx",
				}));
			},
		},
	],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const api = module.exports;

/*
 * Operator 2026-11-09: agent/team/skill creation must use the ordinary tool
 * trace, not an inline profile consent card. The legacy Mesh card's pure
 * authority tests remain in profile-save-consent.test.mjs; these mounted rows
 * now guard the actual transcript path, including a proposed receipt.
 */
for (const toolName of ["agent", "team", "skill"]) {
	for (const status of ["applied", "proposed"]) {
		test(`${toolName} ${status} renders as an ordinary expandable trace, never a consent card`, async () => {
			const calls = [];
			window.api = {
				desktop: {
					request: async (request) => {
						calls.push(request);
						return { status: 200, body: { result: {} } };
					},
				},
			};
			const record = api
				.applyEvent(api.EMPTY_TRANSCRIPT, {
					type: "tool_execution_end",
					tool_name: toolName,
					tool_call_id: `synthetic-${toolName}`,
					result: {
						content: [
							{
								type: "text",
								text:
									status === "applied"
										? "Created marketing."
										: "Proposed marketing; review in Agents.",
							},
						],
						details: {
							status,
							profile_kind: toolName === "team" ? "team" : "agent",
							profile_name: "marketing",
							scope: "global",
							proposal_id: "pp_0123456789abcdef",
							fields: ["instructions"],
							diff: ["+Plan campaigns."],
						},
						is_error: false,
					},
				})
				.records.find((row) => row.kind === "tool");
			const host = document.createElement("div");
			document.body.appendChild(host);
			const root = createRoot(host);
			try {
				await act(async () =>
					root.render(
						h(api.ProfileToolRowUnderTest, {
							record,
							isSmallView: false,
							scope: { sessionId: "synthetic", childId: null },
						}),
					),
				);
				assert.equal(
					host.querySelector('[data-tour-tag="profile-consent-revert"]'),
					null,
				);
				assert.equal(
					host.querySelector('[data-tour-tag="profile-consent-card"]'),
					null,
				);
				assert.doesNotMatch(
					host.textContent,
					/Team profile|Agent profile|Proposal — not saved yet/,
				);
				assert.ok(
					host.querySelector("button"),
					"ordinary trace has its expandable control",
				);
				assert.equal(
					calls.filter(
						(r) =>
							r.op === "sessions.profileActionStatus" ||
							r.op === "sessions.answer",
					).length,
					0,
				);
			} finally {
				await act(async () => root.unmount());
				host.remove();
			}
		});
	}
}
