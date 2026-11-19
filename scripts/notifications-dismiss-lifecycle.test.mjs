import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
	createDismissRecorder,
	finishDismissDiagnostic,
	installDismissDiagnostic,
} from "./notifications-drawer-scene.mjs";

const measuredBlockPattern =
	/try \{[\s\S]*await click\([\s\S]*"optimistic dismiss",\s*\);\s*\} finally \{\s*await finishDismissDiagnostic\(cdp, diagnostic, out\);\s*\}/;

// Synthetic DOM/CDP boundary, not native input or a rendered drawer: execute the
// actual serializable recorder functions so lifecycle regressions cannot hide in
// a rewritten test implementation. Event trust here is fixture data only.
function renderer() {
	const listeners = new Map();
	const context = {
		performance,
		innerWidth: 100,
		innerHeight: 100,
		document: {
			querySelector: () => null,
			elementFromPoint: () => null,
			addEventListener(type, listener) {
				listeners.set(listener, type);
			},
			removeEventListener(_type, listener) {
				listeners.delete(listener);
			},
		},
	};
	runInNewContext(
		`(${installDismissDiagnostic.toString()})("target", "neighbor")`,
		context,
	);
	return {
		context,
		listeners,
		cdp: {
			evaluate: async (source) =>
				JSON.parse(JSON.stringify(runInNewContext(source, context))),
		},
		gesture() {
			for (const [listener, type] of listeners)
				if (type === "click") listener({ isTrusted: true, target: null });
		},
	};
}

for (const outcome of ["success", "failure"])
	test(`measured ${outcome} freezes evidence before later gesture/reload/cleanup`, async () => {
		const out = mkdtempSync(join(tmpdir(), "dismiss-lifecycle-"));
		const r = renderer();
		const host = createDismissRecorder("target", true);
		let cleanupCalls = 0;
		const sink = r.context.__notificationDiagnostic;
		sink.cleanup.push(() => {
			cleanupCalls++;
			throw new Error("cleanup fault");
		});
		sink.cleanup.push(() => {
			cleanupCalls++;
		});
		try {
			let cleanupStarted = false;
			try {
				try {
					r.gesture();
					host.record("measured-result", { outcome });
					if (outcome === "failure") throw new Error("original assertion");
				} finally {
					await finishDismissDiagnostic(r.cdp, host, out);
				}
			} catch (error) {
				assert.equal(error.message, "original assertion");
			} finally {
				assert.equal(cleanupStarted, false);
				const before = readFileSync(
					join(out, "dismiss-diagnostic.json"),
					"utf8",
				);
				const trace = JSON.parse(before);
				assert.equal(trace.host[0].outcome, outcome);
				assert.equal(
					trace.renderer.records.filter((row) => row.phase === "dom.click")
						.length,
					2,
				);
				assert.equal(trace.renderer.rows[0].connected, undefined);
				assert.equal(trace.renderer.errors, 1);
				assert.equal(r.listeners.size, 0);
				const count = sink.records.length;
				r.gesture();
				sink.record("late-direct-write", {});
				host.record("late-host-write");
				sink.stop();
				sink.stop();
				assert.equal(sink.records.length, count);
				assert.equal(cleanupCalls, 2);
				cleanupStarted = true;
				r.context.__notificationDiagnostic = undefined; // later navigation loses globals
				assert.equal(
					readFileSync(join(out, "dismiss-diagnostic.json"), "utf8"),
					before,
				);
			}
		} finally {
			rmSync(out, { recursive: true });
		}
	});

test("snapshot faults still stop; missing renderer is an explicit gap; write faults never replace outcome", async () => {
	const out = mkdtempSync(join(tmpdir(), "dismiss-lifecycle-"));
	try {
		const r = renderer();
		r.context.__notificationDiagnostic.snapshot = () => {
			throw new Error("snapshot fault");
		};
		await finishDismissDiagnostic(
			r.cdp,
			createDismissRecorder("target", true),
			out,
		);
		assert.equal(r.listeners.size, 0);
		assert.equal(
			JSON.parse(readFileSync(join(out, "dismiss-diagnostic.json"))).renderer
				.errors,
			1,
		);
		await finishDismissDiagnostic(
			r.cdp,
			createDismissRecorder("target", true),
			out,
		);
		const absent = JSON.parse(
			readFileSync(join(out, "dismiss-diagnostic.json")),
		);
		assert.equal(absent.renderer.missing, true);
		assert.equal(absent.classification, "gesture-unobserved");
		const failed = renderer();
		let calls = 0;
		const cdp = {
			evaluate: async (source) => {
				if (++calls === 1) throw new Error("CDP response lost");
				return failed.cdp.evaluate(source);
			},
		};
		const host = createDismissRecorder("target", true);
		await finishDismissDiagnostic(
			cdp,
			host,
			join(out, "nonexistent-directory"),
		);
		assert.equal(failed.listeners.size, 0);
		assert.deepEqual(host.errors, [
			"snapshot-error",
			"snapshot-or-write-error",
		]);
		host.record("late");
		assert.equal(host.records.length, 0);
	} finally {
		rmSync(out, { recursive: true });
	}
});

test("scene freezes the original measured block before any subsequent surface action", () => {
	const source = readFileSync(
		new URL("./notifications-drawer-scene.mjs", import.meta.url),
		"utf8",
	);
	const start = source.indexOf("const concurrent = fixture.seedRows[2]");
	const end = source.indexOf("fixture.readFromOtherSurface(concurrent)", start);
	const block = source.slice(start, end);
	assert.match(block, measuredBlockPattern);
	assert.equal(
		source.indexOf('join(out, "dismiss-diagnostic.json")'),
		source.lastIndexOf('join(out, "dismiss-diagnostic.json")'),
	);
});
