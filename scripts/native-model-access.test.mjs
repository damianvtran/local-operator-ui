import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

// Compile the production reader: these states must never trigger a second login
// or rewrite the session's exact model/effort just because access converges.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/session-status/session-model";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	modelAccessReading,
	modelAccessPresentation,
	bandYieldsToRadientIssue,
	modelAccessOwnsRadientStatus,
	composerModelAccessReading,
	modelAccessLocality,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const inventedMode = /API key|subscription|logged in/i;
const permissionPresent = /permission.*present/i;
const automaticRepair = /next request.*automatically/i;
const restoreAccess = /restore owner access or permission/i;
const inventedCause =
	/is unreachable|owner is reachable|not regranted automatically/i;
const ownerName = /Work laptop/;
const historical = /history/i;
const noCachedPermission = /not.*permission|cannot.*reuse/i;

function frame(effective_state, coarse = "temporarily_unavailable") {
	return {
		selected_model: {
			provider: "openai",
			model_id: "gpt-6.1-sol",
			reasoning_effort: "high",
		},
		model_access: {
			state: coarse,
			effective_state,
			provider: "openai",
			label: "OpenAI",
			owner_device: "synthetic-owner",
			owner_label: "Work laptop",
			observed_at: 1700000000,
			last_grant_at: 1699999900,
			last_grant_expires_at: 1699999950,
		},
	};
}

for (const state of [
	"pending",
	"eligible_borrow_unverified",
	"effective_borrow",
	"expired",
	"withdrawn",
	"owner_unavailable",
	"device_bound",
	"absent",
]) {
	test(`native model access: ${state} is a truthful reading, not a local logout`, () => {
		const wire = frame(
			state,
			state === "effective_borrow" ? "ok" : "signed_out",
		);
		const original = structuredClone(wire);
		const reading = modelAccessReading(wire);
		assert.ok(reading, `${state} must reach the selected-provider status`);
		assert.equal(reading.effectiveState, state);
		assert.equal(reading.owner, "Work laptop");
		assert.equal(
			reading.lastGrantExpiresAt,
			wire.model_access.last_grant_expires_at,
		);
		assert.deepEqual(
			wire,
			original,
			"access must not mutate provider/model/effort",
		);
		const presentation = modelAccessPresentation(reading);
		assert.ok(presentation.title && presentation.description);
		assert.equal(
			presentation.canConnect,
			false,
			"unproven native serving context must not target the generic dialog",
		);
		assert.equal(
			presentation.tone,
			state === "effective_borrow" ? "neutral" : "warning",
		);
		assert.doesNotMatch(
			presentation.description,
			inventedMode,
			"native kind is not on this keyless contract, so do not invent it",
		);
	});
}

test("native model access: expiry retains permission; withdrawal does not promise automatic regrant", () => {
	const expired = modelAccessPresentation(modelAccessReading(frame("expired")));
	assert.match(expired.description, permissionPresent);
	assert.match(expired.description, automaticRepair);
	const withdrawn = modelAccessPresentation(
		modelAccessReading(frame("withdrawn")),
	);
	assert.match(withdrawn.description, restoreAccess);
	assert.doesNotMatch(withdrawn.description, inventedCause);
});

test("native model access: unreachable-owner expiry is explicitly history, never cached permission", () => {
	const reading = modelAccessReading(frame("owner_unavailable"));
	const presentation = modelAccessPresentation(reading);
	assert.match(presentation.description, ownerName);
	assert.match(presentation.history, historical);
	assert.match(presentation.history, noCachedPermission);
	assert.equal(presentation.canConnect, false);
});

test("native model access: local and unpublished fields retain legacy behavior", () => {
	assert.equal(modelAccessReading(frame("local", "ok")), null);
	assert.equal(modelAccessReading({}), null);
	const legacy = frame(undefined, "signed_out");
	assert.deepEqual(modelAccessReading(legacy), {
		provider: "openai",
		label: "OpenAI",
	});
	assert.equal(
		modelAccessPresentation(modelAccessReading(legacy)).canConnect,
		true,
	);
});

test("native model access: a selected-provider borrow is not hidden by fallback routing", () => {
	const wire = frame("owner_unavailable");
	wire.effective_model = { provider: "deepseek", model_id: "deepseek-chat" };
	assert.equal(modelAccessReading(wire).effectiveState, "owner_unavailable");
	assert.deepEqual(wire.selected_model, {
		provider: "openai",
		model_id: "gpt-6.1-sol",
		reasoning_effort: "high",
	});
});

test("native model access: stale previous-provider status cannot accuse the current selection", () => {
	const wire = frame("owner_unavailable");
	wire.model_access.provider = "radient";
	assert.equal(modelAccessReading(wire), null);
	assert.equal(wire.selected_model.model_id, "gpt-6.1-sol");
	assert.equal(wire.selected_model.reasoning_effort, "high");
});

test("native model access: malformed metadata and future states fail conservatively", () => {
	const wire = frame("future-host-state", "ok");
	wire.model_access.owner_label = { host: "bad" };
	wire.model_access.last_grant_expires_at = Number.POSITIVE_INFINITY;
	const reading = modelAccessReading(wire);
	assert.equal(reading.effectiveState, "pending");
	assert.equal(reading.owner, "synthetic-owner");
	assert.equal(reading.lastGrantExpiresAt, undefined);
	assert.equal(modelAccessPresentation(reading).canConnect, false);
});

test("native model access: Radient local-login suppression cannot hide borrowed access", () => {
	assert.equal(
		bandYieldsToRadientIssue(
			{ provider: "radient", effectiveState: "effective_borrow" },
			true,
		),
		false,
	);
	assert.equal(
		bandYieldsToRadientIssue(
			{ provider: "radient", effectiveState: "pending" },
			true,
		),
		false,
	);
	assert.equal(
		bandYieldsToRadientIssue(
			{ provider: "radient", effectiveState: "absent", connectHere: true },
			true,
		),
		true,
	);
	assert.equal(bandYieldsToRadientIssue({ provider: "radient" }, true), true);
	assert.equal(
		modelAccessOwnsRadientStatus({
			provider: "radient",
			effectiveState: "owner_unavailable",
		}),
		true,
	);
	assert.equal(
		modelAccessOwnsRadientStatus({
			provider: "radient",
			effectiveState: "effective_borrow",
		}),
		true,
	);
	assert.equal(
		modelAccessOwnsRadientStatus({
			provider: "radient",
			effectiveState: "absent",
			connectHere: true,
		}),
		false,
	);
	assert.equal(modelAccessOwnsRadientStatus({ provider: "radient" }), false);
	assert.equal(
		modelAccessOwnsRadientStatus({
			provider: "openai",
			effectiveState: "pending",
		}),
		false,
	);
});

for (const locality of ["local", "remote", undefined]) {
	test(`composer native absence uses trusted matching source: ${locality ?? "unproven"}`, () => {
		const frontend = frame("absent", "signed_out");
		const before = structuredClone(frontend);
		const rows = [
			{ session_id: "other", locality: "local" },
			{ session_id: "selected", locality },
		];
		const status = {
			frontend,
			servingLocality: modelAccessLocality(rows, "selected"),
		};
		const reading = composerModelAccessReading(status);
		assert.equal(
			modelAccessPresentation(reading).canConnect,
			locality === "local",
		);
		assert.deepEqual(frontend, before);
		assert.equal(composerModelAccessReading({ ...status, draft: true }), null);
		const legacy = {
			...frontend,
			model_access: {
				provider: "openai",
				label: "OpenAI",
				state: "signed_out",
			},
		};
		assert.equal(
			modelAccessPresentation(
				composerModelAccessReading({ ...status, frontend: legacy }),
			).canConnect,
			true,
		);
		assert.equal(modelAccessLocality(rows, "not-listed"), undefined);
	});
}

test("composer native remote Radient absence cannot fall through to a local signup callout", () => {
	const frontend = frame("absent");
	frontend.selected_model.provider = frontend.model_access.provider = "radient";
	const remote = composerModelAccessReading({
		frontend,
		servingLocality: "remote",
	});
	assert.equal(modelAccessPresentation(remote).canConnect, false);
	assert.equal(modelAccessOwnsRadientStatus(remote), true);
	assert.equal(bandYieldsToRadientIssue(remote, true), false);
	const local = composerModelAccessReading({
		frontend,
		servingLocality: "local",
	});
	assert.equal(modelAccessPresentation(local).canConnect, true);
	assert.equal(modelAccessOwnsRadientStatus(local), false);
	assert.equal(bandYieldsToRadientIssue(local, true), true);
});

const producerControls = JSON.parse(
	readFileSync("scripts/fixtures/native-access-bc3d.json", "utf8"),
);
for (const control of producerControls.cases) {
	test(`immutable bc3d producer ${control.cause} does not imply its guessed cause`, () => {
		assert.equal(control.eligible, true);
		assert.equal(
			control.recovered_without_permission_change,
			"effective_borrow",
		);
		const status = { frontend: control.frontend, servingLocality: "remote" };
		const reading = composerModelAccessReading(status);
		assert.equal(
			reading.lastGrantExpiresAt,
			control.frontend.model_access.last_grant_expires_at,
		);
		const display = modelAccessPresentation(reading);
		assert.doesNotMatch(display.description, inventedCause);
		assert.equal(display.canConnect, false);
		assert.match(display.history, historical);
	});
}

test("the real page/content/composer wires the tested serving context and decision", () => {
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const content = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	const composer = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.ok(page.includes("modelAccessLocality(state.sessions, sessionId)"));
	assert.ok(
		page.includes(
			"frontend: canonical.frontend ?? canonical.heldFrontend,\n\t\t\t\t\t\tservingLocality,",
		),
	);
	assert.ok(content.includes('servingLocality?: "local" | "remote"'));
	assert.ok(content.includes("sessionStatus={sessionStatus}"));
	assert.ok(composer.includes("composerModelAccessReading(sessionStatus)"));
	assert.ok(
		composer.includes(
			"!modelAccessOwnsRadientStatus(modelAccess) && radientIssueBlock",
		),
	);
});
