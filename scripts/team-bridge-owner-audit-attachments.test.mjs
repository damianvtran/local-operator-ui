import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import Module from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

/* Real shipped modules, synthetic HTTP/media/dialog boundaries. These tests
 * prove confinement and filesystem side effects, NOT deployed hub authority,
 * native dialog/pixels or a live owner/tenant probe. No Electron is launched. */
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
 export { readOwnerAuditAttachment } from './src/main/team-bridge-audit-media';
 export { saveOwnerAuditAttachment } from './src/main/team-bridge-audit-save';
 export { writeAuditAttachmentAtomically } from './src/main/team-bridge-audit-save-file';
 export { requestDesktopMediaOutcome, requestOwnerAuditDownloadOutcome } from './src/main/desktop-media';
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
const baseDir =
	process.env.LOCAL_OPERATOR_SCRATCHPAD ??
	process.env.RUNNER_TEMP ??
	join(homedir(), ".cache", "local-operator-ui-tests");
await mkdir(baseDir, { recursive: true });
const dir = await mkdtemp(join(baseDir, "audit-attachments-"));
after(async () => {
	await rm(dir, { recursive: true, force: true });
	dom.window.close();
});
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
		"download",
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

test("bounded consumer: PNG/JPEG only for preview; octet-stream only for private native download", async () => {
	for (const mime of [
		"image/png",
		"image/jpeg",
		"application/octet-stream",
		"image/svg+xml",
		"text/html",
		"application/pdf",
	]) {
		for (const download of [false, true]) {
			const response = await m.readOwnerAuditAttachment(
				new Response(bytes, { headers: headers(mime) }),
				download,
			);
			assert.equal(
				response.kind,
				(
					download
						? mime === "application/octet-stream"
						: mime === "image/png" || mime === "image/jpeg"
				)
					? "bytes"
					: "error",
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
			(
				await m.readOwnerAuditAttachment(
					new Response(bytes, { headers: h }),
					false,
				)
			).kind,
			"error",
		);
	}
	for (const status of [401, 403, 404, 409, 410, 503]) {
		const response = await m.readOwnerAuditAttachment(
			new Response("private refusal reason", { status }),
			false,
		);
		assert.equal(response.kind, "error");
		assert.equal(response.status, status);
		assert.equal(response.detail.includes("private refusal reason"), false);
	}
});

test("stream cap applies before exposing bytes, independent of absent/false length headers", async () => {
	for (const download of [false, true]) {
		let cancelled = false;
		const cap = (download ? 25 : 5) * 1024 * 1024;
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(cap));
				controller.enqueue(bytes);
			},
			cancel() {
				cancelled = true;
			},
		});
		const answer = await m.readOwnerAuditAttachment(
			new Response(body, {
				headers: headers(download ? "application/octet-stream" : "image/png"),
			}),
			download,
		);
		assert.equal(answer.kind, "error");
		assert.equal(answer.status, 413);
		assert.equal(cancelled, true);
	}
	const h = { ...headers(), "content-length": String(5 * 1024 * 1024 + 1) };
	assert.equal(
		(
			await m.readOwnerAuditAttachment(
				new Response(bytes, { headers: h }),
				false,
			)
		).status,
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
		const opaque = await m.requestOwnerAuditDownloadOutcome(
			tuple,
			"http://127.0.0.1:1",
			"synthetic-token",
		);
		assert.equal(opaque.response.kind, "bytes");
		assert.equal(
			calls[1].url.pathname,
			"/v1/desktop/team-bridge/owner-audit/conversations/bcv_test/messages/bmsg_test/attachments/batt_test",
		);
		assert.equal(calls[1].url.searchParams.get("tenant_id"), scope.tenantId);
		assert.equal(
			calls[1].url.searchParams.get("expected_account_id"),
			scope.accountId,
		);
		assert.equal(calls[1].options.cache, "no-store");
		assert.equal(calls[1].options.redirect, "error");
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
				await m.requestOwnerAuditDownloadOutcome(
					{ ...tuple, attachmentId: "../outside" },
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

test("native save: cancel/denial/wrong owner/window teardown produce no file or renderer bytes/path", async () => {
	let account = scope.accountId;
	let live = true;
	let downloads = 0;
	const target = join(dir, "attachment.bin");
	const deps = {
		choose: async () => target,
		download: async () => {
			downloads++;
			return {
				status: 200,
				kind: "bytes",
				mimeType: "application/octet-stream",
				data: bytes,
			};
		},
		currentAccount: async () => account,
		live: () => live,
		write: m.writeAuditAttachmentAtomically,
	};
	let result = await m.saveOwnerAuditAttachment(tuple, {
		...deps,
		choose: async () => null,
	});
	assert.equal(result.body.cancelled, true);
	assert.equal(downloads, 0);
	result = await m.saveOwnerAuditAttachment(tuple, {
		...deps,
		download: async () => ({
			status: 403,
			kind: "error",
			detail: "Unavailable",
		}),
	});
	assert.equal(result.kind, "error");
	assert.deepEqual(await readdir(dir), []);
	account = "acct_other";
	assert.equal((await m.saveOwnerAuditAttachment(tuple, deps)).status, 409);
	assert.deepEqual(await readdir(dir), []);
	account = scope.accountId;
	live = false;
	assert.equal((await m.saveOwnerAuditAttachment(tuple, deps)).kind, "error");
	assert.deepEqual(await readdir(dir), []);
	live = true;
	result = await m.saveOwnerAuditAttachment(tuple, deps);
	assert.deepEqual(result.body, { saved: true, cancelled: false });
	assert.deepEqual(new Uint8Array(await readFile(target)), bytes);
	assert.equal((await stat(target)).mode & 0o777, 0o600);
	assert.equal(JSON.stringify(result).includes(target), false);
	assert.equal("data" in result, false);
	await rm(target);
});

test("atomic save rechecks owner at commit and preserves existing file on stale/failure", async () => {
	const target = join(dir, "existing.bin");
	await writeFile(target, "original");
	await assert.rejects(
		m.writeAuditAttachmentAtomically(target, bytes, async () => false),
	);
	assert.equal(await readFile(target, "utf8"), "original");
	assert.deepEqual(await readdir(dir), ["existing.bin"]);
	let account = scope.accountId;
	const result = await m.saveOwnerAuditAttachment(tuple, {
		choose: async () => target,
		download: async () => ({
			status: 200,
			kind: "bytes",
			mimeType: "application/octet-stream",
			data: bytes,
		}),
		currentAccount: async () => account,
		live: () => true,
		write: async (path, data, canCommit) => {
			account = "acct_other";
			await m.writeAuditAttachmentAtomically(path, data, canCommit);
		},
	});
	assert.equal(result.status, 409);
	assert.equal(await readFile(target, "utf8"), "original");
	assert.deepEqual(await readdir(dir), ["existing.bin"]);
	await rm(target);
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

test("save has no web/media fallback and renderer receives only native saved/cancelled outcomes", async () => {
	let calls = 0;
	window.api = {
		desktop: {
			media: async () => {
				calls++;
				throw new Error("not allowed");
			},
		},
	};
	await assert.rejects(m.TeamBridgeOwnerAuditApi.saveAttachment(scope));
	assert.equal(calls, 0);
	window.api.desktop.ownerAuditAttachmentSave = async (request) => {
		assert.deepEqual(request, tuple);
		return {
			status: 200,
			kind: "json",
			body: { saved: false, cancelled: true },
		};
	};
	assert.equal(await m.TeamBridgeOwnerAuditApi.saveAttachment(scope), false);
	assert.equal(calls, 0);
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

test("native save input cannot carry a renderer path or URL, even before the chooser", async () => {
	let chosen = 0;
	const deps = {
		choose: async () => {
			chosen++;
			return join(dir, "never.bin");
		},
		download: async () => {
			throw new Error("must not fetch");
		},
		currentAccount: async () => scope.accountId,
		live: () => true,
		write: m.writeAuditAttachmentAtomically,
	};
	for (const extra of [
		{ path: "outside.bin" },
		{ url: "https://untrusted.invalid" },
		{ fileName: "private-name.pdf" },
	]) {
		const answer = await m.saveOwnerAuditAttachment(
			{ ...tuple, ...extra },
			deps,
		);
		assert.equal(answer.status, 422);
	}
	assert.equal(chosen, 0);
	assert.deepEqual(await readdir(dir), []);
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
