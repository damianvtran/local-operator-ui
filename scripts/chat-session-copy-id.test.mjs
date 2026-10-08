/**
 * Copy session ID (#893), executable: WHAT reaches the clipboard - local and
 * remote - what the act reports, and the two doors that hand it over.
 *
 *     node --test scripts/chat-session-copy-id.test.mjs
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, because the split is the reason for its
 * shape. `copy-session-id.ts` is a DOM-less helper by construction (the toast is
 * the app's own, the clipboard is the platform's), so the helper is EXECUTED
 * here against a stubbed clipboard and a recording toast module, and the two
 * WIRINGS are read off the shipped JSX in the idiom
 * `chat-sidebar-row-menu.test.mjs` established - a source pin, because neither
 * the nine-thousand-line sidebar nor the header's Radix menu has a cheap mount
 * in this suite.
 *
 * THE REMOTE CASE IS THE POINT OF THE FILE, not an edge case: a remote row's
 * `session_id` IS the owning device's id (the backend keys peer rows by
 * `(owner_device, session_id)`, publishes that value as the wire row's `"id"`,
 * and `toCatalogueRow` renames it unchanged), so the copied string has to paste
 * straight into a `sessions`/`send` call naming that device. The assertion is
 * therefore a BYTE EQUALITY plus a "carries no device decoration" check, so a
 * future "helpful" `device:` prefix fails here rather than in a user's terminal.
 *
 * WHAT IT DOES NOT PROVE: the live press - a menu item clicked, a real clipboard
 * written, a toast drawn. That is the evidence/QA pass's, on this same head.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE RECORDING TOAST MODULE, installed before the bundle is evaluated: the two
 * component doors are stubbed to "the toast manager" by path, the way
 * `speech-user-copy.test.mjs` and `mark-all-read-control.test.mjs` do it, and the
 * fixture pushes into a global so the assertions can read what was said. The
 * label is asserted as a LITERAL below rather than by importing the module's own
 * constant, so the two cannot agree on a wrong string.
 */
const toasts = [];
globalThis.__sessionCopyToasts = toasts;

const bundle = await build({
	stdin: {
		contents: `
			export { copySessionId } from "./src/renderer/src/features/chat/copy-session-id";
			export { toCatalogueRow } from "./src/renderer/src/features/mesh/mesh-types";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "toast-fixture",
			setup(builder) {
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						const record = (kind, message) => {
							(globalThis.__sessionCopyToasts ??= []).push([kind, message]);
						};
						export const showSuccessToast = (message) => record("success", message);
						export const showErrorToast = (message) => record("error", message);
						export const showInfoToast = (message) => record("info", message);
						export const showWarningToast = (message) => record("warning", message);
						export const dismissToast = () => {};
						export const resetToastDedup = () => {};
					`,
				}));
			},
		},
	],
});
const { copySessionId, toCatalogueRow } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The clipboard, as the only thing the helper touches outside the toast module. */
const setClipboard = (writeText) => {
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { clipboard: { writeText } },
	});
};

/** The bytes the clipboard was handed, and the toasts raised, for one press. */
const press = async (id) => {
	const written = [];
	setClipboard(async (text) => {
		written.push(text);
	});
	toasts.length = 0;
	const ok = await copySessionId(id);
	return { ok, written, said: [...toasts] };
};

const SIDEBAR = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
);
const HEADER = readFileSync(
	"src/renderer/src/features/chat/components/chat-header.tsx",
	"utf8",
);
const CONTENT = readFileSync(
	"src/renderer/src/features/chat/components/chat-content.tsx",
	"utf8",
);

test("a local row's id reaches the clipboard verbatim, and the act reports once", async () => {
	/* The id spelling this sidebar draws: twelve lowercase hex characters. */
	const { ok, written, said } = await press("1cfce255afc3");
	assert.equal(ok, true, "a successful copy answers true");
	assert.deepEqual(written, ["1cfce255afc3"], "the id is copied byte for byte");
	assert.deepEqual(
		said,
		[["success", "Session ID copied"]],
		"the one label both surfaces use: sentence case, no trailing period - this app's toasts carry none",
	);
});

test("a remote row's owner id is copied verbatim, with no device decoration", async () => {
	/*
	 * THE WIRE'S OWN VALUE, through the rename the catalogue read applies: `id` is
	 * the OWNING DEVICE's id for the session (`local_operator/session/peer_rows.py`
	 * keys its rows by `(owner_device, session_id)`;
	 * `local_operator/server/utils/desktop_mesh.py` publishes it as the wire row's
	 * `"id"`), so a copy decorated with the device - `d_2a1c9f0e77f1:9f8e...`, or a
	 * `remote:` prefix - would paste nowhere.
	 */
	const row = toCatalogueRow({
		id: "9f8e7d6c5b4a",
		name: "Ops run",
		mtime: 1_760_000_000,
		locality: "remote",
		owner_device: "d_2a1c9f0e77f1",
		owner_device_name: "cloud-node-1",
	});
	assert.equal(
		row.session_id,
		"9f8e7d6c5b4a",
		"`toCatalogueRow` renames the wire's `id` to `session_id` UNCHANGED - the fact the helper's docstring states",
	);
	assert.equal(row.locality, "remote", "the row under test is the remote one");
	const { ok, written, said } = await press(row.session_id);
	assert.equal(ok, true);
	assert.deepEqual(
		written,
		["9f8e7d6c5b4a"],
		"a remote row's id is copied VERBATIM: no prefix, no device decoration - the string pastes straight into a `sessions`/`send` call naming that device",
	);
	assert.equal(
		written[0].includes("d_2a1c9f0e77f1"),
		false,
		"the device id leaked into the copied value",
	);
	assert.equal(
		/^[a-z]+[:/]/.test(written[0]),
		false,
		"the copied value wears a scheme or a scope prefix",
	);
	assert.deepEqual(said, [["success", "Session ID copied"]]);
});

test("a refused clipboard answers false and says so", async () => {
	/*
	 * The clipboard can refuse (no permission, no document focus), and the write is
	 * caught rather than thrown - the failure path `file-actions-menu.tsx`'s
	 * `handleCopyFilePath` and `link-open.ts`'s `copyTarget` already take. The
	 * console error the helper logs is silenced: it is the app's own diagnostic,
	 * not this file's subject.
	 */
	const written = [];
	setClipboard(async () => {
		throw new Error("NotAllowedError: clipboard write refused");
	});
	toasts.length = 0;
	const consoleError = console.error;
	console.error = () => {};
	let ok;
	try {
		ok = await copySessionId("1cfce255afc3");
	} finally {
		console.error = consoleError;
	}
	assert.equal(ok, false, "a refused clipboard answers false");
	assert.deepEqual(written, [], "nothing reached the clipboard");
	assert.deepEqual(
		toasts,
		[["error", "Failed to copy session ID"]],
		"the failure is reported in the app's register",
	);
});

test("an empty or whitespace id is a no-op: nothing copied, nothing claimed", async () => {
	for (const id of ["", " ", "\t\n  "]) {
		const { ok, written, said } = await press(id);
		assert.equal(ok, false, `\`${JSON.stringify(id)}\` answered true`);
		assert.deepEqual(
			written,
			[],
			`\`${JSON.stringify(id)}\` reached the clipboard`,
		);
		assert.deepEqual(said, [], `\`${JSON.stringify(id)}\` raised a toast`);
	}
});

/* --------------------------------------------------------- the two doors */

test("both doors call the one helper with their own id, and neither invents one", () => {
	/*
	 * THE SIDEBAR ROW MENU: the item hands over `row.session_id` - the row's own id,
	 * which for a remote row is the owning device's (above) - and not a literal or a
	 * second reading of the row.
	 */
	assert.match(
		SIDEBAR,
		/<ContextMenuItem onSelect=\{\(\) => void copySessionId\(row\.session_id\)\}>/,
		"the sidebar's copy item no longer passes `row.session_id` to the helper",
	);
	/*
	 * THE HEADER'S OVERFLOW MENU: gated on `sessionId` (so a draft, which has none,
	 * simply does not draw it) and passing that same prop - not a hardcoded string,
	 * not the pane's own `renameSessionId`, which is a capability-gated write path.
	 */
	assert.match(
		HEADER,
		/\{sessionId && \(\s*<DropdownMenuItem\s+onSelect=\{\(\) => void copySessionId\(sessionId\)\}/,
		"the header's copy item no longer draws on `sessionId` / passes it to the helper",
	);
	assert.match(
		HEADER,
		/\tsessionId\?: string;/,
		"the header no longer declares the `sessionId` prop its copy item reads",
	);
	/*
	 * AND THE PROP IS WIRED: `chat-content.tsx` carries the canonical session as its
	 * own `sessionId` and passes it through to `<ChatHeader>`, so the header copies
	 * what the pane is showing rather than a second read of it.
	 */
	const mount = CONTENT.slice(CONTENT.indexOf("<ChatHeader"));
	assert.match(
		mount,
		/^\s*sessionId=\{sessionId\}/m,
		"chat-content no longer passes `sessionId` through to `<ChatHeader>`",
	);
	/* The one-label rule, pinned as a literal in the helper's own source. */
	const helper = readFileSync(
		"src/renderer/src/features/chat/copy-session-id.ts",
		"utf8",
	);
	assert.match(helper, /"Session ID copied"/, "the success label moved");
	assert.equal(
		/["`]Session ID copied\.["`]/.test(helper),
		false,
		"the success label gained a trailing period - toasts in this app have none",
	);
});
