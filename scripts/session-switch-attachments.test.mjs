import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { resolveConfig } from "vite";
import previewConfig from "./session-switch.vite.mjs";

// Bundle the real bridge and reducer, not a second implementation of the wire.
const bundle = await build({
	stdin: {
		contents: `
			export * from "./scripts/session-switch-attachments";
			export { historyPage, installSwitchBridge } from "./scripts/session-switch-bridge";
			export { applyEvent, appendPendingUser, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	logLevel: "silent",
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test("preview scans only its own HTML while retaining genuine dependency resolution", async () => {
	// Resolve Vite's actual serve config without booting a server or optimizer.
	// The exact entry is a negative control against default **/*.html scanning:
	// no unrelated composer-alert-geometry graph should become a scan root.
	const config = await resolveConfig(
		{ ...previewConfig, configFile: false },
		"serve",
	);
	const entry = resolve(process.cwd(), "scripts/session-switch.html");
	assert.deepEqual(config.optimizeDeps.entries, [entry]);
	assert.deepEqual(config.optimizeDeps.exclude ?? [], []);
	assert.ok(readFileSync(entry, "utf8").includes('src="./session-switch.tsx"'));
	assert.equal(
		config.resolve.alias.find((alias) => alias.find === "@features")
			?.replacement,
		resolve(process.cwd(), "src/renderer/src/features"),
	);
	assert.equal(config.server.port, 5211);
	assert.equal(config.server.strictPort, true);
});

const ALREADY_PERSISTED = /already persisted/;
const short = { kind: "user", text: "Synthetic brief for attachment capture." };

test("attachment modes are explicit, bounded and leave the default untouched", () => {
	for (const query of ["", "?attachment=bad", "?attachment=100000"]) {
		assert.equal(m.attachmentMode(query), null);
		assert.equal(
			m.withCaptureAttachment(short, m.attachmentMode(query)),
			short,
		);
	}
	for (const mode of ["prose", "only", "echo"]) {
		assert.equal(m.attachmentMode(`?attachment=${mode}`), mode);
		const step = m.withCaptureAttachment(short, mode);
		assert.equal(step.documents.length, 1);
		assert.equal(step.text, mode === "only" ? "" : short.text);
		const content = m.historyPage("abcdef000001", [step]).entries[0].payload
			.content;
		assert.equal(
			content.filter((block) => block.type === "document").length,
			1,
		);
		assert.equal(
			content.some((block) => block.text),
			mode !== "only",
		);
	}
	const long = { ...short, text: "Long synthetic paragraph.\n\n".repeat(24) };
	assert.equal(m.withCaptureAttachment(long, "prose").text, long.text);
});

test("owner admission coalesces the optimistic file row and retains it on history reads", async () => {
	const previousWindow = globalThis.window;
	globalThis.window = {};
	const sessionId = "abcdef000001";
	const id = "synthetic-attachment-admission";
	const step = m.withCaptureAttachment(short, "echo");
	const doc = m.CAPTURE_DOCUMENT;
	const document = {
		id: `${id}:doc:0`,
		attachment: doc.attachment,
		filename: doc.filename,
		mimeType: doc.mime_type,
		bytes: doc.bytes,
		injection: doc.injection,
		path: null,
		storedPath: null,
	};
	let state = m.appendPendingUser(m.EMPTY_TRANSCRIPT, id, step.text, [], 1000, [
		document,
	]);
	assert.equal(state.records[0].local, true);
	const bridge = m.installSwitchBridge({
		sessions: [{ id: sessionId, name: "Synthetic", mtime: 1 }],
		stepsBySession: { [sessionId]: [] },
		latency: { stream: 0, default: 0, "sessions.history": 0 },
	});
	const desktop = window.api.desktop;
	const frames = [];
	const subscription = desktop.stream.subscribe({ sessionId }, (event) => {
		if (event.kind !== "data") return;
		const frame = JSON.parse(event.data);
		frames.push(frame);
		if (frame.type === "event")
			state = m.applyEvent(state, frame.payload, 2000);
	});
	try {
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(frames.at(-1).type, "snapshot");
		assert.deepEqual(frames.at(-1).payload.frontend.snapshot.monitors, []);
		bridge.persistUser(sessionId, step, id);
		assert.equal(frames.at(-1).payload.type, "history_delta");
		assert.equal(state.records.length, 1);
		assert.equal(state.records[0].id, id);
		assert.notEqual(state.records[0].local, true);
		assert.deepEqual(state.records[0].documents, [document]);
		const reply = await desktop.request({ op: "sessions.history", sessionId });
		assert.equal(reply.body.result.entries.length, 1);
		assert.equal(reply.body.result.entries[0].id, id);
		assert.throws(
			() => bridge.persistUser(sessionId, step, id),
			ALREADY_PERSISTED,
		);
		subscription.dispose();
		const count = frames.length;
		bridge.persistUser("abcdef000002", step, id);
		assert.equal(
			frames.length,
			count,
			"a disposed subscription receives no admission",
		);
	} finally {
		subscription.dispose();
		bridge.dispose();
		globalThis.window = previousWindow;
	}
});
