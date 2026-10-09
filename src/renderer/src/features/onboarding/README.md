# Onboarding Components

The first-time setup a new user meets after the installer, and the walkthrough
tour that stays one click away in Settings.

## The flow

Three numbered steps in one dialog (`onboarding-modal.tsx`), then a conversation:

1. **Connect an AI account** (`steps/connect-provider-step.tsx`): four featured
   rows - Radient (recommended: one browser sign-in, nothing to paste), the two
   subscriptions people already pay for (ChatGPT, Claude) and one API-key
   provider (Google) - with everything else behind a "More providers" disclosure
   whose label names what it holds, in the order the panel will show it (the
   dialog leads with the local runtimes, the page with the subscriptions; both
   orders live in `provider-catalog.ts` beside `moreProvidersSummary`).
   Continue appears only once a provider is connected.
2. **Your default model** (`steps/default-model-step.tsx`): the model new chats
   use, proposed from the account just connected.
3. **Web search, then meet <her name>** (`steps/extras-step.tsx`; "Web search
   (optional)" when she is not available): the free pool or the user's own keys,
   and a preview of what happens next. The preview promises that she speaks first
   only while the greeting ledger still owes the user a hello
   (`aidaOwesGreeting`); once it is delivered or skipped the step says what its
   button does instead.

The last step's primary button is **Meet <her name>** when Aida is available
(the `aida` capability and `aida.enabled`, her live name from `aida.status`).
Its press sends the `greet` control op - the attended request that ensures her
session and arms her hidden greeting - and opens her conversation, where SHE
sends the first message. The trigger is a hidden wake the transcript never
paints (`wakeIsHidden`). "Skip to chat", Escape and the close button land in an
empty chat instead. When she is not available the button is **Finish** and
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
2. Add it to `STEP_SEQUENCE` and `stepTitles` in `onboarding-modal.tsx`, and
   render it in `stepContent`.
3. Keep `STEP_PANEL_WIDTH` empty - one measure for the whole flow
   (`scripts/provider-grid-pin.test.mjs` holds that).

## Testing

- `node --test scripts/onboarding-step-block.test.mjs scripts/aida-sidebar.test.mjs scripts/provider-grid-pin.test.mjs`
- Storybook: `Onboarding/*` and `Providers/*` stories.
- A real first run: an isolated profile with no provider configured (see the
  repository AGENTS.md on scratch profiles and window modes).
