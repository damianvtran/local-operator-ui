import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE STEP-2 DECISION AND THE FOOTER THAT OBEYS IT, as pure functions.
 *
 * Both rules used to live inline in their components, and all three mutants a
 * review round tried survived the whole suite: never write the provider the step
 * displays, never report that a model is still needed, and let the modal advance
 * anyway (review round 2 R2-M3, after the same rule shipped as round 1's M2).
 * Component rules without a renderer are only ever asserted by rendering them; a
 * decision stated once and exported is assertable directly, which is the split
 * `sign-in-flow.ts` already uses for the same reason.
 *
 * What each case is FOR is named where it is asserted, so a reader reverting one
 * line can see which failure it restores.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/onboarding/components/steps/default-model-plan";',
			'export { onboardingFooter } from "./src/renderer/src/features/onboarding/components/onboarding-footer";',
			'export { OnboardingStep } from "./src/renderer/src/shared/store/onboarding-store";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});

const {
	planDefaultModelWrite,
	PICK_A_MODEL,
	LOADING_MODELS,
	onboardingFooter,
	OnboardingStep,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The provider the user just connected, as the census returns it. */
const row = (id) => ({ id, name: id, local: false, has_credential: true });

const catalogue = (...providers) => ({ ready: true, providers });
const EMPTY_CATALOGUE = { ready: false, providers: [] };
/** A backend that ANSWERED and lists nothing for the provider in question. */
const NO_MODELS_LISTED = { ready: true, providers: [] };

test("step 2 SHOWS the provider just connected, and writes nothing until it can name a model", () => {
	/*
	 * The released-backend shape, and round 1's M2: nothing is configured, the user
	 * just connected Radient, and the step shows it. Gating the write on
	 * `config.hosting` -- the mutant this case exists for -- is the opposite failure:
	 * the step shows nothing and setup finishes with no hosting at all. What the step
	 * must NOT do is write a hosting it cannot name a model for, which is round 4's
	 * U14 (`hosting: openrouter, model_name: ''`); while the catalogue is unasked
	 * there is no model to name, so there is no write either.
	 */
	const plan = planDefaultModelWrite({
		choice: { kind: "choose", provider: row("radient") },
		hosting: null,
		model: null,
		catalogue: EMPTY_CATALOGUE,
	});
	assert.equal(plan.shownProvider, "radient");
	assert.equal(
		plan.write,
		null,
		"a hosting with no model is the configuration that cannot answer, so nothing may be written",
	);
	/*
	 * An UNASKED catalogue is not a missing one. Round 3's Q3-3 was this exact
	 * conflation: a released backend was told it "can't list DeepSeek models" while it
	 * was serving seven, because nothing had fetched them yet. Waiting is the truthful
	 * state, and the no-catalogue sentence is reserved for an answer.
	 */
	assert.equal(
		plan.block,
		LOADING_MODELS,
		"an unasked catalogue must read as loading, not as a missing one",
	);
	assert.equal(
		plan.noCatalogue,
		false,
		"the step must not claim the backend cannot list models before it has asked",
	);
});

test("a catalogue that ANSWERED and lists nothing is what says the models cannot be listed", () => {
	const plan = planDefaultModelWrite({
		choice: { kind: "choose", provider: row("radient") },
		hosting: null,
		model: null,
		catalogue: NO_MODELS_LISTED,
	});
	assert.equal(
		plan.block,
		null,
		"nothing can be picked, so there is nothing to wait for either",
	);
	assert.equal(
		plan.write,
		null,
		"U14: an answered catalogue that lists nothing for the provider must leave the CONFIG alone, not write the hosting",
	);
	assert.equal(
		plan.noCatalogue,
		true,
		"and the step says so, which is the frame the evidence set carries",
	);
});

test("a configured hosting with no model is still a write that must not happen", () => {
	/*
	 * R5-m1's shape, executed: `needsModel` is about the CHOICE, so a null choice with a
	 * hosting already configured slipped past the rule the docblock states -- and wrote
	 * `model_name: ""`, which is the model-less config U14 was about. The write is gated
	 * on the MODEL, so this shape writes nothing.
	 */
	const plan = planDefaultModelWrite({
		choice: null,
		hosting: "openrouter",
		model: null,
		catalogue: { ready: true, providers: ["openrouter"] },
	});
	assert.equal(plan.shownProvider, "openrouter");
	assert.equal(
		plan.write,
		null,
		"a hosting with no model is not a configuration: nothing may be written",
	);
});

test("a model this Local Operator can name is what makes the write happen at all", () => {
	const plan = planDefaultModelWrite({
		choice: { kind: "choose", provider: row("radient") },
		hosting: null,
		model: "auto",
		catalogue: catalogue("radient"),
	});
	assert.deepEqual(
		plan.write,
		{ hosting: "radient", model_name: "auto" },
		"a host with a model is what this step exists to write",
	);
});

test("a pick that is owed and possible is REPORTED", () => {
	/*
	 * The other half of the same defect: a step that lets Continue through with no
	 * model chosen lands the user in a chat on whatever the backend defaults to.
	 * The mutant this case exists for is the block never being set.
	 */
	const plan = planDefaultModelWrite({
		choice: { kind: "choose", provider: row("deepseek") },
		hosting: null,
		model: null,
		catalogue: catalogue("deepseek"),
	});
	assert.equal(plan.block, PICK_A_MODEL);
	assert.equal(plan.noCatalogue, false);
});

test("the footer OBEYS the block it is handed", () => {
	/*
	 * The third mutant: the modal keeps its own copy of the rule and advances
	 * anyway. Setup then finishes without a model, which is exactly what the block
	 * exists to prevent.
	 */
	const blocked = onboardingFooter(
		OnboardingStep.DEFAULT_MODEL,
		PICK_A_MODEL,
		false,
	);
	assert.equal(blocked.blocked, true);
	assert.equal(blocked.reason, PICK_A_MODEL, "and it says why");
	assert.equal(blocked.primaryDisabled, true);

	const ready = onboardingFooter(OnboardingStep.DEFAULT_MODEL, null, false);
	assert.equal(ready.blocked, false);
	assert.equal(ready.reason, null);
	assert.equal(ready.primaryDisabled, false);

	const busy = onboardingFooter(OnboardingStep.DEFAULT_MODEL, null, true);
	assert.equal(busy.primaryDisabled, true, "a write in flight disables it too");
});

test("defaults the backend already applied are written as they stand", () => {
	const applied = planDefaultModelWrite({
		choice: {
			kind: "applied",
			model: { id: "claude-opus-5-5" },
		},
		hosting: "anthropic",
		model: "claude-opus-5-5",
		catalogue: catalogue("anthropic"),
	});
	assert.deepEqual(applied.write, {
		hosting: "anthropic",
		model_name: "claude-opus-5-5",
	});
	assert.equal(applied.block, null);

	const appliedWithNoModel = planDefaultModelWrite({
		choice: { kind: "applied", model: null },
		hosting: "anthropic",
		model: null,
		catalogue: catalogue("anthropic"),
	});
	assert.equal(
		appliedWithNoModel.block,
		PICK_A_MODEL,
		"'defaults applied' with no model in them still owes the user one",
	);
});

test("a proposal carries its suggested model, and a configured step keeps it", () => {
	const proposed = planDefaultModelWrite({
		choice: {
			kind: "proposed",
			provider: row("anthropic"),
			model: { id: "claude-opus-5-5" },
		},
		hosting: null,
		model: null,
		catalogue: catalogue("anthropic"),
	});
	assert.deepEqual(proposed.write, {
		hosting: "anthropic",
		model_name: "claude-opus-5-5",
	});
	assert.equal(proposed.block, null, "a proposal is already a model");

	const configured = planDefaultModelWrite({
		choice: { kind: "choose", provider: row("openai") },
		hosting: "anthropic",
		model: "claude-opus-5-5",
		catalogue: catalogue("anthropic", "openai"),
	});
	assert.deepEqual(configured.write, {
		hosting: "anthropic",
		model_name: "claude-opus-5-5",
	});
});

test("nothing connected yet writes nothing", () => {
	const plan = planDefaultModelWrite({
		choice: { kind: "none" },
		hosting: null,
		model: null,
		catalogue: EMPTY_CATALOGUE,
	});
	assert.equal(plan.shownProvider, "");
	assert.equal(plan.write, null, "no provider, nothing to write");
	assert.equal(plan.block, null, "and nothing to block on: step 1 owns this");
});

test("a block belongs to step 2 alone", () => {
	/*
	 * The footer's rule is step-specific, because step 3 has its own Skip and step 1
	 * its own gate; a block leaking across steps would strand a user on a step that
	 * has nothing to do with it.
	 */
	const elsewhere = onboardingFooter(
		OnboardingStep.EXTRAS,
		PICK_A_MODEL,
		false,
	);
	assert.equal(elsewhere.blocked, false);
	assert.equal(elsewhere.primaryDisabled, false);
});
