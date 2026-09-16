import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The desktop viewer record and its control endpoint.
 *
 * Both are contract surfaces for a DIFFERENT process — `lop resume-click` reads
 * the file and dials the socket — so what is asserted here is the contract, not
 * an implementation: the JSON keys the backend's `ViewerRecord.from_json`
 * reads, the 0700/0600 permissions that ARE the authorization story, the staged
 * write that makes a torn read impossible, and the two-op wire protocol the
 * backend's `viewer_client` already speaks.
 *
 * The failure these tests exist for is the silent one. A record that names a
 * port nothing is listening on costs a click its whole dial timeout before it
 * falls back to spawning a terminal, and a key compare that answered bad keys
 * with an error frame would turn a loopback port into a key oracle. Neither is
 * visible from the app, which is why both are pinned here.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/viewer-record"; export * from "./src/main/viewer-endpoint";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	VIEWER_PROTOCOL,
	FOCUS_WINDOW_CAPABILITY,
	DESKTOP_NOTIFY_CAPABILITY,
	viewerRunDir,
	publishViewerRecord,
	unpublishViewerRecord,
	ViewerRecordPublisher,
	ViewerEndpoint,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "123456abcdef";

function tempDir() {
	return mkdtempSync(join(tmpdir(), "viewer-record-"));
}

/** Read one record back as the backend's `ViewerRecord.from_json` would. */
function readRecord(dir, pid) {
	return JSON.parse(readFileSync(join(dir, `${pid}.json`), "utf8"));
}

// ------------------------------------------------------------------ the record

test("the record carries the keys the backend's reader needs, and nothing else", () => {
	const dir = tempDir();
	const publisher = new ViewerRecordPublisher(dir, 4242);
	publisher.setControlPort(51234);
	publisher.start();

	const record = readRecord(dir, 4242);
	assert.equal(record.pid, 4242);
	assert.equal(record.surface, "desktop");
	assert.equal(record.control_port, 51234);
	assert.equal(record.protocol, VIEWER_PROTOCOL);
	assert.equal(record.can_switch, true);
	// No window has reported a conversation, so the record must not name one:
	// `current_session` is what lets a click SKIP a switch, and naming a session
	// no window is showing lands the user on whatever the recreated window
	// rehydrates (m2).
	assert.equal(record.current_session, "");
	assert.equal(record.focused_at, 0);
	assert.deepEqual(
		record.capabilities.sort(),
		[DESKTOP_NOTIFY_CAPABILITY, FOCUS_WINDOW_CAPABILITY].sort(),
	);
	assert.ok(
		record.control_key.length >= 32,
		"the key is the whole authorization story",
	);
	assert.equal(typeof record.heartbeat_at, "number");
	assert.equal(typeof record.started_at, "number");
	publisher.stop();
});

test("the directory is 0700 and the file is 0600", () => {
	const dir = join(tempDir(), "run", "viewers");
	const publisher = new ViewerRecordPublisher(dir, 4243);
	publisher.setControlPort(1);
	publisher.start();

	const dirMode = statSync(dir).mode & 0o777;
	const fileMode = statSync(join(dir, "4243.json")).mode & 0o777;
	assert.equal(dirMode, 0o700, "the directory permissions are half the story");
	assert.equal(fileMode, 0o600, "and the file's are the other half");
	publisher.stop();
});

test("a pane that leaves its conversation withdraws the routing report, identity-safely", () => {
	/*
	 * QA ROUND 2, Q1. `current_session` is the click's DESTINATION, so a record
	 * that keeps naming a conversation the pane has left is not merely stale: the
	 * backend reads the match as "already displayed", skips `resume_session` and
	 * reports success, so the click raises whatever the window happens to show and
	 * no later rung of the ladder corrects it.
	 *
	 * Three cases, because "it cleared" is not the contract: the session the record
	 * NAMES is withdrawn, a DIFFERENT session is left alone (a deeper pane has
	 * reported it since), and an empty id withdraws nothing.
	 */
	const dir = tempDir();
	const publisher = new ViewerRecordPublisher(dir, 4248);
	publisher.setControlPort(1);
	publisher.start();
	publisher.noteSession(SESSION);
	assert.equal(readRecord(dir, 4248).current_session, SESSION);

	publisher.releaseSession("ffffffffffff");
	assert.equal(
		readRecord(dir, 4248).current_session,
		SESSION,
		"another conversation's report is not this pane's to withdraw",
	);

	publisher.releaseSession("");
	assert.equal(
		readRecord(dir, 4248).current_session,
		SESSION,
		"an empty id is this record's own 'nothing on screen' value, not a session to leave",
	);

	publisher.releaseSession(SESSION);
	assert.equal(
		readRecord(dir, 4248).current_session,
		"",
		"the pane that left A must stop naming A, or the click for A is answered with a raise",
	);
	publisher.stop();
});

test("the write is staged, so no reader can see a half-written record", () => {
	const dir = tempDir();
	publishViewerRecord(
		{
			pid: 4244,
			surface: "desktop",
			control_port: 1,
			control_key: "k",
			current_session: "",
			can_switch: true,
			focused_at: 0,
			protocol: VIEWER_PROTOCOL,
			started_at: 0,
			heartbeat_at: 0,
			capabilities: [],
		},
		dir,
	);
	// The temporary file is renamed onto the target, so the directory holds the
	// record and nothing else. A leftover `.tmp` would mean a reader can find an
	// unparseable file, which `scan_viewers` DELETES — i.e. the record would be
	// reaped as a crash.
	assert.deepEqual(
		readdirSync(dir).filter((name) => name.includes(".tmp")),
		[],
	);
	// Overwriting an existing record also leaves exactly one file.
	publishViewerRecord(
		{
			pid: 4244,
			surface: "desktop",
			control_port: 2,
			control_key: "k",
			current_session: SESSION,
			can_switch: true,
			focused_at: 0,
			protocol: VIEWER_PROTOCOL,
			started_at: 0,
			heartbeat_at: 0,
			capabilities: [],
		},
		dir,
	);
	assert.deepEqual(readdirSync(dir), ["4244.json"]);
	assert.equal(readRecord(dir, 4244).control_port, 2);
});

test("nothing is published before the port exists", () => {
	const dir = tempDir();
	const publisher = new ViewerRecordPublisher(dir, 4245);
	// Setters before `start` must not write: the first record ever written would
	// otherwise advertise port 0, which is not dialable, for the moment between
	// the window appearing and the listener binding.
	publisher.noteSession(SESSION);
	assert.deepEqual(readdirSync(dir), []);
	publisher.setControlPort(6001);
	assert.deepEqual(readdirSync(dir), []);
	publisher.start();
	assert.equal(readRecord(dir, 4245).current_session, SESSION);
	assert.equal(readRecord(dir, 4245).control_port, 6001);
	publisher.stop();
});

test("navigation and focus are stamped, and stop removes the record", () => {
	const dir = tempDir();
	const publisher = new ViewerRecordPublisher(dir, 4246);
	publisher.setControlPort(6002);
	publisher.start();
	publisher.noteSession(SESSION);
	assert.equal(readRecord(dir, 4246).current_session, SESSION);
	publisher.noteSession("");
	assert.equal(
		readRecord(dir, 4246).current_session,
		"",
		"a closed window shows nothing",
	);
	const before = readRecord(dir, 4246).focused_at;
	publisher.noteFocused();
	assert.ok(readRecord(dir, 4246).focused_at >= before);
	publisher.stop();
	assert.deepEqual(
		readdirSync(dir),
		[],
		"a record left behind advertises a dead port",
	);
	// Idempotent: `will-quit` and the record's own teardown can both call it.
	publisher.stop();
	unpublishViewerRecord(4246, dir);
});

test("the config directory follows the backend's override", () => {
	// The click runs on THIS machine, so the record lives under the app host's
	// config dir — resolved the same way `local_operator.paths.config_dir` does,
	// because a reader looking in one place and a writer writing in another is
	// how the click silently falls through to the terminal rung.
	assert.equal(
		viewerRunDir({ LOCAL_OPERATOR_CONFIG_DIR: "/tmp/example" }),
		"/tmp/example/run/viewers",
	);
	assert.equal(
		viewerRunDir({}),
		join(homedir(), ".local-operator", "run", "viewers"),
	);
});

// ---------------------------------------------------------------- the endpoint

/** One authenticated conversation against a live endpoint. */
function speak(port, key, frames, { expectAuthRejection = false } = {}) {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: "127.0.0.1", port });
		let buffer = "";
		const replies = [];
		const timer = setTimeout(() => {
			socket.destroy();
			resolve({ replies, closed: true });
		}, 3_000);
		socket.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		socket.on("close", () => {
			clearTimeout(timer);
			resolve({ replies, closed: true });
		});
		socket.on("connect", () => {
			if (expectAuthRejection) {
				socket.write(`${JSON.stringify({ key })}\n`);
				return;
			}
			socket.write(`${JSON.stringify({ key })}\n`);
			for (const frame of frames) socket.write(`${JSON.stringify(frame)}\n`);
		});
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				replies.push(JSON.parse(buffer.slice(0, newline)));
				buffer = buffer.slice(newline + 1);
			}
			if (!expectAuthRejection && replies.length >= frames.length) {
				clearTimeout(timer);
				socket.destroy();
				resolve({ replies, closed: false });
			}
		});
	});
}

test("a bad key closes the conversation without a reply", async (t) => {
	const endpoint = new ViewerEndpoint(
		{
			resumeSession: () => "should not run",
			focusWindow: () => "should not run",
		},
		"a".repeat(64),
	);
	// `t.after` rather than a trailing call: a failing assertion must not leave a
	// listening server behind, which would keep node's test file from settling.
	t.after(() => endpoint.close());
	const port = await endpoint.start();
	const { replies } = await speak(port, "b".repeat(64), [], {
		expectAuthRejection: true,
	});
	// No reply at all, deliberately: an error frame here would make the port an
	// oracle for key guesses.
	assert.deepEqual(replies, []);
});

test("both ops answer an ack, and an unknown op answers an error frame", async (t) => {
	const seen = [];
	const endpoint = new ViewerEndpoint(
		{
			resumeSession: (sessionId) => {
				seen.push(sessionId);
				return `showing ${sessionId}`;
			},
			focusWindow: () => {
				seen.push("focus");
				return "raised";
			},
		},
		"c".repeat(64),
	);
	t.after(() => endpoint.close());
	const port = await endpoint.start();
	const { replies } = await speak(port, "c".repeat(64), [
		{ op: "resume_session", req: 1, session_id: SESSION },
		{ op: "focus_window", req: 2 },
		{ op: "delete_everything", req: 3 },
	]);
	assert.deepEqual(replies[0], {
		op: "ack",
		req: 1,
		detail: `showing ${SESSION}`,
	});
	assert.deepEqual(replies[1], { op: "ack", req: 2, detail: "raised" });
	// An unknown op is an ERROR frame, not a dropped connection: the reader's
	// own degradation for a viewer that does not speak an op is exactly this.
	assert.equal(replies[2].op, "error");
	assert.equal(replies[2].req, 3);
	assert.deepEqual(seen, [SESSION, "focus"]);
});

test("a malformed session id is refused rather than passed inward", async (t) => {
	const seen = [];
	const endpoint = new ViewerEndpoint(
		{
			resumeSession: (sessionId) => {
				seen.push(sessionId);
				return "ran";
			},
			focusWindow: () => "ran",
		},
		"d".repeat(64),
	);
	t.after(() => endpoint.close());
	const port = await endpoint.start();
	const { replies } = await speak(port, "d".repeat(64), [
		{ op: "resume_session", req: 1, session_id: "../../etc/passwd" },
	]);
	assert.equal(replies[0].op, "error");
	// The id reaches the renderer's navigation and the backend's route, so a
	// scriptable peer must not be able to address anything but a session.
	assert.deepEqual(seen, []);
});

test("start is idempotent and close is safe twice", async (t) => {
	const endpoint = new ViewerEndpoint(
		{ resumeSession: () => "ok", focusWindow: () => "ok" },
		"e".repeat(64),
	);
	t.after(() => endpoint.close());
	const first = await endpoint.start();
	// A window can be recreated and `activate` re-runs, so a second bind would
	// leak a listener — and a leaked listener is worse than a leaked source
	// because the record then advertises a port nothing reads.
	const second = await endpoint.start();
	assert.equal(first, second);
	assert.ok(second > 0);
	endpoint.close();
	endpoint.close();
	assert.equal(endpoint.boundPort, 0);
});
