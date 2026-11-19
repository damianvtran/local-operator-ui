import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The canvas editor's inline edit, at the renderer half of its transport.
 *
 * WHY THIS FILE EXISTS. `ChatApi.editFileWithAgent` used to be the one control
 * call the renderer sent with its own `fetch`, straight at the backend URL; it
 * now goes through `window.api.desktop.request` as `legacy.agent.editFile`,
 * like every other control, so main attaches the desktop credential. The popover
 * (`inline-edit.tsx`) must see no difference, and that is what is pinned here:
 * the request reaches the IPC seam with the body the backend reads, a 2xx
 * answer comes back as the same `CRUDResponse`, and every failure - an HTTP
 * refusal, main's own 413/504/503, or the IPC itself rejecting - still REJECTS,
 * which is the only thing the popover's catch (one failure toast) reads.
 *
 * The main half (route, method, bearer, budget, deadline) is pinned against a
 * real socket in `desktop-contract.test.mjs`.
 *
 * Bundled in memory like `desktop-renderer-transport.test.mjs`, so this runs the
 * shipped TS rather than a copy and adds no build step or fixture.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { ChatApi } from "./src/renderer/src/shared/api/local-operator/chat-api"; export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api"; export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const source = `${bundle.outputFiles[0].text}\n//# sourceURL=inline-edit-transport.test.bundle.mjs\n`;

/**
 * A fresh module copy with the IPC seam bound to `request`, and a global
 * `fetch` that fails the test if anything still reaches for it.
 */
async function load(request) {
	globalThis.window = { api: { desktop: { request } } };
	globalThis.fetch = async (input) => {
		throw new Error(`inline edit must not use a renderer fetch (${input})`);
	};
	return import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);
}

/** Exactly what `inline-edit.tsx` builds, including a pasted image. */
const editRequest = {
	hosting: "openai",
	model: "gpt-synthetic",
	file_path: "notes/draft.md",
	file_content: "# Title\n\nsome text\n",
	edit_prompt: "make the title louder",
	selection: "# Title",
	attachments: ["data:image/png;base64,iVBORw0KGgo="],
};
const agentId = "11111111-2222-4333-8444-555555555555";

test("an inline edit travels the desktop transport with its request intact", async () => {
	const calls = [];
	const answer = {
		status: 200,
		message: "File edited successfully",
		result: {
			file_path: "notes/draft.md",
			raw_response: "<raw/>",
			edit_prompt: "make the title louder",
			edit_diffs: [{ find: "# Title", replace: "# TITLE" }],
		},
	};
	const { ChatApi, desktopRequestSchema, desktopEndpoint } = await load(
		async (request) => {
			calls.push(request);
			return { status: 200, body: answer };
		},
	);

	const response = await ChatApi.editFileWithAgent(
		"http://127.0.0.1:1111",
		agentId,
		editRequest,
	);

	// The popover reads `result.edit_diffs`; the body comes back untouched.
	assert.deepEqual(response, answer);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		op: "legacy.agent.editFile",
		agentId,
		request: editRequest,
	});
	// What crossed IPC is a request main admits, and it maps to the route and
	// the byte-for-byte body the old renderer fetch sent.
	const parsed = desktopRequestSchema.parse(calls[0]);
	assert.deepEqual(desktopEndpoint(parsed), {
		path: `/v1/chat/agents/${agentId}/edit`,
		method: "POST",
		body: editRequest,
	});
});

test("every failure still rejects, which is all the popover's failure toast reads", async () => {
	// HTTP refusals and main's own synthesised refusals (413 over budget, 504
	// out of time, 503 no credential / transport failed) all arrive as a non-2xx
	// response and must throw the same `chat_edit_file` error the fetch threw.
	for (const status of [401, 404, 413, 422, 500, 503, 504]) {
		const { ChatApi } = await load(async () => ({
			status,
			body: { detail: "refused" },
		}));
		await assert.rejects(
			ChatApi.editFileWithAgent("", agentId, editRequest),
			(error) => {
				assert.ok(error instanceof Error, `status ${status}`);
				assert.match(error.message, new RegExp(String(status)));
				return true;
			},
			`status ${status} must reject`,
		);
	}

	// The IPC itself failing (main never answering a handler, a crashed main) is
	// the transport's DesktopControlError - still a rejection, so the same toast.
	const { ChatApi, DesktopControlError } = await load(async () => {
		throw new Error("ipc down");
	});
	await assert.rejects(
		ChatApi.editFileWithAgent("", agentId, editRequest),
		(error) => error instanceof DesktopControlError && error.status === null,
	);
});

test("the contract refuses a key the backend's edit body does not declare", async () => {
	const { desktopRequestSchema } = await load(async () => ({
		status: 200,
		body: {},
	}));
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "legacy.agent.editFile",
			agentId,
			request: { ...editRequest, smuggled: true },
		}).success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "legacy.agent.editFile",
			agentId: "../config",
			request: editRequest,
		}).success,
		false,
	);
	// An empty buffer is a valid document, and every optional field may be absent.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "legacy.agent.editFile",
			agentId,
			request: {
				hosting: "default",
				model: "default",
				file_path: "x.txt",
				file_content: "",
				edit_prompt: "p",
			},
		}).success,
		true,
	);
});
