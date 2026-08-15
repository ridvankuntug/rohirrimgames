import '../../../shared/feature-flags.js';

const defaults = Object.freeze({
  enableAiGeneration: false,
  enableRegisteredDecks: false,
});

export const featureFlags = Object.freeze({
  ...defaults,
  ...(globalThis.OpenClassFeatureFlags || {}),
});

export const isAiGenerationEnabled = () => featureFlags.enableAiGeneration === true;
export const isRegisteredDecksEnabled = () => featureFlags.enableRegisteredDecks === true;
