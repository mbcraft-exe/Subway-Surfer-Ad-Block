(() => {
  const VIDEO_URL = browser.runtime.getURL("video/sws.webm");
  const MIN_SIZE = 30;
  const MAX_HEIGHT = 2000;
  const PENDING_TIMEOUT_MS = 3000;
  const FALLBACK_HEIGHT = 250;
  const SIZE_TOLERANCE = 4;

  const AD_SIZES = [
    [728, 90], [970, 90], [970, 250], [300, 250], [336, 280], [300, 600], [160, 600],
    [120, 600], [320, 50], [320, 100], [300, 50], [468, 60], [234, 60], [250, 250],
    [200, 200], [180, 150], [300, 1050], [320, 480], [480, 320], [120, 240], [240, 400],
    [580, 400], [750, 200], [750, 300], [980, 120], [930, 180], [250, 360], [300, 100],
  ];
  const EMBED_HOSTS = [
    "youtube.com", "youtube-nocookie.com", "vimeo.com", "dailymotion.com", "twitch.tv",
    "spotify.com", "soundcloud.com", "google.com", "recaptcha.net", "hcaptcha.com",
    "challenges.cloudflare.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "tiktok.com", "reddit.com", "disqus.com", "stripe.com", "paypal.com", "codepen.io",
    "jsfiddle.net", "openstreetmap.org", "bandcamp.com", "apple.com", "wikipedia.org",
  ];

  const pending = new Map();
  let queue = new Set();
  let scheduled = false;
  let videoUrl = null;

  const visibility = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    }
  });

  const sizeWatcher = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (pending.has(target)) tryReplace(target);
      else if (target.tagName === "IFRAME" && looksLikeAdFrame(target)) enqueue(target);
    }
  });

  function px(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function slotSize(el, allowFallback) {
    const rect = el.getBoundingClientRect();
    let w = rect.width;
    let h = rect.height;
    if (w >= MIN_SIZE && h >= MIN_SIZE) return { w, h };

    const iframe = el.tagName === "IFRAME" ? el : el.querySelector("iframe");
    for (const src of [el, iframe]) {
      if (!src) continue;
      w = w || px(src.style.width) || px(src.getAttribute("width"));
      h = h || px(src.style.height) || px(src.getAttribute("height"));
    }
    if (w >= MIN_SIZE && h >= MIN_SIZE) return { w, h };

    if (allowFallback && el.hasAttribute("data-ad-format")) {
      w = w || el.parentElement?.getBoundingClientRect().width || 0;
      h = h || FALLBACK_HEIGHT;
      if (w >= MIN_SIZE) return { w, h };
    }
    return null;
  }

  function hostMatches(host, list) {
    return list.some((h) => host === h || host.endsWith("." + h));
  }

  function looksLikeAdFrame(iframe) {
    if (iframe.dataset.sws || !iframe.isConnected) return false;
    const { width, height } = iframe.getBoundingClientRect();
    const isAdSize = AD_SIZES.some(
      ([w, h]) => Math.abs(width - w) <= SIZE_TOLERANCE && Math.abs(height - h) <= SIZE_TOLERANCE
    );
    if (!isAdSize) return false;
    const src = iframe.getAttribute("src");
    if (!src || src === "about:blank" || src.startsWith("javascript:")) {
      return !iframe.hasAttribute("srcdoc") || /ad|sponsor|banner/i.test(iframe.id + iframe.name + iframe.className);
    }
    let url;
    try {
      url = new URL(src, location.href);
    } catch {
      return false;
    }
    if (url.hostname === location.hostname) return false;
    return !hostMatches(url.hostname, EMBED_HOSTS);
  }

  function loadVideoUrl() {
    videoUrl ??= fetch(VIDEO_URL)
      .then((r) => r.blob())
      .then((b) => URL.createObjectURL(b));
    return videoUrl;
  }

  function makeVideo() {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration)) {
        video.currentTime = Math.random() * video.duration;
      }
    }, { once: true });
    loadVideoUrl().then((url) => {
      video.src = url;
      visibility.observe(video);
    }).catch(() => {});
    return video;
  }

  function replaceAd(el, { w, h }) {
    const slot = document.createElement("div");
    slot.className = "sws-slot";
    slot.dataset.sws = "1";
    slot.style.setProperty("width", `${Math.round(w)}px`, "important");
    slot.style.setProperty("height", `${Math.round(h)}px`, "important");
    const cs = getComputedStyle(el);
    for (const prop of ["margin-top", "margin-bottom", "margin-left", "margin-right", "float"]) {
      slot.style.setProperty(prop, cs.getPropertyValue(prop));
    }
    if (cs.display.startsWith("inline")) {
      slot.style.setProperty("display", "inline-block", "important");
    }
    if (cs.position === "fixed" || cs.position === "sticky") {
      for (const prop of ["position", "top", "right", "bottom", "left", "z-index"]) {
        slot.style.setProperty(prop, cs.getPropertyValue(prop), "important");
      }
    }
    slot.appendChild(makeVideo());
    sizeWatcher.unobserve(el);
    el.replaceWith(slot);
  }

  function forget(el) {
    clearTimeout(pending.get(el));
    pending.delete(el);
    if (el.tagName !== "IFRAME") sizeWatcher.unobserve(el);
  }

  function hide(el) {
    el.dataset.sws = "1";
    el.classList.add("sws-hidden");
  }

  function tryReplace(el, timedOut = false) {
    if (!el.isConnected) return forget(el);
    const size = slotSize(el, timedOut);
    if (size) {
      forget(el);
      if (size.h <= MAX_HEIGHT) replaceAd(el, size);
      else el.dataset.sws = "1";
      return;
    }
    if (timedOut) {
      forget(el);
      hide(el);
    }
  }

  function handle(el) {
    if (!el.isConnected || el.dataset.sws || pending.has(el)) return;
    if (el === document.body || el === document.documentElement) return;
    if (el.closest(".sws-slot")) return;

    const size = slotSize(el, false);
    if (size) {
      if (size.h <= MAX_HEIGHT) replaceAd(el, size);
      else el.dataset.sws = "1";
      return;
    }
    pending.set(el, setTimeout(() => tryReplace(el, true), PENDING_TIMEOUT_MS));
    sizeWatcher.observe(el);
  }

  function flush() {
    scheduled = false;
    const batch = queue;
    queue = new Set();
    for (const el of batch) {
      let inner = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (batch.has(p)) {
          inner = true;
          break;
        }
      }
      if (!inner) handle(el);
    }
  }

  function enqueue(el) {
    queue.add(el);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
      setTimeout(() => scheduled && flush(), 100);
    }
  }

  document.addEventListener("animationstart", (e) => {
    if (e.animationName !== "sws-detect") return;
    const el = e.target;
    if (el instanceof Element && !el.dataset.sws && !el.closest(".sws-slot")) enqueue(el);
  }, true);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "blockedFrame") return;
    for (const iframe of document.querySelectorAll("iframe")) {
      if (iframe.src === msg.url) enqueue(iframe);
    }
  });

  function watchFrames(root) {
    if (root.tagName === "IFRAME") sizeWatcher.observe(root);
    root.querySelectorAll?.("iframe").forEach((f) => sizeWatcher.observe(f));
  }

  browser.runtime.sendMessage({ type: "init" }).then((res) => {
    if (!res?.enabled) return;
    watchFrames(document.documentElement);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) watchFrames(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }).catch(() => {});
})();
