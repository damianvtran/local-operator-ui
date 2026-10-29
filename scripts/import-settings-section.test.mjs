import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The STATEFUL Settings import container, driven end to end against a mocked
 * desktop API. The sibling `import-settings-view.test.mjs` proves the shipped
 * presentational gates; this file proves the sequencing that can only break
 * in the container: preview -> acknowledgement -> import, keeping a running
 * job's monitor when a source card is pressed, recovering from one failed job
 * read, and Refresh reloading both source cards and rows.
 */

const ROOT = process.cwd();
const bundlePath = join(
	ROOT,
	"scripts",
	`.import-section-test-${process.pid}.mjs`,
);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Detached accessors are not used here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
dom.window.Element.prototype.scrollIntoView = () => {};

const bundle = await build({
	stdin: {
		contents: `
			export { ImportSettingsSection } from "./src/renderer/src/features/settings/components/import-settings-section";
		`,
		loader: "tsx",
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${ROOT}/src/renderer/src/shared` },
	loader: { ".css": "empty" },
	plugins: [
		{
			name: "mock-imports-api",
			setup(buildApi) {
				buildApi.onResolve({ filter: /^\.\/imports-api$/ }, () => ({
					path: "imports-api",
					namespace: "import-mock",
				}));
				buildApi.onLoad({ filter: /.*/, namespace: "import-mock" }, () => ({
					loader: "js",
					contents: `
							const mock = () => globalThis.__importMock;
							export const fetchImportSources = (...args) => mock().fetchImportSources(...args);
							export const fetchImportSessions = (...args) => mock().fetchImportSessions(...args);
							export const previewImport = (...args) => mock().previewImport(...args);
							export const startImport = (...args) => mock().startImport(...args);
							export const fetchImportJob = (...args) => mock().fetchImportJob(...args);
							export const cancelImport = (...args) => mock().cancelImport(...args);
						`,
				}));
			},
		},
	],
	write: false,
});
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { ImportSettingsSection } = await import(`file://${bundlePath}`);
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (node) => node.textContent ?? "";

const sources = [
	{
		source: "omp",
		label: "omp",
		root: "/home/user/.omp/agent",
		detected: true,
		sessionCount: 1,
		availability: "full",
		detail: "sessions/**/*.jsonl",
	},
	{
		source: "claude",
		label: "Claude Code",
		root: "/home/user/.claude",
		detected: true,
		sessionCount: 1,
		availability: "full",
		detail: "projects",
	},
];
const sessions = [
	{
		source: "omp",
		sourceId: "omp-one",
		title: "First conversation",
		cwd: "/work/one",
		createdTs: 1_760_000_000,
		updatedTs: 1_760_100_000,
		messageCount: 4,
		compactionCount: 1,
		kind: "conversation",
		availability: "full",
		parentSourceId: null,
	},
];
const secondSession = {
	...sessions[0],
	sourceId: "omp-two",
	title: "Second conversation",
	messageCount: 4,
};
const preview = {
	totalSessions: 1,
	totalMessages: 4,
	messageCountsEstimated: true,
	totalCompactions: 1,
	totalMemoryRecords: 0,
	projectedMemoryTokens: 0,
	projectedGlobalTokens: 0,
	warnings: [],
	instructionReviewPaths: [],
};
const result = {
	jobId: "job-1",
	state: "done",
	sessions: [
		{
			source: "omp",
			sourceId: "omp-one",
			targetSessionId: "target-one",
			outcome: "imported",
			messages: 4,
			compactions: 1,
			redactions: 0,
			skipped: 0,
			warnings: [],
		},
	],
	messages: 4,
	compactions: 1,
	memoryImported: 0,
	memorySkipped: 0,
	memoryReviewPath: "",
	instructionReviewPath: "",
	redactions: 0,
	warnings: [],
	error: "",
};
const running = {
	jobId: "job-1",
	state: "running",
	phase: "importing",
	source: "omp",
	sessionId: "omp-one",
	completed: 0,
	total: 1,
	results: [],
	warnings: [],
	error: "",
	startedAt: 0,
	updatedAt: 0,
};

const makeMock = (overrides = {}) => {
	const calls = { sources: 0, sessions: [], preview: 0, start: 0, job: 0 };
	const mock = {
		fetchImportSources: async () => {
			calls.sources += 1;
			return sources;
		},
		fetchImportSessions: async (source) => {
			calls.sessions.push(source);
			return source === "omp" ? sessions : [];
		},
		previewImport: async () => {
			calls.preview += 1;
			return preview;
		},
		startImport: async () => {
			calls.start += 1;
			return "job-1";
		},
		fetchImportJob: async () => {
			calls.job += 1;
			return { ...running, result };
		},
		cancelImport: async () => undefined,
		...overrides,
	};
	return { mock, calls };
};

let root;
let host;
const mount = async (mock) => {
	globalThis.__importMock = mock;
	host = document.createElement("div");
	document.body.innerHTML = "";
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root.render(React.createElement(ImportSettingsSection));
	});
};
const click = async (node) => {
	await act(async () => {
		node.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};
const waitFor = async (predicate, label, timeout = 6000) => {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		await act(async () => {
			await sleep(40);
		});
		if (predicate()) return;
	}
	throw new Error(`timed out waiting for ${label}: ${text(host)}`);
};
const buttonContaining = (needle) =>
	[...host.querySelectorAll("button")].find((node) =>
		text(node).includes(needle),
	);
const unmount = async () => {
	if (root) await act(async () => root.unmount());
	root = undefined;
};

beforeEach(async () => {
	await unmount();
});

after(async () => {
	await unmount();
	dom.window.close();
	try {
		unlinkSync(bundlePath);
	} catch {
		// Already gone.
	}
});

test("preview, acknowledgement and import are a container gate", async () => {
	const { mock, calls } = makeMock();
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	assert.equal(buttonContaining("Import 1 session"), undefined);
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => text(host).includes("1 selected"), "selection");
	// The preview is built from the selection, so it arrives on its own.
	await waitFor(() => calls.preview === 1, "automatic preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview",
	);
	assert.equal(buttonContaining("Import 1 session")?.disabled, true);
	const boxes = host.querySelectorAll('[role="checkbox"]');
	assert.ok(boxes.length >= 2);
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled",
	);
	await click(buttonContaining("Import 1 session"));
	await waitFor(() => text(host).includes("Import result"), "result");
	await waitFor(() => text(host).includes("New session target-one"), "target");
	assert.equal(calls.start, 1);
	assert.equal(calls.preview, 1);
});

test("a selection change builds the preview without the user asking", async () => {
	const second = {
		...sessions[0],
		sourceId: "omp-two",
		title: "Second conversation",
	};
	const { mock, calls } = makeMock({
		fetchImportSessions: async () => [sessions[0], second],
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	assert.equal(calls.preview, 0);
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => calls.preview === 1, "automatic preview");
	// The preview is debounced, so a second row does not ask the core again
	// for every tick of the selection.
	await click(host.querySelectorAll('[role="checkbox"]')[1]);
	await waitFor(() => calls.preview === 2, "rebuilt preview");
	// An empty selection has nothing to preview, and asking for one is what
	// used to be a silent no-op at the user.
	await click(host.querySelectorAll('[role="checkbox"]')[1]);
	await click(host.querySelectorAll('[role="checkbox"]')[0]);
	await act(async () => {
		await sleep(600);
	});
	assert.equal(calls.preview, 2);
});

test("a running job keeps its monitor when a source card is pressed", async () => {
	const { mock, calls } = makeMock({
		fetchImportJob: async () => ({ ...running }),
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => text(host).includes("1 selected"), "selection");
	await waitFor(() => calls.preview === 1, "automatic preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview",
	);
	const boxes = host.querySelectorAll('[role="checkbox"]');
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled",
	);
	await click(buttonContaining("Import 1 session"));
	await waitFor(
		() => text(host).includes("Importing conversations"),
		"progress",
	);
	const card = buttonContaining("Claude Code");
	assert.ok(card);
	assert.equal(card.disabled, true);
	await click(card);
	await act(async () => {
		await sleep(120);
	});
	assert.equal(calls.start, 1);
	assert.deepEqual(calls.sessions, ["omp"]);
	assert.match(text(host), /Cancel import/);
});

test("one failed job read is retried and clears its error on success", async () => {
	let jobReads = 0;
	const { mock, calls } = makeMock({
		fetchImportJob: async () => {
			jobReads += 1;
			if (jobReads === 1) throw new Error("transient desktop read");
			return { ...running, state: "done", result };
		},
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => text(host).includes("1 selected"), "selection");
	await waitFor(() => calls.preview === 1, "automatic preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview",
	);
	const boxes = host.querySelectorAll('[role="checkbox"]');
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled",
	);
	await click(buttonContaining("Import 1 session"));
	await waitFor(
		() => text(host).includes("Could not read import progress"),
		"poll error",
	);
	await waitFor(
		() => text(host).includes("Import result"),
		"recovered result",
		6000,
	);
	assert.equal(jobReads >= 2, true);
	assert.doesNotMatch(text(host), /Could not read import progress/);
});

test("Refresh reloads source cards and the active session list", async () => {
	const { mock, calls } = makeMock();
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(buttonContaining("Refresh"));
	await waitFor(
		() => calls.sources >= 2 && calls.sessions.length >= 2,
		"refresh",
		4000,
	);
	assert.equal(calls.sources >= 2, true);
	assert.equal(
		calls.sessions.filter((source) => source === "omp").length >= 2,
		true,
	);
});

/*
 * THE INTERLEAVING THAT WEDGED THE SCREEN. A selection change starts a second
 * build while the first is in flight (the debounce delays each build's start,
 * it does not serialize them), and the two responses can land in either order.
 * Before the request guard, the OLD response overwrote the newer preview and
 * signature, and the failure marker recorded by the newer attempt then stopped
 * the effect from ever rebuilding: a permanent "Building the preview..." with
 * the acknowledgement and Import disabled and no error to retry.
 */
test("an out-of-order preview response cannot overwrite the current one", async () => {
	const { mock, calls } = makeMock({
		fetchImportSessions: async () => [sessions[0], secondSession],
		previewImport: async (request) => {
			calls.preview += 1;
			const attempt = calls.preview;
			const ids = request.sessionIds[request.sources[0]] ?? [];
			// The FIRST request answers LAST.
			await sleep(attempt === 1 ? 900 : 60);
			return {
				...preview,
				totalSessions: ids.length,
				totalMessages: ids.length === 2 ? 8 : 154,
			};
		},
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelectorAll('[role="checkbox"]')[0]);
	await waitFor(() => calls.preview === 1, "first preview request");
	await waitFor(() => text(host).includes("1 selected"), "first selection");
	// Add the second row while the first build is still in flight.
	await click(host.querySelectorAll('[role="checkbox"]')[1]);
	await waitFor(() => calls.preview === 2, "second preview request");
	// Let the older response land after the newer one.
	await act(async () => {
		await sleep(1500);
	});
	assert.equal(calls.preview, 2, "exactly one build per settled selection");
	// The current selection's own numbers, not the superseded request's.
	assert.match(text(host), /2 sessions · 8 messages/);
	assert.doesNotMatch(text(host), /1 session · 154 messages/);
	// `previewStale` is false: the acknowledgement is usable again.
	const boxes = host.querySelectorAll('[role="checkbox"]');
	const acknowledgement = boxes.item(boxes.length - 1);
	assert.equal(acknowledgement.disabled, false);
	await click(acknowledgement);
	await waitFor(
		() => buttonContaining("Import 2 sessions")?.disabled === false,
		"import enabled",
	);
});

/*
 * THE LATCH THAT OUTLIVED ITS PREVIEW. `onImportAnother` drops the preview but
 * used to keep the record of the failed attempt; re-selecting the SAME set
 * produces the same signature, so the build was never scheduled again and the
 * spinner stood forever. Reachable from the primary flow.
 */
test("re-selecting the same set after an import builds a new preview", async () => {
	const { mock, calls } = makeMock();
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => calls.preview === 1, "automatic preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview",
	);
	const boxes = host.querySelectorAll('[role="checkbox"]');
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled",
	);
	await click(buttonContaining("Import 1 session"));
	await waitFor(() => text(host).includes("Import result"), "result", 6000);
	await click(buttonContaining("Import more conversations"));
	await waitFor(() => text(host).includes("0 selected"), "reset");
	// The SAME source and the SAME ids as before: the same selection signature.
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => calls.preview === 2, "rebuilt preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview again",
	);
	const again = host.querySelectorAll('[role="checkbox"]');
	await click(again.item(again.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled again",
	);
	assert.equal(calls.preview, 2);
});

/*
 * THE SAFETY INVARIANT UNDER AUTO-PREVIEW. A tick stated for one set of
 * conversations must not authorize a different set once the new preview
 * arrives: the acknowledgement is a statement about THAT copy.
 */
test("a selection change clears the acknowledgement and disables Import", async () => {
	const { mock, calls } = makeMock({
		fetchImportSessions: async () => [sessions[0], secondSession],
		previewImport: async (request) => {
			calls.preview += 1;
			const ids = request.sessionIds[request.sources[0]] ?? [];
			return {
				...preview,
				totalSessions: ids.length,
				totalMessages: ids.length === 2 ? 8 : 154,
			};
		},
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelectorAll('[role="checkbox"]')[0]);
	await waitFor(() => calls.preview === 1, "automatic preview");
	await waitFor(
		() => text(host).includes("I understand these conversations"),
		"preview",
	);
	let boxes = host.querySelectorAll('[role="checkbox"]');
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 1 session")?.disabled === false,
		"enabled",
	);
	// Add a row: a different copy, so the acknowledgement must be re-stated.
	await click(host.querySelectorAll('[role="checkbox"]')[1]);
	await waitFor(() => calls.preview === 2, "rebuilt preview");
	await waitFor(
		() => text(host).includes("2 sessions · 8 messages"),
		"preview",
	);
	boxes = host.querySelectorAll('[role="checkbox"]');
	assert.equal(
		boxes.item(boxes.length - 1).getAttribute("data-state"),
		"unchecked",
	);
	assert.equal(
		buttonContaining("Import 2 sessions")?.disabled,
		true,
		"the new preview does not re-arm the acknowledgement",
	);
	// Re-stating it is what re-enables the action.
	await click(boxes.item(boxes.length - 1));
	await waitFor(
		() => buttonContaining("Import 2 sessions")?.disabled === false,
		"enabled again",
	);
});

/*
 * THE FAILURE WAS REPORTED IN THE WRONG PLACE. It lived only in the section
 * banner, which sits above the source cards and the session list; at the
 * preview block the operator saw a disabled acknowledgement and a grey Import
 * with nothing beside them saying why. The preview's failure now renders in
 * the preview block, next to the controls it explains, and Retry rebuilds.
 */
test("a failed preview is stated where it happened and Retry rebuilds it", async () => {
	let attempts = 0;
	const { mock, calls } = makeMock({
		previewImport: async () => {
			calls.preview += 1;
			attempts += 1;
			if (attempts === 1) throw new Error("preview refused");
			return preview;
		},
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(
		() => text(host).includes("Could not build the preview"),
		"inline preview failure",
	);
	// ONE Retry: the preview failure is no longer duplicated in the section
	// banner, which stays for source, session and job errors.
	const retries = [...host.querySelectorAll("button")].filter(
		(node) => node.textContent?.trim() === "Retry",
	);
	assert.equal(retries.length, 1);
	// The failure and its Retry are in the block that holds the gate.
	const block = retries[0].closest("div.rounded-lg");
	assert.ok(block?.contains(retries[0]));
	assert.match(text(host), /I understand these conversations/);
	await click(retries[0]);
	await waitFor(() => calls.preview === 2, "rebuilt preview");
	await waitFor(
		() => text(host).includes("1 session · 4 messages"),
		"preview recovered",
	);
	assert.doesNotMatch(text(host), /Could not build the preview/);
});

/*
 * ONE CONTROL PER ROW, ONE TOGGLE PER CLICK. The row text used to be a second
 * button with the same action as the checkbox: two focus stops for one action,
 * and the second one did not expose the checked state. The text is now the
 * checkbox's label, so the row has one focusable control and the large pointer
 * target is preserved.
 */
test("a row has one focus stop and its label toggles exactly once", async () => {
	const { mock } = makeMock();
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	const row = [...host.querySelectorAll("div.rounded-md")].find((node) =>
		node.querySelector('[role="checkbox"]'),
	);
	assert.ok(row);
	const checkbox = row.querySelector('[role="checkbox"]');
	const label = row.querySelector("label");
	assert.ok(checkbox);
	assert.ok(label, "the row text is a label, not a second button");
	assert.equal(
		label.getAttribute("for"),
		checkbox.id,
		"the label is associated with the row's checkbox",
	);
	// (a) exactly one focusable control in the row.
	const focusable = row.querySelectorAll(
		'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
	);
	assert.equal(focusable.length, 1);
	assert.equal(focusable[0], checkbox);
	// (b) one click on the label toggles exactly once.
	await click(label);
	await waitFor(() => text(host).includes("1 selected"), "selected once");
	assert.equal(text(host).includes("2 selected"), false);
	// (c) no double toggle: it goes back to empty in one more click.
	await click(label);
	await waitFor(() => text(host).includes("0 selected"), "deselected once");
});
