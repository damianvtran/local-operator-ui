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

test("mounted canonical row shows completed revert without offering another write (Q9-A)", async () => {
	api.profileRevertStatusCache.clear();
	const saved = api.GOLDEN_SAVED_AGENT_TOOL_RESULT;
	let state = "available";
	const calls = [];
	window.api = {
		desktop: {
			request: async (request) => {
				calls.push(request);
				if (request.op === "sessions.answer") state = "succeeded";
				return {
					status: 200,
					body: {
						result: {
							op: "ack",
							req: 1,
							detail: {
								action_id: saved.details.profile_action.action_id,
								state,
							},
						},
					},
				};
			},
		},
	};
	const transcript = api.applyEvent(api.EMPTY_TRANSCRIPT, {
		type: "tool_execution_end",
		tool_name: saved.tool_name,
		tool_call_id: saved.tool_call_id,
		result: saved,
	});
	const record = transcript.records.find((row) => row.kind === "tool");
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	try {
		await act(async () => {
			root.render(
				h(api.ProfileToolRowUnderTest, {
					record,
					isSmallView: false,
					scope: { sessionId: "test-session", childId: null },
					approvalEpoch: "test-epoch",
				}),
			);
		});
		const button = host.querySelector(
			'[data-tour-tag="profile-consent-revert"]',
		);
		assert.ok(button);
		assert.equal(button.disabled, false);
		await act(async () => {
			button.click();
			button.click();
		});
		assert.equal(calls.filter((r) => r.op === "sessions.answer").length, 1);
		assert.equal(
			host.querySelector("[data-profile-revert]")?.dataset.profileRevert,
			"saved",
		);
		assert.equal(
			host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
			true,
		);
		assert.match(host.textContent, /Reverted/);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

for (const [liveState, renderedState] of [
	["succeeded", "saved"],
	["stale", "stale"],
	["failed", "failed"],
	["pending", "pending"],
	["unavailable", "unavailable"],
]) {
	test(`mounted canonical row displays fresh bound ${liveState} without write permission`, async () => {
		api.profileRevertStatusCache.clear();
		const saved = api.GOLDEN_SAVED_AGENT_TOOL_RESULT;
		let reads = 0;
		window.api = {
			desktop: {
				request: async (request) => {
					assert.equal(request.op, "sessions.profileActionStatus");
					reads += 1;
					return {
						status: 200,
						body: {
							result: {
								op: "ack",
								req: 1,
								detail: {
									action_id: saved.details.profile_action.action_id,
									state: liveState,
								},
							},
						},
					};
				},
			},
		};
		const record = api
			.applyEvent(api.EMPTY_TRANSCRIPT, {
				type: "tool_execution_end",
				tool_name: saved.tool_name,
				tool_call_id: saved.tool_call_id,
				result: saved,
			})
			.records.find((row) => row.kind === "tool");
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		try {
			await act(async () => {
				root.render(
					h(api.ProfileToolRowUnderTest, {
						record,
						isSmallView: false,
						scope: { sessionId: "test-session", childId: null },
						approvalEpoch: "test-epoch",
					}),
				);
			});
			assert.equal(reads, 1, "one stable read, no object-identity render loop");
			assert.equal(
				host.querySelector("[data-profile-revert]")?.dataset.profileRevert,
				renderedState,
			);
			assert.equal(
				host.querySelector('[data-tour-tag="profile-consent-revert"]')
					?.disabled,
				true,
			);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
}

test("mounted unknown activation stays unconfirmed, disabled, and does not retry", async () => {
	api.profileRevertStatusCache.clear();
	const saved = api.GOLDEN_SAVED_TEAM_TOOL_RESULT;
	let writes = 0;
	window.api = {
		desktop: {
			request: async (request) => {
				if (request.op === "sessions.answer") {
					writes += 1;
					throw new Error("dropped activation");
				}
				return {
					status: 200,
					body: {
						result: {
							op: "ack",
							req: 1,
							detail: {
								action_id: saved.details.profile_action.action_id,
								state: writes ? "unavailable" : "available",
							},
						},
					},
				};
			},
		},
	};
	const record = api
		.applyEvent(api.EMPTY_TRANSCRIPT, {
			type: "tool_execution_end",
			tool_name: saved.tool_name,
			tool_call_id: saved.tool_call_id,
			result: saved,
		})
		.records.find((r) => r.kind === "tool");
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	try {
		await act(async () => {
			root.render(
				h(api.ProfileToolRowUnderTest, {
					record,
					isSmallView: false,
					scope: { sessionId: "test-session", childId: null },
					approvalEpoch: "test-epoch",
				}),
			);
		});
		await act(async () =>
			host.querySelector('[data-tour-tag="profile-consent-revert"]').click(),
		);
		assert.equal(
			host.querySelector("[data-profile-revert]")?.dataset.profileRevert,
			"unconfirmed",
		);
		assert.equal(
			host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
			true,
		);
		assert.match(host.textContent, /may not have gone through/);
		assert.equal(writes, 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});

for (const invalid of ["foreign-action", "missing-epoch"]) {
	test(`mounted ${invalid} cannot borrow an available status`, async () => {
		api.profileRevertStatusCache.clear();
		const saved = api.GOLDEN_SAVED_AGENT_TOOL_RESULT;
		let writes = 0;
		window.api = {
			desktop: {
				request: async (request) => {
					if (request.op === "sessions.answer") writes += 1;
					return {
						status: 200,
						body: {
							result: {
								op: "ack",
								req: 1,
								detail: {
									action_id:
										invalid === "foreign-action"
											? `prv_${"a".repeat(32)}`
											: saved.details.profile_action.action_id,
									state: "available",
								},
							},
						},
					};
				},
			},
		};
		const record = api
			.applyEvent(api.EMPTY_TRANSCRIPT, {
				type: "tool_execution_end",
				tool_name: saved.tool_name,
				tool_call_id: saved.tool_call_id,
				result: saved,
			})
			.records.find((r) => r.kind === "tool");
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					h(api.ProfileToolRowUnderTest, {
						record,
						isSmallView: false,
						scope: { sessionId: "test-session", childId: null },
						approvalEpoch: invalid === "missing-epoch" ? null : "test-epoch",
					}),
				),
			);
			assert.equal(
				host.querySelector("[data-profile-revert]")?.dataset.profileRevert,
				"unavailable",
			);
			assert.equal(
				host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
				true,
			);
			assert.equal(writes, 0);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
}

test("mounted identity switch with an unresolved read cannot retain the prior permission", async () => {
	api.profileRevertStatusCache.clear();
	const saved = api.GOLDEN_SAVED_AGENT_TOOL_RESULT;
	let resolveNext;
	let reads = 0;
	const ack = {
		status: 200,
		body: {
			result: {
				op: "ack",
				req: 1,
				detail: {
					action_id: saved.details.profile_action.action_id,
					state: "available",
				},
			},
		},
	};
	window.api = {
		desktop: {
			request: async (request) => {
				assert.equal(request.op, "sessions.profileActionStatus");
				reads += 1;
				if (request.sessionId === "session-b")
					return new Promise((resolve) => {
						resolveNext = resolve;
					});
				return ack;
			},
		},
	};
	const record = api
		.applyEvent(api.EMPTY_TRANSCRIPT, {
			type: "tool_execution_end",
			tool_name: saved.tool_name,
			tool_call_id: saved.tool_call_id,
			result: saved,
		})
		.records.find((r) => r.kind === "tool");
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	const render = (sessionId) =>
		root.render(
			h(api.ProfileToolRowUnderTest, {
				record,
				isSmallView: false,
				scope: { sessionId, childId: null },
				approvalEpoch: "test-epoch",
			}),
		);
	try {
		await act(async () => render("session-a"));
		assert.equal(
			host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
			false,
		);
		await act(async () => render("session-b"));
		assert.equal(reads, 2);
		assert.equal(
			host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
			true,
		);
		assert.equal(
			host.querySelector("[data-profile-revert]").dataset.profileRevert,
			"unavailable",
		);
		await act(async () => resolveNext(ack));
		assert.equal(
			host.querySelector('[data-tour-tag="profile-consent-revert"]').disabled,
			false,
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
