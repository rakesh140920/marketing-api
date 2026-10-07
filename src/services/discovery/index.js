import { searchGooglePlaces } from './googlePlaces.js';
import { searchOpenStreetMap } from './openStreetMap.js';

/**
 * @param {'osm' | 'google'} source
 * @param {import('./types.js').DiscoveryInput} input
 * @returns {Promise<import('./types.js').DiscoveryResult>}
 */
export function discover(source, input) {
  switch (source) {
    case 'google':
      return searchGooglePlaces(input);
    case 'osm':
      return searchOpenStreetMap(input);
  }
}
