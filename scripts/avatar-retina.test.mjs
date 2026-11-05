import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * AVATARS ARE SHARP ON RETINA (operator report 2026-11-03: "The avatar images
 * show up blurry in team bridge, can you make sure they're sharp at their sizes
 * on retina displays").
 *
 * The blur was a plate drawing the hub's 64 px derivative across more device
 * pixels than it has (36 CSS px x 2 = 72; the 64 px card x 2 = 128). The fix is
 * the rule `pickAvatarVariant(cssPx, dpr)`: the server variant must cover the
 * plate's DEVICE size. These tests pin that rule at every real call-site size,
 * pin that the Team Bridge plate actually asks the relay for that variant under
 * a 2x display (and re-picks when the display changes), and pin that the agent
 * mark is drawn at whole pixels.
 */

const dom = new JSDOM("<html><body></body></html>", {
	url: "http://localhost",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator ??= dom.window.navigator;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* A controllable display: `devicePixelRatio` plus the `(resolution: Xdppx)`
   media query the hook arms. `setDpr` fires `change` on the armed query, which
   is what the browser does when the window moves to another display. */
let dpr = 2;
const armed = new Set();
Object.defineProperty(window, "devicePixelRatio", {
	configurable: true,
	get: () => dpr,
});
window.matchMedia = (query) => {
	const listeners = new Set();
	const mql = {
		media: query,
		get matches() {
			return query === `(resolution: ${dpr}dppx)`;
		},
		addEventListener: (_type, fn) => {
			listeners.add(fn);
			armed.add(mql);
		},
		removeEventListener: (_type, fn) => {
			listeners.delete(fn);
			if (listeners.size === 0) armed.delete(mql);
		},
		fire: () => {
			for (const fn of [...listeners]) fn({ matches: mql.matches });
		},
	};
	return mql;
};
const setDpr = (next) => {
	dpr = next;
	for (const mql of [...armed]) mql.fire();
};

const bundle = await build({
	stdin: {
		contents: `
export { pickAvatarVariant, AVATAR_VARIANTS, pickAgentAvatarSize } from './src/shared/avatar-variant';
export { AgentMark } from './src/renderer/src/shared/agent-avatar/agent-mark';
export { useAgentAvatar } from './src/renderer/src/shared/agent-avatar/agent-avatar';
export { requestDesktopMediaOutcome } from './src/main/desktop-media';
export { TeamBridgeAvatar, agentMarkPx } from './src/renderer/src/features/team-bridge/team-bridge-profile-card';
export { useAccountAvatar } from './src/renderer/src/shared/hooks/use-account-avatar';
export { desktopKeys } from './src/renderer/src/shared/api/local-operator/desktop-hooks';
export { radientUserKeys, beginRadientAuthorityTransition } from './src/renderer/src/shared/hooks/radient-account-authority';
export { TeamBridgeApi } from './src/renderer/src/shared/api/local-operator/team-bridge-api';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	mainFields: ["module", "main"],
	conditions: ["import"],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	write: false,
	logLevel: "silent",
});
const file = new URL(`./_avatar-retina-${process.pid}.mjs`, import.meta.url);
await writeFile(file, bundle.outputFiles[0].text);
// Unlinked even when the import throws, so a failed run leaves no bundle.
const bundled = await import(file.href).finally(() => unlink(file));
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const m = {
	...bundled,
	createElement: React.createElement,
	act: React.act,
	createRoot,
};

/* Every CSS size an avatar plate is drawn at today (team-bridge rail 20,
   compose 20, add-members 24, mention popover 28, sidebar account row 28,
   message row 36, Team Bridge page 56, profile card / settings photo 64). */
const CALL_SITE_CSS = [20, 24, 28, 36, 56, 64];

test("pickAvatarVariant covers the plate's device pixels at every call-site size", () => {
	for (const ratio of [1, 2, 3]) {
		for (const css of CALL_SITE_CSS) {
			const variant = m.pickAvatarVariant(css, ratio);
			const device = Math.ceil(css * ratio);
			assert.ok(
				variant >= device || variant === 256,
				`${css} CSS px @${ratio}x -> ${variant} must be >= ${device} device px (or the 256 cap)`,
			);
			// Right-sized: never the large file when the small one already covers.
			if (device <= 64) assert.equal(variant, 64, `${css}@${ratio}x`);
			else assert.equal(variant, 256, `${css}@${ratio}x`);
		}
	}
	// The exact cases from the report: message row and profile card at 2x.
	assert.equal(m.pickAvatarVariant(36, 2), 256);
	assert.equal(m.pickAvatarVariant(64, 2), 256);
	assert.equal(m.pickAvatarVariant(36, 1), 64);
	// Fractional DPRs (Windows 125/150 %) round UP to the next device pixel.
	assert.equal(m.pickAvatarVariant(28, 1.25), 64); // 35
	assert.equal(m.pickAvatarVariant(56, 1.25), 256); // 70
	// Beyond the largest variant: capped, never undefined.
	assert.equal(m.pickAvatarVariant(128, 3), 256);
	// Zoomed out (dpr < 1) and garbage inputs never ask below the CSS size.
	assert.equal(m.pickAvatarVariant(64, 0.5), 64);
	assert.equal(m.pickAvatarVariant(36, Number.NaN), 64);
});

test("agent mark is whole CSS pixels at every plate size, inner one hairline smaller", () => {
	for (const size of [...CALL_SITE_CSS, 16, 32, 40, 48]) {
		const { outer, inner } = m.agentMarkPx(size);
		assert.ok(Number.isInteger(outer) && Number.isInteger(inner), `${size}`);
		assert.equal(inner, outer - 1);
		assert.ok(outer >= 8);
	}
	// Same proportion as the old 32% rule, rounded: 36 -> 12 (was 11.52),
	// 64 -> 20 (was 20.48), and the 8 px floor below 25 px.
	assert.deepEqual(m.agentMarkPx(36), { outer: 12, inner: 11 });
	assert.deepEqual(m.agentMarkPx(64), { outer: 20, inner: 19 });
	assert.deepEqual(m.agentMarkPx(20), { outer: 8, inner: 7 });
});

function fixture() {
	const client = new m.QueryClient();
	client.setQueryData(m.radientUserKeys.user(), { account: { id: "A" } });
	client.setQueryData(m.desktopKeys.capabilities, {
		desktop_available: true,
		features: { team_bridge_endpoint_avatar: 1 },
	});
	const reads = [];
	m.TeamBridgeApi.avatarBytes = async (request) => {
		reads.push({ kind: "account", size: request.size });
		return { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
	};
	m.TeamBridgeApi.endpointAvatarBytes = async (request) => {
		reads.push({ kind: "endpoint", size: request.size });
		return { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" };
	};
	let seq = 0;
	URL.createObjectURL = () => `blob:test/${++seq}`;
	URL.revokeObjectURL = () => {};
	const host = document.createElement("div");
	document.body.append(host);
	const root = m.createRoot(host);
	return {
		client,
		host,
		reads,
		render: (children) =>
			m.act(async () =>
				root.render(
					m.createElement(m.QueryClientProvider, { client }, children),
				),
			),
		async close() {
			await m.act(async () => {
				m.beginRadientAuthorityTransition(client);
				root.unmount();
			});
			host.remove();
			client.clear();
		},
	};
}

const person = (id) => ({
	account_id: id,
	display_name: id,
	avatar_url: `/v1/accounts/${id}/avatar?v=0123456789abcdef`,
});
const agentOf = (id) => ({
	account_id: id,
	display_name: id,
	agent: {
		endpoint_id: `ep_${id}`,
		avatar_url: `/v1/messaging/endpoints/ep_${id}/avatar?v=fedcba9876543210`,
	},
});

test("TeamBridgeAvatar at 36 and 64 CSS px on a 2x display requests the 256 variant", async () => {
	dpr = 2;
	const f = fixture();
	try {
		await f.render([
			m.createElement(m.TeamBridgeAvatar, {
				key: "row",
				member: person("acc_row"),
				kind: "human",
				label: "Row",
				size: 36,
			}),
			m.createElement(m.TeamBridgeAvatar, {
				key: "card",
				member: agentOf("acc_card"),
				kind: "agent",
				label: "Card",
				size: 64,
			}),
		]);
		assert.deepEqual(f.reads.map((r) => `${r.kind}:${r.size}`).sort(), [
			"account:256",
			"endpoint:256",
		]);
		for (const read of f.reads) assert.ok(read.size >= 2 * 64);
		// The agent mark renders at integer px from the plate size.
		const mark = f.host.querySelector("[data-agent-mark]");
		assert.equal(mark.style.width, "20px");
		assert.equal(mark.firstElementChild.style.width, "19px");
	} finally {
		await f.close();
	}
});

test("a 1x display keeps the small variant, and moving to 2x re-picks without a remount", async () => {
	dpr = 1;
	const f = fixture();
	try {
		await f.render(
			m.createElement(m.TeamBridgeAvatar, {
				member: person("acc_move"),
				kind: "human",
				label: "Move",
				size: 36,
			}),
		);
		assert.deepEqual(
			f.reads.map((r) => r.size),
			[64],
		);
		await m.act(async () => setDpr(2));
		assert.deepEqual(
			f.reads.map((r) => r.size),
			[64, 256],
		);
		// The listener re-armed for the new ratio, so the move back is seen too,
		// and the 64 already cached for this version is reused (no third read).
		await m.act(async () => setDpr(1));
		assert.deepEqual(
			f.reads.map((r) => r.size),
			[64, 256],
		);
	} finally {
		await f.close();
	}
});

test("plates of different CSS sizes on the same variant share one read", async () => {
	dpr = 2;
	const f = fixture();
	function Account({ css }) {
		const url = m.useAccountAvatar(
			{ accountId: "acc_shared", hash: "0123456789abcdef" },
			css,
		);
		return m.createElement("img", { src: url });
	}
	try {
		// 36@2x and 64@2x both resolve to 256: one fetch, keyed by variant.
		await f.render([
			m.createElement(Account, { key: "a", css: 36 }),
			m.createElement(Account, { key: "b", css: 64 }),
		]);
		assert.deepEqual(
			f.reads.map((r) => r.size),
			[256],
		);
	} finally {
		await f.close();
	}
});

/*
 * LOCAL AGENT PICTURES (core `agent_avatar_sizes`, local-operator #3381). Every
 * surface that draws one, at its CSS size: chat sidebar row 16, chat session
 * mark 16, Agents roster 16, chat header 20, message avatar 20, agents sidebar
 * 32, agent detail summary portrait 80. The relay asks core for the smallest
 * of 64/128/256 covering the device pixels - and asks for NO size when core
 * does not advertise the feature (an older core serves the 512 px original).
 */
const AGENT_CALL_SITE_CSS = [16, 20, 32, 80];

test("pickAgentAvatarSize covers device pixels at every local-agent call site", () => {
	for (const ratio of [1, 2, 3])
		for (const css of AGENT_CALL_SITE_CSS) {
			const size = m.pickAgentAvatarSize(css, ratio);
			const device = Math.ceil(css * ratio);
			assert.ok(
				size >= device || size === 256,
				`${css} CSS px @${ratio}x -> ${size} must be >= ${device} (or the 256 cap)`,
			);
			assert.ok([64, 128, 256].includes(size));
		}
	assert.equal(m.pickAgentAvatarSize(20, 2), 64);
	assert.equal(m.pickAgentAvatarSize(32, 3), 128);
	assert.equal(m.pickAgentAvatarSize(80, 1), 128);
	assert.equal(m.pickAgentAvatarSize(80, 2), 256);
	assert.equal(m.pickAgentAvatarSize(80, 3), 256);
});

function agentFixture({ sizes }) {
	const client = new m.QueryClient();
	client.setQueryData(m.desktopKeys.capabilities, {
		desktop_available: true,
		features: sizes
			? { agent_avatar: 1, agent_avatar_sizes: 1 }
			: { agent_avatar: 1 },
	});
	const reads = [];
	window.api = {
		desktop: {
			media: async (request) => {
				reads.push(request);
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: new Uint8Array([137, 80, 78, 71]),
				};
			},
		},
	};
	let seq = 0;
	URL.createObjectURL = () => `blob:agent/${++seq}`;
	URL.revokeObjectURL = () => {};
	const host = document.createElement("div");
	document.body.append(host);
	const root = m.createRoot(host);
	return {
		reads,
		render: (children) =>
			m.act(async () =>
				root.render(
					m.createElement(m.QueryClientProvider, { client }, children),
				),
			),
		async close() {
			await m.act(async () => root.unmount());
			host.remove();
			client.clear();
			window.api = undefined;
		},
	};
}

const AGENT_SHA = "c".repeat(64);
let agentSeq = 0;
function Agent({ id, css }) {
	const url = m.useAgentAvatar(id, AGENT_SHA, css);
	return m.createElement("img", { src: url ?? undefined });
}

for (const ratio of [1, 2, 3])
	test(`local agent reads at ${ratio}x ask core for >= DPR x CSS at every call site`, async () => {
		dpr = ratio;
		const f = agentFixture({ sizes: true });
		try {
			// A fresh agent id per CSS size: the blob cache is module-wide, and
			// the assertion is about what each surface ASKS for.
			const ids = AGENT_CALL_SITE_CSS.map(
				(css) => `agent-${ratio}x-${css}-${++agentSeq}`,
			);
			await f.render(
				AGENT_CALL_SITE_CSS.map((css, i) =>
					m.createElement(Agent, { key: css, id: ids[i], css }),
				),
			);
			assert.equal(f.reads.length, AGENT_CALL_SITE_CSS.length);
			for (const [i, css] of AGENT_CALL_SITE_CSS.entries()) {
				const read = f.reads.find((r) => r.agentId === ids[i]);
				assert.equal(read.op, "agent.avatar");
				assert.ok(
					read.size >= Math.min(256, Math.ceil(css * ratio)),
					`${css} CSS px @${ratio}x asked ${read.size}`,
				);
			}
		} finally {
			await f.close();
		}
	});

test("no size is sent when core does not advertise agent_avatar_sizes, nor for the editor's original", async () => {
	dpr = 2;
	const f = agentFixture({ sizes: false });
	try {
		await f.render([
			m.createElement(Agent, {
				key: "a",
				id: `agent-old-${++agentSeq}`,
				css: 20,
			}),
			m.createElement(Agent, {
				key: "b",
				id: `agent-old-${++agentSeq}`,
				css: 80,
			}),
		]);
		assert.equal(f.reads.length, 2);
		for (const read of f.reads) assert.equal("size" in read, false);
	} finally {
		await f.close();
	}
	const g = agentFixture({ sizes: true });
	try {
		// No CSS size = the editor's crop preview: it must see the stored original.
		await g.render(
			m.createElement(Agent, { id: `agent-editor-${++agentSeq}` }),
		);
		assert.equal(g.reads.length, 1);
		assert.equal("size" in g.reads[0], false);
	} finally {
		await g.close();
	}
});

test("AgentMark forwards its CSS size to the read", async () => {
	dpr = 2;
	const f = agentFixture({ sizes: true });
	try {
		await f.render(
			m.createElement(m.AgentMark, {
				agentId: `agent-mark-${++agentSeq}`,
				sha256: AGENT_SHA,
				className: "size-5",
				cssPx: 20,
				fallback: null,
			}),
		);
		assert.deepEqual(
			f.reads.map((r) => r.size),
			[64],
		);
	} finally {
		await f.close();
	}
});

test("main sends ?size only when asked, and refuses a size core does not serve", async () => {
	const original = globalThis.fetch;
	const urls = [];
	globalThis.fetch = async (url) => {
		urls.push(String(url));
		return new Response(new Uint8Array([137, 80, 78, 71]), {
			status: 200,
			headers: { "Content-Type": "image/png" },
		});
	};
	try {
		const run = (request) =>
			m.requestDesktopMediaOutcome(
				request,
				null,
				"http://127.0.0.1:1111",
				"test-bearer",
			);
		await run({
			op: "agent.avatar",
			agentId: "a1",
			sha256: AGENT_SHA,
			size: 128,
		});
		await run({ op: "agent.avatar", agentId: "a1", sha256: AGENT_SHA });
		assert.deepEqual(urls, [
			`http://127.0.0.1:1111/v1/agents/a1/avatar?v=${AGENT_SHA}&size=128`,
			`http://127.0.0.1:1111/v1/agents/a1/avatar?v=${AGENT_SHA}`,
		]);
		const refused = await run({
			op: "agent.avatar",
			agentId: "a1",
			sha256: AGENT_SHA,
			size: 512,
		});
		assert.equal(urls.length, 2, "an unserved size never reaches core");
		assert.notEqual(refused.response?.kind, "bytes");
	} finally {
		globalThis.fetch = original;
	}
});
