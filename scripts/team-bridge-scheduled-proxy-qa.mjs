import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";

/** Bounded integration probe, run ONLY against the runtime lane's isolated
 * loopback proxy/hub fixture. It exercises the renderer API and shared mapping
 * over real HTTP; it does not claim native IPC or the real Go/Mongo worker.
 * Never point this write probe at an operator account or print body/bearer data.
 */
const base = process.env.TB_QA_BASE_URL;
const authorization = process.env.TB_QA_AUTHORIZATION;
assert.ok(
	base?.startsWith("http://127.0.0.1:"),
	"isolated loopback fixture required",
);
assert.ok(authorization, "test-only proxy authorization required");
const bundle = await build({
	stdin: {
		contents: `export {TeamBridgeApi} from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
 export {scheduledEditPatch} from "./src/renderer/src/features/team-bridge/team-bridge-scheduling";
 export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";`,
		resolveDir: process.cwd(),
	},
	tsconfig: "tsconfig.app.json",
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react"],
	write: false,
});
const compiled = new Module(
	`${process.cwd()}/scripts/team-bridge-proxy-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/team-bridge-proxy-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const {
	TeamBridgeApi,
	desktopEndpoint,
	desktopRequestSchema,
	scheduledEditPatch,
} = compiled.exports;
const receipts = [];
globalThis.window = {
	api: {
		desktop: {
			request: async (request) => {
				const endpoint = desktopEndpoint(desktopRequestSchema.parse(request));
				const response = await fetch(base + endpoint.path, {
					method: endpoint.method,
					headers: { authorization, "content-type": "application/json" },
					...(endpoint.body ? { body: JSON.stringify(endpoint.body) } : {}),
				});
				const body = await response.json();
				receipts.push({
					op: request.op,
					http: response.status,
					envelope: Object.keys(body).sort(),
					resultKind: Array.isArray(body.result?.scheduled)
						? "scheduled-list"
						: body.result?.id
							? "scheduled-row"
							: "empty-ack",
				});
				return { status: response.status, body };
			},
		},
	},
};
try {
	const noAuth = await fetch(
		`${base}/v1/desktop/team-bridge/scheduled?tenant_id=org-a`,
	);
	assert.equal(noAuth.status, 401);
	const sendAt = new Date(Date.now() + 600_000).toISOString();
	const row = await TeamBridgeApi.scheduledCreate({
		tenant_id: "org-a",
		conversation_id: `bcv_${"b".repeat(32)}`,
		client_ref: crypto.randomUUID(),
		body: "synthetic private draft",
		send_at: sendAt,
	});
	assert.equal(row.status, "scheduled");
	assert.equal(row.send_at, sendAt);
	assert.equal(
		(await TeamBridgeApi.scheduledList("org-a")).scheduled[0].id,
		row.id,
	);
	const patch = scheduledEditPatch(row, row.send_at, "synthetic edited draft");
	assert.deepEqual(patch, { body: "synthetic edited draft" });
	const edited = await TeamBridgeApi.scheduledUpdate("org-a", row.id, patch);
	assert.equal(edited.body, "synthetic edited draft");
	assert.deepEqual(await TeamBridgeApi.scheduledCancel("org-a", row.id), {});
	assert.deepEqual(await TeamBridgeApi.scheduledList("org-a"), {
		scheduled: [],
	});
	console.log(
		JSON.stringify(
			{
				negativeControl: { unauthorized: noAuth.status },
				receipts,
				finalPending: 0,
			},
			null,
			2,
		),
	);
} finally {
	globalThis.window = undefined;
}
