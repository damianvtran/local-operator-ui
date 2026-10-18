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
	await click(buttonContaining("Preview"));
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

test("a running job keeps its monitor when a source card is pressed", async () => {
	const { mock, calls } = makeMock({
		fetchImportJob: async () => ({ ...running }),
	});
	await mount(mock);
	await waitFor(() => text(host).includes("First conversation"), "sessions");
	await click(host.querySelector('[role="checkbox"]'));
	await waitFor(() => text(host).includes("1 selected"), "selection");
	await click(buttonContaining("Preview"));
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
	const { mock } = makeMock({
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
	await click(buttonContaining("Preview"));
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
