import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const NAMED_COMMAND = /lop network update lop-remote-node-2/;
const ANY_COMMAND = /lop network update/;
const FALLBACK_NAME = /Update the other device/;

/*
 * Remote files parity, UI half (core docs/design/remote-files-parity.md §3).
 *
 * REAL: `canonical/remote-files.ts` (the action table and the row mapping),
 * `canonical/remote-file-transfer.tsx` (content/download doors, landed paths),
 * `components/remote-file-actions-menu.tsx` (`performRemoteAction`, the one
 * dispatcher the menu calls), and the real English catalogue through `t()`.
 *
 * SUBSTITUTED: the desktop transport (`desktopRequest`/`desktopMedia`, recorded
 * and answered by the test), the toast channel (recorded), the UI primitives
 * the menu module imports but this file never renders, and `window.api`'s
 * openFile/showItemInFolder/readFileBytes (spies). The spies are the point of
 * I3-1: a remote row's owner path must never reach any of them.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "remote-files");

const stubs = {
	"@shared/api/local-operator/desktop-api": `
		export const desktopRequest = (r) => globalThis.__remote.request(r);
		export const desktopMedia = (r) => globalThis.__remote.media(r);`,
	"@shared/utils/toast-manager": `
		const note = (kind) => (message, options) => { globalThis.__remote.toasts.push({ kind, message, options }); return 1; };
		export const showErrorToast = note("error");
		export const showInfoToast = note("info");
		export const showSuccessToast = note("success");
		export const showLoadingToast = note("loading");
		export const dismissToast = () => {};`,
	"@shared/components/ui": `
		const C = () => null;
		export const Button = C, DropdownMenu = C, DropdownMenuContent = C,
			DropdownMenuItem = C, DropdownMenuLabel = C, DropdownMenuTrigger = C,
			Tooltip = C;`,
	"@shared/i18n/use-locale": "export const useI18nLocale = () => 'en';",
	"@shared/lib/external-open-refusal":
		"export const showExternalOpenRefusal = () => {};",
};

const bundle = await build({
	stdin: {
		contents: `
			export { remoteOf, remoteFileActions, remoteUnreadableText, remoteMenuReason, revealableCwd, remoteUnsupportedSentence, REMOTE_PREVIEW_MAX_BYTES } from "./src/renderer/src/features/chat/canonical/remote-files";
			export { downloadRemoteFile, fetchRemoteFileBlob, landedPathFor, rememberLanded, remoteCanvasDocument, RemoteFetchPendingError } from "./src/renderer/src/features/chat/canonical/remote-file-transfer";
			export { performRemoteAction } from "./src/renderer/src/features/chat/components/remote-file-actions-menu";
			export { indexedDocument } from "./src/renderer/src/features/chat/canonical/session-files";
			export { AttachmentOwnerUnreachableError } from "./src/renderer/src/features/chat/canonical/use-attachment-url";
		`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	plugins: [
		{
			name: "remote-files-edges",
			setup(builder) {
				// Stubbed edges only; every other `@shared/…` resolves through the
				// alias to the real module (undefined = esbuild's own resolution).
				builder.onResolve({ filter: /^@shared\// }, (args) =>
					stubs[args.path] !== undefined
						? { path: args.path, namespace: "stub" }
						: undefined,
				);
				builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
					contents: stubs[path],
					loader: "js",
				}));
			},
		},
	],
	write: false,
});

mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "remote-files.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	remoteOf,
	remoteFileActions,
	remoteUnreadableText,
	remoteMenuReason,
	revealableCwd,
	remoteUnsupportedSentence,
	REMOTE_PREVIEW_MAX_BYTES,
	remoteCanvasDocument,
	downloadRemoteFile,
	fetchRemoteFileBlob,
	landedPathFor,
	performRemoteAction,
	indexedDocument,
	AttachmentOwnerUnreachableError,
	RemoteFetchPendingError,
} = await import(pathToFileURL(bundlePath).href);

// ------------------------------------------------------------- the rig

const OWNER_PATH = "~/.local-operator/sessions/abc/scratchpad/chart.png";
const ISOLATES = /[\u2066-\u2069]/g;
/*
 * A toast's text, whether it is a string or a React node: the loading toast
 * keeps the device name in a nowrap run (design round 2, D2-3), so its message
 * is a fragment of strings and one span.
 */
const textOf = (node) =>
	node === null || node === undefined || typeof node === "boolean"
		? ""
		: typeof node === "string" || typeof node === "number"
			? String(node)
			: Array.isArray(node)
				? node.map(textOf).join("")
				: textOf(node.props?.children);
const plain = (text) => textOf(text).replace(ISOLATES, "");

const calls = { open: [], reveal: [], read: [], clipboard: [] };
globalThis.window = {
	api: {
		openFile: async (path) => {
			calls.open.push(path);
			return { ok: true };
		},
		showItemInFolder: async (path) => {
			calls.reveal.push(path);
			return { ok: true };
		},
		readFileBytes: async (path) => {
			calls.read.push(path);
			return { success: false };
		},
	},
};
Object.defineProperty(globalThis, "navigator", {
	value: {
		clipboard: {
			writeText: async (text) => {
				calls.clipboard.push(text);
			},
			write: async () => {},
		},
	},
	configurable: true,
});
globalThis.ClipboardItem = class {};
globalThis.document = {
	createElement: () => ({ click() {} }),
	body: { appendChild() {}, removeChild() {} },
};
const objectUrls = { created: 0 };
globalThis.URL.createObjectURL = () => {
	objectUrls.created += 1;
	return "blob:test/1";
};
globalThis.URL.revokeObjectURL = () => {};

const remoteState = { request: null, media: null, toasts: [] };
globalThis.__remote = remoteState;
function resetCalls() {
	for (const key of Object.keys(calls)) calls[key].length = 0;
	remoteState.toasts.length = 0;
	remoteState.requests = [];
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return { status: 500, body: null };
	};
	remoteState.media = async (request) => {
		remoteState.requests.push(request);
		return {
			kind: "bytes",
			status: 200,
			mimeType: "image/png",
			data: new Uint8Array([137, 80, 78, 71]),
		};
	};
}

let nextFileId = 0;
const row = (overrides = {}) => ({
	id: (nextFileId++).toString(16).padStart(16, "0"),
	ref: { type: "path", path: OWNER_PATH },
	name: "chart.png",
	kind: "image",
	size_bytes: 1024,
	created_at: 1,
	modified_at: 1,
	origin: "write",
	highlighted: false,
	highlight_why: null,
	first_seq: 1,
	last_seq: 1,
	first_ts: 1,
	last_ts: 1,
	exists: true,
	session: { id: "aaaaaaaaaaaa", role: "self", child_id: null, label: null },
	remote: true,
	origin_device: { id: "dev2", name: "lop-remote-node-2" },
	remote_read: { kind: "path" },
	remote_unreadable: null,
	...overrides,
});

const PATH_ACTIONS = new Set(["open-file", "open-folder", "copy-file-path"]);
const REASONS = [
	"outside_session_files",
	"missing",
	"too_large",
	"sensitive",
	"not_referenced",
];

// ------------------------------------------------------------- the rows

test("a local row has no remote facts; a remote row carries the viewer-stamped device", () => {
	assert.equal(remoteOf(row({ remote: undefined }), "aaaaaaaaaaaa"), null);
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	assert.equal(remote.deviceName, "lop-remote-node-2");
	assert.equal(remote.readKind, "path");
	assert.equal(remote.unreadable, null);
	assert.equal(remote.ownerPath, OWNER_PATH);
	assert.equal(remote.sessionId, "aaaaaaaaaaaa");
});

test("a remote row with no read verdict is unreadable, never guessed readable", () => {
	const remote = remoteOf(
		row({ remote_read: null, remote_unreadable: null }),
		"aaaaaaaaaaaa",
	);
	assert.equal(remote.unreadable, "outside_session_files");
});

test("indexedDocument keeps the remote row on the same classification path, without a local path identity", () => {
	const local = indexedDocument(row({ remote: undefined }), "aaaaaaaaaaaa");
	const remote = indexedDocument(row(), "aaaaaaaaaaaa");
	assert.equal(remote.type, local.type, "same kind → same sticky section");
	assert.equal(remote.title, local.title);
	assert.ok(remote.id.startsWith("remote:"), "id is the owner's row id");
	assert.ok(remote.remote, "carries its remote facts");
	assert.equal(local.remote, undefined);
});

// ------------------------------------------------------------- §3 table

test("readable, not yet downloaded: preview, Download, Copy path on <device>, Save as, Copy image — no local path actions", () => {
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const actions = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: true,
		landedPath: null,
	});
	assert.deepEqual(
		actions.map((action) => action.id),
		[
			"show-in-canvas",
			"expand-image",
			"download",
			"copy-owner-path",
			"save-as",
			"copy-image",
		],
	);
	assert.ok(actions.every((action) => action.disabledReason === null));
	const download = actions.find((action) => action.id === "download");
	assert.equal(plain(download.label), "Download to this device");
	const copy = actions.find((action) => action.id === "copy-owner-path");
	assert.equal(plain(copy.label), "Copy path on lop-remote-node-2");
	assert.equal(copy.target, OWNER_PATH, "copied as text, labelled as theirs");
});

test("readable, downloaded: Open file / Open folder / Copy file path act on the LANDED path", () => {
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const landed = "/home/me/Downloads/chart.png";
	const actions = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: false,
		landedPath: landed,
	});
	const ids = actions.map((action) => action.id);
	assert.ok(!ids.includes("download"), "no second download offer");
	assert.ok(!ids.includes("copy-owner-path"), "the local copy's path wins");
	for (const id of PATH_ACTIONS)
		assert.equal(actions.find((action) => action.id === id).target, landed);
});

test("readable over 32 MiB: Download stays, Save as and Copy image are hidden", () => {
	const remote = remoteOf(
		row({ size_bytes: REMOTE_PREVIEW_MAX_BYTES + 1 }),
		"aaaaaaaaaaaa",
	);
	const actions = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: false,
		landedPath: null,
	});
	const ids = actions.map((action) => action.id);
	assert.ok(ids.includes("download"));
	assert.ok(!ids.includes("save-as"));
	assert.ok(!ids.includes("copy-image"));
	// R1-4: an open can only fail above the relay's ceiling, so it says why.
	const show = actions.find((action) => action.id === "show-in-canvas");
	assert.equal(
		plain(show.disabledReason),
		"Too large to open from lop-remote-node-2. Download it to this device instead.",
	);
	assert.equal(
		actions.find((action) => action.id === "download").disabledReason,
		null,
		"Download stays offered",
	);
});

test("unreadable rows: the readable row's entries, transfers disabled, the reason said once (D1-4)", () => {
	for (const reason of REASONS) {
		const remote = remoteOf(
			row({ remote_read: null, remote_unreadable: reason }),
			"aaaaaaaaaaaa",
		);
		const actions = remoteFileActions(remote, {
			mediaKind: "image",
			canShowInCanvas: true,
			canExpand: true,
			landedPath: null,
		});
		const sentence = remoteUnreadableText(remote);
		assert.ok(plain(sentence).includes("lop-remote-node-2"), reason);
		assert.equal(remoteMenuReason(remote), sentence, `${reason}: menu header`);
		assert.deepEqual(
			actions.map((action) => action.id),
			["show-in-canvas", "download", "copy-owner-path", "save-as"],
			`${reason}: same shape as a readable row`,
		);
		for (const id of ["show-in-canvas", "download", "save-as"]) {
			const action = actions.find((entry) => entry.id === id);
			assert.equal(action.disabledReason, sentence, `${reason}: ${id}`);
			assert.equal(action.target, null);
		}
		assert.equal(
			actions.find((action) => action.id === "copy-owner-path").disabledReason,
			null,
		);
	}
	const readable = remoteOf(row(), "aaaaaaaaaaaa");
	assert.equal(remoteMenuReason(readable), null);
	const workspace = remoteOf(
		row({ remote_read: null, remote_unreadable: "outside_session_files" }),
		"aaaaaaaaaaaa",
	);
	assert.equal(
		plain(remoteUnreadableText(workspace)),
		"Lives in lop-remote-node-2's workspace. Ask the session to copy it to its scratchpad.",
	);
});

// ------------------------------------------------------------- I3-1

function* everyRemoteCase() {
	for (const unreadable of [null, ...REASONS])
		for (const landed of [null, "/home/me/Downloads/chart (1).png"])
			for (const mediaKind of ["image", "video", "audio", "file"])
				for (const size of [1024, REMOTE_PREVIEW_MAX_BYTES + 1, null]) {
					const remote = remoteOf(
						row({
							size_bytes: size,
							remote_read: unreadable ? null : { kind: "path" },
							remote_unreadable: unreadable,
						}),
						"aaaaaaaaaaaa",
					);
					yield { remote, landed, mediaKind };
				}
}

test("I3-1 (table): no path-shaped action ever targets the owner's path", () => {
	let checked = 0;
	for (const { remote, landed, mediaKind } of everyRemoteCase()) {
		for (const action of remoteFileActions(remote, {
			mediaKind,
			canShowInCanvas: true,
			canExpand: true,
			landedPath: landed,
		})) {
			if (!PATH_ACTIONS.has(action.id)) continue;
			checked += 1;
			assert.notEqual(action.target, OWNER_PATH, action.id);
			assert.ok(
				action.target === null || action.target === landed,
				`${action.id} acts on the landed copy or nothing`,
			);
		}
	}
	assert.ok(checked > 0, "the property was exercised");
});

test("I3-1 (dispatch): performing every action never hands the owner path to openFile, showItemInFolder or readFileBytes", async () => {
	resetCalls();
	let performed = 0;
	for (const { remote, landed, mediaKind } of everyRemoteCase()) {
		const document = {
			id: `remote:${remote.fileId}`,
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote,
		};
		for (const action of remoteFileActions(remote, {
			mediaKind,
			canShowInCanvas: true,
			canExpand: true,
			landedPath: landed,
		})) {
			await performRemoteAction(action, {
				document,
				saveName: "chart.png",
				onShowInCanvas: () => {},
				onExpand: () => {},
			});
			performed += 1;
		}
	}
	assert.ok(performed > 100, `exercised ${performed} dispatches`);
	assert.ok(!calls.open.includes(OWNER_PATH), "openFile never saw it");
	assert.ok(
		!calls.reveal.includes(OWNER_PATH),
		"showItemInFolder never saw it",
	);
	assert.equal(calls.read.length, 0, "no local file read at all");
	assert.ok(calls.open.length > 0, "landed copies did open");
	for (const request of remoteState.requests)
		assert.ok(
			!JSON.stringify(request).includes(OWNER_PATH),
			"no transport request carries the owner path either",
		);
});

// ------------------------------------------------------------- doors

test("content: a path row's bytes come over sessions.files.content by row id", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const blob = await fetchRemoteFileBlob({
		id: "remote:x",
		title: "chart.png",
		path: OWNER_PATH,
		content: "",
		remote,
	});
	assert.equal(blob.type, "image/png");
	assert.deepEqual(remoteState.requests, [
		{
			op: "sessions.files.content",
			sessionId: "aaaaaaaaaaaa",
			fileId: remote.fileId,
		},
	]);
	assert.equal(calls.read.length, 0);
});

test("content: a 504 is AttachmentOwnerUnreachableError (retryable)", async () => {
	resetCalls();
	remoteState.media = async () => ({
		kind: "error",
		status: 504,
		detail: "pending",
	});
	await assert.rejects(
		fetchRemoteFileBlob({
			id: "remote:x",
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote: remoteOf(row(), "aaaaaaaaaaaa"),
		}),
		(error) => error instanceof AttachmentOwnerUnreachableError,
	);
});

/*
 * UX round 2, U2-1: a viewer's read is asked again on the transcript's 504
 * backoff, and only an owner the backend calls unreachable is "offline"; a
 * transfer still running is its own error, so the viewer says "still fetching".
 */
const remoteDoc = () => ({
	id: "remote:x",
	title: "notes.md",
	path: OWNER_PATH,
	content: "",
	remote: remoteOf(row(), "aaaaaaaaaaaa"),
});
const contentPending504 = {
	kind: "error",
	status: 504,
	detail: "Still fetching.",
	refusal: { code: "attachment_fetch_pending" },
};

test("content (U2-1): a 504 is re-asked on the given backoff, with onPending before each wait", async () => {
	resetCalls();
	let calls = 0;
	remoteState.media = async () =>
		++calls < 3
			? contentPending504
			: {
					kind: "bytes",
					status: 200,
					mimeType: "text/markdown",
					data: new Uint8Array([35]),
				};
	let pendings = 0;
	const blob = await fetchRemoteFileBlob(remoteDoc(), {
		delays: [0, 0, 0],
		onPending: () => {
			pendings += 1;
		},
	});
	assert.equal(blob.size, 1);
	assert.equal(calls, 3, "two 504s, then the bytes");
	assert.equal(pendings, 2);
});

test("content (U2-1): a transfer still running after the backoff is RemoteFetchPendingError, not offline", async () => {
	resetCalls();
	remoteState.media = async () => contentPending504;
	await assert.rejects(
		fetchRemoteFileBlob(remoteDoc(), { delays: [0] }),
		(error) =>
			error instanceof RemoteFetchPendingError &&
			// Still retryable for every caller that already treats it so.
			error instanceof AttachmentOwnerUnreachableError,
	);
	remoteState.media = async () => ({
		kind: "error",
		status: 504,
		detail: "offline",
		refusal: { code: "attachment_owner_unreachable" },
	});
	await assert.rejects(
		fetchRemoteFileBlob(remoteDoc(), { delays: [0] }),
		(error) =>
			error instanceof AttachmentOwnerUnreachableError &&
			!(error instanceof RemoteFetchPendingError),
	);
});

test("I2-3: the older-peer command line shows only with a real device name", () => {
	const named = remoteUnsupportedSentence({
		unsupported_reason: "peer_update_required",
		device_name: "lop-remote-node-2",
	});
	assert.match(named, NAMED_COMMAND);
	const nameless = remoteUnsupportedSentence({
		unsupported_reason: "peer_update_required",
		device_name: null,
	});
	assert.doesNotMatch(nameless, ANY_COMMAND);
	assert.match(nameless, FALLBACK_NAME);
});

test("download: a receipt lands the path, toasts it, and unlocks the local actions", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const landed = "/home/me/Downloads/chart.png";
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return {
			status: 200,
			body: {
				result: {
					path: landed,
					name: "chart.png",
					bytes: 4,
					sha256: "0".repeat(64),
					created: true,
				},
			},
		};
	};
	const receipt = await downloadRemoteFile(remote, "chart.png");
	assert.equal(receipt.path, landed);
	assert.deepEqual(remoteState.requests, [
		{
			op: "sessions.files.download",
			sessionId: "aaaaaaaaaaaa",
			fileId: remote.fileId,
		},
	]);
	assert.equal(landedPathFor(remote), landed);
	// U1-2: a loading toast from the press, replaced in place by the outcome.
	const [loading, toast] = remoteState.toasts;
	assert.equal(loading.kind, "loading");
	assert.equal(
		loading.message.props.children[1].props.className,
		"whitespace-nowrap",
		"D2-3: the device name is one unbreakable run",
	);
	assert.equal(
		loading.message.props.children[1].props.children,
		"lop-remote-node-2",
	);
	assert.equal(
		plain(loading.message),
		"Downloading chart.png from lop-remote-node-2…",
	);
	assert.equal(toast.kind, "success");
	assert.equal(toast.options.id, loading.options.id, "one toast, replaced");
	// D1-8 / U1-9: where it landed, for long enough to reach the actions.
	assert.equal(plain(toast.message), "Downloaded chart.png to Downloads");
	assert.equal(toast.options.duration, 8000);
	assert.ok(toast.options?.description, "the receipt carries its actions");
	const open = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: false,
		canExpand: false,
		landedPath: landedPathFor(remote),
	}).find((action) => action.id === "open-file");
	await performRemoteAction(open, {
		document: {
			id: "x",
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote,
		},
		saveName: "chart.png",
	});
	assert.deepEqual(calls.open, [landed]);
});

const receiptOf = (path, created = true) => ({
	status: 200,
	body: {
		result: {
			path,
			name: "chart.png",
			bytes: 4,
			sha256: "0".repeat(64),
			created,
		},
	},
});
const pending504 = {
	status: 504,
	body: { detail: { code: "attachment_fetch_pending" } },
};
const offline504 = {
	status: 504,
	body: { detail: { code: "attachment_owner_unreachable" } },
};

test("download: a still-running transfer is re-sent on the backoff and lands without a re-click (U1-2)", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const answers = [
		pending504,
		pending504,
		receiptOf("/home/me/Downloads/chart.png"),
	];
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return answers.shift();
	};
	const receipt = await downloadRemoteFile(remote, "chart.png", {
		delays: [0, 0, 0, 0],
	});
	assert.equal(receipt.path, "/home/me/Downloads/chart.png");
	assert.equal(
		remoteState.requests.length,
		3,
		"two re-POSTs joined the transfer",
	);
	assert.deepEqual(
		remoteState.toasts.map((toast) => toast.kind),
		["loading", "success"],
		"no error toast while it was still running",
	);
});

test("download: an offline owner says so in the shared sentence and is not retried (U1-6)", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return offline504;
	};
	assert.equal(
		await downloadRemoteFile(remote, "chart.png", { delays: [0, 0] }),
		null,
	);
	assert.equal(remoteState.requests.length, 1);
	assert.equal(landedPathFor(remote), null);
	const toast = remoteState.toasts.at(-1);
	assert.equal(toast.kind, "error");
	assert.equal(
		plain(toast.message),
		"lop-remote-node-2 isn't answering. Try again when it's online.",
	);
});

test("download: a transfer still running after the whole backoff says so and lands nothing", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return pending504;
	};
	assert.equal(
		await downloadRemoteFile(remote, "chart.png", { delays: [0, 0] }),
		null,
	);
	assert.equal(remoteState.requests.length, 3, "first try plus two waits");
	assert.equal(
		plain(remoteState.toasts.at(-1).message),
		"Still fetching from lop-remote-node-2. Try again in a moment.",
	);
});

test("download: an identical file already there says so instead of Downloaded (Q1-5)", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	remoteState.request = async () =>
		receiptOf("/home/me/Downloads/chart.png", false);
	await downloadRemoteFile(remote, "chart.png");
	assert.equal(
		plain(remoteState.toasts.at(-1).message),
		"chart.png is already in Downloads on this device",
	);
});

test("download: an unreadable row never reaches the backend", async () => {
	resetCalls();
	const remote = remoteOf(
		row({ remote_read: null, remote_unreadable: "sensitive" }),
		"aaaaaaaaaaaa",
	);
	assert.equal(await downloadRemoteFile(remote, "chart.png"), null);
	assert.equal(remoteState.requests.length, 0);
});

// ------------------------------------------------------------- Q1-1, R1-2/R1-3

test("Q1-1: a remote session's header never reveals the owner's cwd here", () => {
	assert.equal(revealableCwd("/Users/me/project", true), undefined);
	assert.equal(revealableCwd("/Users/me/project", false), "/Users/me/project");
});

test("R1-2/R1-3: a remote document opens as an identifier with no bytes and no object URL", () => {
	const remote = remoteOf(row({ name: "report.pdf" }), "aaaaaaaaaaaa");
	const before = objectUrls.created;
	const opened = remoteCanvasDocument({
		id: "doc",
		title: "report.pdf",
		path: OWNER_PATH,
		content: "",
		type: "pdf",
		remote,
	});
	assert.equal(
		opened.path,
		`remote-file:aaaaaaaaaaaa/${remote.fileId}/report.pdf`,
		"the persisted path is a re-fetchable identifier, never a blob: URL",
	);
	assert.ok(!opened.path.includes(OWNER_PATH), "I3-1: the owner path is gone");
	assert.equal(opened.content, "");
	assert.equal(objectUrls.created, before, "opening creates no object URL");
});
