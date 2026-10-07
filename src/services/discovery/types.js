/**
 * Shapes shared by the discovery providers (documentation only — nothing is exported at runtime).
 *
 * @typedef {object} DiscoveredPlace
 * @property {string} externalId   Google place_id or OSM "node/123"
 * @property {string} name
 * @property {string} [address]
 * @property {string} [city]
 * @property {string} [state]
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [website]
 * @property {string[]} phones
 * @property {string[]} emails
 * @property {number} [beds]
 *
 * @typedef {object} DiscoveryInput
 * @property {string} query        The "What" text, e.g. "hospitals", "IT companies"
 * @property {string} location     The "Where" text, e.g. "Mysuru, Karnataka"
 * @property {string[]} keywords   Optional extra words that narrow the search
 * @property {number} maxResults
 *
 * @typedef {object} DiscoveryResult
 * @property {DiscoveredPlace[]} places
 * @property {string} [note]       What was actually searched, and any fallback applied — shown in the UI
 */

export {};
