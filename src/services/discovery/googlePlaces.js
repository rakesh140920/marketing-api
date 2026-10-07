import axios from 'axios';
import { env } from '../../config/env.js';

/**
 * Google Places API (New) — Text Search.
 * websiteUri / phone fields put every request in the "Enterprise" SKU
 * (1,000 free requests per month, up to 20 places per request, max 3 pages per query).
 */
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const PAGE_SIZE = 20;
const MAX_PAGES = 3;

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'nextPageToken',
].join(',');

// Google sometimes returns address parts without a `types` list (e.g. { longText: "Court Road" })
const component = (place, type) => place.addressComponents?.find((c) => c.types?.includes(type))?.longText;

/**
 * @param {import('./types.js').DiscoveryInput} input
 * @returns {Promise<import('./types.js').DiscoveryResult>}
 */
export async function searchGooglePlaces(input) {
  if (!env.GOOGLE_PLACES_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY is not configured');

  // Google understands free text, so extra keywords simply refine the query
  const refined = `${[input.query, ...input.keywords].join(' ')} in ${input.location}`;
  const places = await textSearch(refined, input.maxResults);
  if (places.length || !input.keywords.length) return { places, note: `Google: “${refined}”` };

  // Map listings rarely mention things like tech stacks — retry with just What + Where (1 extra request)
  const plain = `${input.query} in ${input.location}`;
  return {
    places: await textSearch(plain, input.maxResults),
    note: `Google: nothing matched “${refined}”, so the keywords were dropped and “${plain}” was searched`,
  };
}

async function textSearch(textQuery, maxResults) {
  const results = [];
  const pages = Math.min(MAX_PAGES, Math.ceil(maxResults / PAGE_SIZE));
  let pageToken;

  for (let page = 0; page < pages; page++) {
    const { data } = await axios.post(
      ENDPOINT,
      {
        textQuery,
        pageSize: PAGE_SIZE,
        regionCode: 'IN',
        languageCode: 'en',
        ...(pageToken ? { pageToken } : {}),
      },
      {
        headers: {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        timeout: 20_000,
      },
    );

    for (const p of data.places ?? []) {
      const phone = p.internationalPhoneNumber || p.nationalPhoneNumber;
      results.push({
        externalId: p.id,
        name: p.displayName?.text ?? 'Unknown',
        address: p.formattedAddress,
        city: component(p, 'locality') ?? component(p, 'administrative_area_level_3'),
        state: component(p, 'administrative_area_level_1'),
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        website: p.websiteUri,
        phones: phone ? [phone] : [],
        emails: [],
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken || results.length >= maxResults) break;
  }

  return results.slice(0, maxResults);
}
