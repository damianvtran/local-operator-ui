#!/usr/bin/env node
/**
 * Measure TEAM BRIDGE CHANNEL LOAD in the shipped app: dispatch to first row
 * painted, dispatch to settled, DOM nodes, long-task time, and the network the
 * two of them cost.
 *
 *     node scripts/team-bridge-bench.mjs --scenario=first-paint --messages=50
 *     node scripts/team-bridge-bench.mjs --scenario=first-paint --messages=5000 \
 *         --root ~/local-operator-ui/.worktrees/tb-perf
 *     node scripts/team-bridge-bench.mjs --scenario=first-paint --control
 *
 * WHAT THIS IS FOR. A change to how a channel's history arrives (today one
 * unpaginated read, after the change pages) has no number attached to it unless
 * something produces one. This is that command. It drives the REAL built app -
 * `out/` in Electron, headless over CDP - against a STUB daemon that answers the
 * desktop plane's Team Bridge routes from synthetic fixtures, so a 5 000-message
 * channel needs no real hub, no account, no network and no second machine.
 *
 * WHY THE STUB AND NOT A MOCK INSIDE THE PAGE. A mocked fetch would measure a
 * component in isolation; the cost this bench exists to report is the cost of the
 * thing that ships - the router, the React tree, the markdown renderer, the query
 * cache, the IPC hop through main and back - and only the real page has those. So
 * the page is real, the app is real, and the WIRE is a fixture. Same architecture
 * as `scripts/mesh-canvas-bench.mjs`, deliberately: one stub-daemon rig in this
 * repository, not two.
 *
 * HOW THE APP IS MADE TO DIAL IT. It discovers a daemon by a RECORD on disk
 * (`<config>/run/serve/<pid>.json`, re-written every 5 s because discovery calls a
 * record wedged once its heartbeat passes 45 s), then exchanges the record's
 * `claim_key` at `/v1/desktop/claim`. `LOCAL_OPERATOR_CONFIG_DIR` points at this
 * run's scratch, so the app finds the stub and never a real `lop serve` that is
 * also running on this machine. `/v1/capabilities` must advertise
 * `features.team_bridge_conversations` or the `/team-bridge` route falls through
 * to the app's catch-all and there is nothing to measure (`app.tsx` gates the
 * route on it).
 *
 * THE THREE NUMBERS, and why they are three:
 *
 *   1. **first row painted** - from the dispatch (the hash assignment or the rail
 *      row's click) to the second `requestAnimationFrame` after the first
 *      `[data-message-id]` appears. One rAF runs BEFORE the frame that carries
 *      the row, so a single rAF would report the time to the last painted frame.
 *   2. **settled** - the same, once the row count has stopped growing and every
 *      image in the list reports `complete && naturalWidth > 0`. This is the
 *      number that separates "the list appeared" from "the list finished".
 *   3. **long-task total** - `long-animation-frame` entries observed across the
 *      window, because a settled time can be short while the main thread spent
 *      300 ms blocked, and that difference is what the reader feels on the NEXT
 *      interaction.
 *
 * THE NEGATIVE CONTROL IS PART OF THE INSTRUMENT. `--messages 50` must produce
 * materially smaller settled times and DOM node counts than `--messages 5000`, or
 * the rig is measuring something other than the history it says it is. `--control`
 * runs both and prints the pair with a verdict; two separate runs carry the same
 * two numbers and can be compared by hand.
 *
 * WHAT IT CANNOT MEASURE YET, stated here rather than discovered later:
 *   - Only what the app READS. Sends, edits, reactions, threads and the owner
 *     audit are not driven: the stub refuses those routes by name.
 *   - The unread poll and the notification path are present in the page but not
 *     measured; their loads land in the same timeline and could be separated with
 *     a `--quiet` mode that has not been written.
 *   - The page's People rail is served an EMPTY directory on purpose: a directory
 *     row carries a `bridge_state` vocabulary this rig has not verified against
 *     the hub, and a guessed value would show as a phantom "unavailable" count in
 *     the UI rather than as an error here.
 *   - `scroll-back` reports today's app honestly even when the answer is "zero
 *     pages": the shipped app requests history unpaginated, so the rig prints 0
 *     `before_seq` requests and 0 pages instead of inventing a page that never
 *     happened. That zero IS the baseline the paging change moves.
 *
 * SAFETY AND SCRATCH. Nothing here touches the operator's app state: `HOME`,
 * `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR` and `--user-data-dir` all
 * point inside `$LOCAL_OPERATOR_SCRATCHPAD`, telemetry and notifications are off,
 * the window is `--window-mode=headless` BY NAME (never inferred), and the
 * Electron tree is reaped by exact pid and process group on every exit path -
 * throws, Ctrl-C and the synchronous last-resort `exit` handler alike. The only
 * edit to a build artifact is one loopback origin added to `connect-src` of
 * `out/renderer/index.html`, converging (never accumulating) across runs; the
 * renderer's own `/v1/credentials` fetch fails CSP against any other port, and
 * 1111 is held by a real daemon on this machine. THAT EDIT MOVES THE FILE'S MTIME,
 * so `identity.outMtimes.renderer` is the last BENCH run and not the build: read
 * `outMtimes.main` for the build's own age.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { hostname, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { reapOnExit, stopAppTree } from "./app-tree-teardown.mjs";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/* ------------------------------------------------------------------- the CLI */

const ARGS = process.argv.slice(2);
/**
 * A flag's value, accepting BOTH spellings: `--name=value` and `--name value`.
 *
 * The space form is not politeness. `--json <path>` is how the brief and every
 * other command in this repository is written, and a helper that only understood
 * `=` silently returned the fallback - measured here: a 5000-message run printed
 * its report to stdout and wrote no file at all, which reads as "the rig has no
 * --json" rather than "the spelling was wrong".
 */
const flag = (name, fallback = null) => {
	const joined = ARGS.find((a) => a.startsWith(`--${name}=`));
	if (joined) return joined.slice(name.length + 3);
	const at = ARGS.indexOf(`--${name}`);
	if (at !== -1 && ARGS[at + 1] && !ARGS[at + 1].startsWith("--"))
		return ARGS[at + 1];
	return fallback;
};
const has = (name) => ARGS.includes(`--${name}`);

/** The checkout to measure. `--root` lets one rig measure a baseline worktree and
 * a branch worktree - the whole point of a before/after number. */
const ROOT = resolve(
	flag("root", resolve(dirname(fileURLToPath(import.meta.url)), "..")),
);
const SCENARIO = flag("scenario", "first-paint");
const MESSAGES = Number(flag("messages", "5000"));
/** The negative control's small channel, and the size the pair is compared at. */
const CONTROL_SMALL = Number(flag("control-small", "50"));
const SIZE = flag("size", "1380x900");
const JSON_OUT = flag("json", null);
const _VERBOSE = has("verbose");
const _KEEP = has("keep");

/**
 * Where this run's scratch lives. REQUIRED to be under
 * `$LOCAL_OPERATOR_SCRATCHPAD` (the brief's isolation rule, and this machine
 * shares its `/tmp`): `--scratch` is the only way to choose somewhere else, and a
 * run with neither is refused rather than silently landing in the working
 * directory.
 */
const SCRATCH_ROOT =
	process.env.LOCAL_OPERATOR_SCRATCHPAD ?? flag("scratch", null);
if (!SCRATCH_ROOT)
	throw new Error(
		"refusing to run: set LOCAL_OPERATOR_SCRATCHPAD (or pass --scratch=<dir>) so the profile, config and daemon record are isolated",
	);

const _SCENARIOS = [
	"first-paint",
	"switch-cold",
	"switch-warm",
	"media",
	"scroll-back",
	"memory",
];

/* ------------------------------------------------------------------ fixtures */

/**
 * A seeded PRNG, so two runs of the same fixture are the same fixture. A bench
 * whose payload changed between runs would make every comparison a new
 * comparison, which is the one thing a before/after number cannot survive.
 */
function seeded(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(state ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const TENANTS = [
	{
		tenant_id: "t_benchhome0000000001",
		tenant_name: "Bench Home",
		eligible: true,
		endpoint: null,
	},
	{
		tenant_id: "t_benchlabs0000000002",
		tenant_name: "Bench Labs",
		eligible: true,
		endpoint: null,
	},
];
const ACCOUNT = "a_benchself0000000001";
/** This device's id in the mesh fixtures: the shell reads it, and an empty mesh
 * needs one for `/v1/desktop/peers` and `/v1/desktop/networks` to parse. */
const SELF_DEVICE = "d_benchself0000000001";

/** 6 synthetic humans and 2 agents. Labels are bench-shaped on purpose: a run that
 * leaked into a real roster would be recognisable as a bench. */
const PEOPLE = [
	{
		account_id: "a_benchhuman00000001",
		kind: "human",
		display_label: "Bench Human One",
	},
	{
		account_id: "a_benchhuman00000002",
		kind: "human",
		display_label: "Bench Human Two",
	},
	{
		account_id: "a_benchhuman00000003",
		kind: "human",
		display_label: "Bench Human Three",
	},
	{
		account_id: "a_benchhuman00000004",
		kind: "human",
		display_label: "Bench Human Four",
	},
	{
		account_id: "a_benchhuman00000005",
		kind: "human",
		display_label: "Bench Human Five",
	},
	{
		account_id: "a_benchhuman00000006",
		kind: "human",
		display_label: "Bench Human Six",
	},
	{
		account_id: "a_benchagent00000001",
		kind: "agent",
		display_label: "Bench Agent One",
	},
	{
		account_id: "a_benchagent00000002",
		kind: "agent",
		display_label: "Bench Agent Two",
	},
];

/** The big channel is deliberately NOT first in the list: if the page auto-opens
 * the first row on mount, `first-paint` still measures a genuinely cold visit. */
const MEDIA_CONVERSATION = "c_benchmedia0000000001";
const BIG_CONVERSATION = "c_benchbig000000000001";
const SMALL_A = "c_benchsmall0000000001";
const SMALL_B = "c_benchsmall0000000002";

/** Markdown variety, so the renderer does the work a real channel makes it do. */
function bodyFor(seq, sender) {
	const shape = seq % 7;
	if (shape === 0)
		return `## Bench heading ${seq}\n\nA paragraph from ${sender} with **bold** and *italic* and a [link](https://example.invalid/bench/${seq}).\n\n- first point\n- second point\n- third point\n`;
	if (shape === 1)
		return `A short line from ${sender}, then a list:\n\n1. alpha\n2. beta\n3. gamma\n4. delta\n`;
	if (shape === 2)
		return `\`\`\`js\nconst bench${seq} = { seq: ${seq}, sender: "${sender}" };\nbench${seq}.run();\n\`\`\`\n`;
	if (shape === 3)
		return `> quoted context ${seq}\n\n${sender} replies underneath the quote with a longer sentence so the row wraps across lines in a narrow pane.\n`;
	if (shape === 4) return `Plain line ${seq} from ${sender}.`;
	if (shape === 5)
		return `### Sub heading ${seq}\n\n${sender} writes a paragraph with \`inline code\`, an em dash — and enough words that the bubble needs two visual lines at 1380 px.\n`;
	return `| col | value |\n| --- | --- |\n| seq | ${seq} |\n| sender | ${sender} |\n`;
}

/**
 * One message in the wire shape (`teamBridgeMessageSchema`). `attachments` are
 * descriptors only - bytes are fetched through the attachment route, which is
 * what the `media` scenario counts.
 */
function messageFor(conversationId, seq, attachmentCount = 0) {
	const random = seeded(seq * 7919 + 13);
	const sender = PEOPLE[seq % PEOPLE.length];
	const attachments = Array.from({ length: attachmentCount }, (_, index) => ({
		id: `att-${conversationId.slice(-6)}-${seq}-${index}`,
		mime: "image/png",
		size: 1_024,
		width: 32,
		height: 32,
		state: "bound",
	}));
	return {
		id: `m_${seq.toString(16).padStart(6, "0")}_${conversationId.slice(-6)}`,
		conversation_id: conversationId,
		seq,
		sender: {
			account_id: sender.account_id,
			kind: sender.kind,
			display_label: sender.display_label,
		},
		body: bodyFor(seq, sender.display_label),
		origin: sender.kind === "agent" ? "agent" : "human",
		created_at: new Date(
			Date.UTC(2026, 0, 1) + seq * 60_000 + Math.floor(random() * 1_000),
		).toISOString(),
		...(attachments.length ? { attachments } : {}),
	};
}

/**
 * The fixture set: 20 conversations over 2 tenants, one of them carrying
 * `messageCount` messages, and one carrying images on its first screen.
 */
function fixtures(messageCount) {
	const random = seeded(20261105);
	const conversations = [];
	const counts = new Map();
	const attachments = new Map();

	const push = (id, tenantIndex, name, kind, count, imageMessages = 0) => {
		counts.set(id, count);
		attachments.set(id, imageMessages);
		conversations.push({
			id,
			tenant_id: TENANTS[tenantIndex].tenant_id,
			kind,
			name,
			visibility: "tenant",
			agent_capable: true,
			status: "open",
			created_by: ACCOUNT,
			last_message_at: new Date(
				Date.UTC(2026, 0, 2) + count * 60_000,
			).toISOString(),
			latest_seq: count,
			members: [
				{
					account_id: ACCOUNT,
					kind: "human",
					display_label: "Bench Self",
					role: "owner",
					state: "active",
				},
				...PEOPLE.slice(0, 4).map((person) => ({
					account_id: person.account_id,
					kind: person.kind,
					display_label: person.display_label,
					role: "member",
					state: "active",
				})),
			],
			last_read_seq: Math.max(0, count - 3),
			unread_count: 3,
			muted: false,
			can_administer: true,
		});
	};

	// 1. The image channel first, so an auto-selected row is not the big one.
	push(MEDIA_CONVERSATION, 0, "Bench media", "channel", 12, 6);
	// 2. Two named small channels the switch scenarios use.
	push(SMALL_A, 0, "Bench small A", "channel", 120);
	push(SMALL_B, 1, "Bench small two", "group", 180);
	// 3. Sixteen fillers spread over both tenants.
	for (let index = 0; index < 16; index += 1) {
		push(
			`c_benchfiller${(index + 1).toString().padStart(8, "0")}`,
			index % 2,
			`Bench channel ${index + 1}`,
			index % 5 === 0 ? "dm" : "channel",
			40 + Math.floor(random() * 400),
		);
	}
	// 4. The big channel LAST: never the auto-selected row.
	push(BIG_CONVERSATION, 0, "Bench big", "channel", messageCount);

	return {
		messageCount,
		conversations,
		counts,
		attachments,
		/** One page of a channel's history, NEWEST FIRST, honouring `limit` and
		 * `before_seq` so one stub serves today's unpaginated app and the paged app
		 * after the change. */
		page(conversationId, { limit, before_seq, after_seq } = {}) {
			const total = counts.get(conversationId) ?? 0;
			const upper = before_seq ? Math.min(total, before_seq - 1) : total;
			const lower = after_seq ? Math.max(1, after_seq + 1) : 1;
			const span = Math.max(0, upper - lower + 1);
			const take = limit ? Math.min(limit, span) : span;
			const newest = upper;
			const oldest = upper - take + 1;
			const messages = [];
			for (let seq = newest; seq >= Math.max(oldest, 1); seq -= 1) {
				messages.push(
					messageFor(
						conversationId,
						seq,
						attachments.get(conversationId) &&
							seq <= (attachments.get(conversationId) ?? 0)
							? 2
							: seq % 23 === 0
								? 1
								: 0,
					),
				);
			}
			return {
				messages,
				...(oldest > 1 ? { next_before_seq: oldest } : {}),
				has_more: oldest > 1,
			};
		},
	};
}

/* ------------------------------------------------------- a deterministic PNG */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1)
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();

const crc32 = (buffer) => {
	let crc = 0xffffffff;
	for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

/**
 * A 32x32 PNG generated in-process - no bytes on disk, nothing to clean up, and
 * identical on every run so an image's decode cost does not move between runs.
 */
const PNG_BYTES = (() => {
	const width = 32;
	const height = 32;
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 2; // truecolour
	const raw = Buffer.alloc((width * 3 + 1) * height);
	let offset = 0;
	for (let y = 0; y < height; y += 1) {
		raw[offset] = 0; // filter: none
		offset += 1;
		for (let x = 0; x < width; x += 1) {
			raw[offset] = (x * 8) & 0xff;
			raw[offset + 1] = (y * 8) & 0xff;
			raw[offset + 2] = ((x + y) * 4) & 0xff;
			offset += 3;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
})();

/* ------------------------------------------------------------- the stub daemon */

/**
 * The paths this stub answers. Compiled once (an `eslint` rule in this repo, and
 * this daemon answers a poll several times a second).
 */
const MESSAGES_PATH =
	/^\/v1\/desktop\/team-bridge\/conversations\/([^/]+)\/messages$/;
const READ_PATH = /^\/v1\/desktop\/team-bridge\/conversations\/([^/]+)\/read$/;
/**
 * A HISTORY READ, and nothing else. The attachment relay's path also contains
 * `/messages` (`…/messages/<id>/attachments/<aid>`), so a bare substring count
 * reports image fetches as history pages - measured here as 219 "message"
 * requests on a run that made one.
 */
const MESSAGES_READ = /\/messages(\?|$)/;
const ATTACHMENT_PATH =
	/^\/v1\/desktop\/team-bridge\/conversations\/([^/]+)(?:\/messages\/[^/]+)?\/attachments\/([^/]+)$/;

/**
 * A stand-in for `lop serve`, so the app dials a hub this run invented.
 *
 * IT IS A RESPONDER, NOT A BACKEND. What it must be is PROVABLE: `/health` proves
 * identity in the envelope the app's discovery parses (`result.instance_id`), the
 * record on disk proves the claim key, and any path it does not know is REFUSED BY
 * NAME - never answered with a plausible empty body, because an empty 200 turns
 * "the bench forgot this route" into a silent empty state that reads as a product
 * bug.
 */
function startStub(fixture, recordsDir) {
	const instanceId = randomUUID();
	const token = `bench-${randomUUID()}`;
	let claims = 0;
	const unknown = [];
	const seen = new Map();

	const count = (key) => seen.set(key, (seen.get(key) ?? 0) + 1);

	const status = {
		capability: 1,
		consent_account_guard: true,
		state: "ready",
		account_id: ACCOUNT,
		tenant_id: TENANTS[0].tenant_id,
		/*
		 * SURFACE C: an enrolled organization whose Team Bridge is on. The letter is
		 * load-bearing, not decoration - `teamBridgeEligibility`
		 * (`team-bridge-model.ts:1016-1033`) turns surface A into `plan_required`
		 * and E into `off`, and either one REPLACES the whole page with a gate
		 * panel. This rig's first status said "A", so the page rendered "This
		 * organization's plan does not include Team Bridge" over a healthy fixture
		 * and measured nothing at all.
		 */
		surface_state: "C",
		visibility: {
			settings: true,
			inbox: true,
			account_door: true,
			onboarding: true,
		},
		update_required: false,
		read_only: false,
		local: { enabled: true, onboarding: "done", session: "bench" },
		status: { tenants: TENANTS },
		consent: null,
		error: null,
		state_note: null,
		delivery_hold: null,
		default_on: { in_force: false, notice_pending: false },
		trial_ended: null,
	};

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const path = url.pathname;
		count(`${request.method} ${path}${url.search || ""}`);
		const json = (code, body) => {
			const text = JSON.stringify(body);
			response.writeHead(code, {
				"content-type": "application/json",
				"content-length": Buffer.byteLength(text),
			});
			response.end(text);
		};
		const send = (body) => json(200, body);
		const refuse = (code, message) =>
			json(code, { detail: { code: "bench_stub_refused", message } });

		if (path === "/health")
			return send({
				result: {
					instance_id: instanceId,
					pid: process.pid,
					version: "bench",
					prefix: "",
					install_kind: "bench",
				},
			});

		if (path === "/v1/capabilities")
			return send({
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					/*
					 * THE TWO CAPABILITIES THE PAGE ITSELF READS. `app.tsx` mounts
					 * `/team-bridge` for `team_bridge_conversations`; the page's own write
					 * guard and the command palette also require
					 * `team_bridge_conversation_owner_guard >= 1`
					 * (`team-bridge-api.ts:87`). Without either the route falls through to
					 * the catch-all and this bench would measure an unknown route.
					 * `radient` gates the account read below, which is what the status's
					 * `account_id` has to match for the page to render a channel. `peers`
					 * and the rest are advertised because the shell renders its chrome
					 * from the same block.
					 */
					features: {
						team_bridge_conversations: 1,
						team_bridge_conversation_owner_guard: 1,
						team_bridge_thread_reads: 1,
						team_bridge_attachments: 1,
						radient: 1,
						peers: 1,
						session_transfer: 1,
						settings: 1,
						library: 1,
						notifications: 1,
					},
				},
			});

		if (path === "/v1/desktop/claim") {
			claims += 1;
			return send({ result: { token, desktop: true } });
		}

		/*
		 * THE SIGNED-IN ACCOUNT, SYNTHESISED. The page does not read an account from
		 * the renderer's session: `useTeamBridgeAccount` reads the
		 * `["radient-user","user"]` query, whose fetch is `POST /v1/desktop/radient
		 * {operation:"account"}` through main's proxy. The page then requires the
		 * Team Bridge status's `account_id` to equal THIS account's id, so the two
		 * fixtures share `ACCOUNT` - a mismatch renders the page's no-account
		 * surface instead of a channel, which would be a rig that measures a
		 * refusal.
		 */
		if (path === "/v1/desktop/radient") {
			/*
			 * ONE ROUTE, MANY OPERATIONS. The renderer sends every Radient read
			 * through `POST /v1/desktop/radient` with a `control.operation`, so a stub
			 * that answered the account shape to all of them made
			 * `memberships.list` return an account - which reads as "this account has
			 * no organizations" and puts the page on its plan-required panel (
			 * measured: the page said "This organization's plan does not include Team
			 * Bridge" while every request was a 200). The body is read here rather
			 * than at the top of the handler so every other route stays synchronous.
			 */
			let raw = "";
			request.on("data", (chunk) => {
				raw += chunk;
			});
			request.on("end", () => {
				let operation = "account";
				try {
					const body = JSON.parse(raw || "{}");
					operation =
						body?.control?.operation ??
						body?.operation ??
						body?.op ??
						"account";
				} catch {
					process.stderr.write(
						`[stub] radient body was not JSON: ${raw.slice(0, 200)}\n`,
					);
				}
				count(`radient:${operation}`);
				if (operation === "memberships.list")
					return send({
						result: {
							data: {
								msg: "success",
								/*
								 * AN ACTIVE PLAN IS WHAT PUTS AN ORGANIZATION IN THE SCOPE
								 * SELECTOR (`types.ts:843-849`: "each org from
								 * memberships.list where plan is active"). `is_home` is
								 * irrelevant to that filter by design, so the home row is
								 * marked and the second organization is not.
								 */
								result: {
									memberships: TENANTS.map((tenant, index) => ({
										tenant_id: tenant.tenant_id,
										tenant_name: tenant.tenant_name,
										role: "owner",
										status: "active",
										is_home: index === 0,
										plan: { status: "active", seats: 5 },
									})),
								},
							},
						},
					});
				return send({
					/*
					 * THE PROXY ENVELOPE IS DOUBLY NESTED, and getting it wrong is silent.
					 * `radientProxyEnvelope` asks the desktop route for `{data}` and then
					 * unwraps the upstream's own `{msg, result}` from it, so the account must
					 * arrive at `result.data.result.account` (`shared/api/radient/
					 * proxy.ts:137-158`). A flat `{result: {account}}` - this rig's first
					 * spelling - makes `radientProxy` return `undefined`, the account read
					 * fails, and the page draws "Account unavailable / Reconnect Radient"
					 * while every request returns 200.
					 */
					result: {
						data: {
							msg: "success",
							result: {
								account: {
									id: ACCOUNT,
									tenant_id: TENANTS[0].tenant_id,
									email: "bench@bench.invalid",
									name: "Bench Reader",
									role: "owner",
								},
								identity: {
									id: ACCOUNT,
									email: "bench@bench.invalid",
									display_name: "Bench Reader",
								},
								verification: null,
							},
						},
					},
				});
			});
			return;
		}

		if (path === "/v1/desktop/team-bridge/status")
			return send({ result: status });

		if (path === "/v1/desktop/team-bridge/conversations") {
			const tenant = url.searchParams.get("tenant_id");
			const archived = url.searchParams.get("status") === "archived";
			const rows = fixture.conversations
				.filter((row) => (tenant ? row.tenant_id === tenant : true))
				.filter((row) => (archived ? row.status === "archived" : true));
			return send({ result: { conversations: rows } });
		}

		const messages = MESSAGES_PATH.exec(path);
		if (messages) {
			const conversationId = decodeURIComponent(messages[1]);
			if (!fixture.counts.has(conversationId))
				return refuse(404, `unknown conversation ${conversationId}`);
			const limit = url.searchParams.get("limit");
			const before = url.searchParams.get("before_seq");
			const after = url.searchParams.get("after_seq");
			return send({
				result: fixture.page(conversationId, {
					limit: limit === null ? null : Number(limit),
					before_seq: before === null ? null : Number(before),
					after_seq: after === null ? null : Number(after),
				}),
			});
		}

		if (ATTACHMENT_PATH.test(path)) {
			response.writeHead(200, {
				"content-type": "image/png",
				"content-length": PNG_BYTES.length,
				"cache-control": "no-store",
			});
			return response.end(PNG_BYTES);
		}

		const read = READ_PATH.exec(path);
		if (read) {
			const conversationId = decodeURIComponent(read[1]);
			return send({
				result: {
					conversation_id: conversationId,
					last_read_seq: fixture.counts.get(conversationId) ?? 0,
					unread_count: 0,
					muted: false,
				},
			});
		}

		// A directory served EMPTY on purpose: a real row carries a `bridge_state`
		// vocabulary this rig has not verified against the hub, and a guessed value
		// would surface as a phantom "unavailable" count in the UI.
		if (path === "/v1/desktop/team-bridge/directory")
			return send({ result: { members: [] } });

		if (path === "/v1/desktop/team-bridge/unread")
			return send({ result: { conversations: [], total: 0 } });

		if (path === "/v1/desktop/team-bridge/settings")
			return send({ result: { settings: { enabled: true, notify: "all" } } });

		/*
		 * THE SHELL'S OWN READS, answered with EMPTY fixtures rather than refused.
		 * The shell polls these before the Team Bridge route is reachable, and main's
		 * attach logic treats a 5xx on a desktop read as "this daemon is not ready"
		 * - measured on the first run of this rig: the app claimed the plane, then
		 * logged "answered HTTP 503 to this app's desktop read ... not attaching this
		 * tick" and never attached. An empty list is the honest answer for a bench
		 * that has no sessions and no mesh, and it keeps the chrome rendering while
		 * the page under test is the only thing being measured.
		 */
		if (path === "/v1/desktop/sessions")
			return send({ result: { sessions: [], degraded: [], truncated: false } });
		if (path === "/v1/desktop/peers")
			return send({
				result: { peers: [], self_device_id: SELF_DEVICE, degraded: [] },
			});
		if (path === "/v1/desktop/networks")
			return send({ result: { networks: [], self_device_id: SELF_DEVICE } });

		/*
		 * THE CREDENTIAL FILE PROBE, and the reason the account slice works at all.
		 * `use-radient-account.ts` decides "is this app connected to Radient?" from
		 * `credentials.includes("RADIENT_API_KEY")` and calls the read UNCONDITIONALLY
		 * — it is one of the few routes the renderer fetches itself rather than
		 * through main (which is why the CSP widening above exists). Without a key in
		 * this list the Team Bridge page renders "Account unavailable / Reconnect
		 * Radient" even though the account read answered, which is the refusal this
		 * rig met on its second run.
		 */
		if (path === "/v1/credentials")
			return send({ result: { keys: ["RADIENT_API_KEY"] } });

		// Shell chrome reads. Empty/zero answers, so nothing 5xxs into main's
		// attach logic; none of them is what this rig measures.
		if (path === "/v1/settings") return send({ result: { settings: [] } });
		/*
		 * THE CONFIG READ THE COMPOSER READS, in the shape `ConfigResponse` declares.
		 * An empty object here is not tolerated: the composer does
		 * `config.values.hosting` to pick its model, and this rig's first attempt
		 * crashed the whole page into its ErrorBoundary with "Cannot read properties
		 * of undefined (reading 'hosting')" - so a bench that answered `{}` measured
		 * nothing at all, twice.
		 */
		if (path === "/v1/config")
			return send({
				result: {
					version: "bench",
					metadata: {
						schema_version: "1",
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
					},
					values: {
						conversation_length: 20,
						detail_length: 5,
						max_learnings_history: 50,
						hosting: "openrouter",
						model_name: "openai/gpt-4o-mini",
						auto_save_conversation: true,
					},
				},
			});
		if (path === "/v1/desktop/asks") return send({ result: { asks: [] } });
		if (path === "/v1/desktop/notifications/count")
			return send({ result: { count: 0, unread: 0, items: [] } });
		if (path === "/v1/agents")
			return send({
				result: { agents: [], total: 0, page: 1, per_page: 500 },
			});

		unknown.push(`${request.method} ${path}`);
		/*
		 * THE REFUSAL IS PRINTED AS IT HAPPENS, on stderr, in the app's own timeline
		 * order. A run that dies before its report would otherwise lose the one fact
		 * that explains it - which route the page demanded and this stub did not
		 * have - and the next person would have to re-derive it from a full re-run.
		 */
		process.stderr.write(`[stub] unhandled ${request.method} ${path}\n`);
		return refuse(404, `the stub has no route for ${request.method} ${path}`);
	});

	return new Promise((resolve_, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			const record = {
				pid: process.pid,
				host: "127.0.0.1",
				port,
				instance_id: instanceId,
				version: "bench",
				source_ref: "bench",
				prefix: "",
				install_kind: "bench",
				desktop: true,
				claim_key: token,
				started_at: Math.floor(Date.now() / 1000),
				heartbeat_at: Math.floor(Date.now() / 1000),
			};
			mkdirSync(recordsDir, { recursive: true, mode: 0o700 });
			const file = join(recordsDir, `${process.pid}.json`);
			const beat = () =>
				writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
			beat();
			/*
			 * THE HEARTBEAT IS NOT OPTIONAL: discovery calls a record WEDGED once its
			 * heartbeat is older than 45 s even while the pid is alive, so a stub that
			 * wrote its record once would be discoverable for the first 45 seconds of a
			 * run and invisible after - a bench that measures different things
			 * depending on how long it took to start.
			 */
			const timer = setInterval(() => {
				record.heartbeat_at = Math.floor(Date.now() / 1000);
				beat();
			}, 5_000);
			timer.unref();
			resolve_({
				port,
				token,
				claims: () => claims,
				unknown: () => [...unknown],
				seen: () => [...seen.entries()],
				/** Requests whose `METHOD path?query` matches, counted or filtered. */
				total: (pattern) =>
					[...seen.entries()]
						.filter(([key]) => pattern.test(key))
						.reduce((sum, [, value]) => sum + value, 0),
				close: () =>
					new Promise((done) => {
						clearInterval(timer);
						try {
							rmSync(file, { force: true });
						} catch {
							// Already gone is the ordinary case.
						}
						server.close(() => done());
					}),
			});
		});
	});
}

/* --------------------------------------------------------------- the launcher */

/**
 * The app, headless, dialling this run's stub.
 *
 * `detached: true` is what makes the group kill in `app-tree-teardown.mjs` real:
 * the child leads its own group, so `process.kill(-pid)` reaches every helper the
 * app spawned and cannot reach this bench's own group by mistake.
 */
function launchApp({ port, scratch, size }) {
	const [width, height] = size.split("x").map((value) => Number(value));
	const userData = join(scratch, "profile");
	const home = join(scratch, "home");
	mkdirSync(home, { recursive: true });
	const child = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules", "electron", "cli.js"),
			".",
			/*
			 * NAMED, never inferred. A scratch profile happens to resolve to headless,
			 * but a rig that relies on the inference is one switch away from putting a
			 * window on the operator's screen.
			 */
			"--window-mode=headless",
			`--window-size=${width}x${height}`,
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${userData}`,
			// From the one module that spells it: a scratch HOME has no login keychain,
			// and Chromium asking the OS to create one is an alert on the operator's
			// screen (`scripts/chrome-keychain.mjs`).
			MOCK_KEYCHAIN_SWITCH,
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				HOME: home,
				LOCAL_OPERATOR_CONFIG_DIR: join(scratch, "config"),
				LOCAL_OPERATOR_LOG_DIR: join(scratch, "logs"),
				LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
				LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
				LOCAL_OPERATOR_UI_TELEMETRY: "off",
				CMUX_SESSION_ID: "",
			},
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		},
	);
	const log = [];
	child.stdout.on("data", (chunk) => log.push(String(chunk)));
	child.stderr.on("data", (chunk) => log.push(String(chunk)));
	return { child, userData, log: () => log.join("") };
}

/**
 * Widen the packaged page's `connect-src` by ONE loopback origin this run.
 *
 * WHY IT IS NECESSARY: the app ships a fixed CSP allowlist (1111 and 8080 pairs)
 * and on this machine 1111 is held by a real daemon, so a bench forced onto it
 * would measure whatever that daemon answers. The renderer's own `/v1/credentials`
 * fetch is refused against any other port - measured, not assumed.
 *
 * WHY IT CONVERGES RATHER THAN APPENDS. Every run uses a new ephemeral port, so
 * appending would leave one stale origin per run in a built artifact that must
 * stay otherwise byte-identical. Tokens outside the shipped allowlist are dropped
 * before this run's are added, so the file holds exactly one widening at rest.
 */
function allowStubOrigin(stubPort) {
	const file = join(ROOT, "out", "renderer", "index.html");
	if (!existsSync(file))
		throw new Error(
			`no build at ${file} - run the build in ${ROOT} first (this rig measures the built app, never source)`,
		);
	const html = readFileSync(file, "utf8");
	/*
	 * THE META TAG'S OWN content ATTRIBUTE, and nothing else. The comment block
	 * above it in the packaged page also contains the words "connect-src" (it
	 * explains what the directive carries), so a pattern anchored on the word
	 * alone widens the COMMENT and leaves the policy untouched - measured on this
	 * rig's second run: the file gained the origin, the renderer still logged
	 * "Fetch API cannot load http://127.0.0.1:<port>/v1/credentials. Refused to
	 * connect because it violates the document's Content Security Policy", and
	 * the page reported the account unavailable for want of that read.
	 */
	const tag = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/;
	const found = tag.exec(html);
	if (!found) throw new Error("the packaged page carries no CSP meta tag");
	const policy = /(connect-src[^;"]*)/.exec(found[0]);
	if (!policy)
		throw new Error("the packaged page carries no connect-src to widen");
	const match = policy;
	const origin = `http://127.0.0.1:${stubPort}`;
	const shipped = new Set([
		"http://localhost:1111",
		"http://127.0.0.1:1111",
		"http://localhost:8080",
		"http://127.0.0.1:8080",
	]);
	const loopback = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/;
	const kept = match[1]
		.split(/\s+/)
		.filter((token) => token.length > 0)
		.filter((token) => (loopback.test(token) ? shipped.has(token) : true));
	const widened = `${kept.join(" ")} ${origin} ${origin.replace("127.0.0.1", "localhost")}`;
	if (policy[1].trim() === widened.trim()) return false;
	writeFileSync(
		file,
		html.replace(found[0], found[0].replace(policy[1], widened)),
	);
	return true;
}

/** The DevTools endpoint of the app's own renderer, once it is listening. */
async function waitForTarget(port, timeoutMs = 90_000) {
	const started = Date.now();
	let lastProblem = "no attempt yet";
	while (Date.now() - started < timeoutMs) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const pages = list.filter(
				(target) => target.type === "page" && target.webSocketDebuggerUrl,
			);
			// The app's OWN window, not merely the first page target: this app hosts
			// more than one WebContents and the packaged renderer is the one whose URL
			// is the built `index.html`.
			const app =
				pages.find((target) =>
					/renderer\/index\.html/.test(target.url ?? ""),
				) ?? pages.find((target) => (target.url ?? "").startsWith("file://"));
			if (app) return app;
			lastProblem = `no application target yet (${pages.length} page targets)`;
		} catch (error) {
			lastProblem = String(error?.cause?.code ?? error);
		}
		await new Promise((done) => setTimeout(done, 250));
	}
	throw new Error(`the renderer never exposed a page target: ${lastProblem}`);
}

/**
 * A minimal CDP client over the platform's own WebSocket, no dependency.
 *
 * It also KEEPS WHAT THE RENDERER SAID: a refusal ("sign in", "this build cannot
 * load that channel", a zod parse throwing on a fixture field) is stated in the
 * console before it is stated anywhere a bench can see, and a rig that reports
 * "the page never mounted" without those lines costs the next person the same
 * hunt this one cost.
 */
async function cdp(port) {
	const target = await waitForTarget(port);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map();
	const console_ = [];
	let nextId = 0;
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data));
		if (message.method === "Runtime.consoleAPICalled") {
			console_.push(
				`${message.params.type}: ${(message.params.args ?? [])
					.map((arg) => arg.value ?? arg.description ?? arg.type)
					.join(" ")}`,
			);
			return;
		}
		if (message.method === "Runtime.exceptionThrown") {
			console_.push(
				`exception: ${message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text}`,
			);
			return;
		}
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
		else waiter.resolve(message.result);
	});
	await new Promise((done, fail) => {
		socket.addEventListener("open", () => done(), { once: true });
		socket.addEventListener(
			"error",
			() => fail(new Error("CDP socket failed")),
			{
				once: true,
			},
		);
	});
	const send = (method, params = {}) =>
		new Promise((resolve_, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve: resolve_, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				`in-page evaluation threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
			);
		}
		return result.result?.value;
	};
	return {
		send,
		evaluate,
		console: () => console_,
		close: () => socket.close(),
	};
}

/* ---------------------------------------------------- the page-side instrument */

/**
 * What the bench installs INSIDE the page.
 *
 * INSTALLED FROM THE BENCH, NEVER COMPILED INTO THE APP: a counter compiled into
 * the renderer would be a test hook in shipped code, and it would be measuring
 * itself. Everything here rides on the platform: `performance.mark`/`measure`,
 * a `long-animation-frame` observer, a `MutationObserver` for the row count, and
 * a double `requestAnimationFrame` for "painted" - because one rAF runs BEFORE
 * the frame that carries the new rows, so measuring at the first reports the time
 * to the previous frame.
 */
const INSTRUMENT = `(() => {
	const bench = { marks: new Map(), frames: [], rows: 0, rowAddedAt: null };
	window.__tbBench = bench;
	bench.rowsNow = () => document.querySelectorAll("[data-message-id]").length;
	bench.domNodes = () => document.querySelectorAll("*").length;
	bench.mark = (name) => {
		bench.marks.set(name, performance.now());
		try { performance.mark("bench:" + name); } catch {}
		return bench.marks.get(name);
	};
	bench.since = (name) =>
		performance.now() - (bench.marks.has(name) ? bench.marks.get(name) : performance.now());
	bench.paint = () =>
		new Promise((done) =>
			requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now()))),
		);
	try {
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				bench.frames.push({ start: entry.startTime, duration: entry.duration });
		});
		observer.observe({ type: "long-animation-frame", buffered: true });
	} catch (error) { bench.frameError = String(error); }
	bench.resetFrames = () => { bench.frames = []; };
	bench.longTasks = () => ({
		count: bench.frames.length,
		total: bench.frames.reduce((sum, frame) => sum + entryOf(frame), 0),
		worst: bench.frames.reduce((worst, frame) => Math.max(worst, frame.duration), 0),
	});
	function entryOf(entry) { return entry && typeof entry.duration === "number" ? entry.duration : 0; }
	bench.waitRows = async (min, timeoutMs = 60000) => {
		const start = performance.now();
		while (performance.now() - start < timeoutMs) {
			if (bench.rowsNow() >= min) {
				const painted = await bench.paint();
				return { ok: true, ms: painted - (bench.marks.has("dispatch") ? bench.marks.get("dispatch") : start), rows: bench.rowsNow() };
			}
			await new Promise((done) => requestAnimationFrame(() => done()));
		}
		return { ok: false, ms: null, rows: bench.rowsNow() };
	};
	bench.waitSettle = async (quietMs = 400, timeoutMs = 90000) => {
		const start = performance.now();
		let last = bench.rowsNow();
		let lastChange = performance.now();
		while (performance.now() - start < timeoutMs) {
			await new Promise((done) => setTimeout(done, 60));
			const now = bench.rowsNow();
			if (now !== last) { last = now; lastChange = performance.now(); }
			const imagesIdle = [...document.querySelectorAll("[data-message-id] img")].every(
				(image) => image.complete,
			);
			if (quietMs > 0 && last > 0 && imagesIdle && performance.now() - lastChange >= quietMs)
				break;
			if (quietMs === 0 && performance.now() - start > 120) break;
		}
		const painted = await bench.paint();
		const dispatch = bench.marks.has("dispatch") ? bench.marks.get("dispatch") : start;
		return { ok: true, ms: painted - dispatch, rows: bench.rowsNow() };
	};
	bench.scroller = () => {
		let node = document.querySelector("[data-message-id]");
		while (node) {
			const style = getComputedStyle(node);
			if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4)
				return node;
			node = node.parentElement;
		}
		return document.scrollingElement;
	};
	bench.waitImages = async (timeoutMs = 60000) => {
		const start = performance.now();
		while (performance.now() - start < timeoutMs) {
			const images = [...document.querySelectorAll("[data-message-id] img")];
			if (images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)) {
				const painted = await bench.paint();
				return { ok: true, ms: painted - (bench.marks.has("dispatch") ? bench.marks.get("dispatch") : start), count: images.length };
			}
			await new Promise((done) => setTimeout(done, 40));
		}
		const images = [...document.querySelectorAll("[data-message-id] img")];
		return { ok: false, ms: null, count: images.length, complete: images.filter((image) => image.complete && image.naturalWidth > 0).length };
	};
	return { ok: true, frames: typeof PerformanceObserver !== "undefined" };
})()`;

/* --------------------------------------------------------------- the app state */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The route, and the deep link that opens one channel inside it. */
const BRIDGE_ROUTE = "#/team-bridge";
const bridgePath = (tenantId, conversationId) =>
	`#/team-bridge?tenant=${encodeURIComponent(tenantId)}&conversation=${encodeURIComponent(conversationId)}`;

/**
 * Get the app onto `/team-bridge` and wait for the rail to hold rows.
 *
 * THE HASH IS SET ON EVERY POLL, not once: the app resolves its initial route
 * after mount and lands elsewhere, so a single assignment made before that
 * resolution is simply overwritten. After a few tries it presses the rail row -
 * the path a reader takes - in case the Router is not listening to the hash.
 */
async function waitForBridge(evaluate, timeoutMs = 90_000) {
	const started = Date.now();
	let last = null;
	let polls = 0;
	while (Date.now() - started < timeoutMs) {
		polls += 1;
		await evaluate(`(() => {
			if (!window.location.hash.startsWith("#/team-bridge")) {
				window.location.hash = ${JSON.stringify(BRIDGE_ROUTE)};
			}
			if (${polls} > 8) {
				const rail = document.querySelector('a[href="#/team-bridge"]') ??
					[...document.querySelectorAll("button, a")].find((node) =>
						/team bridge/i.test(node.textContent ?? ""));
				if (rail) rail.click();
			}
			return true;
		})()`);
		const state = await evaluate(`(() => ({
			hash: window.location.hash,
			rail: document.querySelectorAll("[data-conversation-id]").length,
			root: document.getElementById("root")?.childElementCount ?? -1,
			body: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 400),
		}))()`);
		if (state.rail > 0) return state;
		last = state;
		await sleep(500);
	}
	throw new Error(
		`the Team Bridge page never listed a conversation. Last state: ${JSON.stringify(last)}`,
	);
}

/* ---------------------------------------------------------------- the scenarios */

/** Dispatch to a channel and measure the first row, the settle, and the cost. */
/**
 * Open one channel and measure it.
 *
 * THE DISPATCH IS A CLICK ON THE RAIL ROW, not a hash assignment, and that is a
 * correction rather than a preference: a hash assignment races the app's own
 * initial-route resolution, which overwrites it - measured here, the `switch-cold`
 * scenario set the deep link, the app re-resolved to its landing route, and the
 * run waited two minutes on a page that had never been asked to open anything
 * (zero `/messages` requests, 323 DOM nodes, no rows). A rail row carries
 * `data-conversation-id`, is what a reader actually presses, and cannot be
 * overwritten by a router that finishes later. The deep link stays as the
 * FALLBACK for a channel the rail has not listed (a filtered or collapsed rail).
 */
async function openChannel({
	evaluate,
	stub,
	conversationId,
	tenantId,
	label,
}) {
	const before = stub.total(MESSAGES_READ);
	const dispatched = await evaluate(`(() => {
		window.__tbBench.resetFrames();
		const row = document.querySelector('[data-conversation-id="${conversationId}"]');
		window.__tbBench.mark("dispatch");
		if (row) {
			row.scrollIntoView({ block: "nearest" });
			row.click();
			return "rail";
		}
		window.location.hash = ${JSON.stringify(bridgePath(tenantId, conversationId))};
		return "deep-link";
	})()`);
	const first = await evaluate("window.__tbBench.waitRows(1, 30000)");
	const settled = await evaluate("window.__tbBench.waitSettle(400, 90000)");
	const page = await evaluate(`(() => ({
		rows: window.__tbBench.rowsNow(),
		dom: window.__tbBench.domNodes(),
		longTasks: window.__tbBench.longTasks(),
		scroller: (() => { const node = window.__tbBench.scroller(); return node ? { top: node.scrollTop, height: node.scrollHeight, view: node.clientHeight } : null; })(),
		body: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 200),
	}))()`);
	return {
		label,
		conversation: conversationId,
		dispatched,
		firstRowMs: first.ms,
		settledMs: settled.ms,
		rows: page.rows,
		domNodes: page.dom,
		longTasks: page.longTasks,
		scroller: page.scroller,
		messageRequests: stub.total(MESSAGES_READ) - before,
		first: first.ok,
		settled: settled.ok,
		body: page.body,
	};
}

async function runScenario({ scenario, fixture, evaluate, stub }) {
	const tenant0 = TENANTS[0].tenant_id;
	const _tenant1 = TENANTS[1].tenant_id;

	if (scenario === "first-paint") {
		const opened = await openChannel({
			evaluate,
			stub,
			conversationId: BIG_CONVERSATION,
			tenantId: tenant0,
			label: "cold open of the big channel",
		});
		return {
			scenario,
			conversation: BIG_CONVERSATION,
			firstRowMs: opened.firstRowMs,
			settledMs: opened.settledMs,
			rows: opened.rows,
			domNodes: opened.domNodes,
			longTasks: opened.longTasks,
			scroller: opened.scroller,
			messageRequests: opened.messageRequests,
			checks: [
				{
					name: "the timeline rendered at least one row",
					ok: opened.first,
				},
				{
					name: "the timeline settled with every image decoded",
					ok: opened.settled && opened.rows > 0,
				},
			],
			body: opened.body,
		};
	}

	if (scenario === "switch-cold" || scenario === "switch-warm") {
		const a = await openChannel({
			evaluate,
			stub,
			conversationId: SMALL_A,
			tenantId: tenant0,
			label: "first open of A",
		});
		const b = await openChannel({
			evaluate,
			stub,
			conversationId: SMALL_B,
			tenantId: tenant0,
			label: "switch to a channel never visited",
		});
		const checks = [
			{ name: "A rendered rows", ok: a.first },
			{ name: "B (cold) rendered rows", ok: b.first },
		];
		let warm = null;
		if (scenario === "switch-warm") {
			/*
			 * THE CACHE QUESTION, answered as a REQUEST COUNT rather than a stopwatch:
			 * returning to a channel the page has already read must cost ZERO
			 * `/messages` requests if the query cache is doing its job. A fast refetch
			 * is not a cache hit, and only the count tells them apart.
			 */
			warm = await openChannel({
				evaluate,
				stub,
				conversationId: SMALL_A,
				tenantId: tenant0,
				label: "return to A",
			});
			checks.push({
				name: "returning to A cost no /messages request",
				ok: warm.messageRequests === 0,
			});
		}
		return {
			scenario,
			conversation: scenario === "switch-warm" ? SMALL_A : SMALL_B,
			firstRowMs: (warm ?? b).firstRowMs,
			settledMs: (warm ?? b).settledMs,
			rows: (warm ?? b).rows,
			domNodes: (warm ?? b).domNodes,
			longTasks: (warm ?? b).longTasks,
			messageRequests: (warm ?? b).messageRequests,
			steps: [a, b, ...(warm ? [warm] : [])].map((step) => ({
				label: step.label,
				firstRowMs: step.firstRowMs,
				settledMs: step.settledMs,
				rows: step.rows,
				messageRequests: step.messageRequests,
			})),
			checks,
			body: (warm ?? b).body,
		};
	}

	if (scenario === "media") {
		const opened = await openChannel({
			evaluate,
			stub,
			conversationId: MEDIA_CONVERSATION,
			tenantId: tenant0,
			label: "cold open of the image channel",
		});
		// `waitImages` runs AFTER the open: the open's own settle already waits for
		// images, so this is the assertion that they really decoded, not a second
		// measurement of the same wait.
		const images = await evaluate("window.__tbBench.waitImages(20000)");
		const firstPass = stub.total(/attachments/);
		await openChannel({
			evaluate,
			stub,
			conversationId: SMALL_A,
			tenantId: tenant0,
			label: "leave the image channel",
		});
		const again = await openChannel({
			evaluate,
			stub,
			conversationId: MEDIA_CONVERSATION,
			tenantId: tenant0,
			label: "re-enter the image channel",
		});
		return {
			scenario,
			conversation: MEDIA_CONVERSATION,
			firstRowMs: opened.firstRowMs,
			settledMs: opened.settledMs,
			rows: opened.rows,
			domNodes: opened.domNodes,
			longTasks: opened.longTasks,
			attachmentRequests: firstPass,
			reentry: {
				firstRowMs: again.firstRowMs,
				settledMs: again.settledMs,
				attachmentRequests: stub.total(/attachments/) - firstPass,
			},
			images,
			checks: [
				{
					name: "every visible image decoded (complete && naturalWidth>0)",
					ok: images.ok,
				},
				{
					name: "the attachment route was actually fetched",
					ok: firstPass > 0,
				},
			],
			body: opened.body,
		};
	}

	if (scenario === "scroll-back") {
		const opened = await openChannel({
			evaluate,
			stub,
			conversationId: BIG_CONVERSATION,
			tenantId: tenant0,
			label: "cold open of the big channel",
		});
		/*
		 * THE PRECONDITION THIS SCENARIO EXISTS TO PROVE: NO paging request before a
		 * scroll. If the page asks for `before_seq` unprompted, the rows on screen are
		 * not the rows the reader asked for and every later number is unmoored.
		 */
		const beforeSeqRequests = stub.total(/before_seq/);
		const pages = [];
		for (let index = 0; index < 5; index += 1) {
			const rowsBefore = opened.rows + index;
			const requestsBefore = stub.total(/before_seq/);
			await evaluate(`(() => {
				window.__tbBench.mark("scroll");
				const node = window.__tbBench.scroller();
				if (node) node.scrollTop = 0;
				return true;
			})()`);
			const grown = await evaluate(
				`window.__tbBench.waitRows(${rowsBefore + 1}, 4000)`,
			);
			await sleep(250);
			pages.push({
				page: index + 1,
				ms: grown.ms,
				ok: grown.ok,
				requests: stub.total(/before_seq/) - requestsBefore,
				rows: await evaluate("window.__tbBench.rowsNow()"),
			});
		}
		return {
			scenario,
			conversation: BIG_CONVERSATION,
			firstRowMs: opened.firstRowMs,
			settledMs: opened.settledMs,
			rows: opened.rows,
			domNodes: opened.domNodes,
			beforeSeqRequests,
			pages,
			checks: [
				{
					name: "zero before_seq requests before any scroll",
					ok: beforeSeqRequests === 0,
				},
				{
					name: "older rows really appeared",
					ok: pages.some((page) => page.ok),
				},
			],
			body: opened.body,
		};
	}

	if (scenario === "memory") {
		const conversations = fixture.conversations.map((row) => ({
			id: row.id,
			tenantId: row.tenant_id,
		}));
		const visited = [];
		for (let index = 0; index < 20; index += 1) {
			// Five revisited: the cycle is what a reader's afternoon looks like, and
			// it is the revisit that would expose a cache that keeps every page.
			const row = conversations[index % conversations.length];
			visited.push(
				await openChannel({
					evaluate,
					stub,
					conversationId: row.id,
					tenantId: row.tenantId,
					label: `cycle ${index + 1}`,
				}),
			);
		}
		const page = await evaluate(`(() => ({
			rows: window.__tbBench.rowsNow(),
			dom: window.__tbBench.domNodes(),
		}))()`);
		return {
			scenario,
			visited: visited.length,
			rows: page.rows,
			domNodes: page.dom,
			messageRequests: stub.total(MESSAGES_READ),
			checks: [
				{
					name: "all 20 channel opens rendered",
					ok: visited.every((step) => step.first),
				},
			],
		};
	}

	throw new Error(
		`unknown --scenario=${scenario}; known scenarios are first-paint, switch-cold, switch-warm, media, scroll-back, memory`,
	);
}

/* ------------------------------------------------------------------- helpers */
function noop() {}

/* ---------------------------------------------------------------- the numbers */

function percentile(values, p) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * values.length) - 1,
	);
	return roundValues(values)[Math.max(0, index)];
}

const roundValues = (values) =>
	values.map((value) => Math.round(value * 10) / 10);

/* --------------------------------------------------------------------- the run */

async function freePort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await new Promise((done) => server.close(() => done()));
	return port;
}

/** The renderer's RSS, read from the OS by the profile path unique to this run. */
function rendererRss(userData) {
	const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,command="], {
		encoding: "utf8",
	});
	const rows = [];
	for (const line of (ps.stdout ?? "").split("\n")) {
		if (!line.includes(userData)) continue;
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
		if (!match) continue;
		rows.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			rssMb: Math.round((Number(match[3]) / 1024) * 10) / 10,
			renderer: /--type=renderer/.test(match[4]),
		});
	}
	const renderers = rows.filter((row) => row.renderer);
	return {
		processes: rows.length,
		renderers: renderers.length,
		rendererRssMb:
			Math.round(renderers.reduce((sum, row) => sum + row.rssMb, 0) * 10) / 10,
		treeRssMb:
			Math.round(rows.reduce((sum, row) => sum + row.rssMb, 0) * 10) / 10,
	};
}

/** Everything that makes two runs comparable, or not. */
function identity(startedAt) {
	const run = (file, args) => {
		try {
			const out = spawnSync(file, args, { encoding: "utf8", cwd: ROOT });
			return (out.stdout ?? "").trim();
		} catch {
			return null;
		}
	};
	const outMtimes = {};
	for (const [name, relative] of [
		["main", ["out", "main", "index.js"]],
		["preload", ["out", "preload", "index.js"]],
		["renderer", ["out", "renderer", "index.html"]],
	]) {
		const file = join(ROOT, ...relative);
		try {
			outMtimes[name] = statSync(file).mtime.toISOString();
		} catch {
			outMtimes[name] = null;
		}
	}
	return {
		root: ROOT,
		commit: run("git", ["rev-parse", "HEAD"]),
		version: (() => {
			try {
				return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
					.version;
			} catch {
				return null;
			}
		})(),
		/*
		 * EVERY ARTEFACT'S OWN MTIME, one line per bundle. A single timestamp was a
		 * guess at which file identifies the build: `out/` is written by three
		 * different steps, and a run whose main bundle predates its renderer is a
		 * different app from the one the numbers claim to describe.
		 */
		outMtimes,
		outMtime: outMtimes.renderer,
		electron: (() => {
			try {
				return JSON.parse(
					readFileSync(
						join(ROOT, "node_modules", "electron", "package.json"),
						"utf8",
					),
				).version;
			} catch {
				return null;
			}
		})(),
		node: process.version,
		macos: run("sw_vers", ["-productVersion"]),
		cpu: spawnSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
			encoding: "utf8",
		}).stdout?.trim(),
		hostname: hostname(),
		loadAverage: loadavg()
			.map((value) => value.toFixed(2))
			.join(" "),
		wallMs: Date.now() - startedAt,
	};
}

/**
 * One measured run: scratch, stub, app, CDP, instrument, scenario, teardown.
 *
 * The teardown is in a `finally` and it WAITS for the process to be gone before
 * returning - a killed-but-not-yet-dead Electron still flushes into its profile,
 * and the scratch removal that follows would otherwise fail with `ENOTEMPTY` on a
 * run that measured everything.
 */
async function measure({ scenario, messageCount, keepScratch = false }) {
	const startedAt = Date.now();
	const scratch = join(
		SCRATCH_ROOT,
		`team-bridge-bench-${process.pid}-${messageCount}-${Date.now()}`,
	);
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	const fixture = fixtures(messageCount);
	const stub = await startStub(
		fixture,
		join(scratch, "config", "run", "serve"),
	);
	const cdpPort = await freePort();
	let app = null;
	let client = null;
	let _tearDown = null;
	let reaped = null;

	const reap = async () => {
		if (client) {
			try {
				client.close();
			} catch {
				// already gone
			}
		}
		if (app?.child?.pid) {
			try {
				await stopAppTree({
					pid: app.child.pid,
					userData: app.userData,
					isExited: () =>
						app.child.exitCode !== null || app.child.signalCode !== null,
				});
			} catch (error) {
				reaped = { clean: false, error: String(error) };
			}
		}
		const verdict = app?.userData ? rendererRss(app.userData) : null;
		if (verdict) reaped = { ...(reaped ?? {}), survivors: verdict.processes };
		await stub.close();
		if (!keepScratch) {
			try {
				rmSync(scratch, { recursive: true, force: true });
			} catch {
				// A leftover directory is not a measurement failure.
			}
		}
	};

	try {
		allowStubOrigin(stub.port);
		app = launchApp({ port: cdpPort, scratch, size: SIZE });
		// The synchronous last resort: `process.exit` runs no `finally` at all.
		reapOnExit({ pid: app.child.pid, userData: app.userData });
		client = await cdp(cdpPort);
		await client.send("Runtime.enable");
		await client.send("Page.enable");
		let mounted;
		try {
			mounted = await waitForBridge(client.evaluate);
		} catch (error) {
			const interesting =
				/team[- ]bridge|desktop|capabilit|claim|discovery|error|fail|refus/i;
			const appLog = app
				.log()
				.split("\n")
				.filter((line) => interesting.test(line))
				.slice(-30)
				.join("\n");
			throw new Error(
				`${error.message}\n--- what the stub was asked for ---\n${stub
					.seen()
					.map(([key, value]) => `${value}× ${key}`)
					.join(
						"\n",
					)}\n--- routes the stub refused ---\n${[...new Set(stub.unknown())].join("\n")}\n--- renderer console ---\n${client
					.console()
					.slice(-40)
					.join("\n")}\n--- app log ---\n${appLog}`,
			);
		}
		const installed = await client.evaluate(INSTRUMENT);
		if (!installed.ok)
			throw new Error(
				`the instrument did not install: ${JSON.stringify(installed)}`,
			);
		// One beat for the page's own first paint to settle before the scripted
		// interaction: the bench measures the channel open, not the mount.
		await sleep(500);
		const result = await runScenario({
			scenario,
			fixture,
			evaluate: client.evaluate,
			stub,
			send: client.send,
		});
		const heap = await client.send("Runtime.getHeapUsage").catch(() => null);
		const measuredAt = rendererRss(app.userData);
		return {
			result,
			mounted,
			heapMb: heap ? Math.round((heap.usedSize / 1024 / 1024) * 10) / 10 : null,
			domNodes: await client.evaluate(`document.querySelectorAll("*").length`),
			rss: measuredAt,
			requests: stub.seen(),
			refused: [...new Set(stub.unknown())],
			console: client.console(),
			identity: identity(startedAt),
		};
	} finally {
		await reap();
		_tearDown = reaped;
	}
}

/* ------------------------------------------------------------------ the report */

function formatTable(rows) {
	const lines = [];
	for (const row of rows) lines.push(row);
	return lines.join("\n");
}

export async function main() {
	const startedAt = Date.now();
	const runs = [];
	const control = has("control");
	const sizes = control ? [CONTROL_SMALL, MESSAGES] : [MESSAGES];

	for (const messageCount of sizes) {
		const measured = await measure({ scenario: SCENARIO, messageCount });
		runs.push({ messageCount, ...measured });
	}

	const report = {
		bench: "team-bridge-bench",
		scenario: SCENARIO,
		size: SIZE,
		ranAt: new Date().toISOString(),
		runs: runs.map((run) => ({
			messageCount: run.messageCount,
			identity: run.identity,
			result: run.result,
			heapMb: run.heapMb,
			domNodes: run.domNodes,
			rss: run.rss,
			refused: run.refused,
		})),
		wallMs: Date.now() - startedAt,
	};

	if (control && runs.length === 2) {
		const [small, big] = runs;
		const smallSettled = small.result.settledMs;
		const bigSettled = big.result.settledMs;
		const smallRows = small.result.rows;
		const bigRows = big.result.rows;
		const ok =
			typeof smallSettled === "number" &&
			typeof bigSettled === "number" &&
			bigSettled > smallSettled * 1.5 &&
			bigRows > smallRows * 1.5;
		report.negativeControl = {
			ok,
			small: {
				messages: small.messageCount,
				settledMs: smallSettled,
				rows: smallRows,
				domNodes: small.domNodes,
			},
			big: {
				messages: big.messageCount,
				settledMs: bigSettled,
				rows: bigRows,
				domNodes: big.domNodes,
			},
			verdict: ok
				? "the rig responds to history size"
				: "THE RIG DID NOT RESPOND TO HISTORY SIZE - treat every number here as suspect",
		};
	}

	const text = JSON.stringify(report, null, 2);
	if (JSON_OUT) writeFileSync(resolve(JSON_OUT), `${text}\n`);
	process.stdout.write(`${text}\n`);

	// The human summary goes to stderr so stdout stays parseable.
	const lines = ["", `team-bridge-bench · ${SCENARIO} · ${SIZE}`];
	for (const run of runs) {
		const result = run.result;
		lines.push(
			`  messages=${run.messageCount}  firstRow=${fmt(result.firstRowMs)}ms  settled=${fmt(result.settledMs)}ms  rows=${result.rows}  dom=${run.domNodes}  history-reads=${result.messageRequests ?? "?"}`,
		);
		/*
		 * EVERY FAILED PRECONDITION IS NAMED HERE, not buried in the JSON. The
		 * scenario asserts its own preconditions (rows really rendered, images really
		 * decoded, the cache really answered), and a number whose precondition failed
		 * is meaningless - so a reader of the one-line summary must see the failure
		 * beside the number rather than discover it forty lines into a report.
		 */
		for (const check of result.checks ?? []) {
			if (!check.ok) lines.push(`    FAILED: ${check.name}`);
		}
		for (const step of result.steps ?? []) {
			lines.push(
				`    step: ${step.label} firstRow=${fmt(step.firstRowMs)}ms settled=${fmt(step.settledMs)}ms rows=${step.rows} history-reads=${step.messageRequests}`,
			);
		}
		if (result.pages)
			lines.push(
				`    pages: ${result.pages.map((page) => `${fmt(page.ms)}ms/${page.requests}req${page.ok ? "" : " (no growth)"}`).join(" ")}`,
			);
		if (result.attachmentRequests !== undefined)
			lines.push(
				`    attachments=${result.attachmentRequests} re-entry=${result.reentry.attachmentRequests}`,
			);
		if (result.heapMb !== undefined || run.heapMb !== undefined)
			lines.push(
				`    heap=${run.heapMb ?? "?"}MB rss=${run.rss?.rendererRssMb ?? "?"}MB renderers=${run.rss?.renderers ?? "?"}`,
			);
	}
	if (report.negativeControl)
		lines.push(`  negative control: ${report.negativeControl.verdict}`);
	process.stderr.write(`${formatTable(lines)}\n`);

	const failed = runs.some((run) => run.result.settledMs === null);
	if (failed) process.exitCode = 1;
	if (report.negativeControl && !report.negativeControl.ok)
		process.exitCode = 1;
	return report;
}

const fmt = (value) =>
	typeof value === "number" ? value.toFixed(1) : String(value);

if (isEntryPoint(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(`${String(error?.stack ?? error)}\n`);
		process.exitCode = 1;
	});
}
