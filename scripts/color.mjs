/**
 * Perceptual colour maths, shared - now a re-export.
 *
 * The implementation moved to `src/shared/theme-engine/color.mjs` so the
 * renderer's theme composition engine measures with the same functions the
 * gates do. This path stays so `check-evidence.mjs`, `derive-glass-floors.mjs`
 * and every test that imports `./color.mjs` keep working unchanged.
 */
/* An import-then-export rather than `export ... from`: `ci-scope.test.mjs` derives
   the evidence gate's source closure from `import ... from` lines, and this edge
   has to be in it (the shared module moves the gate's verdict). */
import {
	deltaE,
	labToHex,
	r2,
	toLab,
} from "../src/shared/theme-engine/color.mjs";

export { deltaE, labToHex, r2, toLab };
