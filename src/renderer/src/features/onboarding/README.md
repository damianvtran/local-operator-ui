# Onboarding Components

This directory contains components for the first-time setup experience in the Local Operator UI.

## Overview

The onboarding flow is designed to guide new users through setting up their environment when they first install the application. It consists of a multi-step wizard that walks users through:

1. **Welcome**: Introduction to the onboarding process
2. **User Profile**: Setting up their name and email
3. **Model Credential**: Adding their first model provider API key
4. **Search API (Optional)**: Optionally adding a search API key
5. **Default Model**: Selecting a default model and provider
6. **Create Agent**: Creating their first agent
7. **Congratulations**: Completion screen

## Components

- `OnboardingModal`: Main container for the onboarding experience
- `OnboardingStep`: Individual step components for each part of the setup
- Styled components for consistent UI

## How It Works

The onboarding flow is triggered automatically when:

1. The user has no credentials set up
2. The onboarding has not been explicitly completed before

The `useCheckFirstTimeUser` hook in `src/renderer/src/hooks/use-check-first-time-user.ts` handles this detection logic.

The onboarding state is managed by the `onboardingStore` in `src/renderer/src/store/onboarding-store.ts`, which tracks:

- Whether onboarding is complete
- Which step the user is on
- Whether onboarding is currently active

## Adding New Steps

To add a new step to the onboarding flow:

1. Create a new step component in the `steps` directory
2. Add the step to the `OnboardingStep` enum in `onboarding-store.ts`
3. Update the `OnboardingModal` component to include the new step
4. Update the navigation logic in the `handleNext` and `handleBack` functions

## Testing

To test the onboarding flow, you can:

1. Clear your localStorage to reset the onboarding state
2. Use the `resetOnboarding` function from the onboarding store
3. Delete any credentials you have set up
