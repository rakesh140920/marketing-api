import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { env } from '../config/env.js';

/**
 * Polite website crawler: reads the homepage plus a few contact/about/management pages,
 * honours robots.txt, and pulls out publicly listed emails, phone numbers and page text.
 */

const MAX_EXTRA_PAGES = 4;
const MAX_TEXT_PER_PAGE = 6_000;
const PAGE_DELAY_MS = 1_000;

const INTERESTING_LINK =
  /contact|reach[-_ ]?us|enquir|about|management|leadership|team|board|director|administration|facilit|insurance|tpa/i;
const CONTACT_LINK = /contact|reach|enquir/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const BAD_EMAIL =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|sentry|wixpress|domain\.com|email\.com|yourname|@sample|@test\.|u00/i;
const PHONE_RE = /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b|\b0\d{2,4}[\s-]\d{6,8}\b/g;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeUrl(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProto).toString();
}

const sameSite = (a, b) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');

async function fetchHtml(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': env.CRAWLER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      responseType: 'text',
      timeout: 25_000,
      maxContentLength: 3 * 1024 * 1024,
      maxRedirects: 5,
    });
    const type = String(res.headers['content-type'] ?? '');
    if (!type.includes('html')) return { error: `not an HTML page (${type || 'unknown type'})` };
    const finalUrl = res.request?.res?.responseUrl ?? url;
    // Space between tags so text from neighbouring elements doesn't glue together ("Healthinfo@x.com")
    return { html: res.data.replace(/>\s*</g, '> <'), finalUrl };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      return { error: err.response ? `HTTP ${err.response.status}` : (err.code ?? err.message) };
    }
    return { error: err.message };
  }
}

async function loadRobots(origin) {
  try {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await axios.get(robotsUrl, {
      headers: { 'User-Agent': env.CRAWLER_USER_AGENT },
      responseType: 'text',
      timeout: 8_000,
      validateStatus: (s) => s < 500,
    });
    return res.status < 400 ? robotsParser(robotsUrl, res.data) : null;
  } catch {
    return null;
  }
}

/** Undo common "info [at] hospital [dot] com" obfuscation. */
const deobfuscate = (text) => text.replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');

function extract($, pageUrl) {
  const emails = new Set();
  const phones = new Set();

  $('a[href^="mailto:"]').each((_, el) => {
    const addr = decodeURIComponent(($(el).attr('href') ?? '').slice(7).split('?')[0]).trim();
    if (addr) emails.add(addr.toLowerCase());
  });
  $('a[href^="tel:"]').each((_, el) => {
    const tel = ($(el).attr('href') ?? '').slice(4).replace(/[^\d+]/g, '');
    if (tel.length >= 10) phones.add(tel);
  });

  $('script, style, noscript, svg, iframe, template').remove();
  const text = deobfuscate($('body').text().replace(/\s+/g, ' ').trim());

  for (const m of text.match(EMAIL_RE) ?? []) emails.add(m.toLowerCase());
  for (const m of text.match(PHONE_RE) ?? []) phones.add(m.replace(/[\s-]/g, ''));

  return {
    text: text.slice(0, MAX_TEXT_PER_PAGE),
    emails: [...emails]
      .filter((e) => !BAD_EMAIL.test(e) && e.length <= 80)
      .map((address) => ({ address, page: pageUrl })),
    phones: [...phones],
  };
}

/**
 * @param {string} website
 * @returns {Promise<{ finalUrl: string, pages: { url: string, text: string }[], emails: { address: string, page: string }[], phones: string[] }>}
 */
export async function crawlWebsite(website) {
  const startUrl = normalizeUrl(website);
  const home = await fetchHtml(startUrl);
  if ('error' in home) throw new Error(`Website not reachable: ${startUrl} (${home.error})`);

  const base = new URL(home.finalUrl);
  const robots = await loadRobots(base.origin);
  const allowed = (url) => robots?.isAllowed(url, env.CRAWLER_USER_AGENT) !== false;

  const $home = cheerio.load(home.html);

  // Collect same-site links that look like contact/about/management pages, contact pages first
  const candidates = new Map();
  $home('a[href]').each((_, el) => {
    const href = $home(el).attr('href') ?? '';
    const label = `${href} ${$home(el).text()}`;
    if (!INTERESTING_LINK.test(label)) return;
    try {
      const u = new URL(href, base);
      u.hash = '';
      if (!/^https?:$/.test(u.protocol) || !sameSite(u, base) || u.toString() === base.toString()) return;
      if (/\.(pdf|jpe?g|png|docx?|xlsx?|zip)$/i.test(u.pathname)) return;
      candidates.set(u.toString(), CONTACT_LINK.test(label) ? 0 : 1);
    } catch {
      /* ignore malformed links */
    }
  });
  const extraUrls = [...candidates.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([u]) => u)
    .filter(allowed)
    .slice(0, MAX_EXTRA_PAGES);

  const pages = [];
  const emails = new Map();
  const phones = new Set();

  const absorb = (r, url) => {
    pages.push({ url, text: r.text });
    for (const e of r.emails) if (!emails.has(e.address)) emails.set(e.address, e.page);
    for (const p of r.phones) phones.add(p);
  };

  if (allowed(home.finalUrl)) absorb(extract($home, home.finalUrl), home.finalUrl);

  for (const url of extraUrls) {
    await sleep(PAGE_DELAY_MS);
    const page = await fetchHtml(url);
    if (!('error' in page)) absorb(extract(cheerio.load(page.html), page.finalUrl), page.finalUrl);
  }

  return {
    finalUrl: home.finalUrl,
    pages,
    emails: [...emails.entries()].map(([address, page]) => ({ address, page })),
    phones: [...phones].slice(0, 10),
  };
}
