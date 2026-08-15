/*
 * Product feature switches.
 *
 * Keep both false while the game hub is distributed as a self-contained,
 * backend-free site. Change a value to true only when the matching backend
 * workflow is deliberately being re-enabled.
 */
(function configureOpenClassFeatures(root) {
    'use strict';

    root.OpenClassFeatureFlags = Object.freeze({
        enableAiGeneration: false,
        enableRegisteredDecks: false
    });
}(globalThis));
