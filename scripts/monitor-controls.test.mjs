import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The monitor controls' model and mapping: what the run pane's cancel sends,
 * and what it retries.
 *
 * The Monitors section draws a control for a route, so two things here have a
 * right answer rather than a look. The first is the operation's mapping onto the
 * wire - the DELETE and its path (`desktopEndpoint`), including the handle
 * question the path is the only place to get wrong. The second is the retry
 * boundary (`retryMonitorWrite`), whose currency is a `DesktopControlError` and
 * which is therefore CONSTRUCTED rather than approximated - the rule
 * `scheduled-task-model.test.mjs` states for its wake twin.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { retryMonitorWrite } from "./src/renderer/src/features/chat/components/run-details/monitor-controls-model";',
			/*
			 * The retry policy's own currency, so the boundary can be built rather
			 * than approximated. Same import as the wake twin's test.
			 */
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const {
	desktopEndpoint,
	desktopRequestSchema,
	retryMonitorWrite,
	DesktopControlError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The mapping. One assertion, three facts: the route is the monitor family's,
 * both handles ride the path, and the method is the DELETE the core's route
 * declares (`routes/desktop_monitors.py`).
 */
test("the cancel maps onto the monitor route as a DELETE, both handles in the path", () => {
	assert.deepEqual(
		desktopEndpoint({
			op: "monitors.cancel",
			sessionId: "a1b2c3d4e5f6",
			monitorId: "m2",
		}),
		{ path: "/v1/desktop/monitors/a1b2c3d4e5f6/m2", method: "DELETE" },
	);
});

/*
 * A handle is a path SEGMENT, never a fragment. The schemas already refuse
 * separators, so this can only be reached by a hand-built request - which is
 * exactly the caller the encoding is for (the mesh writes' own recorded rule).
 */
test("a handle cannot become a path fragment", () => {
	const { path } = desktopEndpoint({
		op: "monitors.cancel",
		sessionId: "a1b2c3d4e5f6",
		monitorId: "m1/../x",
	});
	assert.equal(path, "/v1/desktop/monitors/a1b2c3d4e5f6/m1%2F..%2Fx");
});

/*
 * The op is a member of the request union and nothing more: it parses with the
 * handles it declares, and `.strict()` refuses a companion key from a sibling
 * family (a `wakeId` sent by a copy-paste is a refused request, not an ignored
 * field).
 */
test("the op parses strictly, with no sibling family's keys", () => {
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "monitors.cancel",
			sessionId: "a1b2c3d4e5f6",
			monitorId: "m2",
		}).success,
		true,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "monitors.cancel",
			sessionId: "a1b2c3d4e5f6",
			monitorId: "m2",
			wakeId: "w1",
		}).success,
		false,
	);
	// A malformed handle is still SENT: the route's own `^m\d{1,4}$` pattern is
	// where the shape is enforced (the control that must not be refused here is
	// the lenient-client rule `wakeId` records).
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "monitors.cancel",
			sessionId: "a1b2c3d4e5f6",
			monitorId: "not-a-handle",
		}).success,
		true,
	);
});

/*
 * The retry boundary, in the wake family's own readings: one retry for a
 * request that never got an answer, and none for a request the backend DID
 * answer - a refusal's own sentence is what the dialog shows, and a retry would
 * ask a second time what the refusal already settled.
 */
test("a cancel retries once, and only when nothing answered", () => {
	const transport = (status) => new DesktopControlError(status, "transport");
	assert.equal(retryMonitorWrite(0, transport(503)), true);
	assert.equal(retryMonitorWrite(0, transport(null)), true);
	assert.equal(retryMonitorWrite(1, transport(503)), false, "and only once");
	assert.equal(retryMonitorWrite(1, transport(null)), false);
	for (const status of [409, 422, 404]) {
		assert.equal(
			retryMonitorWrite(0, transport(status)),
			false,
			`an answered ${status} is not retried`,
		);
		assert.equal(retryMonitorWrite(1, transport(status)), false);
	}
	assert.equal(retryMonitorWrite(0, new Error("boom")), false);
});
