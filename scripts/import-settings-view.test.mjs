import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * Settings -> Import conversations, rendered from the SHIPPED presentational
 * component.
 *
 * WHY THIS FILE EXISTS. The import screen's dangerous states are not the happy
 * one: an empty selection must not offer a default-all import, a changed
 * selection must invalidate the preview that authorised the copy, and a
 * metadata-only row must say why it produces no session. Those are view states,
 * so this harness bundles the real component against the renderer's aliases and
 * mounts it in jsdom, the way the repository's other rendered-surface suites
 * do. It does not drive the Electron app; live evidence is the app-driver run.
 *
 * SUBSTITUTED: the container and the backend. Callbacks are recorded in
 * `calls`, and every state arrives as a prop. The shipped component is the
 * subject, not a mock of it.
 */

const ROOT = process.cwd();
const bundlePath = join(
	ROOT,
	"scripts",
	`.import-view-test-${process.pid}.mjs`,
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
		// jsdom accessors that refuse to be detached are not used here.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { escape: (value) => String(value) };
let scrollIntoViewCalls = 0;
let scrollTopWrites = 0;
dom.window.Element.prototype.scrollIntoView = () => {
	scrollIntoViewCalls += 1;
};
/*
 * A scrollTop write is the OTHER way a component can move the frame: it sets
 * the offset on a container it does not own. Counting the writes pins "the
 * component moved nothing" and not merely "it did not call scrollIntoView".
 */
const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
	dom.window.Element.prototype,
	"scrollTop",
);
if (scrollTopDescriptor?.set) {
	Object.defineProperty(dom.window.Element.prototype, "scrollTop", {
		configurable: true,
		get: scrollTopDescriptor.get,
		set(value) {
			scrollTopWrites += 1;
			scrollTopDescriptor.set.call(this, value);
		},
	});
}

const bundle = await build({
	stdin: {
		contents: `
			export { ImportSettingsView } from "./src/renderer/src/features/settings/components/import-settings-view";
			export { cleanSessionTitle, filterSessions, MAX_IMPORT_SESSIONS, selectAllWithinCap, selectionSignature } from "./src/renderer/src/features/settings/components/imports-model";
			export { desktopEndpoint } from "./src/shared/desktop-contract";
			export { fetchImportSources, previewImport, startImport, fetchImportJob } from "./src/renderer/src/features/settings/components/imports-api";
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
	write: false,
});
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	ImportSettingsView,
	cleanSessionTitle,
	filterSessions,
	MAX_IMPORT_SESSIONS,
	selectAllWithinCap,
	selectionSignature,
	desktopEndpoint,
	fetchImportSources,
	previewImport,
	startImport,
	fetchImportJob,
} = await import(`file://${bundlePath}`);

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
after(() => {
	try {
		unlinkSync(bundlePath);
	} catch {
		// The test may have failed before the bundle existed.
	}
});

const sources = [
	{
		source: "omp",
		label: "omp",
		root: "/home/user/.omp/agent",
		detected: true,
		sessionCount: 2,
		availability: "full",
		detail: "sessions/**/*.jsonl",
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
	{
		source: "omp",
		sourceId: "omp-two",
		title: "Second conversation",
		cwd: "/work/two",
		createdTs: 1_759_000_000,
		updatedTs: 1_759_100_000,
		messageCount: null,
		compactionCount: 0,
		kind: "conversation",
		availability: "metadata_only",
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

let calls;
const render = async (overrides = {}) => {
	calls = [];
	const props = {
		sources,
		activeSource: "omp",
		sessions,
		query: "",
		selected: new Set(),
		preview: null,
		previewStale: false,
		previewError: null,
		confirmed: false,
		busy: null,
		error: null,
		progress: null,
		result: null,
		cancelling: false,
		onSelectSource: (value) => calls.push(["source", value]),
		onQueryChange: (value) => calls.push(["query", value]),
		onToggleSession: (value) => calls.push(["toggle", value]),
		onSelectAll: () => calls.push(["select-all"]),
		onClearSelection: () => calls.push(["clear"]),
		onConfirmChange: (value) => calls.push(["confirm", value]),
		onImport: () => calls.push(["import"]),
		onCancel: () => calls.push(["cancel"]),
		onRetry: () => calls.push(["retry"]),
		onImportAnother: () => calls.push(["another"]),
		onRefresh: () => calls.push(["refresh"]),
		selectionNotice: null,
		onCopyPath: async () => true,
		...overrides,
	};
	const host = document.createElement("div");
	document.body.innerHTML = "";
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(React.createElement(ImportSettingsView, props));
	});
	const click = async (element) => {
		await act(async () => {
			element.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
	};
	return { host, click, root };
};

const buttonByText = (root, text) =>
	[...root.querySelectorAll("button")].find((node) =>
		node.textContent?.includes(text),
	);

const setInputValue = (input, value) => {
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

after(() => {
	dom.window.close();
	for (const name of ["window", "document", "CSS"]) {
		Reflect.deleteProperty(globalThis, name);
	}
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	try {
		unlinkSync(bundlePath);
	} catch {
		// Already removed by a failed build cleanup.
	}
});

test("an empty source list explains itself and offers no import", async () => {
	const { host } = await render({
		sources: [],
		sessions: [],
		activeSource: null,
	});
	assert.match(host.textContent ?? "", /No Claude Code, Codex or omp stores/);
	assert.equal(
		[...host.querySelectorAll("button")].some((node) =>
			node.textContent?.includes("Import"),
		),
		false,
	);
});

test("sessions start unselected and no import control exists before preview", async () => {
	const { host } = await render();
	assert.match(host.textContent ?? "", /0 selected/);
	assert.equal(buttonByText(host, "Import "), undefined);
	assert.match(
		host.textContent ?? "",
		/source index has an entry but no conversation body/,
	);
});

test("search filters rows and select-all is explicit", async () => {
	const { host, click } = await render();
	const input = host.querySelector("input");
	assert.ok(input);
	await act(async () => {
		setInputValue(input, "Second");
	});
	// The input is controlled by the container; this render proves the callback,
	// then the filtered frame is rendered directly.
	assert.deepEqual(calls.at(-1), ["query", "Second"]);
	const filtered = await render({ query: "Second" });
	assert.equal(
		filtered.host.textContent?.includes("First conversation"),
		false,
	);
	assert.equal(
		filtered.host.textContent?.includes("Second conversation"),
		true,
	);
	await filtered.click(buttonByText(filtered.host, "Select all"));
	assert.deepEqual(calls.at(-1), ["select-all"]);
});

test("a preview without confirmation cannot be imported; confirmation enables it", async () => {
	scrollIntoViewCalls = 0;
	scrollTopWrites = 0;
	const { host, click } = await render({
		selected: new Set(["omp-one"]),
		preview,
	});
	/*
	 * THE COMPONENT MUST NOT MOVE THE PAGE. `scrollIntoView` with the default
	 * `container: "all"` walks EVERY scrolling ancestor, and an
	 * `overflow: hidden` box is one of them - it is programmatically
	 * scrollable even though the user cannot scroll it. Measured in the built
	 * app: building a preview scrolled the app's own shell root 237px, which
	 * left the whole window shifted up with an empty band at the bottom and no
	 * way to scroll back. The preview no longer scrolls at all.
	 */
	assert.equal(scrollIntoViewCalls, 0);
	assert.equal(scrollTopWrites, 0);
	const checkboxes = host.querySelectorAll('[role="checkbox"]');
	const checkbox = checkboxes.item(checkboxes.length - 1);
	assert.ok(checkbox);
	const importButton = [...host.querySelectorAll("button")].find((node) =>
		node.textContent?.includes("Import 1 session"),
	);
	assert.ok(importButton);
	assert.equal(importButton.disabled, true);
	await click(checkbox);
	assert.deepEqual(calls.at(-1), ["confirm", true]);
	const confirmed = await render({
		selected: new Set(["omp-one"]),
		preview,
		confirmed: true,
	});
	const enabled = [...confirmed.host.querySelectorAll("button")].find((node) =>
		node.textContent?.includes("Import 1 session"),
	);
	assert.ok(enabled);
	assert.equal(enabled.disabled, false);
});

test("a stale preview disables the import even when confirmed", async () => {
	const { host } = await render({
		selected: new Set(["omp-one", "omp-two"]),
		preview,
		previewStale: true,
		confirmed: true,
	});
	const button = [...host.querySelectorAll("button")].find((node) =>
		node.textContent?.includes("Import"),
	);
	assert.ok(button);
	assert.equal(button.disabled, true);
	assert.match(host.textContent ?? "", /preview/i);
});

test("the acknowledgement and the button it gates share one block", async () => {
	/*
	 * THEY USED TO BE IN TWO PLACES, which is why the operator could not tell
	 * the row's selection box from the acknowledgement box: two identically
	 * shaped 16px squares, one of which was the gate of a button in another
	 * section. One bordered block, the acknowledgement directly above the
	 * button it holds shut, is what makes the pair read as one action.
	 */
	const { host } = await render({
		selected: new Set(["omp-one"]),
		preview,
	});
	const importButton = [...host.querySelectorAll("button")].find((node) =>
		node.textContent?.includes("Import 1 session"),
	);
	assert.ok(importButton);
	const confirm = [...host.querySelectorAll('[role="checkbox"]')].find((node) =>
		(node.getAttribute("aria-label") ?? "").includes("I understand"),
	);
	assert.ok(confirm, "the acknowledgement is a labelled checkbox");
	const block = importButton.closest("div.rounded-lg");
	assert.ok(block, "the import button sits in a bordered block");
	assert.ok(
		block.contains(confirm),
		"the acknowledgement and the button it gates share one block",
	);
	// The acknowledgement is ABOVE the button it gates, not below it.
	assert.ok(
		confirm.compareDocumentPosition(importButton) &
			dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
		"the acknowledgement comes before the button it gates",
	);
});

test("the selected row is marked at row level, not only by its tick", async () => {
	const { host } = await render({
		selected: new Set(["omp-one"]),
		preview,
	});
	const rows = [...host.querySelectorAll("div.rounded-md")].filter((node) =>
		node.querySelector('[role="checkbox"]'),
	);
	const selected = rows.find((node) =>
		node.className.includes("bg-row-selected"),
	);
	assert.ok(
		selected,
		"a selected row carries the app's selected-row treatment, so it reads as selected even if the tick is missed",
	);
	/*
	 * AND ONLY THE SELECTED ROW. Without this half, an implementation that paints
	 * every row would pass the assertion above: the test would be pinning "some
	 * row has the class", not "selection decides which row does".
	 */
	const unselected = rows.filter(
		(node) => !node.className.includes("bg-row-selected"),
	);
	assert.equal(unselected.length, rows.length - 1);
});

test("no row carries the selected treatment when nothing is selected", async () => {
	const { host } = await render({ selected: new Set(), preview });
	const rows = [...host.querySelectorAll("div.rounded-md")].filter((node) =>
		node.querySelector('[role="checkbox"]'),
	);
	assert.ok(rows.length > 0, "the fixture renders session rows");
	for (const row of rows) {
		assert.equal(
			row.className.includes("bg-row-selected"),
			false,
			"an unselected row must not carry the selected-row treatment",
		);
	}
});

test("progress and result rows carry per-session outcomes and review paths", async () => {
	const progress = {
		jobId: "imp-test",
		state: "running",
		phase: "importing",
		source: "omp",
		sessionId: "omp-two",
		completed: 1,
		total: 2,
		results: [
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
		warnings: [],
		error: "",
		startedAt: 0,
		updatedAt: 0,
	};
	const running = await render({ progress, selected: new Set(["omp-one"]) });
	assert.match(running.host.textContent ?? "", /Job imp-test · running/);
	assert.match(running.host.textContent ?? "", /First conversation|omp-one/);
	const result = {
		jobId: "imp-test",
		state: "done",
		sessions: progress.results,
		messages: 4,
		compactions: 1,
		memoryImported: 0,
		memorySkipped: 0,
		memoryReviewPath: "/tmp/imports/memory/omp.md",
		instructionReviewPath: "/tmp/imports/instructions/omp.md",
		redactions: 0,
		warnings: [],
		error: "",
	};
	const finished = await render({
		progress,
		result,
		selected: new Set(["omp-one"]),
	});
	assert.match(finished.host.textContent ?? "", /Import result/);
	assert.match(finished.host.textContent ?? "", /New session target-one/);
	const finishedText = finished.host.textContent ?? "";
	assert.match(finishedText, /Instructions saved for review/);
	assert.match(finishedText, /\/tmp\/imports\/instructions\/omp\.md/);
	assert.match(finishedText, /Unattached memory saved for review/);
	assert.match(finishedText, /\/tmp\/imports\/memory\/omp\.md/);
	assert.match(finished.host.textContent ?? "", /Re-running is safe/);
});

test("a cancelled job's interrupted row reads cancelled and hides its empty target", async () => {
	const result = {
		jobId: "imp-cancel",
		state: "cancelled",
		sessions: [
			{
				source: "omp",
				sourceId: "omp-one",
				targetSessionId: "empty-target",
				outcome: "failed",
				messages: 0,
				compactions: 0,
				redactions: 0,
				skipped: 0,
				warnings: ["import cancelled"],
			},
		],
		messages: 0,
		compactions: 0,
		memoryImported: 0,
		memorySkipped: 0,
		memoryReviewPath: "",
		instructionReviewPath: "",
		redactions: 0,
		warnings: [],
		error: "",
	};
	const { host } = await render({
		result,
		progress: {
			jobId: "imp-cancel",
			state: "cancelled",
			phase: "cancelled",
			source: "omp",
			sessionId: "",
			completed: 0,
			total: 5,
			results: [],
			warnings: [],
			error: "",
			startedAt: 0,
			updatedAt: 0,
		},
	});
	const text = host.textContent ?? "";
	assert.ok((text.match(/cancelled/g) ?? []).length >= 2, text);
	assert.doesNotMatch(text, /failed/);
	assert.doesNotMatch(text, /New session empty-target/);
	assert.doesNotMatch(host.textContent ?? "", /1 warning/);
	assert.match(text, /1 of 5 sessions/);
});

test("a skipped row still shows the target it was already imported into", async () => {
	const result = {
		jobId: "imp-noop",
		state: "done",
		sessions: [
			{
				source: "omp",
				sourceId: "omp-one",
				targetSessionId: "existing-target",
				outcome: "skipped_already_imported",
				messages: 0,
				compactions: 0,
				redactions: 0,
				skipped: 0,
				warnings: [],
			},
		],
		messages: 0,
		compactions: 0,
		memoryImported: 0,
		memorySkipped: 0,
		memoryReviewPath: "",
		instructionReviewPath: "",
		redactions: 0,
		warnings: [],
		error: "",
	};
	const { host } = await render({ result });
	assert.match(host.textContent ?? "", /already imported/);
	assert.match(host.textContent ?? "", /New session existing-target/);
});

test("source cards and Refresh are disabled while a job is active", async () => {
	const progress = {
		jobId: "imp-active",
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
	const { host, click } = await render({
		progress,
		selected: new Set(["omp-one"]),
	});
	const sourceCard = buttonByText(host, "omp");
	assert.ok(sourceCard);
	assert.equal(sourceCard.disabled, true);
	const refresh = buttonByText(host, "Refresh");
	assert.ok(refresh);
	assert.equal(refresh.disabled, true);
	await click(sourceCard);
	assert.equal(
		calls.some(([name]) => name === "source"),
		false,
	);
});

test("error state exposes the reason and a retry", async () => {
	const { host, click } = await render({ error: "backend unavailable" });
	assert.match(host.textContent ?? "", /backend unavailable/);
	const retry = buttonByText(host, "Retry");
	assert.ok(retry);
	await click(retry);
	assert.deepEqual(calls.at(-1), ["retry"]);
});

/*
 * A PREVIEW FAILURE BELONGS WHERE IT HAPPENED. The section banner sits above the
 * source cards and the session list, so at the preview block it is above the
 * fold: the operator saw the acknowledgement and Import disabled with nothing
 * beside them saying why. The failure is now stated in the preview block, with
 * its Retry, next to the controls it explains.
 */
test("a preview failure is stated inside the preview block, beside its Retry", async () => {
	const { host, click } = await render({
		selected: new Set(["omp-one"]),
		preview: null,
		previewError: "Could not build the preview. backend unavailable",
	});
	const message = [...host.querySelectorAll("p, span")].find((node) =>
		(node.textContent ?? "").includes("Could not build the preview"),
	);
	assert.ok(message, "the failure's reason is rendered");
	const retry = buttonByText(host, "Retry");
	assert.ok(retry, "the failure offers a retry");
	const block = buttonByText(host, "Import 1 session")?.closest(
		"div.rounded-lg",
	);
	assert.ok(block, "the acknowledgement block is rendered");
	assert.ok(block.contains(message), "the failure sits beside the gate");
	assert.ok(block.contains(retry), "the retry sits beside the gate");
	await click(retry);
	assert.equal(
		calls.some(([name]) => name === "retry"),
		true,
		"Retry reaches the container",
	);
	// The spinner must not stand under a stated failure: it would read as work
	// still in progress while the block says it failed.
	assert.doesNotMatch(host.textContent ?? "", /Building the preview/);
});

test("private-use title glyphs are stripped at the display boundary", () => {
	assert.equal(
		cleanSessionTitle("\u{F0016} OMPUI: Find alternate versions"),
		"OMPUI: Find alternate versions",
	);
	assert.equal(cleanSessionTitle("  normal\u0007 title  "), "normal title");
});

test("filtering and signatures are deterministic", () => {
	assert.deepEqual(
		filterSessions(sessions, "second").map((row) => row.sourceId),
		["omp-two"],
	);
	assert.equal(
		selectionSignature("omp", new Set(["b", "a"])),
		selectionSignature("omp", new Set(["a", "b"])),
	);
	assert.notEqual(
		selectionSignature("omp", new Set(["a"])),
		selectionSignature("claude", new Set(["a"])),
	);
	const many = Array.from({ length: MAX_IMPORT_SESSIONS + 1 }, (_, index) => ({
		...sessions[0],
		sourceId: `row-${index}`,
	}));
	const capped = selectAllWithinCap(many, "", new Set());
	assert.equal(capped.selected.size, MAX_IMPORT_SESSIONS);
	assert.equal(capped.capped, true);
});

test("the control-plane endpoints map to the desktop import routes", () => {
	assert.deepEqual(desktopEndpoint({ op: "imports.sources" }), {
		path: "/v1/desktop/imports/sources",
		method: "GET",
	});
	assert.deepEqual(desktopEndpoint({ op: "imports.sessions", source: "omp" }), {
		path: "/v1/desktop/imports/sessions?source=omp",
		method: "GET",
	});
	const preview = desktopEndpoint({
		op: "imports.preview",
		sources: ["omp"],
		sessionIds: { omp: ["a"] },
	});
	assert.equal(preview.path, "/v1/desktop/imports/preview");
	assert.equal(preview.method, "POST");
	assert.deepEqual(preview.body, {
		sources: ["omp"],
		session_ids: { omp: ["a"] },
		all: false,
		include_subagents: false,
		include_cleared_segments: false,
		include_memory: true,
		include_instructions: true,
	});
	assert.equal(
		desktopEndpoint({ op: "imports.status", jobId: "a/b" }).path,
		"/v1/desktop/imports/jobs/a%2Fb",
	);
});

test("the API client maps the control-plane envelope and keeps the request explicit", async () => {
	const requests = [];
	globalThis.window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "imports.sources") {
					return {
						status: 200,
						body: {
							result: {
								sources: [
									{
										source: "claude",
										label: "Claude Code",
										root: "/home/user/.claude",
										detected: true,
										session_count: 2,
										availability: "full",
										detail: "",
									},
								],
							},
						},
					};
				}
				if (request.op === "imports.preview") {
					return {
						status: 200,
						body: {
							result: {
								total_sessions: 1,
								total_messages: 4,
								message_counts_estimated: true,
								total_compactions: 0,
								total_memory_records: 0,
								projected_memory_tokens: 0,
								projected_global_tokens: 0,
								warnings: [],
								instruction_review_paths: [],
							},
						},
					};
				}
				if (request.op === "imports.start") {
					return { status: 200, body: { result: { job_id: "imp-1" } } };
				}
				return {
					status: 200,
					body: {
						result: {
							job_id: "imp-1",
							state: "done",
							phase: "done",
							source: "claude",
							session_id: "",
							completed: 1,
							total: 1,
							results: [],
							warnings: [
								{
									source: "claude",
									session_id: "a",
									code: "preview_counts_estimated",
									message: "Preview counts are estimates.",
								},
							],
							error: "",
							started_at: 0,
							updated_at: 0,
						},
					},
				};
			},
		},
	};
	const sources = await fetchImportSources();
	assert.deepEqual(sources[0], {
		source: "claude",
		label: "Claude Code",
		root: "/home/user/.claude",
		detected: true,
		sessionCount: 2,
		availability: "full",
		detail: "",
	});
	const preview = await previewImport({
		sources: ["claude"],
		sessionIds: { claude: ["a"] },
	});
	assert.equal(preview.totalSessions, 1);
	assert.equal(preview.messageCountsEstimated, true);
	assert.equal(
		await startImport({ sources: ["claude"], sessionIds: { claude: ["a"] } }),
		"imp-1",
	);
	const progress = await fetchImportJob("imp-1");
	assert.equal(progress.state, "done");
	assert.equal(progress.warnings[0].code, "preview_counts_estimated");
	assert.deepEqual(
		requests.map((request) => request.op),
		["imports.sources", "imports.preview", "imports.start", "imports.status"],
	);
	assert.deepEqual(requests[1].sessionIds, { claude: ["a"] });
	Reflect.deleteProperty(globalThis.window, "api");
});
