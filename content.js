(() => {
  // Inject script into MAIN world
  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.warn("[Apii] inject failed", e);
  }

  let enabledCache = true;

  // Sync enabled state to injected
  chrome.storage.local.get(["apiInspectorEnabled"], (res) => {
    if (res.apiInspectorEnabled !== undefined) {
      enabledCache = res.apiInspectorEnabled;
      postEnabled();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.apiInspectorEnabled) {
      enabledCache = changes.apiInspectorEnabled.newValue;
      postEnabled();
    }
  });

  function postEnabled() {
    window.postMessage({ source: "API_INSPECTOR_CONTROL", enabled: enabledCache }, "*");
  }

  // Bridge window message -> background
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "API_INSPECTOR_LOG") return;
    const payload = msg.payload;
    if (!payload) return;
    // Enrich with page info
    chrome.runtime.sendMessage({
      type: "API_LOG",
      payload: {
        ...payload,
        pageUrl: location.href,
        pageTitle: document.title
      }
    }).catch(() => {
      // background may not be ready, fallback to storage local queue? ignore
    });
  });

  // Also handle messages from background to forward to injected if needed
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "SET_ENABLED") {
      enabledCache = !!msg.enabled;
      postEnabled();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
