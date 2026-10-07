import axios from 'axios';
import { env } from '../../config/env.js';

/**
 * OpenStreetMap — completely free, data may be stored (ODbL licence, attribute "© OpenStreetMap contributors").
 * 1. Nominatim turns the location text into an OSM area.
 * 2. The "What" text is turned into OSM tags (hospital → amenity=hospital, IT services → office=it …);
 *    anything we don't recognise is searched by name instead.
 * 3. Extra keywords filter by name / operator / speciality tags — OSM has no free-text search.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Public Overpass servers are often busy (429/504) — try the next mirror when one fails
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Common business types → OSM tag filters. Matched against the lower-cased "What" text,
 * so "multi-speciality hospitals", "Restaurants" or "IT sevices" (typo) all work.
 */
const CATEGORIES = [
  { label: 'hospitals', match: /hospital/, tags: ['"amenity"="hospital"', '"healthcare"="hospital"'] },
  { label: 'clinics', match: /clinic|nursing/, tags: ['"amenity"="clinic"', '"healthcare"="clinic"'] },
  { label: 'doctors', match: /doctor|physician/, tags: ['"amenity"="doctors"', '"healthcare"="doctor"'] },
  { label: 'dentists', match: /dent(al|ist)/, tags: ['"amenity"="dentist"', '"healthcare"="dentist"'] },
  {
    label: 'pharmacies',
    match: /pharma|chemist|medical (store|shop)/,
    tags: ['"amenity"="pharmacy"', '"healthcare"="pharmacy"'],
  },
  {
    label: 'labs & diagnostics',
    match: /\blabs?\b|laborator|diagnos|patholog|scan/,
    tags: ['"healthcare"="laboratory"', '"healthcare"="diagnostic"'],
  },
  {
    label: 'restaurants',
    match: /restaurant|eatery|dining|food/,
    tags: ['"amenity"="restaurant"', '"amenity"="fast_food"'],
  },
  { label: 'cafes', match: /cafe|café|coffee/, tags: ['"amenity"="cafe"'] },
  {
    label: 'hotels',
    match: /hotel|lodge|resort|guest ?house/,
    tags: ['"tourism"="hotel"', '"tourism"="guest_house"', '"tourism"="resort"'],
  },
  { label: 'schools', match: /school/, tags: ['"amenity"="school"'] },
  { label: 'colleges', match: /college/, tags: ['"amenity"="college"'] },
  { label: 'universities', match: /universit/, tags: ['"amenity"="university"'] },
  { label: 'banks', match: /\bbanks?\b/, tags: ['"amenity"="bank"'] },
  { label: 'gyms', match: /\bgym|fitness/, tags: ['"leisure"="fitness_centre"'] },
  {
    label: 'IT / software companies',
    match: /\bit\b|software|tech|computer|\bweb\b|digital|app develop/,
    tags: ['"office"="it"', '"office"="software"', '"office"="telecommunication"'],
  },
  { label: 'companies / offices', match: /office|compan|firm|business|agency/, tags: ['"office"="company"'] },
  { label: 'supermarkets', match: /supermarket|grocer/, tags: ['"shop"="supermarket"'] },
];

/** Overpass filters for the "What" text, plus a human-readable description of what was searched. */
function filtersFor(query) {
  const q = query.toLowerCase();
  const hits = CATEGORIES.filter((c) => c.match.test(q));
  if (hits.length) {
    return {
      filters: hits.flatMap((c) => c.tags.map((t) => `[${t}]`)),
      description: `OpenStreetMap types: ${hits.map((c) => c.label).join(', ')}`,
    };
  }
  // Unknown type — look for places whose name contains the text (only letters/digits/spaces kept)
  const phrase = query
    .replace(/[^\p{L}\p{N}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { filters: [`["name"~"${phrase}",i]`], description: `OpenStreetMap names containing “${phrase}”` };
}

/** Tags worth matching keywords against (descriptions are rare on OSM, names are not). */
const KEYWORD_TAGS = [
  'name',
  'name:en',
  'alt_name',
  'official_name',
  'operator',
  'brand',
  'healthcare:speciality',
  'description',
];

/** True when every keyword appears in one of the place's searchable tags. */
const matchesKeywords = (tags, keywords) => {
  if (!keywords.length) return true;
  const haystack = KEYWORD_TAGS.map((k) => tags[k] ?? '')
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ');
  return keywords.every((k) => haystack.includes(k.toLowerCase()));
};

const split = (v) =>
  (v ?? '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Returns an optional Overpass statement plus the filter that limits results to the location. */
async function resolveArea(location) {
  const { data } = await axios
    .get(NOMINATIM, {
      params: { q: location, format: 'json', limit: 5, countrycodes: 'in' },
      headers: { 'User-Agent': env.CRAWLER_USER_AGENT },
      timeout: 20_000,
    })
    .catch((err) => {
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        throw new Error('OpenStreetMap refused the request — set CRAWLER_USER_AGENT to include a real contact email');
      }
      throw err;
    });
  if (!data.length) throw new Error(`Location "${location}" not found on OpenStreetMap`);

  // Prefer an administrative boundary (relation) so we search the whole city/district/state
  const rel = data.find((r) => r.osm_type === 'relation');
  if (rel) return { statement: `area(id:${3600000000 + rel.osm_id})->.a;`, scope: '(area.a)' };
  const way = data.find((r) => r.osm_type === 'way');
  if (way) return { statement: `area(id:${2400000000 + way.osm_id})->.a;`, scope: '(area.a)' };

  const [s, n, w, e] = data[0].boundingbox;
  return { statement: '', scope: `(${s},${w},${n},${e})` };
}

async function runOverpass(query) {
  let lastError;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const { data } = await axios.post(url, new URLSearchParams({ data: query }).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': env.CRAWLER_USER_AGENT,
        },
        timeout: 120_000,
      });
      return data;
    } catch (err) {
      lastError = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // Only a bad query (400) is worth giving up on immediately
      if (status === 400) break;
    }
  }
  throw new Error(`OpenStreetMap (Overpass) request failed: ${lastError.message}`);
}

/**
 * @param {import('./types.js').DiscoveryInput} input
 * @returns {Promise<import('./types.js').DiscoveryResult>}
 */
export async function searchOpenStreetMap(input) {
  const { statement, scope } = await resolveArea(input.location);
  const { filters, description } = filtersFor(input.query);

  const query = `[out:json][timeout:90];
${statement}
(
${filters.map((f) => `  nwr${f}${scope};`).join('\n')}
);
out center tags;`;

  const data = await runOverpass(query);

  const named = data.elements.filter((el) => el.tags?.name);
  let matching = named.filter((el) => matchesKeywords(el.tags, input.keywords));
  let note = description;
  if (input.keywords.length && !matching.length && named.length) {
    // Keywords removed everything — show the unfiltered results rather than nothing
    matching = named;
    note += ` · none of the ${named.length} matched the keywords, so they were ignored`;
  }

  const places = [];
  for (const el of matching) {
    const t = el.tags;
    const addr = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city'], t['addr:postcode']]
      .filter(Boolean)
      .join(', ');
    const beds = parseInt(t.beds ?? t['capacity:beds'] ?? '', 10);

    places.push({
      externalId: `${el.type}/${el.id}`,
      name: t.name,
      address: addr || t['addr:full'],
      city: t['addr:city'] ?? t['addr:district'],
      state: t['addr:state'],
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      website: t.website ?? t['contact:website'] ?? t.url,
      phones: [...split(t.phone), ...split(t['contact:phone']), ...split(t['contact:mobile'])],
      emails: [...split(t.email), ...split(t['contact:email'])],
      beds: Number.isFinite(beds) ? beds : undefined,
    });
  }

  // Places with a website are the most useful — keep them first when trimming
  places.sort((a, b) => Number(!!b.website) - Number(!!a.website));
  return { places: places.slice(0, input.maxResults), note };
}
