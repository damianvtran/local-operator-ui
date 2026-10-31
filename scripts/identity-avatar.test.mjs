import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * AN AGENT NEVER WEARS ITS OWNER'S FACE (2026-10-30).
 *
 * Production showed "Aida (Damian Tran)" with Damian's photo, and Sherman's
 * chief of staff with Sherman's, because an agent's plate looked its picture up
 * by the owner's account id (an agent shares its owner's directory row). The
 * fix routes every Team Bridge picture through ONE resolver
 * (`src/shared/identity-avatar.ts`). These tests fail if:
 *   1. the resolver ever returns an account picture for an agent identity, for
 *      any owner row we can build (photo, profile hash, a planted
 *      account-shaped `avatar_url` on the agent object);
 *   2. the shipped plate (`TeamBridgeAvatar`, kind="agent") ever asks the
 *      private avatar relay for bytes, or draws anything but the Bot glyph;
 *   3. the notification sender descriptor for a `person_agent` carries an
 *      avatar reference.
 * A human with the same row still gets their photo, so the agent result is
 * not passing because nothing ever loads.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
export * from './src/shared/identity-avatar';
export { TeamBridgeAvatar } from './src/renderer/src/features/team-bridge/team-bridge-profile-card';
export { radientUserKeys } from './src/renderer/src/shared/hooks/radient-account-authority';
export { TeamBridgeApi } from './src/renderer/src/shared/api/local-operator/team-bridge-api';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["react", "react-dom"],
	tsconfig: "tsconfig.app.json",
	write: false,
	logLevel: "silent",
});
const compiled = new Module(
	`${process.cwd()}/scripts/identity-avatar-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/identity-avatar-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

const OWNER = "2fc3a222-9e22-4c85-8b94-0b11c81972f7";
const HASH = "0123456789abcdef";
/** The owner's directory row: a real photo, and an agent riding on it. */
const ownerRow = {
	account_id: OWNER,
	display_label: "Damian Tran",
	role: "owner",
	bridge_enabled: true,
	bridge_state: "active",
	avatar_url: `/v1/accounts/${OWNER}/avatar?v=${HASH}`,
	profile: {
		display_name: "Damian Tran",
		avatar: { source: "uploaded", hash: HASH, updated_at: "2026-10-01" },
	},
	agent: { endpoint_id: "ep_aida", name: "Aida", state: "active" },
};

test("an agent identity never resolves to an account avatar, whatever the owner row carries", () => {
	const plantedAccountUrl = {
		...ownerRow,
		agent: { ...ownerRow.agent, avatar_url: ownerRow.avatar_url },
	};
	const identities = [
		m.directoryIdentity(ownerRow, "agent"),
		m.directoryIdentity(ownerRow, "agent", "ep_aida"),
		m.directoryIdentity(plantedAccountUrl, "agent"),
		m.directoryIdentity({ ...ownerRow, agent: undefined }, "agent"),
		// Hand-built, the shape a future surface might write by mistake.
		{
			kind: "agent",
			account_id: OWNER,
			endpoint_id: "ep_aida",
			avatar_url: ownerRow.avatar_url,
		},
		{ kind: "agent", account_id: OWNER, endpoint_id: null },
	];
	for (const identity of identities) {
		const resolved = m.resolveIdentityAvatar(identity);
		assert.equal(resolved.kind, "agent");
		assert.notEqual(
			resolved.src?.type,
			"account",
			`agent resolved to an account avatar: ${JSON.stringify(identity)}`,
		);
		assert.equal(resolved.src, null, "no endpoint picture exists today");
		// The owner's row fields are never copied onto an agent identity.
		assert.equal(JSON.stringify(identity).includes("profile"), false);
	}
	// Control: the SAME row as a human resolves to the owner's photo.
	assert.deepEqual(
		m.resolveIdentityAvatar(m.directoryIdentity(ownerRow, "human")).src,
		{
			type: "account",
			accountId: OWNER,
			hash: HASH,
		},
	);
});

test("the endpoint seam: an agent's own picture resolves by endpoint, never another endpoint's", () => {
	const own = `/v1/endpoints/ep_aida/avatar?v=${HASH}`;
	const row = { ...ownerRow, agent: { ...ownerRow.agent, avatar_url: own } };
	assert.deepEqual(
		m.resolveIdentityAvatar(m.directoryIdentity(row, "agent")).src,
		{
			type: "endpoint",
			endpointId: "ep_aida",
			hash: HASH,
		},
	);
	assert.equal(
		m.resolveIdentityAvatar(m.directoryIdentity(row, "agent", "ep_other")).src,
		null,
	);
	assert.equal(
		m.resolveIdentityAvatar({
			kind: "agent",
			account_id: OWNER,
			endpoint_id: "ep_aida",
			avatar_url: "/v1/endpoints/ep_aida%2F..%2Fx/avatar?v=0123456789abcdef",
		}).src,
		null,
	);
});

test("a human keeps today's refusals: source=none, mismatched account, mismatched hash", () => {
	const human = (patch) =>
		m.resolveIdentityAvatar(
			m.directoryIdentity({ ...ownerRow, ...patch }, "human"),
		).src;
	assert.equal(
		human({
			profile: { avatar: { source: "none", hash: HASH, updated_at: "" } },
		}),
		null,
	);
	assert.equal(human({ account_id: "acc_someone_else" }), null);
	assert.equal(
		human({
			profile: {
				avatar: {
					source: "uploaded",
					hash: "fedcba9876543210",
					updated_at: "",
				},
			},
		}),
		null,
	);
});

test("the shipped plate draws the Bot glyph for an agent and never fetches the owner's photo", async () => {
	const requests = [];
	m.TeamBridgeApi.avatarBytes = async (request) => {
		requests.push(request);
		return { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
	};
	URL.createObjectURL = () => "blob:test/owner-photo";
	URL.revokeObjectURL = () => {};
	const client = new m.QueryClient();
	client.setQueryData(m.radientUserKeys.user(), {
		account: { id: "acc_viewer" },
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const plate = (kind) =>
		React.createElement(m.TeamBridgeAvatar, {
			member: ownerRow,
			kind,
			label: kind === "agent" ? "Aida (Damian Tran)" : "Damian Tran",
			size: 36,
			// A surface's person placeholder must not leak into an agent plate.
			fallback: "D",
		});
	try {
		await act(async () =>
			root.render(
				React.createElement(m.QueryClientProvider, { client }, plate("agent")),
			),
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		assert.equal(requests.length, 0, "an agent plate asked for account bytes");
		assert.equal(
			host.querySelector("img"),
			null,
			"an agent plate drew an image",
		);
		assert.ok(
			host.querySelector("svg.lucide-bot"),
			"an agent plate must draw the Bot glyph",
		);
		assert.equal(
			host.textContent,
			"",
			"no person placeholder on an agent plate",
		);

		// Control: the same row as the person loads the owner's photo.
		await act(async () =>
			root.render(
				React.createElement(m.QueryClientProvider, { client }, plate("human")),
			),
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		assert.equal(requests.length, 1);
		assert.equal(requests[0].accountId, OWNER);
		assert.equal(
			host.querySelector("img")?.getAttribute("src"),
			"blob:test/owner-photo",
		);
	} finally {
		await act(async () => root.unmount());
		host.remove();
		client.clear();
	}
});
