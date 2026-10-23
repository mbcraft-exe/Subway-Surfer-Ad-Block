const LIST_URL = "https://easylist.to/easylist/easylist.txt";
const BUNDLED_LIST = browser.runtime.getURL("filters/easylist.txt");
const UPDATE_EVERY_MS = 4 * 24 * 3600 * 1000;
const BLOCKED_TYPES = ["sub_frame", "script", "image", "imageset", "xmlhttprequest", "media", "object", "beacon", "ping", "websocket", "other"];
const CHUNK = 1000;

let filters = emptyFilters();
let genericCss = "";
const cssCache = new Map();

const ready = loadFilters();

async function loadFilters() {
  const { listText, listTime } = await browser.storage.local.get(["listText", "listTime"]);
  const text = listText || (await (await fetch(BUNDLED_LIST)).text());
  applyList(text);
  if (!listTime || Date.now() - listTime > UPDATE_EVERY_MS) updateList();
}

function applyList(text) {
  filters = parseFilterList(text);
  genericCss = detectionCss(filters.generic);
  cssCache.clear();
}

async function updateList() {
  try {
    const res = await fetch(LIST_URL, { cache: "no-store" });
    if (!res.ok || !res.url.startsWith("https://")) return;
    const text = await res.text();
    if (!text.startsWith("[Adblock Plus")) return;
    applyList(text);
    await browser.storage.local.set({ listText: text, listTime: Date.now() });
  } catch {}
}
setInterval(updateList, UPDATE_EVERY_MS);

function detectionCss(selectors) {
  let css = "@keyframes sws-detect {}\n";
  for (let i = 0; i < selectors.length; i += CHUNK) {
    css += `${selectors.slice(i, i + CHUNK).join(",\n")} { animation: 1ms sws-detect !important; }\n`;
  }
  return css;
}

function cssForSite(host) {
  if (cssCache.has(host)) return cssCache.get(host);
  const keys = siteKeys(host);
  const exceptions = new Set();
  const specific = [];
  for (const key of keys) {
    filters.specificExceptions.get(key)?.forEach((s) => exceptions.add(s));
    specific.push(...(filters.specific.get(key) || []));
  }
  const noGeneric = keys.some((k) => filters.noGenericSites.has(k));
  if (!exceptions.size && !specific.length && !noGeneric) return genericCss;

  const generic = noGeneric ? [] : filters.generic.filter((s) => !exceptions.has(s));
  const css = detectionCss([...generic, ...specific.filter((s) => !exceptions.has(s))]);
  cssCache.set(host, css);
  return css;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function siteAllowed(host) {
  return siteKeys(host).some((k) => filters.allowSites.has(k));
}

function shouldBlock(details) {
  const host = hostOf(details.url);
  if (!host) return false;
  const pageHost = hostOf(details.documentUrl || details.originUrl || "");
  if (pageHost && siteAllowed(pageHost)) return false;

  const chain = hostChain(host);
  for (const h of chain) {
    if (!filters.allowHosts.has(h)) continue;
    const sites = filters.allowHosts.get(h);
    if (sites === null || (pageHost && matchesAny(pageHost, sites))) return false;
  }
  for (const h of chain) {
    const rule = filters.blockHosts.get(h);
    if (rule && (!rule.thirdParty || details.thirdParty !== false)) return true;
  }
  return false;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!shouldBlock(details)) return {};
    if (details.type === "sub_frame" && details.parentFrameId === 0 && details.tabId >= 0) {
      browser.tabs
        .sendMessage(details.tabId, { type: "blockedFrame", url: details.url }, { frameId: 0 })
        .catch(() => {});
    }
    return { cancel: true };
  },
  { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"], types: BLOCKED_TYPES },
  ["blocking"]
);

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type !== "init" || !sender.tab) return;
  await ready;
  const host = hostOf(sender.url);
  if (!host || siteAllowed(host)) return { enabled: false };
  await browser.tabs.insertCSS(sender.tab.id, {
    code: cssForSite(host),
    cssOrigin: "user",
    frameId: sender.frameId,
    runAt: "document_start",
  });
  return { enabled: true };
});
