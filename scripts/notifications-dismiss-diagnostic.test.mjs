import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build, transform } from "esbuild";
import {
	classifyDismissTrace,
	createDismissRecorder,
	prepareDrawerRemediation,
} from "./notifications-drawer-scene.mjs";

const targetId = "synthetic-update-2";
const entry = (phase, metadata = {}) => ({ phase, id: targetId, ...metadata });
const click = entry("dom.click", {
	isTrusted: true,
	target: { row: targetId, action: "dismiss" },
});

test("omitted recorder is inert; missing, wrong and guarded gesture cannot imply cache failure", () => {
	const omitted = createDismissRecorder(targetId);
	omitted.record("anything");
	assert.deepEqual(omitted.records, []);
	assert.equal(classifyDismissTrace([], targetId), "gesture-unobserved");
	assert.equal(
		classifyDismissTrace([entry("dom.click", { isTrusted: false })], targetId),
		"gesture-unobserved",
	);
	assert.equal(
		classifyDismissTrace(
			[{ ...click, target: { row: "synthetic-update-3", action: "dismiss" } }],
			targetId,
		),
		"wrong-target",
	);
	assert.equal(
		classifyDismissTrace(
			[{ ...click, target: { ...click.target, ariaDisabled: "true" } }],
			targetId,
		),
		"handler-guarded",
	);
	assert.equal(
		classifyDismissTrace(
			[
				click,
				entry("applyWrite.entry"),
				entry("onMutate.entry"),
				entry("cancel.start"),
			],
			targetId,
		),
		"cancellation-unfinished",
	);
	assert.equal(
		classifyDismissTrace(
			[
				click,
				entry("applyWrite.entry"),
				entry("onMutate.entry"),
				entry("cache.known", { present: false }),
			],
			targetId,
		),
		"target-missing-from-cache",
	);
});

test("real held proxy records arrival before forward; no completed receipt until release", async () => {
	let writes = 0;
	const core = createServer((req, res) => {
		if (req.method === "PATCH") writes++;
		res.setHeader("Content-Type", "application/json");
		res.end(
			JSON.stringify(
				req.method === "POST"
					? { result: { session_id: "synthetic-session" } }
					: { changed: [targetId] },
			),
		);
	});
	await new Promise((resolve) => core.listen(0, "127.0.0.1", resolve));
	const prior = process.env.LOCAL_OPERATOR_UI_NOTIFICATION_DIAGNOSTIC;
	process.env.LOCAL_OPERATOR_UI_NOTIFICATION_DIAGNOSTIC = "1988-single-step-v1";
	let fixture;
	try {
		fixture = await prepareDrawerRemediation({
			base: `http://127.0.0.1:${core.address().port}`,
			config: "synthetic-config",
			token: "synthetic-token",
			coreStore: () =>
				JSON.stringify([
					{ id: "row-0" },
					{ id: "row-1" },
					{ id: targetId, revision: 1 },
				]),
		});
		fixture.state.enabled = true;
		fixture.state.holdPatch = true;
		const diagnostic = fixture.state.diagnostic;
		let held;
		const arrived = new Promise((resolve) => {
			held = resolve;
		});
		const record = diagnostic.record.bind(diagnostic);
		diagnostic.record = (phase, metadata) => {
			record(phase, metadata);
			if (phase === "proxy.hold-enter") held();
		};
		const response = fetch(`${fixture.apiUrl}/v1/desktop/notifications`, {
			method: "PATCH",
			body: JSON.stringify({
				verb: "dismiss",
				target: { items: [{ id: targetId, revision: 1 }] },
			}),
		});
		await arrived;
		assert.deepEqual(
			diagnostic.records.map((row) => row.phase),
			["proxy.arrived-body-read", "proxy.hold-enter"],
		);
		assert.equal(writes, 0);
		assert.deepEqual(fixture.state.patches, []);
		fixture.release();
		assert.equal((await response).status, 200);
		assert.equal(writes, 1);
		assert.equal(
			diagnostic.records.findIndex((row) => row.phase === "proxy.hold-enter") <
				diagnostic.records.findIndex((row) => row.phase === "proxy.forward"),
			true,
		);
	} finally {
		fixture?.release();
		fixture?.close();
		core.closeAllConnections();
		await new Promise((resolve) => core.close(resolve));
		if (prior === undefined)
			Reflect.deleteProperty(
				process.env,
				"LOCAL_OPERATOR_UI_NOTIFICATION_DIAGNOSTIC",
			);
		else process.env.LOCAL_OPERATOR_UI_NOTIFICATION_DIAGNOSTIC = prior;
	}
});

test("real optimistic path: recorder missing/throwing cannot alter return, cancellation or cache publication", async () => {
	const bundle = await build({
		stdin: {
			contents:
				'export { beginOptimisticWrite, notificationKeys, recordNotificationDiagnostic } from "./src/renderer/src/features/notifications/notifications-api"; export { QueryClient } from "@tanstack/react-query";',
			resolveDir: process.cwd(),
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		logLevel: "silent",
		alias: {
			"@shared": "./src/renderer/src/shared",
			"@features": "./src/renderer/src/features",
		},
	});
	const api = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
	for (const mode of ["omitted", "throwing", "recording"]) {
		const client = new api.QueryClient();
		const records = [];
		const sink = {
			targetId,
			errors: 0,
			cleanup: [],
			record(phase, metadata) {
				if (mode === "throwing") throw new Error("synthetic recorder fault");
				records.push({ phase, ...metadata });
			},
		};
		if (mode !== "omitted") globalThis.__notificationDiagnostic = sink;
		try {
			const rollback = await api.beginOptimisticWrite(client, "dismiss", [
				{ id: targetId, revision: 1 },
			]);
			assert.equal(typeof rollback, "function");
			rollback();
			const row = {
				id: targetId,
				source: "notify",
				priority: "normal",
				title: "synthetic",
				excerpt: "",
				created_at: 1,
				updated_at: 1,
				seq: 5,
				revision: 1,
				read: false,
				read_via: null,
				dismissed: false,
				repeat_count: 1,
				session: { id: "aaaaaaaaaaa1", title: "synthetic" },
			};
			const key = [...api.notificationKeys.factsRoot, "synthetic"];
			client.setQueryData(key, {
				items: [row],
				unread_count: 1,
				high_water: 5,
			});
			const undo = await api.beginOptimisticWrite(client, "dismiss", [
				{ id: targetId, revision: 1 },
			]);
			assert.equal(client.getQueryData(key).items[0].dismissed, true);
			undo();
			assert.equal(client.getQueryData(key).items[0].dismissed, false);
			api.recordNotificationDiagnostic(
				"wrong-id-must-be-ignored",
				"synthetic-other-target",
			);
			assert.equal(
				records.some((row) => row.phase === "wrong-id-must-be-ignored"),
				false,
			);
			if (mode === "throwing") assert.ok(sink.errors > 0);
			if (mode === "recording") {
				assert.ok(
					records.some((row) => row.phase === "cache.known" && !row.present),
				);
				assert.ok(records.some((row) => row.phase === "publish.after"));
				assert.ok(records.some((row) => row.phase === "ledger.settlement"));
				// Independent BigInt FNV-1a oracle checks contents, not only hash presence.
				const rawHash = client
					.getQueryCache()
					.find({ queryKey: key }).queryHash;
				let expectedHash = 2166136261n;
				for (const char of rawHash)
					expectedHash =
						((expectedHash ^ BigInt(char.charCodeAt(0))) * 16777619n) &
						0xffffffffn;
				const cache = records.filter(
					(row) => row.phase === "cache.notification",
				);
				assert.ok(cache.length > 0);
				assert.ok(
					cache.every((row) => row.queryHash === expectedHash.toString(16)),
				);
				assert.ok(cache.some((row) => row.present === false));
				assert.equal(
					JSON.stringify(cache).includes(JSON.stringify(key)),
					false,
				);
			}
		} finally {
			for (const stop of sink.cleanup) stop();
			globalThis.__notificationDiagnostic = undefined;
			client.clear();
		}
	}
	const client = new api.QueryClient();
	let release;
	client.cancelQueries = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const records = [];
	const sink = {
		targetId,
		errors: 0,
		cleanup: [],
		record: (phase, metadata) => records.push({ phase, ...metadata }),
	};
	globalThis.__notificationDiagnostic = sink;
	try {
		const pending = api.beginOptimisticWrite(client, "dismiss", [
			{ id: targetId, revision: 1 },
		]);
		assert.ok(records.some((row) => row.phase === "cancel.start"));
		assert.equal(
			records.some((row) => row.phase === "cancel.resolve"),
			false,
		);
		assert.equal(
			records.some((row) => row.phase === "publish.after"),
			false,
		);
		release();
		const rollback = await pending;
		assert.ok(records.some((row) => row.phase === "cancel.resolve"));
		rollback();
	} finally {
		for (const stop of sink.cleanup) stop();
		globalThis.__notificationDiagnostic = undefined;
		client.clear();
	}
});

test("forced original failure rc survives diagnostic failure (app's rc gate remains unchanged)", () => {
	const child = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'import { createDismissRecorder } from "./scripts/notifications-drawer-scene.mjs"; try { throw new Error("original assertion"); } catch { process.exitCode=7; } finally { try { const r=createDismissRecorder("target",true); r.records.push=()=>{throw new Error("recorder");};r.record("forced"); } catch {} }',
		],
		{ encoding: "utf8" },
	);
	assert.equal(child.status, 7, child.stderr);
});

// Execute the shipped observer diagnostic block, not a rendered DrawerUpdates:
// absence is an observation, never evidence that the optimistic UI succeeded.
test("absent drawer observer emits explicit false without inventing row state", async () => {
	const source = readFileSync(
		"src/renderer/src/features/notifications/components/drawer-updates.tsx",
		"utf8",
	);
	const start = source.indexOf("// Include an absent observer target:");
	const end = source.indexOf("\n\tconst unread =", start);
	assert.ok(start > 0 && end > start);
	const { code } = await transform(source.slice(start, end), { loader: "ts" });
	const records = [];
	const context = {
		__notificationDiagnostic: { targetId },
		list: { data: { items: [] }, isError: false },
		rows: [],
		view: "unread",
		recordNotificationDiagnostic: (phase, id, metadata) =>
			records.push({ phase, id, ...metadata }),
	};
	runInNewContext(code, context);
	assert.equal(records.length, 1);
	assert.equal(records[0].phase, "drawer.projection");
	assert.equal(records[0].id, targetId);
	assert.equal(records[0].present, false);
	assert.equal(records[0].visible, false);
	assert.equal(records[0].dismissed, undefined);
	records.length = 0;
	context.__notificationDiagnostic = undefined;
	runInNewContext(code, context);
	assert.equal(records.length, 0);
});
