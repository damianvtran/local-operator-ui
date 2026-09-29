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
			'export { desktopEndpoint, desktopRequestSchema, DESKTOP_REFUSAL_CODE } from "./src/shared/desktop-contract";',
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
	DESKTOP_REFUSAL_CODE,
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
 * The retry boundary, and it is NARROWER than the wake family's: a re-send is
 * kept for a request that never got an answer (the `null` status, and the 503
 * main SYNTHESISES when the fetch itself failed) and for the ONE 503 the core
 * itself calls retryable (the contended lock, `monitor_write_busy` - "a
 * retryable 503 is the honest answer to contention", `monitors/arm.py`).
 * Every 503 that carries the owner's ANSWER is surfaced on the FIRST response:
 * a re-send cannot repair an owner that stands (measured against a hosted
 * conversation, the owner-present 503 never cleared across ~10 minutes of
 * presses), and the blanket 503 retry only sent the same DELETE twice while
 * holding the sentence back a second (UX review round 1, U3).
 */
test("a cancel retries only a request nothing answered, or the core's own contention 503", () => {
	const refused = (status, code) =>
		new DesktopControlError(status, "transport", undefined, code);
	assert.equal(
		retryMonitorWrite(0, new DesktopControlError(null, "no response")),
		true,
		"a request that never got an answer is retried",
	);
	assert.equal(
		retryMonitorWrite(1, new DesktopControlError(null, "no response")),
		false,
		"and only once",
	);
	/* The synthesised no-response 503: main could not complete the request. */
	assert.equal(
		retryMonitorWrite(0, refused(503, DESKTOP_REFUSAL_CODE.transportFailed)),
		true,
	);
	/* The contended lock, the core's own "retryable 503". */
	assert.equal(retryMonitorWrite(0, refused(503, "monitor_write_busy")), true);
	assert.equal(
		retryMonitorWrite(1, refused(503, "monitor_write_busy")),
		false,
		"and only once",
	);
	/*
	 * Every 503 that carries the backend's ANSWER is NOT retried: the two owner
	 * states and the plane-closed reading of a bare 503 all surface verbatim.
	 */
	assert.equal(
		retryMonitorWrite(0, refused(503, "monitor_owner_present")),
		false,
		"an owner-present 503 is an answer, not an unreachable transport",
	);
	assert.equal(
		retryMonitorWrite(0, refused(503, "monitor_owner_wedged")),
		false,
		"and the wedged owner carries its own sentence too",
	);
	assert.equal(
		retryMonitorWrite(0, refused(503, DESKTOP_REFUSAL_CODE.planeClosed)),
		false,
	);
	assert.equal(
		retryMonitorWrite(0, new DesktopControlError(503, "bare 503")),
		false,
	);
	for (const status of [409, 422, 404]) {
		assert.equal(
			retryMonitorWrite(0, refused(status, "monitor_refused")),
			false,
			`an answered ${status} is not retried`,
		);
		assert.equal(
			retryMonitorWrite(1, refused(status, "monitor_refused")),
			false,
		);
	}
	assert.equal(retryMonitorWrite(0, new Error("boom")), false);
});
