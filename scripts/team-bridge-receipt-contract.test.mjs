import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The desktop request boundary is the last client-side fence before main opens
 * a socket. These cases exercise the real Zod union and HTTP builder together:
 * a receipt present only in a TypeScript caller, or only in a schema, is not
 * evidence that the guarded runtime will receive it.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const { desktopEndpoint, desktopRequestSchema } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const OWNER = "acct_captured";
const TENANT = "tnt_target";
const reaction = {
	op: "team_bridge.reactions.toggle",
	conversation_id: "bcv_one",
	message_id: "bcmsg_one",
	emoji: "👍",
	active: true,
	expected_account_id: OWNER,
	tenant_id: TENANT,
};
const replies = {
	op: "team_bridge.messages.replies",
	conversation_id: "bcv_one",
	message_id: "bcmsg_root",
	expected_account_id: OWNER,
	tenant_id: TENANT,
	limit: 25,
	after_seq: 8,
};
const threadedSend = {
	op: "team_bridge.messages.send",
	conversation_id: "bcv_one",
	client_ref: "client_one",
	body: "reply",
	thread_root_id: "bcmsg_root",
	expected_account_id: OWNER,
	tenant_id: TENANT,
};

function endpoint(input) {
	return desktopEndpoint(desktopRequestSchema.parse(input));
}

function query(path) {
	return Object.fromEntries(new URL(path, "http://local").searchParams);
}

test("reaction add requires and sends the captured account and target tenant in the PUT body", () => {
	for (const expected_account_id of [undefined, ""]) {
		assert.equal(
			desktopRequestSchema.safeParse({ ...reaction, expected_account_id })
				.success,
			false,
		);
	}
	assert.equal(
		desktopRequestSchema.safeParse({ ...reaction, tenant_id: undefined })
			.success,
		false,
	);
	const put = endpoint(reaction);
	assert.equal(put.method, "PUT");
	assert.deepEqual(put.body, {
		expected_account_id: OWNER,
		tenant_id: TENANT,
	});
});

test("reaction remove requires and sends the captured account and target tenant in the DELETE query", () => {
	const del = endpoint({ ...reaction, active: false });
	assert.equal(del.method, "DELETE");
	assert.equal(del.body, undefined);
	assert.deepEqual(query(del.path), {
		expected_account_id: OWNER,
		tenant_id: TENANT,
	});
});

test("thread replies require and send the captured account and target tenant in the query", () => {
	for (const expected_account_id of [undefined, ""]) {
		assert.equal(
			desktopRequestSchema.safeParse({ ...replies, expected_account_id })
				.success,
			false,
		);
	}
	assert.equal(
		desktopRequestSchema.safeParse({ ...replies, tenant_id: undefined })
			.success,
		false,
	);
	const get = endpoint(replies);
	assert.equal(get.method, "GET");
	assert.deepEqual(query(get.path), {
		expected_account_id: OWNER,
		tenant_id: TENANT,
		limit: "25",
		after_seq: "8",
	});
});

test("the schema refuses a threaded send without a receipt before a route can be built", () => {
	for (const expected_account_id of [undefined, ""]) {
		assert.equal(
			desktopRequestSchema.safeParse({ ...threadedSend, expected_account_id })
				.success,
			false,
			"a threaded send must never fall back to the legacy receipt-less shape",
		);
	}
	assert.equal(
		desktopRequestSchema.safeParse({ ...threadedSend, tenant_id: undefined })
			.success,
		false,
	);
	const post = endpoint(threadedSend);
	assert.equal(post.method, "POST");
	assert.equal(post.body.expected_account_id, OWNER);
	assert.equal(post.body.tenant_id, TENANT);
	assert.equal(post.body.thread_root_id, "bcmsg_root");
});

test("a top-level send keeps the legacy optional receipt without weakening the threaded rule", () => {
	const { thread_root_id, expected_account_id, ...topLevel } = threadedSend;
	assert.equal(desktopRequestSchema.safeParse(topLevel).success, true);
	assert.equal(
		desktopRequestSchema.safeParse({
			...topLevel,
			thread_root_id: "bcmsg_root",
		}).success,
		false,
	);
});
