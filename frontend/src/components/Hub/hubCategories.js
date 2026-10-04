// Hub category filter. Category tokens mirror the legacy fallback hub
// (`index.html` `data-category`: "solo", "multi") plus "online" for games that
// need the `/rt/*` Worker. Pure module: no React, so `node --test` can import it.

export const HUB_FILTERS = Object.freeze(['all', 'solo', 'multi', 'online']);

export const matchesHubFilter = (game, filter) =>
  filter === 'all' || (Array.isArray(game?.categories) && game.categories.includes(filter));
