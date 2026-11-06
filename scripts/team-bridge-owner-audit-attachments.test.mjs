import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

/* Real shipped modules, synthetic HTTP/media boundaries. These tests
 * prove confinement and image byte confinement, NOT deployed hub authority,
 * native dialog/pixels or a live owner/tenant probe. No Electron is launched. */
const ELECTRON_MODULE = /^electron$/;
const ANY_MODULE = /.*/;
const dom = new JSDOM("<!doctype html><div></div>", {
	url: "http://localhost/",
});
for (const name of [
	"window",
	"document",
	"HTMLElement",
	"HTMLButtonElement",
	"Element",
	"Node",
	"MutationObserver",
	"DocumentFragment",
	"NodeFilter",
	"navigator",
	"localStorage",
	"SVGElement",
	"CustomEvent",
	"Event",
	"FocusEvent",
	"MouseEvent",
	"KeyboardEvent",
	"HTMLInputElement",
]) {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		value: dom.window[name],
	});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const urls = new Set();
let urlSequence = 0;
URL.createObjectURL = () => {
	const url = `blob:audit-${++urlSequence}`;
	urls.add(url);
	return url;
};
URL.revokeObjectURL = (url) => urls.delete(url);
const bundle = await build({
	stdin: {
		resolveDir: process.cwd(),
		contents: `
 export { registerDesktopIPC } from './src/main/desktop-ipc';
 export { readOwnerAuditAttachment } from './src/main/team-bridge-audit-media';
 export { requestDesktopMediaOutcome } from './src/main/desktop-media';
 export { AuditAttachmentGroup } from './src/renderer/src/features/team-bridge/attachments/audit-attachment-group';
 export { auditAttachmentKey, auditAttachmentAction, auditMessageScope } from './src/renderer/src/features/team-bridge/attachments/audit-attachment-scope';
 export { TeamBridgeOwnerAuditApi } from './src/renderer/src/shared/api/local-operator/team-bridge-owner-audit-api';
 `,
	},
	bundle: true,
	tsconfig: "tsconfig.web.json",
	jsx: "automatic",
	platform: "node",
	format: "cjs",
	write: false,
	external: ["react", "react-dom", "react-dom/client"],
	define: { "import.meta.env": "{}" },
	plugins: [
		{
			name: "original-electron-surface",
			setup(build) {
				build.onResolve({ filter: ELECTRON_MODULE }, () => ({
					path: "electron",
					namespace: "audit-electron",
				}));
				build.onLoad(
					{ filter: ANY_MODULE, namespace: "audit-electron" },
					() => ({
						contents: `
   export const ipcMain = { handle: (name, fn) => globalThis.__auditIpc.set(name, fn), on: () => {} };
   export const shell = { openExternal: async () => { throw new Error("unexpected external open"); } };
  `,
						loader: "js",
					}),
				);
			},
		},
	],
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
	},
});
const runtimeFile = join(
	process.cwd(),
	"scripts/_audit-attachment-runtime.cjs",
);
const compiled = new Module(runtimeFile);
compiled.filename = runtimeFile;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
after(() => dom.window.close());
const scope = {
	accountId: "acct_owner",
	tenantId: "org_test",
	conversationId: "bcv_test",
	messageId: "bmsg_test",
	attachmentId: "batt_test",
};
const tuple = {
	tenantId: scope.tenantId,
	expectedAccountId: scope.accountId,
	conversationId: scope.conversationId,
	messageId: scope.messageId,
	attachmentId: scope.attachmentId,
};
const attachment = {
	id: scope.attachmentId,
	mime: "image/png",
	size: 4,
	width: 240,
	height: 150,
	state: "bound",
};
const headers = (mime = "image/png") => ({
	"content-type": mime,
	"cache-control": "private, no-store",
	"x-content-type-options": "nosniff",
	"content-security-policy": "default-src 'none'; sandbox",
});
const bytes = new Uint8Array([1, 2, 3, 4]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("audit authority key includes account and every tuple field; only explicit bound closed types commission", () => {
	const key = m.auditAttachmentKey(scope);
	for (const field of Object.keys(scope))
		assert.notEqual(
			m.auditAttachmentKey({ ...scope, [field]: "different" }),
			key,
		);
	assert.equal(m.auditAttachmentAction(attachment), "preview");
	assert.equal(
		m.auditAttachmentAction({
			...attachment,
			mime: "application/octet-stream",
		}),
		null,
	);
	for (const state of [
		undefined,
		"",
		"expired",
		"withheld",
		"deleted",
		"revoked",
		"unknown",
	])
		assert.equal(m.auditAttachmentAction({ ...attachment, state }), null);
	for (const mime of ["image/svg+xml", "text/html", "application/pdf"])
		assert.equal(m.auditAttachmentAction({ ...attachment, mime }), null);
});

test("bounded audit consumer rejects every opaque/active type, including a stale download argument", async () => {
	for (const mime of [
		"image/png",
		"image/jpeg",
		"application/octet-stream",
		"image/svg+xml",
		"text/html",
		"application/pdf",
	]) {
		for (const staleDownloadArgument of [false, true]) {
			const response = await m.readOwnerAuditAttachment(
				new Response(bytes, { headers: headers(mime) }),
				staleDownloadArgument,
			);
			assert.equal(
				response.kind,
				mime === "image/png" || mime === "image/jpeg" ? "bytes" : "error",
			);
			if (response.kind === "bytes")
				assert.equal(response.cacheControl, "private, no-store");
		}
	}
	for (const missing of [
		"cache-control",
		"content-security-policy",
		"x-content-type-options",
	]) {
		const h = headers();
		delete h[missing];
		assert.equal(
			(await m.readOwnerAuditAttachment(new Response(bytes, { headers: h })))
				.kind,
			"error",
		);
	}
	for (const status of [401, 403, 404, 409, 410, 503]) {
		const response = await m.readOwnerAuditAttachment(
			new Response("private refusal reason", { status }),
		);
		assert.equal(response.kind, "error");
		assert.equal(response.status, status);
		assert.equal(response.detail.includes("private refusal reason"), false);
	}
});

test("five-MiB stream cap precedes exposure regardless of stale mode/length arguments", async () => {
	for (const staleMode of [false, true]) {
		let cancelled = false;
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(5 * 1024 * 1024));
				controller.enqueue(bytes);
			},
			cancel() {
				cancelled = true;
			},
		});
		const answer = await m.readOwnerAuditAttachment(
			new Response(body, { headers: headers() }),
			staleMode,
		);
		assert.equal(answer.kind, "error");
		assert.equal(answer.status, 413);
		assert.equal(cancelled, true);
	}
	const h = { ...headers(), "content-length": String(5 * 1024 * 1024 + 1) };
	assert.equal(
		(await m.readOwnerAuditAttachment(new Response(bytes, { headers: h })))
			.status,
		413,
	);
});

test("closed relay binds all five fields, no-store, fixed origin and no generic renderer opaque mode", async () => {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, options) => {
		calls.push({ url: new URL(url), options });
		return new Response(bytes, {
			headers: headers("application/octet-stream"),
		});
	};
	try {
		const preview = await m.requestDesktopMediaOutcome(
			{ op: "team_bridge.owner_audit.attachment", ...tuple },
			null,
			"http://127.0.0.1:1",
			"synthetic-token",
		);
		assert.equal(
			preview.response.kind,
			"error",
			"public relay never exposes opaque bytes",
		);
		assert.equal(typeof m.requestOwnerAuditDownloadOutcome, "undefined");
		assert.equal(
			calls[0].url.pathname,
			"/v1/desktop/team-bridge/owner-audit/conversations/bcv_test/messages/bmsg_test/attachments/batt_test",
		);
		assert.equal(calls[0].url.searchParams.get("tenant_id"), scope.tenantId);
		assert.equal(
			calls[0].url.searchParams.get("expected_account_id"),
			scope.accountId,
		);
		assert.equal(calls[0].options.cache, "no-store");
		assert.equal(calls[0].options.redirect, "error");
		for (const extra of [
			{ ownerAuditDownload: true },
			{ path: "/arbitrary" },
			{ url: "https://foreign.example" },
		]) {
			const before = calls.length;
			const rejected = await m.requestDesktopMediaOutcome(
				{ op: "team_bridge.owner_audit.attachment", ...tuple, ...extra },
				null,
				"http://127.0.0.1:1",
				"synthetic-token",
			);
			assert.equal(rejected.response.kind, "error");
			assert.equal(calls.length, before);
		}
		const before = calls.length;
		assert.equal(
			(
				await m.requestDesktopMediaOutcome(
					{
						op: "team_bridge.owner_audit.attachment",
						...tuple,
						attachmentId: "../outside",
					},
					null,
					"http://127.0.0.1:1",
					"synthetic-token",
				)
			).response.kind,
			"error",
		);
		assert.equal(calls.length, before);
	} finally {
		globalThis.fetch = original;
	}
});

async function renderAudit(props) {
	const node = document.createElement("div");
	document.body.append(node);
	const root = createRoot(node);
	await act(async () =>
		root.render(React.createElement(m.AuditAttachmentGroup, props)),
	);
	await act(async () => {
		await tick();
		await tick();
	});
	return {
		node,
		update: async (next) => {
			await act(async () =>
				root.render(React.createElement(m.AuditAttachmentGroup, next)),
			);
			await act(async () => {
				await tick();
			});
		},
		close: async () => {
			await act(async () => root.unmount());
			node.remove();
			await tick();
			await tick();
		},
	};
}

test("audit cards never commission terminal/count-only/unknown or missing authority", async () => {
	const calls = [];
	window.api = {
		desktop: {
			media: async (request) => {
				calls.push(request);
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: bytes,
				};
			},
		},
	};
	for (const props of [
		{ attachments: [], count: 3, scope },
		{ attachments: [attachment], count: 1, scope: null },
		{
			attachments: ["expired", "revoked", "withheld", "unknown", ""].map(
				(state) => ({ ...attachment, id: state || "empty", state }),
			),
			count: 5,
			scope,
		},
	]) {
		const view = await renderAudit(props);
		assert.equal(calls.length, 0);
		assert.equal(view.node.querySelectorAll("img").length, 0);
		await view.close();
	}
});

test("in-flight account switch rejects old completion; audit blobs are account/authority-separated and cleaned", async () => {
	const calls = [];
	let resolveOld;
	window.api = {
		desktop: {
			media: async (request) => {
				calls.push(request);
				if (request.expectedAccountId === scope.accountId)
					return new Promise((resolve) => {
						resolveOld = resolve;
					});
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: bytes,
				};
			},
		},
	};
	const view = await renderAudit({
		attachments: [attachment],
		count: 1,
		scope,
	});
	await view.update({
		attachments: [attachment],
		count: 1,
		scope: { ...scope, accountId: "acct_other" },
	});
	await act(async () => {
		resolveOld({
			status: 200,
			kind: "bytes",
			mimeType: "image/png",
			data: bytes,
		});
		await tick();
		await tick();
	});
	assert.deepEqual(
		calls.map((request) => request.expectedAccountId),
		[scope.accountId, "acct_other"],
	);
	assert.ok(
		calls.every(
			(request) => request.op === "team_bridge.owner_audit.attachment",
		),
	);
	assert.equal(view.node.querySelectorAll("img").length, 1);
	assert.equal(urls.size, 1, "abandoned A blob is revoked");
	await view.close();
	assert.equal(urls.size, 0);
});

test("captured query scope must match the rendered tenant and conversation exactly", () => {
	const conversation = { id: scope.conversationId, tenant_id: scope.tenantId };
	const message = {
		id: scope.messageId,
		conversation_id: scope.conversationId,
	};
	assert.deepEqual(
		m.auditMessageScope(
			{ accountId: scope.accountId, tenantId: scope.tenantId },
			conversation,
			message,
		),
		{
			accountId: scope.accountId,
			tenantId: scope.tenantId,
			conversationId: scope.conversationId,
			messageId: scope.messageId,
		},
	);
	assert.equal(m.auditMessageScope(null, conversation, message), null);
	assert.equal(
		m.auditMessageScope({ ...scope, accountId: "" }, conversation, message),
		null,
	);
	assert.equal(
		m.auditMessageScope(
			{ ...scope, tenantId: "org_other" },
			conversation,
			message,
		),
		null,
	);
	assert.equal(
		m.auditMessageScope(scope, conversation, {
			...message,
			conversation_id: "bcv_other",
		}),
		null,
	);
});

test("audit in-flight dedup retains one blob until the final authorized holder leaves", async () => {
	let calls = 0;
	let release;
	window.api = {
		desktop: {
			media: async () => {
				calls++;
				return new Promise((resolve) => {
					release = resolve;
				});
			},
		},
	};
	const first = await renderAudit({
		attachments: [attachment],
		count: 1,
		scope,
	});
	const second = await renderAudit({
		attachments: [attachment],
		count: 1,
		scope,
	});
	assert.equal(calls, 1);
	await act(async () => {
		release({ status: 200, kind: "bytes", mimeType: "image/png", data: bytes });
		await tick();
		await tick();
	});
	assert.equal(urls.size, 1);
	await first.close();
	assert.equal(urls.size, 1);
	await second.close();
	assert.equal(urls.size, 0);
});

test("removed native save is absent and stale IPC/media invocations fail closed without a fetch", async () => {
	globalThis.__auditIpc = new Map();
	const frame = { url: "http://localhost/index.html" };
	const sender = { mainFrame: frame, isDestroyed: () => false };
	const owner = { webContents: sender, isDestroyed: () => false };
	let fetched = 0;
	const previous = globalThis.fetch;
	globalThis.fetch = async () => {
		fetched++;
		throw new Error("no request permitted");
	};
	try {
		m.registerDesktopIPC(
			() => owner,
			frame.url,
			async () => ({ status: 200, body: {} }),
			undefined,
			async (input, payload) =>
				(
					await m.requestDesktopMediaOutcome(
						input,
						payload,
						"http://127.0.0.1:1",
						"synthetic-token",
					)
				).response,
		);
		assert.equal(
			globalThis.__auditIpc.has("desktop-owner-audit-attachment-save"),
			false,
		);
		const invoke = async (name, ...args) => {
			const handler = globalThis.__auditIpc.get(name);
			if (!handler) throw new Error("No handler registered");
			return handler({ sender, senderFrame: frame }, ...args);
		};
		await assert.rejects(invoke("desktop-owner-audit-attachment-save", tuple));
		for (const op of [
			"team_bridge.owner_audit.save",
			"team_bridge.owner_audit.attachment.save",
			"desktop-owner-audit-attachment-save",
		]) {
			const answer = await invoke("desktop-media", { op, ...tuple }, null);
			assert.equal(answer.kind, "error");
			assert.equal(answer.status, 422);
		}
		assert.equal(fetched, 0);
		const preload = await readFile(
			join(process.cwd(), "src/preload/index.ts"),
			"utf8",
		);
		assert.equal(preload.includes("ownerAuditAttachmentSave"), false);
		assert.equal(
			preload.includes("desktop-owner-audit-attachment-save"),
			false,
		);
		assert.equal("canSaveAttachment" in m.TeamBridgeOwnerAuditApi, false);
		assert.equal("saveAttachment" in m.TeamBridgeOwnerAuditApi, false);
	} finally {
		globalThis.fetch = previous;
	}
});

test("bound generic descriptors expose only metadata, with zero byte/save calls and no dead control", async () => {
	let reads = 0;
	let saves = 0;
	window.api = {
		desktop: {
			media: async () => {
				reads++;
				throw new Error("generic file must not fetch");
			},
			ownerAuditAttachmentSave: async () => {
				saves++;
				throw new Error("removed legacy method must not run");
			},
		},
	};
	const view = await renderAudit({
		attachments: [
			"application/octet-stream",
			"application/pdf",
			"text/html",
			"image/svg+xml",
			"unknown",
		].map((mime, index) => ({
			...attachment,
			id: `batt_generic_${index}`,
			mime,
		})),
		count: 5,
		scope,
	});
	assert.equal(reads, 0);
	assert.equal(saves, 0);
	assert.equal(view.node.querySelectorAll("button").length, 0);
	assert.equal(view.node.querySelectorAll("img").length, 0);
	await view.close();
});

/*
 * #1634's rule on the inline tile (agent review round 1, minor 3): a READY
 * audit picture gets Open and nothing else - no Save, no download anchor - while
 * the member tile beside it does offer Save. Asserted on the rendered cluster,
 * not by inspection.
 */
test("ready audit image offers Open only: no Save control and no download anchor", async () => {
	window.api = {
		desktop: {
			media: async () => ({
				status: 200,
				kind: "bytes",
				mimeType: "image/png",
				data: bytes,
			}),
		},
	};
	const view = await renderAudit({
		attachments: [attachment],
		count: 1,
		scope,
	});
	assert.equal(view.node.querySelectorAll("img").length, 1);
	const cluster = view.node.querySelector("[data-attachment-actions]");
	assert.ok(cluster, "the ready tile has its hover cluster");
	assert.equal(cluster.querySelectorAll("button").length, 1, "Open only");
	assert.equal(view.node.querySelectorAll("a[download]").length, 0);
	await view.close();
});
