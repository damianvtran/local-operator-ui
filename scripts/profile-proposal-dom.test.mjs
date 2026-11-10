import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
const require = createRequire(import.meta.url);
// Install DOM before react-dom chooses its input-event implementation. All
// bridge calls below are synthetic; no actual profile or session is touched.
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
for (const key of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"Element",
	"Node",
	"MutationObserver",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
const React = require("react");
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { MemoryRouter } = require("react-router-dom");
const bundle = await build({
	stdin: {
		contents:
			'export {UnifiedDiff} from "./src/renderer/src/shared/components/common/unified-diff"; export {ProfileProposalPanel} from "./src/renderer/src/features/agents/components/profile-proposal-panel";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	format: "cjs",
	platform: "node",
	jsx: "automatic",
	packages: "external",
	tsconfig: "tsconfig.app.json",
	define: { "import.meta.env": "{}" },
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@renderer": "./src/renderer/src",
	},
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	module,
	module.exports,
);
const { UnifiedDiff, ProfileProposalPanel } = module.exports;
const h = React.createElement;
const { act } = React;
const root = createRoot(document.getElementById("root"));
let client;
after(async () => {
	await act(async () => root.unmount());
	client?.clear();
	dom.window.close();
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
/** Re-render the mounted tree with new props: same instance, no remount. */
async function rerender(Component, props) {
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MemoryRouter, {}, h(Component, props)),
			),
		);
		await flush();
	});
}
async function mount(Component, props) {
	await act(async () => root.render(null));
	client?.clear();
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, retryDelay: 0, gcTime: 0 },
			mutations: { retry: false, gcTime: 0 },
		},
	});
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(MemoryRouter, {}, h(Component, props)),
			),
		);
		await flush();
	});
	for (let i = 0; i < 6; i++) await act(flush);
}
async function click(node) {
	assert.ok(node, `control exists: ${document.body.textContent}`);
	await act(async () => {
		node.click();
		await flush();
	});
	await act(flush);
}
const button = (text) =>
	[...document.querySelectorAll("button")].find((n) => n.textContent === text);
const id = "pp_0123456789abcdef";
function bridge({
	state = "pending",
	conflict = false,
	error = false,
	acceptError = false,
	operation = "update",
} = {}) {
	let proposal = {
		id,
		kind: "team",
		name: "lopdev",
		operation,
		fields: ["instructions"],
		state,
		stale: state === "stale",
		origin: { trust: "agent", session_id: "synthetic", trigger: "wake_prompt" },
		changes: [
			{
				field: "instructions",
				label: "Instructions",
				before_text: "Be short and direct.",
				after_text: "Be concise and direct.",
				format: "text",
			},
		],
	};
	const calls = [];
	window.api = {
		desktop: {
			request: async (ask) => {
				calls.push(ask);
				if (error)
					return {
						status: 400,
						body: { detail: { code: "store_busy", message: "Store busy" } },
					};
				let result;
				if (ask.op === "profileProposals.list")
					result = {
						proposals:
							proposal.state === "accepted" || proposal.state === "rejected"
								? []
								: [proposal],
						counts: { team: { lopdev: 1 }, agent: {} },
					};
				else if (ask.op === "profileProposals.get") result = proposal;
				else if (ask.op === "profileProposals.accept") {
					if (acceptError)
						return {
							status: 503,
							body: { detail: { code: "store_busy", message: "Store busy" } },
						};
					if (conflict)
						return {
							status: 409,
							body: {
								detail: {
									code: "profile_proposal_stale",
									message: "Changed; nothing applied.",
								},
							},
						};
					proposal = { ...proposal, state: "accepted" };
					result = { proposal, profile: {}, backup_id: "backup" };
				} else if (ask.op === "profileProposals.reject") {
					proposal = { ...proposal, state: "rejected" };
					result = { proposal };
				} else throw new Error(`Unexpected op ${ask.op}`);
				return { status: 200, body: { result } };
			},
		},
	};
	return calls;
}
const props = { kind: "team", name: "lopdev", enabled: true };
test("diff: word marks, counts, expand context and next/previous keyboard focus", async () => {
	const before = Array.from(
		{ length: 30 },
		(_, i) => `Line ${i}: be short and direct.`,
	);
	const after = [...before];
	after[5] = "Line 5: be concise and direct.";
	after[24] = "Line 24: be clear and direct.";
	await mount(UnifiedDiff, {
		before: before.join("\n"),
		after: after.join("\n"),
	});
	assert.equal(document.querySelectorAll("[data-diff-word]").length, 4);
	assert.match(
		document.querySelector("[data-diff-stats]").textContent,
		/\+2.*−2/,
	);
	const gap = document.querySelector("[data-diff-gap]");
	await click(gap);
	assert.equal(gap.isConnected, false);
	await click(document.querySelector('[aria-label="Next change"]'));
	assert.equal(document.activeElement.dataset.diffChange, "0");
	await act(async () =>
		document.activeElement.dispatchEvent(
			new KeyboardEvent("keydown", { key: "n", bubbles: true }),
		),
	);
	assert.equal(document.activeElement.dataset.diffChange, "1");
	await act(async () =>
		document.activeElement.dispatchEvent(
			new KeyboardEvent("keydown", { key: "p", bubbles: true }),
		),
	);
	assert.equal(document.activeElement.dataset.diffChange, "0");
});
test("diff: no-change, add-only and delete-only render honestly", async () => {
	await mount(UnifiedDiff, { before: "same", after: "same" });
	assert.match(document.body.textContent, /No changes/);
	await mount(UnifiedDiff, { before: "", after: "New" });
	assert.equal(document.querySelectorAll('[data-diff-line="add"]').length, 1);
	await mount(UnifiedDiff, { before: "Old", after: "" });
	assert.equal(document.querySelectorAll('[data-diff-line="del"]').length, 1);
});
test("panel: Accept and Reject settle visibly after pending list removes the card", async () => {
	let calls = bridge();
	await mount(ProfileProposalPanel, props);
	await click(button("Accept"));
	assert.match(
		document.body.textContent,
		/Applied the proposed change to lopdev/,
	);
	assert.equal(
		calls.filter((c) => c.op === "profileProposals.accept").length,
		1,
	);
	calls = bridge();
	await mount(ProfileProposalPanel, { ...props, key: "reject" });
	await click(button("Reject"));
	assert.match(document.body.textContent, /Rejected the proposed change/);
	assert.equal(
		calls.filter((c) => c.op === "profileProposals.reject").length,
		1,
	);
});
test("panel: Edit & accept updates live diff and sends only edited after field", async () => {
	const calls = bridge();
	await mount(ProfileProposalPanel, { ...props, key: "edit" });
	await click(button("Edit & accept"));
	const input = document.querySelector("textarea");
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		).set.call(input, "Be concise, clear and direct.");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	assert.match(
		document.querySelector('[data-testid="unified-diff"]').textContent,
		/clear/,
	);
	await click(button("Accept edited change"));
	assert.deepEqual(
		calls.find((c) => c.op === "profileProposals.accept").after,
		{ instructions: "Be concise, clear and direct." },
	);
});
test("panel: stale and 409 block Accept, keep Reject and originating conversation", async () => {
	bridge({ state: "stale" });
	await mount(ProfileProposalPanel, { ...props, key: "stale" });
	assert.equal(button("Accept").disabled, true);
	assert.equal(button("Reject").disabled, false);
	assert.match(
		document.querySelector("a").textContent,
		/originating conversation/,
	);
	const calls = bridge({ conflict: true });
	await mount(ProfileProposalPanel, { ...props, key: "409" });
	await click(button("Accept"));
	assert.equal(button("Accept").disabled, true);
	assert.match(document.body.textContent, /fresh proposal/);
	assert.equal(
		calls.filter((c) => c.op === "profileProposals.accept").length,
		1,
	);
	await click(button("Reject"));
	assert.match(document.body.textContent, /Rejected/);
});
test("panel: errors have retry, disabled capability issues no calls, wrong-record links cannot mutate", async () => {
	bridge({ error: true });
	await mount(ProfileProposalPanel, { ...props, key: "error" });
	assert.ok(button("Try again"), document.body.textContent);
	let calls = bridge();
	await mount(ProfileProposalPanel, { ...props, key: "off", enabled: false });
	assert.equal(calls.length, 0);
	assert.equal(
		document.querySelector('[data-testid="profile-proposal-panel"]'),
		null,
	);
	calls = bridge();
	await mount(ProfileProposalPanel, {
		...props,
		key: "wrong",
		name: "another",
		proposalId: id,
	});
	assert.equal(button("Accept"), undefined);
	assert.equal(
		calls.some((c) => c.op.endsWith("accept")),
		false,
	);
});

test("panel: fields line uses labels; a create proposal is titled as a new profile (U4/D1, F4)", async () => {
	bridge({ operation: "create" });
	await mount(ProfileProposalPanel, { ...props, key: "create" });
	assert.match(document.body.textContent, /Changes: Instructions/);
	assert.doesNotMatch(document.body.textContent, /ui\.agents\.proposals/);
	assert.match(document.body.textContent, /Proposed new profile: lopdev/);
	assert.ok(button("Accept"));
});
test("panel: a failed non-stale decision offers the Refresh it tells the person to use (U8)", async () => {
	const calls = bridge({ acceptError: true });
	await mount(ProfileProposalPanel, { ...props, key: "accept-error" });
	assert.equal(button("Refresh status"), undefined);
	await click(button("Accept"));
	assert.ok(
		document.querySelector('[role="alert"]'),
		document.body.textContent,
	);
	const gets = () =>
		calls.filter((c) => c.op === "profileProposals.get").length;
	const before = gets();
	await click(button("Refresh status"));
	assert.ok(gets() > before, "Refresh re-reads the proposal");
	assert.equal(button("Refresh status"), undefined);
});
test("diff: expanded context folds again (D2) and editing keeps folds and position (U7)", async () => {
	const before = Array.from({ length: 30 }, (_, i) => `Line ${i}: be short.`);
	const after = [...before];
	after[5] = "Line 5: be brief.";
	after[24] = "Line 24: be clear.";
	const base = { before: before.join("\n"), resetKey: "pp:instructions" };
	await mount(UnifiedDiff, { ...base, after: after.join("\n") });
	await click(document.querySelector("[data-diff-gap]"));
	const hide = document.querySelector("[data-diff-gap-hide]");
	assert.match(hide.textContent, /Hide \d+ unchanged lines/);
	await click(document.querySelector('[aria-label="Next change"]'));
	assert.equal(document.activeElement.dataset.diffChange, "0");
	// A keystroke in the editor: same identity, different `after`.
	after[24] = "Line 24: be clearer.";
	await rerender(UnifiedDiff, { ...base, after: after.join("\n") });
	assert.ok(
		document.querySelector("[data-diff-gap-hide]"),
		"fold survives typing",
	);
	assert.match(document.body.textContent, /Change 1 of 2/);
	await click(document.querySelector("[data-diff-gap-hide]"));
	assert.ok(document.querySelector("[data-diff-gap]"), "context folded again");
	// A new identity starts over.
	await rerender(UnifiedDiff, {
		...base,
		resetKey: "pp:other",
		after: after.join("\n"),
	});
	assert.doesNotMatch(document.body.textContent, /Change 1 of 2/);
});
