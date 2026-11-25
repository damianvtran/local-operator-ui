# Onboarding Components

The first-time setup a new user meets after the installer, and the walkthrough
tour that stays one click away in Settings.

## The flow

A full-window stage (`onboarding-dialog.tsx`, `OnboardingStage`; styles in
`onboarding-stage.css`) opens on an intro - the brand mark and the new-chat helix
fade in under "Welcome to Local Operator" - and after ~2.2 s (or any key, click
or wheel) the helix rises into the header slot of the first step. Under reduced
motion there is no intro. Then up to four numbered steps
(`onboarding-sequence.ts` derives them):

1. **Build your base of agent operations** (`steps/connect-provider-step.tsx`): Radient as the
   one primary in a glass panel that lists what it adds, ChatGPT and Claude as
   "Log in with ..." buttons (subscription sign-ins, not API keys), and "Other
   ways to connect · API keys, local models" folding away the rest of the
   registry (`ProviderGrid restOnly`). Each button starts its browser sign-in in a
   well beneath it (`ProviderDetail autoStart`); several sources can be
   connected. While only subscriptions are connected, the Radient panel stays
   first with a nudge. Continue appears only once a provider is connected.
2. **Pick your default model** (`steps/default-model-step.tsx`).
3. **Web search** (`steps/search-api-step.tsx`) - ONLY when Radient is not
   connected, decided when the user leaves step 2 and kept while they are on it:
   Free (recommended, preselected) · Sign in with Radient · your own search API
   keys.
4. **Meet <her name>** (`steps/meet-aida-step.tsx`), only when she is available:
   the helix returns to full strength as a bookend. The sentence promises that she
   speaks first only while the greeting ledger still owes a hello
   (`aidaOwesGreeting`).

Every step reports `onboarding_step_viewed` / `onboarding_step_completed`
(`onboarding-analytics.ts`; catalogue in `docs/analytics-events.md`).

The last step's primary button is **Meet <her name>** when Aida is available
(the `aida` capability and `aida.enabled`, her live name from `aida.status`).
Its press sends the `greet` control op - the attended request that ensures her
session and arms her hidden greeting - and opens her conversation, where SHE
sends the first message. The trigger is a hidden wake the transcript never
paints (`wakeIsHidden`). "Skip to chat" and Escape land in an empty chat instead. When she is not available the button is **Finish** and
lands in the chat.

A refused `greet` never strands the user: 409 `aida_no_provider` lands in the
chat with an info toast, `aida_disabled` lands silently, anything else lands
with an error toast; a paused Aida opens her conversation with a note that she
will say hello on `/aida resume` (`aidaGreetFailure` / `aidaGreetHeldNotice`
in `features/aida/aida-control.ts`).

Name and email are NOT asked here. Aida asks in her first conversation and
records them in the backend's operator profile, where every session reads them;
with a Radient sign-in she already has both from the account.

The Shepherd walkthrough (`hooks/use-onboarding-tour.ts`) does not start after
setup - completing setup marks the tour done - and stays available in
Settings > Application tour.

## Where the state lives

- `onboardingStore` (`src/renderer/src/shared/store/onboarding-store.ts`):
  completion flags and the current step, persisted; whether the modal is active
  is derived per launch and not persisted.
- `useCheckFirstTimeUser` (`src/renderer/src/shared/hooks/first-time-user.ts`)
  decides whether setup opens: no connected provider in the census and setup
  not completed.

## Adding a step

1. Add it to `OnboardingStep` in `onboarding-store.ts`.
2. Add it to `onboardingSequence` (`onboarding-sequence.ts`), `trackTitle` and
   the header/`stepContent` switches in `onboarding-modal.tsx`.
3. Lay it out in the stage's one column (`ONBOARDING_COLUMN_WIDTH`,
   `onboarding-layout.ts`) - one measure for the whole flow
   (`scripts/provider-grid-pin.test.mjs` holds that).

## Testing

- `node --test scripts/onboarding-stage.test.mjs scripts/onboarding-step-block.test.mjs scripts/onboarding-search-step.test.mjs scripts/provider-grid-pin.test.mjs`
- Storybook: `Onboarding/OnboardingModal` (Intro, IntroLive, each step, Meet
  Aida) and `Provider sign-in onboarding` (stage states against a fake census).
- Re-trigger first run in the app: Settings has no reset; clear the
  `onboarding-storage` localStorage key on a profile with no connected provider.
- A real first run: an isolated profile with no provider configured (see the
  repository AGENTS.md on scratch profiles and window modes).
