(() => {
  if (window.__API_INSPECTOR_INJECTED__) return;
  window.__API_INSPECTOR_INJECTED__ = true;

  let enabled = true;
  const MAX_BODY_LENGTH = 20000;

  // Listen for enable/disable from content script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg && msg.source === "API_INSPECTOR_CONTROL") {
      if (typeof msg.enabled === "boolean") enabled = msg.enabled;
    }
  });

  function truncate(str) {
    if (typeof str !== "string") return str;
    if (str.length > MAX_BODY_LENGTH) return str.slice(0, MAX_BODY_LENGTH) + `\n...[truncated ${str.length - MAX_BODY_LENGTH} chars]`;
    return str;
  }

  function safeParseJson(text) {
    if (typeof text !== "string") return { parsed: text, isJson: false };
    const trimmed = text.trim();
    if (!trimmed) return { parsed: text, isJson: false };
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return { parsed: JSON.parse(text), isJson: true };
      } catch {}
    }
    return { parsed: text, isJson: false };
  }

  function parseQueryParams(url) {
    try {
      const u = new URL(url, location.href);
      const params = {};
      u.searchParams.forEach((v, k) => {
        if (params[k] !== undefined) {
          if (Array.isArray(params[k])) params[k].push(v);
          else params[k] = [params[k], v];
        } else params[k] = v;
      });
      return params;
    } catch { return {}; }
  }

  function getDomain(url) {
    try { return new URL(url, location.href).hostname; } catch { return ""; }
  }

  function shouldIgnore(url) {
    if (!url) return true;
    const s = String(url);
    if (s.startsWith("chrome-extension://") || s.startsWith("chrome://") || s.startsWith("moz-extension://") || s.startsWith("about:") || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("file:")) return true;
    // 只攔截 http(s)，避免 chrome-search 等內部協議噪音
    if (!s.startsWith("http://") && !s.startsWith("https://") && !s.startsWith("/") && !s.startsWith("./") && !s.startsWith("../")) {
      // 相對路徑以外的非 http 直接忽略（例如 ws:, wss: 由其他邏輯處理）
      if (s.includes("://")) return true;
    }
    return false;
  }

  function sendLog(payload) {
    if (!enabled) return;
    if (shouldIgnore(payload.url)) return;
    window.postMessage({ source: "API_INSPECTOR_LOG", payload }, "*");
  }

  // ---------- FETCH PATCH ----------
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    let url = "";
    let method = "GET";
    let requestHeaders = {};
    let requestBody = null;

    try {
      if (typeof input === "string") url = input;
      else if (input instanceof Request) {
        url = input.url;
        method = input.method || method;
        // Extract headers from Request
        try {
          input.headers.forEach((v, k) => { requestHeaders[k] = v; });
        } catch {}
        // Try to clone body? Request body can only be read once, so we try best effort
      } else if (input && typeof input === "object" && input.url) {
        url = String(input.url);
      }

      if (init) {
        if (init.method) method = String(init.method).toUpperCase();
        if (init.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach((v, k) => { requestHeaders[k] = v; });
          } else if (Array.isArray(init.headers)) {
            init.headers.forEach(([k, v]) => { requestHeaders[k] = v; });
          } else if (typeof init.headers === "object") {
            Object.assign(requestHeaders, init.headers);
          }
        }
        if (init.body !== undefined) requestBody = init.body;
      }

      if (!method && input instanceof Request) method = input.method;
      method = (method || "GET").toUpperCase();
    } catch {}

    if (shouldIgnore(url)) {
      return originalFetch.apply(this, arguments);
    }

    const start = performance.now();
    const timestamp = Date.now();

    // Normalize requestBody for logging
    let loggedRequestBody = null;
    let requestBodyType = "empty";
    if (requestBody !== null && requestBody !== undefined) {
      if (typeof requestBody === "string") {
        const { parsed, isJson } = safeParseJson(requestBody);
        loggedRequestBody = isJson ? parsed : truncate(requestBody);
        requestBodyType = isJson ? "json" : "text";
        if (!isJson && requestBody.startsWith && (requestBody.includes("=") || requestBody.includes("&"))) {
          // try form
          requestBodyType = "form";
        }
      } else if (requestBody instanceof URLSearchParams) {
        loggedRequestBody = Object.fromEntries(requestBody.entries());
        requestBodyType = "form";
      } else if (requestBody instanceof FormData) {
        const obj = {};
        try { for (const [k, v] of requestBody.entries()) obj[k] = v instanceof File ? `[File: ${v.name} ${v.size}bytes]` : String(v); } catch {}
        loggedRequestBody = obj;
        requestBodyType = "form";
      } else if (requestBody instanceof Blob) {
        loggedRequestBody = `[Blob ${requestBody.type} ${requestBody.size}bytes]`;
        requestBodyType = "blob";
      } else if (requestBody instanceof ArrayBuffer) {
        loggedRequestBody = `[ArrayBuffer ${requestBody.byteLength}bytes]`;
        requestBodyType = "binary";
      } else {
        try { loggedRequestBody = truncate(JSON.stringify(requestBody)); } catch { loggedRequestBody = String(requestBody); }
      }
    }

    let response;
    let error = null;
    try {
      response = await originalFetch.apply(this, arguments);
    } catch (e) {
      error = e;
      const duration = Math.round(performance.now() - start);
      sendLog({
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        timestamp,
        isoTime: new Date(timestamp).toISOString(),
        method,
        url: String(url),
        domain: getDomain(String(url)),
        queryParams: parseQueryParams(String(url)),
        requestHeaders,
        requestBody: loggedRequestBody,
        requestBodyType,
        status: 0,
        statusText: error ? String(error.message || error) : "Network Error",
        responseHeaders: {},
        responseBody: null,
        responseBodyType: "error",
        duration,
        type: "fetch",
        error: String(error)
      });
      throw e;
    }

    // Clone response for reading
    let responseBody = null;
    let responseBodyType = "unknown";
    let responseHeaders = {};
    let status = response.status;
    let statusText = response.statusText;

    try {
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });
    } catch {}

    try {
      const clone = response.clone();
      const text = await clone.text();
      const truncated = truncate(text);
      const { parsed, isJson } = safeParseJson(truncated);
      // if original text was truncated, parsed may be incomplete, fallback to text
      if (text.length > MAX_BODY_LENGTH) {
        // Try parse original truncated? just keep truncated text
        responseBody = truncated;
        responseBodyType = "text";
        // attempt json parse on truncated may fail, keep text
        try { responseBody = JSON.parse(text.slice(0, MAX_BODY_LENGTH)); responseBodyType = "json"; } catch {}
      } else {
        responseBody = parsed;
        responseBodyType = isJson ? "json" : "text";
        if (!isJson && typeof parsed === "string" && parsed.length === 0) {
          responseBody = null;
          responseBodyType = "empty";
        }
      }
      // Detect header content-type
      const ct = responseHeaders["content-type"] || responseHeaders["Content-Type"] || "";
      if (ct.includes("application/json") && typeof responseBody === "string") {
        try { responseBody = JSON.parse(responseBody); responseBodyType = "json"; } catch {}
      }
    } catch (e) {
      responseBody = `[unreadable: ${e.message}]`;
      responseBodyType = "error";
    }

    const duration = Math.round(performance.now() - start);

    sendLog({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      timestamp,
      isoTime: new Date(timestamp).toISOString(),
      method,
      url: String(url),
      domain: getDomain(String(url)),
      queryParams: parseQueryParams(String(url)),
      requestHeaders,
      requestBody: loggedRequestBody,
      requestBodyType,
      status,
      statusText,
      responseHeaders,
      responseBody,
      responseBodyType,
      duration,
      type: "fetch",
      error: null
    });

    return response;
  };

  // ---------- XHR PATCH ----------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origGetResponseHeader = XMLHttpRequest.prototype.getResponseHeader;
  const origGetAllResponseHeaders = XMLHttpRequest.prototype.getAllResponseHeaders;

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._apiInspector = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
      requestHeaders: {},
      requestBody: null,
      requestBodyType: "empty",
      start: 0,
      timestamp: 0
    };
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (this._apiInspector) {
      this._apiInspector.requestHeaders[header] = value;
    }
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (!this._apiInspector || shouldIgnore(this._apiInspector.url)) {
      return origSend.apply(this, arguments);
    }

    const info = this._apiInspector;
    info.start = performance.now();
    info.timestamp = Date.now();

    // Normalize body
    let loggedBody = null;
    let bodyType = "empty";
    if (body !== null && body !== undefined) {
      if (typeof body === "string") {
        const { parsed, isJson } = safeParseJson(body);
        loggedBody = isJson ? parsed : truncate(body);
        bodyType = isJson ? "json" : "text";
        if (typeof body === "string" && body.includes("=") && !isJson) bodyType = "form";
      } else if (body instanceof URLSearchParams) {
        loggedBody = Object.fromEntries(body.entries());
        bodyType = "form";
      } else if (body instanceof FormData) {
        const obj = {};
        try { for (const [k, v] of body.entries()) obj[k] = v instanceof File ? `[File: ${v.name} ${v.size}bytes]` : String(v); } catch {}
        loggedBody = obj;
        bodyType = "form";
      } else if (body instanceof Document) {
        loggedBody = "[Document]";
        bodyType = "document";
      } else if (body instanceof Blob) {
        loggedBody = `[Blob ${body.type} ${body.size}bytes]`;
        bodyType = "blob";
      } else {
        try { loggedBody = truncate(String(body)); bodyType = "text"; } catch { loggedBody = String(body); }
      }
    }
    info.requestBody = loggedBody;
    info.requestBodyType = bodyType;

    const xhr = this;

    const handleDone = () => {
      try {
        if (!enabled) return;
        const duration = Math.round(performance.now() - info.start);
        let status = 0;
        let statusText = "";
        let responseHeaders = {};
        let responseBody = null;
        let responseBodyType = "unknown";
        try { status = xhr.status; statusText = xhr.statusText; } catch {}
        try {
          const rawHeaders = origGetAllResponseHeaders.call(xhr);
          if (rawHeaders) {
            rawHeaders.trim().split(/[\r\n]+/).forEach(line => {
              const idx = line.indexOf(":");
              if (idx > 0) {
                const k = line.slice(0, idx).trim().toLowerCase();
                const v = line.slice(idx + 1).trim();
                responseHeaders[k] = v;
              }
            });
          }
        } catch {}
        try {
          let text = null;
          // xhr.responseType may be json, blob, etc
          if (xhr.responseType === "" || xhr.responseType === "text" || xhr.responseType === "json") {
            text = xhr.responseText;
            if (xhr.responseType === "json" && xhr.response) {
              responseBody = xhr.response;
              responseBodyType = "json";
            } else if (typeof text === "string") {
              const trunc = truncate(text);
              const { parsed, isJson } = safeParseJson(trunc);
              if (text.length > MAX_BODY_LENGTH) {
                responseBody = trunc;
                responseBodyType = "text";
              } else {
                responseBody = parsed;
                responseBodyType = isJson ? "json" : (text ? "text" : "empty");
                if (responseBody === "" ) { responseBody = null; responseBodyType = "empty"; }
              }
            }
          } else if (xhr.responseType === "blob" && xhr.response) {
            responseBody = `[Blob ${xhr.response.type || ""} ${xhr.response.size || 0}bytes]`;
            responseBodyType = "blob";
          } else if (xhr.responseType === "arraybuffer" && xhr.response) {
            responseBody = `[ArrayBuffer ${xhr.response.byteLength}bytes]`;
            responseBodyType = "binary";
          } else if (xhr.responseType === "document" && xhr.response) {
            responseBody = "[Document]";
            responseBodyType = "document";
          } else {
            try { responseBody = truncate(String(xhr.response)); responseBodyType = "text"; } catch { responseBody = null; }
          }
        } catch (e) {
          responseBody = `[unreadable: ${e.message}]`;
          responseBodyType = "error";
        }

        sendLog({
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          timestamp: info.timestamp,
          isoTime: new Date(info.timestamp).toISOString(),
          method: info.method,
          url: info.url.startsWith("http") ? info.url : new URL(info.url, location.href).href,
          domain: getDomain(info.url),
          queryParams: parseQueryParams(info.url),
          requestHeaders: info.requestHeaders,
          requestBody: info.requestBody,
          requestBodyType: info.requestBodyType,
          status,
          statusText,
          responseHeaders,
          responseBody,
          responseBodyType,
          duration,
          type: "xhr",
          error: status === 0 ? "Network Error" : null
        });
      } catch (e) {
        console.debug("[Apii] XHR log error", e);
      }
    };

    // Use loadend to capture both success and error
    xhr.addEventListener("loadend", handleDone, { once: true });

    return origSend.apply(this, arguments);
  };

  // Initial state broadcast
  console.debug("[Apii] Injected fetch/XHR hooks");
})();
