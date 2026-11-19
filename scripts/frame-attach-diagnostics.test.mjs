/** Source-only controls: real pool/resolver/RPC, fake debugger; no Chromium or
 * Electron is launched. These cannot prove the live cross-site cause or a fix. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { CdpPool } from "./src/main/browser/cdp";',
			'export { BrowserHostError } from "./src/main/browser/errors";',
			'export { childRoot } from "./src/main/browser/actions/frames";',
			'export { startRpcServer, KEY_HEADER } from "./src/main/browser/rpc";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { electron: join(process.cwd(), "scripts/browser-electron-stub.ts") },
});
const { CdpPool, BrowserHostError, childRoot, startRpcServer, KEY_HEADER } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

async function fixture(answer) {
	const calls = [];
	const debuggerFake = new EventEmitter();
	debuggerFake.attach = () => {};
	debuggerFake.detach = () => {};
	debuggerFake.isAttached = () => true;
	debuggerFake.sendCommand = async (method, params, sessionId) => {
		calls.push({ method, params, sessionId });
		return answer(method, params, sessionId);
	};
	const contents = {
		id: 71001,
		debugger: debuggerFake,
		isDestroyed: () => false,
		getURL: () => "about:blank",
		loadURL: async () => {},
	};
	const pool = new CdpPool();
	await pool.attach(contents);
	return { pool, contents, calls };
}

async function serializedAttach(raw) {
	const { pool, contents, calls } = await fixture((method) => {
		if (method === "Target.attachToTarget") throw raw;
		return {};
	});
	const server = await startRpcServer({
		key: "synthetic-test-key",
		dispatch: async () => {
			await pool.attachFrame(contents, "synthetic-frame-marker");
			return {};
		},
	});
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}/rpc`, {
			method: "POST",
			headers: {
				[KEY_HEADER]: "synthetic-test-key",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				id: "synthetic-request",
				method: "snapshot",
				params: {},
			}),
		});
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(
			calls.filter((c) => c.method === "Target.attachToTarget").length,
			1,
		);
		return body.error;
	} finally {
		await server.close();
		pool.detach(contents);
	}
}

const expected = (errorClass) => ({
	reason: "frame_detached",
	attach_diagnostic: {
		error_class: errorClass,
		operation: "Target.attachToTarget",
		context: "child_frame_session_acquisition",
	},
});

test("attach diagnostics: known target rejection survives production RPC serialization", async (t) => {
	const marker = "synthetic-sensitive-context";
	const raw = Object.assign(new Error("No target with given id found"), {
		name: marker,
		data: { marker },
		stack: marker,
	});
	const error = await serializedAttach(raw);
	assert.equal(JSON.stringify(error).includes(marker), false);
	assert.equal(error.code, "element_not_found");
	assert.equal(
		error.message,
		"that frame is gone or still loading; take a new snapshot and retry",
	);
	assert.deepEqual(error.data, expected("target_not_found"));
	t.diagnostic(`production RPC error: ${JSON.stringify(error)}`);
});

test("attach diagnostics: unknown and malicious raw data fail closed on the wire", async () => {
	const marker =
		"https://secret.invalid/?token=credential-marker <DOM> session-marker nonce-marker";
	const getter = Object.defineProperty(new Error(), "message", {
		get() {
			throw new Error("must not inspect getter");
		},
	});
	for (const raw of [
		new Error(marker),
		Object.assign(new Error(marker), {
			name: marker,
			data: { marker },
			stack: marker,
		}),
		new Error(`No target with given id found ${marker}`),
		{ message: "No target with given id found", name: marker, data: marker },
		marker,
		null,
		undefined,
		42,
		getter,
	]) {
		const error = await serializedAttach(raw);
		assert.deepEqual(error.data, expected("unknown"));
		const wire = JSON.stringify(error);
		for (const forbidden of [
			marker,
			"secret.invalid",
			"credential-marker",
			"<DOM>",
			"session-marker",
			"nonce-marker",
			"synthetic-frame-marker",
		])
			assert.equal(wire.includes(forbidden), false, forbidden);
	}
});

test("attach diagnostics: typed errors pass through unchanged without diagnostics", async () => {
	for (const code of ["debugger_conflict", "tab_closed", "element_not_found"]) {
		const typed = new BrowserHostError(code, "existing typed answer", {
			reason: "frame_detached",
		});
		const { pool, contents } = await fixture((method) => {
			if (method === "Target.attachToTarget") throw typed;
			return {};
		});
		try {
			await assert.rejects(
				() => pool.attachFrame(contents, "synthetic-frame"),
				(error) => error === typed,
			);
			assert.deepEqual(typed.data, { reason: "frame_detached" });
		} finally {
			pool.detach(contents);
		}
	}
});

test("attach diagnostics: generic attach failure retains resolver retry limit and metadata", async () => {
	const { pool, contents, calls } = await fixture((method) => {
		if (method === "Target.attachToTarget")
			throw new Error("synthetic attach failure");
		return {};
	});
	try {
		await assert.rejects(
			() => childRoot({ cdp: pool }, contents, "synthetic-frame"),
			(error) => {
				assert.deepEqual(error.data, expected("unknown"));
				return true;
			},
		);
		assert.equal(
			calls.filter((c) => c.method === "Target.attachToTarget").length,
			2,
		);
		assert.equal(
			calls.some((c) => c.method === "DOM.getDocument"),
			false,
		);
	} finally {
		pool.detach(contents);
	}
});

test("attach diagnostics: stale child document keeps exactly one existing reattach", async () => {
	for (const alwaysStale of [false, true]) {
		let attaches = 0;
		let documents = 0;
		const { pool, contents } = await fixture((method, _params, sessionId) => {
			if (method === "Target.attachToTarget")
				return { sessionId: `synthetic-child-${++attaches}` };
			if (method === "DOM.getDocument" && sessionId) {
				if (++documents === 1 || alwaysStale)
					throw new Error("Session with given id not found");
				return { root: { nodeId: 9, documentURL: "https://example.test/" } };
			}
			return {};
		});
		try {
			const result = childRoot({ cdp: pool }, contents, "synthetic-frame");
			if (alwaysStale)
				await assert.rejects(
					() => result,
					(error) => error.data.reason === "frame_detached",
				);
			else assert.equal((await result).rootNodeId, 9);
			assert.equal(attaches, 2);
			assert.equal(documents, 2);
		} finally {
			pool.detach(contents);
		}
	}
});
