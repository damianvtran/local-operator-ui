import assert from "node:assert/strict";
import { createServer } from "node:http";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge image attachments: wire contract, pure model, staging hook,
 * draft persistence and message rendering - exercising the SHIPPED modules
 * (bundled with esbuild, as the sibling team-bridge tests do).
 *
 * WHAT IS MOCKED, stated so nobody reads more into a green run: the desktop
 * media relay (`window.api.desktop.media`) and the JSON transport
 * (`window.api.desktop.request`) answer from in-test fakes shaped by the
 * frozen contract; there is no hub, runtime or Electron main here, and JSDOM
 * has no canvas, so `prepareImageForUpload`'s convert/bound path is the
 * documented pass-through for already-bounded PNG/JPEG. This is DOM/state and
 * wire-contract proof, never a rendered-frame claim.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLButtonElement",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;
// JSDOM has no object URLs; the blob cache needs a create/revoke pair it can count.
let urlSeq = 0;
const liveUrls = new Set();
URL.createObjectURL = () => {
	const url = `blob:test/${++urlSeq}`;
	liveUrls.add(url);
	return url;
};
URL.revokeObjectURL = (url) => liveUrls.delete(url);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-attachments-model";
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-attachments";
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-scheduling";
 export {TeamBridgeMessageList} from "./src/renderer/src/features/team-bridge/team-bridge-message-list";
 export {TeamBridgeMarkdown} from "./src/renderer/src/features/team-bridge/team-bridge-markdown";
 export {TeamBridgeScheduledAttachments} from "./src/renderer/src/features/team-bridge/team-bridge-attachments";
 export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";
 export {teamBridgeMessageSchema, teamBridgeScheduledMessageSchema} from "./src/shared/team-bridge-contract";
 export {reconcileDraftAccount} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {requestDesktopMediaOutcome} from "./src/main/desktop-media";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-attachments-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

/* A 1x1 PNG and a 1x1 JPEG header: real magic numbers, no fixture files. */
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const SVG = new TextEncoder().encode(
	"<svg xmlns='http://www.w3.org/2000/svg'/>",
);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const HEIC = new Uint8Array([
	0,
	0,
	0,
	24,
	...new TextEncoder().encode("ftypheic"),
]);
const CAP = {
	enabled: true,
	max_count: 4,
	max_bytes: 5 * 1024 * 1024,
	max_pixels: 16_777_216,
	mime_types: ["image/png", "image/jpeg"],
};

/* ---------------------------------------------------------------- wire */

test("send/schedule DTOs carry attachment_ids only when present, and refuse empty messages", () => {
	const ok = (request) => m.desktopRequestSchema.safeParse(request).success;
	const send = {
		op: "team_bridge.messages.send",
		conversation_id: "bcv_1",
		tenant_id: "tnt_1",
		client_ref: "ref_1",
	};
	assert.equal(ok({ ...send, body: "" }), false, "empty without images");
	assert.equal(ok({ ...send, body: "  " }), false, "blank without images");
	assert.equal(ok({ ...send, body: "", attachment_ids: ["batt_a"] }), true);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["a", "b", "c", "d", "e"] }),
		false,
		"5th image",
	);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["a", "a"] }),
		false,
		"duplicate id",
	);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["../etc"] }),
		false,
		"path text",
	);
	const textOnly = m.desktopEndpoint({ ...send, body: "hi" });
	assert.equal("attachment_ids" in textOnly.body, false, "text-only unchanged");
	const withImages = m.desktopEndpoint({
		...send,
		body: "",
		attachment_ids: ["batt_a", "batt_b"],
	});
	assert.deepEqual(withImages.body.attachment_ids, ["batt_a", "batt_b"]);
	assert.equal(withImages.body.body, "");

	const create = {
		op: "team_bridge.scheduled.create",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		client_ref: "ref_1",
		send_at: "2030-01-01T12:00:00Z",
	};
	assert.equal(ok({ ...create, body: "" }), false);
	assert.deepEqual(
		m.desktopEndpoint({ ...create, body: "", attachment_ids: ["batt_a"] }).body
			.attachment_ids,
		["batt_a"],
	);
	const patch = {
		op: "team_bridge.scheduled.update",
		tenant_id: "tnt_1",
		scheduled_id: "bsm_1",
	};
	// `[]` is meaningful on PATCH (remove every image) and must reach the wire.
	assert.deepEqual(
		m.desktopEndpoint({ ...patch, attachment_ids: [] }).body.attachment_ids,
		[],
	);
	assert.equal(
		"attachment_ids" in
			m.desktopEndpoint({ ...patch, send_at: "2030-01-02T12:00:00Z" }).body,
		false,
	);
	assert.equal(
		ok({ ...patch, body: "" }),
		false,
		"PATCH to empty with no images",
	);
	const del = m.desktopEndpoint({
		op: "team_bridge.attachments.delete",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		attachment_id: "batt_a",
	});
	assert.equal(del.method, "DELETE");
	assert.equal(
		del.path,
		"/v1/desktop/team-bridge/conversations/bcv_1/attachments/batt_a?tenant_id=tnt_1",
	);
});

test("message and scheduled schemas accept additive attachment descriptors", () => {
	const message = m.teamBridgeMessageSchema.parse({
		id: "bmsg_1",
		conversation_id: "bcv_1",
		seq: 1,
		sender: { account_id: "acct_a", kind: "human", display_label: "Ana" },
		body: "",
		origin: "human",
		created_at: "2026-10-21T10:00:00Z",
		attachments: [
			{
				id: "batt_a",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				state: "bound",
				sha256: "x",
			},
		],
	});
	assert.equal(message.attachments.length, 1);
	const old = m.teamBridgeMessageSchema.parse({
		...message,
		attachments: undefined,
	});
	assert.equal(old.attachments, undefined, "old hub: no attachments field");
	const scheduled = m.teamBridgeScheduledMessageSchema.parse({
		id: "bsm_1",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		body: "",
		send_at: "2030-01-01T12:00:00Z",
		status: "scheduled",
		created_at: "2026-10-21T10:00:00Z",
		attachments: [
			{
				id: "batt_a",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				state: "reserved",
			},
		],
	});
	assert.equal(scheduled.attachments[0].state, "reserved");
});

/* --------------------------------------------------------------- model */

test("capability gate: absent, disabled or narrower blocks hide attachments", () => {
	assert.equal(m.attachmentCapability({ status: { tenants: [] } }), null);
	assert.equal(m.attachmentCapability({ status: null }), null);
	assert.equal(m.attachmentCapability(undefined), null);
	assert.equal(
		m.attachmentCapability({
			status: { attachments: { ...CAP, enabled: false } },
		}),
		null,
	);
	assert.equal(
		m.attachmentCapability({
			status: { attachments: { ...CAP, mime_types: ["image/png"] } },
		}),
		null,
	);
	const on = m.attachmentCapability({ status: { attachments: CAP } });
	assert.equal(on.max_count, 4);
	assert.equal(m.maxAttachments({ ...CAP, max_count: 9 }), 4, "never above 4");
	assert.equal(m.maxAttachments({ ...CAP, max_count: 2 }), 2);
	assert.equal(m.maxAttachments(null), 0);
});

test("sniffing reads magic bytes, never the declared type", () => {
	assert.equal(m.sniffImage(PNG), "image/png");
	assert.equal(m.sniffImage(JPEG), "image/jpeg");
	assert.equal(m.sniffImage(WEBP), "image/webp");
	assert.equal(m.sniffImage(HEIC), "image/heic");
	assert.equal(
		m.sniffImage(new TextEncoder().encode("GIF89a......")),
		"image/gif",
	);
	assert.equal(m.sniffImage(SVG), null, "SVG is never an image here");
	assert.equal(m.sniffImage(new Uint8Array()), null);
});

test("prepare: png/jpeg pass, svg is refused, convert needs a canvas (unsupported without one)", async () => {
	const png = await m.prepareImageForUpload(
		new Blob([PNG], { type: "image/webp" }),
		CAP.max_bytes,
	);
	assert.equal(png.mime, "image/png", "declared type ignored");
	assert.equal(png.bytes.byteLength, PNG.byteLength);
	await assert.rejects(
		m.prepareImageForUpload(
			new Blob([SVG], { type: "image/png" }),
			CAP.max_bytes,
		),
		(error) => error.reason === "unsupported",
	);
	// JSDOM has no createImageBitmap/OffscreenCanvas: a webp cannot be
	// converted, and the honest answer is "unsupported", never a raw upload.
	await assert.rejects(
		m.prepareImageForUpload(new Blob([WEBP]), CAP.max_bytes),
		(error) => error.reason === "unsupported",
	);
	await assert.rejects(
		m.prepareImageForUpload(new Blob([PNG]), 10),
		(error) => error.reason === "too_large",
	);
});

test("bubble state is fail-closed: only absent/bound is fetched", () => {
	const base = { id: "a", mime: "image/png", size: 1, width: 1, height: 1 };
	assert.equal(m.attachmentView(base), "fetch");
	assert.equal(m.attachmentView({ ...base, state: "bound" }), "fetch");
	assert.equal(m.attachmentView({ ...base, state: "expired" }), "expired");
	assert.equal(m.attachmentView({ ...base, state: "deleted" }), "unavailable");
	assert.equal(m.attachmentView({ ...base, state: "withheld" }), "unavailable");
	assert.equal(m.attachmentView({ ...base, state: "future" }), "unavailable");
	assert.equal(
		m.attachmentView({ ...base, mime: "image/svg+xml" }),
		"unavailable",
		"never fetch a non-picture type",
	);
});

test("upload failures map to a closed set of reasons", () => {
	assert.equal(m.uploadFailure(413), "too_large");
	assert.equal(m.uploadFailure(415), "unsupported");
	assert.equal(m.uploadFailure(422), "invalid");
	assert.equal(m.uploadFailure(429), "rate_limited");
	assert.equal(m.uploadFailure(400), "limit");
	assert.equal(m.uploadFailure(404), "expired");
	assert.equal(m.uploadFailure(null), "offline");
	assert.equal(m.uploadFailure(500), "failed");
	assert.equal(
		m.isAttachmentNotFound({ status: 404, code: "attachment_not_found" }),
		true,
	);
	assert.equal(
		m.isAttachmentNotFound({ status: 404, code: "conversation_not_found" }),
		false,
	);
});

test("scheduled edit patch sends the whole image set only when it changed", () => {
	const message = {
		body: "x",
		send_at: "2030-01-01T12:00:00Z",
		attachments: [{ id: "a" }, { id: "b" }],
	};
	assert.deepEqual(
		m.scheduledEditPatch(message, message.send_at, "x", ["a", "b"]),
		{},
	);
	assert.deepEqual(m.scheduledEditPatch(message, message.send_at, "x", []), {
		attachment_ids: [],
	});
	assert.deepEqual(
		m.scheduledEditPatch(message, message.send_at, "x", undefined),
		{},
	);
});

test("first-send scheduling stages held images into the new conversation BEFORE the POST", async () => {
	const calls = [];
	await m.scheduleTeamBridgeDraft({
		tenantId: "tnt_1",
		recipients: [{ kind: "human", accountId: "acct_b", label: "Bea" }],
		body: "",
		clientRef: "ref_1",
		sendAt: "2030-01-01T12:00:00Z",
		remembered: new Map(),
		onCreated: (id) => calls.push(`created:${id}`),
		create: async () => ({ id: "bcv_new", tenant_id: "tnt_1" }),
		stageHeld: async (id, tenant) => {
			calls.push(`stage:${id}:${tenant}`);
			return ["batt_x"];
		},
		schedule: async (input) => {
			calls.push(
				`schedule:${input.attachment_ids.join(",")}:${JSON.stringify(input.body)}`,
			);
		},
	});
	assert.deepEqual(calls, [
		"created:bcv_new",
		"stage:bcv_new:tnt_1",
		'schedule:batt_x:""',
	]);
	// A failed stage throws: nothing is scheduled text-only, the group id is remembered.
	const remembered = new Map();
	let scheduled = false;
	await assert.rejects(
		m.scheduleTeamBridgeDraft({
			tenantId: "tnt_1",
			recipients: [
				{ kind: "human", accountId: "acct_b", label: "Bea" },
				{ kind: "human", accountId: "acct_c", label: "Cy" },
			],
			body: "with images",
			clientRef: "ref_2",
			sendAt: "2030-01-01T12:00:00Z",
			remembered,
			onCreated: () => {},
			create: async () => ({ id: "bcv_group", tenant_id: "tnt_1" }),
			stageHeld: async () => {
				throw new Error("attachments not staged");
			},
			schedule: async () => {
				scheduled = true;
			},
		}),
	);
	assert.equal(scheduled, false);
	assert.equal(
		[...remembered.values()][0].id,
		"bcv_group",
		"retry reuses the group",
	);
});

/* ---------------------------------------------------- relay fakes + hook */

let mediaCalls = [];
let requestCalls = [];
let mediaAnswer = () => ({ status: 404, kind: "error", detail: "no" });
window.api = {
	desktop: {
		media: async (request, bytes) => {
			mediaCalls.push({ request, size: bytes?.byteLength ?? 0 });
			return mediaAnswer(request, bytes);
		},
		request: async (request) => {
			requestCalls.push(request);
			return { status: 204, body: null };
		},
	},
};

let hook;
function HookProbe(props) {
	hook = m.useTeamBridgeAttachments(props);
	return null;
}
async function mountHook(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const render = async (next) =>
		act(async () => root.render(React.createElement(HookProbe, next)));
	await render(props);
	return {
		render,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}
const settle = () =>
	act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const staged = (id) => ({
	status: 201,
	kind: "json",
	body: {
		attachment: {
			id,
			mime: "image/png",
			size: PNG.byteLength,
			width: 1,
			height: 1,
			state: "staged",
			expires_at: "2099-01-01T00:00:00Z",
		},
	},
});

test("hook: upload into an existing conversation, max 4, retry after failure, remove deletes", async () => {
	mediaCalls = [];
	requestCalls = [];
	let n = 0;
	let failNext = true;
	mediaAnswer = (request) => {
		if (request.op !== "team_bridge.attachment.upload")
			return { status: 404, kind: "error" };
		if (failNext) {
			failNext = false;
			return { status: 503, kind: "error", detail: "x" };
		}
		return staged(`batt_${++n}`);
	};
	const persisted = [];
	const app = await mountHook({
		scopeKey: "a",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: CAP,
		onPersist: (next) => persisted.push(next.map((row) => row.id)),
	});
	await act(async () => hook.add([1, 2, 3, 4, 5].map(() => new Blob([PNG]))));
	assert.equal(hook.notice, "limit", "5th image is refused with a note");
	await settle();
	await settle();
	assert.equal(hook.count, 4);
	const statuses = hook.chips.map((chip) => chip.status).sort();
	assert.deepEqual(statuses, ["error", "ready", "ready", "ready"]);
	assert.equal(hook.blocked, true, "a failed chip blocks send");
	const failed = hook.chips.find((chip) => chip.status === "error");
	assert.equal(failed.reason, "offline");
	await act(async () => hook.retry(failed.key));
	await settle();
	assert.equal(
		hook.chips.every((chip) => chip.status === "ready"),
		true,
	);
	assert.equal(hook.readyIds().length, 4);
	// Every upload went through the media relay with the conversation's tenant,
	// a raw body, and no filename or declared type anywhere in the request.
	for (const call of mediaCalls) {
		assert.deepEqual(Object.keys(call.request).sort(), [
			"conversationId",
			"op",
			"tenantId",
		]);
		assert.equal(call.request.tenantId, "tnt_1");
	}
	// Drafts persisted descriptors (ids), never bytes.
	assert.equal(persisted.at(-1).length, 4);
	const victim = hook.chips[0];
	await act(async () => hook.remove(victim.key));
	assert.equal(hook.count, 3);
	assert.equal(requestCalls.at(-1).op, "team_bridge.attachments.delete");
	assert.equal(requestCalls.at(-1).attachment_id, victim.attachment.id);
	await act(async () => hook.markExpired());
	assert.equal(
		hook.chips.every((chip) => chip.status === "expired"),
		true,
	);
	assert.equal(hook.readyIds().length, 0, "expired ids are never sent");
	await app.close();
});

test("hook: a draft with no conversation HOLDS images and stages them on first send", async () => {
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_h${++n}`);
	const app = await mountHook({
		scopeKey: "compose",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: null,
		capability: CAP,
	});
	await act(async () => hook.add([new Blob([PNG]), new Blob([JPEG])]));
	await settle();
	assert.deepEqual(
		hook.chips.map((chip) => chip.status),
		["held", "held"],
	);
	assert.equal(
		mediaCalls.length,
		0,
		"pasting creates nothing and uploads nothing",
	);
	let ids;
	await act(async () => {
		ids = await hook.uploadHeld("bcv_new", "tnt_1");
	});
	assert.deepEqual(ids, ["batt_h1", "batt_h2"]);
	assert.deepEqual(
		mediaCalls.map((call) => call.request.conversationId),
		["bcv_new", "bcv_new"],
	);
	await app.close();
});

test("hook: no capability shows the unsupported note and stages nothing", async () => {
	mediaCalls = [];
	const app = await mountHook({
		scopeKey: "x",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: null,
	});
	assert.equal(hook.enabled, false);
	await act(async () => hook.add([new Blob([PNG])]));
	assert.equal(hook.notice, "unsupported");
	assert.equal(hook.count, 0);
	assert.equal(mediaCalls.length, 0);
	await app.close();
});

/* --------------------------------------------------------------- drafts */

let drafts;
function DraftProbe(props) {
	drafts = m.useTeamBridgeDrafts(
		props.account ?? "acct_a",
		"tnt_1",
		props.target,
		"",
		props.signedOut,
	);
	return null;
}

test("drafts persist descriptors only, restore them, and the logout fence clears them", async () => {
	localStorage.clear();
	const target = { type: "conversation", id: "bcv_1" };
	const element = document.createElement("div");
	const root = createRoot(element);
	await act(async () =>
		root.render(React.createElement(DraftProbe, { target })),
	);
	const before = drafts.current?.clientRef;
	await act(async () =>
		drafts.setAttachments([
			{
				id: "batt_a",
				conversationId: "bcv_1",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				expiresAt: "2099-01-01T00:00:00Z",
			},
		]),
	);
	assert.notEqual(
		drafts.current.clientRef,
		before,
		"a new image set is a new idempotency key",
	);
	const raw = Object.entries(localStorage).find(([key]) =>
		key.startsWith("team-bridge-authored-drafts:v1:"),
	)[1];
	assert.match(raw, /batt_a/);
	assert.doesNotMatch(raw, /base64|data:|iVBOR/, "no image bytes in storage");
	// A tampered entry carrying bytes is dropped on read, never restored.
	const key = Object.keys(localStorage).find((k) =>
		k.startsWith("team-bridge-authored-drafts:v1:"),
	);
	const parsed = JSON.parse(raw);
	parsed["conversation:bcv_1"].attachments[0].data = "iVBORw0K";
	assert.deepEqual(
		m.readDrafts({ getItem: () => JSON.stringify(parsed) }, key),
		{},
	);
	// Sent ids leave the draft; a body-less, image-less draft is removed.
	await act(async () =>
		drafts.clearSent("conversation:bcv_1", "", drafts.current.clientRef, [
			"batt_a",
		]),
	);
	assert.equal(drafts.current, undefined);
	await act(async () =>
		drafts.setAttachments([
			{
				id: "batt_b",
				conversationId: "bcv_1",
				mime: "image/png",
				size: 1,
				width: 1,
				height: 1,
			},
		]),
	);
	m.rememberUploadPreview(
		"acct_a",
		"batt_b",
		new Blob([PNG], { type: "image/png" }),
	);
	assert.ok(m.uploadPreview("acct_a", "batt_b"));
	assert.equal(
		m.uploadPreview("acct_other", "batt_b"),
		null,
		"previews are account-scoped",
	);
	m.reconcileDraftAccount(localStorage, {
		state: "signed_out",
		account_id: null,
	});
	assert.equal(
		Object.keys(localStorage).some((k) =>
			k.startsWith("team-bridge-authored-drafts:v1:"),
		),
		false,
	);
	assert.equal(
		m.uploadPreview("acct_a", "batt_b"),
		null,
		"fence drops in-memory previews too",
	);
	assert.equal(m.isStagedExpired({ expiresAt: "2000-01-01T00:00:00Z" }), true);
	await act(async () => root.unmount());
});

/* -------------------------------------------------------------- render */

const message = (overrides) => ({
	id: "bmsg_1",
	conversation_id: "bcv_1",
	seq: 1,
	sender: { account_id: "acct_b", kind: "human", display_label: "Bea" },
	body: "",
	origin: "human",
	created_at: "2026-10-21T10:00:00Z",
	...overrides,
});

async function renderList(messages, tenantId = "tnt_1") {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	await act(async () =>
		root.render(
			React.createElement(m.TeamBridgeMessageList, {
				messages,
				labelFor: (sender) => sender.display_label,
				tenantId,
			}),
		),
	);
	await settle();
	await settle();
	return {
		element,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}

test("bubble: images render ONLY from attachments[], fetched member-gated; placeholders never fetch", async () => {
	mediaCalls = [];
	mediaAnswer = (request) =>
		request.op === "team_bridge.attachment"
			? request.attachmentId === "batt_fail"
				? { status: 404, kind: "error", detail: "x" }
				: { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
			: { status: 404, kind: "error" };
	const base = { mime: "image/png", size: 10, width: 4, height: 3 };
	const view = await renderList([
		message({
			body: "",
			attachments: [
				{ id: "batt_ok", ...base, state: "bound" },
				{ id: "batt_exp", ...base, state: "expired" },
				{ id: "batt_del", ...base, state: "deleted" },
				{ id: "batt_fail", ...base },
			],
		}),
	]);
	const fetched = mediaCalls.map((call) => call.request.attachmentId).sort();
	assert.deepEqual(
		fetched,
		["batt_fail", "batt_ok"],
		"expired/deleted are never requested",
	);
	for (const call of mediaCalls) {
		assert.equal(call.request.op, "team_bridge.attachment");
		assert.equal(call.request.tenantId, "tnt_1");
		assert.equal(call.request.messageId, "bmsg_1");
	}
	const imgs = [...view.element.querySelectorAll("img")];
	assert.equal(imgs.length, 1);
	assert.match(imgs[0].getAttribute("src"), /^blob:test\//);
	const placeholders = [
		...view.element.querySelectorAll("[data-attachment-placeholder]"),
	].map((node) => node.getAttribute("data-attachment-placeholder"));
	assert.deepEqual(placeholders.sort(), ["expired", "failed", "unavailable"]);
	assert.equal(
		view.element.querySelector(".team-bridge-message-body"),
		null,
		"image-only message draws no empty prose block",
	);
	assert.doesNotMatch(
		view.element.textContent,
		/batt_/,
		"ids never reach the screen",
	);
	await view.close();
	await settle();
	assert.equal(liveUrls.size, 0, "blob URLs are revoked on unmount");
});

test("markdown images in a body stay alt text and fetch nothing", async () => {
	mediaCalls = [];
	const view = await renderList([
		message({
			body: "look ![shot](http://localhost:1111/v1/secret) and ![](https://evil.example/p.png)",
		}),
	]);
	assert.equal(view.element.querySelectorAll("img").length, 0);
	assert.match(view.element.textContent, /shot/);
	assert.match(view.element.textContent, /https:\/\/evil\.example\/p\.png/);
	assert.equal(mediaCalls.length, 0);
	await view.close();
});

test("scheduled images: descriptor tile, or this account's own in-memory preview; never a fetch", async () => {
	mediaCalls = [];
	m.rememberUploadPreview(
		"acct_a",
		"batt_s1",
		new Blob([PNG], { type: "image/png" }),
	);
	const element = document.createElement("div");
	const root = createRoot(element);
	await act(async () =>
		root.render(
			React.createElement(m.TeamBridgeScheduledAttachments, {
				accountId: "acct_a",
				attachments: [
					{
						id: "batt_s1",
						mime: "image/png",
						size: 1,
						width: 1,
						height: 1,
						state: "reserved",
					},
					{
						id: "batt_s2",
						mime: "image/png",
						size: 1,
						width: 1,
						height: 1,
						state: "reserved",
					},
				],
			}),
		),
	);
	const tiles = [
		...element.querySelectorAll("[data-attachment-scheduled]"),
	].map((node) => node.getAttribute("data-attachment-scheduled"));
	assert.deepEqual(tiles, ["preview", "descriptor"]);
	assert.equal(mediaCalls.length, 0);
	await act(async () => root.unmount());
});

/*
 * MAIN'S RELAY, over real loopback HTTP: the bearer is attached here (never by
 * the renderer), ids are shape-checked before a path is built, the upload is a
 * raw octet-stream with no filename/type, the 5 MiB ceiling refuses before
 * sending, and a picture route answering anything but png/jpeg (SVG is
 * script-capable) never reaches the renderer as bytes.
 */
test("main relay: upload/fetch paths, bearer, id validation, type and size refusal", async () => {
	const seen = [];
	let answer = { status: 201, type: "application/json", body: "{}" };
	const server = createServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			seen.push({
				method: req.method,
				url: req.url,
				auth: req.headers.authorization === "Bearer t0k",
				type: req.headers["content-type"],
				bytes: Buffer.concat(chunks).length,
			});
			res.writeHead(answer.status, { "content-type": answer.type });
			res.end(answer.body);
		});
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		answer = {
			status: 201,
			type: "application/json",
			body: JSON.stringify({ attachment: { id: "batt_1" } }),
		};
		const up = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
			},
			new Uint8Array(PNG),
			base,
			"t0k",
		);
		assert.equal(up.response.kind, "json");
		assert.deepEqual(seen.at(-1), {
			method: "POST",
			url: "/v1/desktop/team-bridge/conversations/bcv_1/attachments?tenant_id=tnt_1",
			auth: true,
			type: "application/octet-stream",
			bytes: PNG.length,
		});

		answer = { status: 200, type: "image/png", body: Buffer.from(PNG) };
		const got = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(got.response.kind, "bytes");
		assert.equal(
			seen.at(-1).url,
			"/v1/desktop/team-bridge/conversations/bcv_1/messages/bmsg_1/attachments/batt_1?tenant_id=tnt_1",
		);
		assert.equal(seen.at(-1).method, "GET");

		answer = { status: 200, type: "image/svg+xml", body: "<svg/>" };
		const svg = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(
			svg.response.kind,
			"error",
			"non-png/jpeg answer is refused in main",
		);
		assert.equal(svg.response.status, 502);

		answer = {
			status: 404,
			type: "application/json",
			body: JSON.stringify({ detail: "attachment_not_found" }),
		};
		const gone = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				messageId: "bmsg_1",
				attachmentId: "batt_other",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(gone.response.kind, "error");
		assert.equal(gone.response.status, 404);

		const before = seen.length;
		const traversal = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "../../v1/admin",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(traversal.response.status, 422);
		assert.equal(traversal.answered, false);
		const huge = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
			},
			new Uint8Array(5 * 1024 * 1024 + 1),
			base,
			"t0k",
		);
		assert.equal(huge.response.status, 413);
		assert.equal(huge.answered, false);
		const empty = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(empty.response.status, 422);
		const noToken = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
			},
			new Uint8Array(PNG),
			base,
			null,
		);
		assert.equal(noToken.response.status, 503);
		assert.equal(seen.length, before, "refused requests never left main");
	} finally {
		await new Promise((done) => server.close(done));
	}
});
