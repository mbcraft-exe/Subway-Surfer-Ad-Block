const EXTRA_SELECTORS = [
  "ins.adsbygoogle",
  '[id^="google_ads_iframe"]',
  "[data-google-query-id]",
  "[data-ad-slot]",
  "[data-ad-unit]",
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="amazon-adsystem.com"]',
  'iframe[id^="google_ads"]',
  '[aria-label="Advertisement"]',
  '[aria-label="advertisement"]',
  ".trc_rbox_container",
];

function emptyFilters() {
  return {
    blockHosts: new Map(),
    allowHosts: new Map(),
    allowSites: new Set(),
    noGenericSites: new Set(),
    generic: [],
    genericExceptions: new Set(),
    specific: new Map(),
    specificExceptions: new Map(),
  };
}

const probeSheet = new CSSStyleSheet();

function canonicalSelector(sel) {
  try {
    if (!CSS.supports(`selector(${sel})`)) return null;
    probeSheet.replaceSync(`${sel}{}`);
  } catch {
    return null;
  }
  const rules = probeSheet.cssRules;
  return rules.length === 1 && rules[0] instanceof CSSStyleRule ? rules[0].selectorText : null;
}

function canonicalAll(sels) {
  const out = [];
  for (const sel of sels) {
    const canonical = canonicalSelector(sel);
    if (canonical) out.push(canonical);
  }
  return out;
}

function parseOptions(str) {
  const opts = {};
  for (const part of str.split(",")) {
    const [key, value] = part.split("=");
    opts[key.trim()] = value === undefined ? true : value;
  }
  return opts;
}

function addTo(map, key, value) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
}

function parseNetworkRule(f, line) {
  const isException = line.startsWith("@@");
  if (isException) line = line.slice(2);
  const m = /^\|\|([a-z0-9.-]+)\^(?:\$(.*))?$/i.exec(line);
  if (!m) return;
  const host = m[1].toLowerCase();
  const opts = m[2] ? parseOptions(m[2]) : {};
  const domains = opts.domain
    ? opts.domain.split("|").filter((d) => !d.startsWith("~"))
    : null;

  if (isException) {
    if (opts.document && !domains) f.allowSites.add(host);
    else if (opts.generichide && !domains) f.noGenericSites.add(host);
    else if (!opts.popup) {
      const prev = f.allowHosts.get(host);
      if (prev === null) return;
      f.allowHosts.set(host, domains ? [...(prev || []), ...domains] : null);
    }
    return;
  }

  if (opts.popup || opts.domain || opts["~third-party"] || opts.csp) return;
  const thirdParty = Boolean(opts["third-party"] || opts["3p"]);
  const prev = f.blockHosts.get(host);
  if (!prev || (prev.thirdParty && !thirdParty)) f.blockHosts.set(host, { thirdParty });
}

function parseCosmeticRule(f, line, sep) {
  const idx = line.indexOf(sep);
  const domainPart = line.slice(0, idx);
  let sel = line.slice(idx + sep.length).trim();
  if (!sel) return;

  if (sep === "#?#") {
    sel = sel.replace(/:-abp-has\(/g, ":has(");
    if (/:-abp-|:has-text|:contains|:xpath|:upward|:remove|:style|:matches-/.test(sel)) return;
  }

  const sites = domainPart
    ? domainPart.split(",").map((d) => d.trim().toLowerCase()).filter((d) => d && !d.startsWith("~"))
    : [];

  if (sep === "#@#") {
    if (!domainPart) f.genericExceptions.add(sel);
    for (const site of sites) {
      let set = f.specificExceptions.get(site);
      if (!set) f.specificExceptions.set(site, (set = new Set()));
      set.add(sel);
    }
    return;
  }

  if (!domainPart) f.generic.push(sel);
  for (const site of sites) addTo(f.specific, site, sel);
}

function parseFilterList(text) {
  const f = emptyFilters();
  for (let line of text.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    if (line.includes("#$#") || line.includes("#@$#") || line.includes("#%#")) continue;
    const sep = ["#@#", "#?#", "##"].find((s) => line.includes(s));
    if (sep) parseCosmeticRule(f, line, sep);
    else parseNetworkRule(f, line);
  }
  f.generic = canonicalAll(
    [...new Set([...f.generic, ...EXTRA_SELECTORS])].filter((sel) => !f.genericExceptions.has(sel))
  );
  for (const [site, sels] of f.specific) {
    const valid = canonicalAll(sels);
    if (valid.length) f.specific.set(site, valid);
    else f.specific.delete(site);
  }
  for (const [site, sels] of f.specificExceptions) {
    f.specificExceptions.set(site, new Set(canonicalAll(sels)));
  }
  return f;
}

function hostChain(host) {
  const labels = host.split(".");
  return labels.map((_, i) => labels.slice(i).join("."));
}

function siteKeys(host) {
  const keys = hostChain(host);
  for (const h of [...keys]) {
    const labels = h.split(".");
    if (labels.length > 1) keys.push(labels.slice(0, -1).join(".") + ".*");
    if (labels.length > 2) keys.push(labels.slice(0, -2).join(".") + ".*");
  }
  return keys;
}

function matchesAny(host, sites) {
  const keys = siteKeys(host);
  return sites.some((s) => keys.includes(s));
}
