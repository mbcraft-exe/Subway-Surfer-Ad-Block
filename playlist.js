// Picks a random file from video/playlist.txt for each replaced ad.
const PLAYLIST_URL = browser.runtime.getURL("video/playlist.txt");
const DEFAULT_PLAYLIST = ["sws.webm"];
const IMAGE_FILE = /\.(gif|png|jpe?g|webp|avif|svg)$/i;

let playlist = null;
const mediaUrls = new Map();

// One file name per line. Empty lines are ignored.
function parsePlaylist(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

// Reads the playlist once per page.
function loadPlaylist() {
  playlist ??= fetch(PLAYLIST_URL)
    .then((r) => r.text())
    .then(parsePlaylist)
    .then((names) => (names.length ? names : [...DEFAULT_PLAYLIST]))
    .catch(() => [...DEFAULT_PLAYLIST]);
  return playlist;
}

// Loads each file only once, then reuses it for every ad.
function mediaUrl(name) {
  if (!mediaUrls.has(name)) {
    const url = fetch(browser.runtime.getURL(`video/${name}`))
      .then((r) => {
        if (!r.ok) throw new Error(`cannot load video/${name}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    mediaUrls.set(name, url);
  }
  return mediaUrls.get(name);
}

// Returns { url, isImage } for a random playable file.
async function pickMedia() {
  const names = await loadPlaylist();
  while (names.length) {
    const name = names[Math.floor(Math.random() * names.length)];
    try {
      return { url: await mediaUrl(name), isImage: IMAGE_FILE.test(name) };
    } catch {
      // Missing or broken file: never pick it again on this page.
      const i = names.indexOf(name);
      if (i !== -1) names.splice(i, 1);
    }
  }
  throw new Error("no playable file in video/playlist.txt");
}
