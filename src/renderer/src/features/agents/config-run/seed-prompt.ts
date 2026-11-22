import { translateRaw } from "@shared/i18n";
import type { RunTarget } from "./config-run-store";

/**
 * THE SENTENCE "ASK FOR A CHANGE" PUTS IN THE BOX, built in ONE place.
 *
 * Three readers depend on the exact same words: the composer and the team pane
 * write it (`configSeedPrompt`), the page's cleanup compares the box against it
 * to tell a seeded draft from typed text, and `typedTopic` (use-config-run.ts)
 * strips it off to show "You asked: …". When the sentence was English-only the
 * cleanup could restate it as a template literal; now it is catalogue copy
 * (`ui.agents.config.seed_prompt`, an ICU select over the kind so no English
 * noun is interpolated into a translated sentence), so every reader must call
 * this function in the same locale or a translated seed stops being recognised.
 *
 * It lives in its own module because config-composer.tsx imports
 * use-config-run.ts; putting it in either would make the other restate it.
 *
 * `translateRaw`, NOT `t`: the text is pre-filled into the composer and SENT to
 * the model, so it is data. In an RTL catalogue `t` wraps the Latin name in
 * U+2068/2069 isolates (src/i18n/bidi.ts) that would travel in the message and
 * could stop the model matching the definition by name (same reason as
 * agent-detail.tsx's `ask_change_prefill`).
 */
export const configSeedPrompt = (about: RunTarget): string =>
	translateRaw("ui.agents.config.seed_prompt", {
		kind: about.kind,
		name: about.name,
	});
