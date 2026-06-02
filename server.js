const http = require("http");
const https = require("https");
const { URL } = require("url");
const path = require("path");
const fs = require("fs");

const PORT = Number(process.env.PORT || 4174);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 1024 * 1024;

const sessions = new Map();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeBaseUrl(input) {
  const trimmed = String(input || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Server address is required.");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildBaseCandidates(input) {
  const normalized = normalizeBaseUrl(input);
  const url = new URL(normalized);
  const withoutPath = `${url.protocol}//${url.host}`;
  const candidates = [normalized, withoutPath];

  if (url.protocol === "https:") {
    candidates.push(`http://${url.host}`);
  }

  return [...new Set(candidates.map((item) => item.replace(/\/+$/, "")))];
}

function httpRequest(method, target, options = {}) {
  const url = new URL(target);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const body = options.body || null;
  const headers = { ...(options.headers || {}) };

  if (body && !headers["content-length"]) {
    headers["content-length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers,
        rejectUnauthorized: options.rejectUnauthorized !== false,
        timeout: options.timeout || 8000
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = raw;
          const contentType = String(res.headers["content-type"] || "");
          if (raw && contentType.includes("json")) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, data, raw });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Timeout calling ${target}`));
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function hasGatewaySignal(response) {
  if (!response) return false;
  if ([200, 401, 403].includes(response.status)) return true;
  if (response.status === 404) return false;
  const text = typeof response.data === "string" ? response.data : JSON.stringify(response.data || {});
  return /xprotect|milestone|oauth|openid|bearer|unauthorized/i.test(text);
}

async function probeGateway(server, allowInsecure) {
  const idpPaths = [
    "/API/IDP/.well-known/openid-configuration",
    "/api/idp/.well-known/openid-configuration",
    "/IDP/.well-known/openid-configuration",
    "/idp/.well-known/openid-configuration"
  ];
  const tokenPaths = [
    "/API/IDP/connect/token",
    "/api/idp/connect/token",
    "/IDP/connect/token",
    "/idp/connect/token"
  ];
  const apiRoots = ["/api/rest/v1", "/API/rest/v1"];
  const results = [];

  for (const base of buildBaseCandidates(server)) {
    for (const idpPath of idpPaths) {
      const target = joinUrl(base, idpPath);
      try {
        const response = await httpRequest("GET", target, {
          rejectUnauthorized: !allowInsecure,
          timeout: 5000
        });
        results.push({ kind: "idp-discovery", url: target, status: response.status });
        if (response.status === 200 && response.data && typeof response.data === "object") {
          const tokenEndpoint = response.data.token_endpoint || joinUrl(base, idpPath.replace("/.well-known/openid-configuration", "/connect/token"));
          return await probeApiRoots(base, tokenEndpoint, apiRoots, allowInsecure, results);
        }
      } catch (error) {
        results.push({ kind: "idp-discovery", url: target, error: error.message });
      }
    }

    for (const tokenPath of tokenPaths) {
      const tokenEndpoint = joinUrl(base, tokenPath);
      try {
        const response = await httpRequest("POST", tokenEndpoint, {
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "grant_type=password&client_id=GrantValidatorClient",
          rejectUnauthorized: !allowInsecure,
          timeout: 5000
        });
        results.push({ kind: "token", url: tokenEndpoint, status: response.status });
        if ([400, 401, 415].includes(response.status) || hasGatewaySignal(response)) {
          return await probeApiRoots(base, tokenEndpoint, apiRoots, allowInsecure, results);
        }
      } catch (error) {
        results.push({ kind: "token", url: tokenEndpoint, error: error.message });
      }
    }
  }

  return {
    ok: false,
    message: "Could not locate the IDP/API Gateway with the known routes.",
    results
  };
}

async function probeApiRoots(base, tokenEndpoint, apiRoots, allowInsecure, results) {
  let selectedApiRoot = null;

  for (const apiRootPath of apiRoots) {
    const cameraUrl = joinUrl(base, `${apiRootPath}/cameras?page=0&size=1`);
    try {
      const response = await httpRequest("GET", cameraUrl, {
        rejectUnauthorized: !allowInsecure,
        timeout: 5000
      });
      results.push({ kind: "config-api", url: cameraUrl, status: response.status });
      if ([200, 401, 403].includes(response.status)) {
        selectedApiRoot = joinUrl(base, apiRootPath);
        break;
      }
    } catch (error) {
      results.push({ kind: "config-api", url: cameraUrl, error: error.message });
    }
  }

  return {
    ok: Boolean(selectedApiRoot),
    baseUrl: base,
    tokenEndpoint,
    apiRoot: selectedApiRoot,
    results,
    message: selectedApiRoot
      ? "Gateway located. Authentication can be attempted."
      : "IDP was located, but the Configuration API root was not confirmed."
  };
}

function createSession(data) {
  const id = cryptoRandomId();
  sessions.set(id, { ...data, createdAt: Date.now() });
  return id;
}

function cryptoRandomId() {
  return require("crypto").randomBytes(24).toString("hex");
}

function getSession(req) {
  const id = req.headers["x-session-id"];
  if (!id || !sessions.has(id)) {
    throw new Error("Session not found. Connect again.");
  }
  return sessions.get(id);
}

async function login(payload) {
  const probe = await probeGateway(payload.server, payload.allowInsecure);
  if (!probe.ok) {
    return { status: 400, body: probe };
  }

  const authMode = payload.authMode || "password";
  const tokenBody =
    authMode === "windows_credentials"
      ? {
          grant_type: "windows_credentials",
          client_id: payload.clientId || "GrantValidatorClient"
        }
      : {
          grant_type: "password",
          username: payload.username || "",
          password: payload.password || "",
          client_id: payload.clientId || "GrantValidatorClient"
        };
  const body = new URLSearchParams(tokenBody).toString();

  const response = await httpRequest("POST", probe.tokenEndpoint, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    rejectUnauthorized: !payload.allowInsecure,
    timeout: 10000
  });

  if (response.status < 200 || response.status >= 300 || !response.data.access_token) {
    return {
      status: 401,
      body: {
        ok: false,
        message: "Could not obtain an access token. Check credentials, authentication mode, IDP route, and permissions.",
        authMode,
        tokenEndpoint: probe.tokenEndpoint,
        status: response.status,
        response: response.data,
        raw: typeof response.raw === "string" ? response.raw.slice(0, 2000) : ""
      }
    };
  }

  const sessionId = createSession({
    apiRoot: probe.apiRoot,
    tokenEndpoint: probe.tokenEndpoint,
    accessToken: response.data.access_token,
    allowInsecure: Boolean(payload.allowInsecure),
    expiresIn: response.data.expires_in || null
  });

  return {
    status: 200,
    body: {
      ok: true,
      sessionId,
      apiRoot: probe.apiRoot,
      tokenEndpoint: probe.tokenEndpoint,
      expiresIn: response.data.expires_in || null,
      probeResults: probe.results
    }
  };
}

function normalizeItems(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.array)) return data.array;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function listCameras(session) {
  const all = [];
  let page = 0;
  const size = 100;

  while (page < 1000) {
    const url = joinUrl(session.apiRoot, `/cameras?page=${page}&size=${size}`);
    const response = await httpRequest("GET", url, {
      headers: { authorization: `Bearer ${session.accessToken}` },
      rejectUnauthorized: !session.allowInsecure,
      timeout: 15000
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Camera list failed with HTTP ${response.status}: ${stringifyShort(response.data)}`);
    }

    const items = normalizeItems(response.data);
    all.push(...items);
    if (items.length < size) break;
    page += 1;
  }

  return all.map((camera) => ({
    id: camera.id || camera.objectId || camera.path || camera.url || "",
    name: camera.name || camera.displayName || "",
    enabled: camera.enabled ?? camera.isEnabled ?? null,
    description: camera.description || "",
    parentId: camera.parentId || camera.hardwareId || "",
    raw: camera
  }));
}

function stringifyShort(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function cameraPatchUrl(apiRoot, camera) {
  const raw = camera.raw || camera;
  const id = raw.id || raw.objectId || camera.id;
  if (!id) {
    throw new Error(`Camera ${camera.name || "(unnamed)"} has no id.`);
  }
  if (/^https?:\/\//i.test(id)) {
    return id;
  }
  const safeId = String(id).startsWith("/") ? String(id) : `/cameras/${encodeURIComponent(id)}`;
  return joinUrl(apiRoot, safeId);
}

async function renameCameras(session, changes) {
  const results = [];

  for (const change of changes) {
    const url = cameraPatchUrl(session.apiRoot, change);
    const response = await httpRequest("PATCH", url, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: change.newName }),
      rejectUnauthorized: !session.allowInsecure,
      timeout: 15000
    });

    results.push({
      id: change.id,
      oldName: change.oldName,
      newName: change.newName,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      response: response.status >= 200 && response.status < 300 ? undefined : response.data
    });
  }

  return results;
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  const rawPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  });
}

async function routeApi(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/probe") {
      const body = await readBody(req);
      sendJson(res, 200, await probeGateway(body.server, body.allowInsecure));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const result = await login(body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cameras") {
      const session = getSession(req);
      sendJson(res, 200, { ok: true, cameras: await listCameras(session) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/rename") {
      const session = getSession(req);
      const body = await readBody(req);
      const changes = Array.isArray(body.changes) ? body.changes : [];
      if (!changes.length) {
        sendJson(res, 400, { ok: false, message: "No changes provided." });
        return;
      }
      const results = await renameCameras(session, changes);
      sendJson(res, 200, { ok: results.every((item) => item.ok), results });
      return;
    }

    sendJson(res, 404, { ok: false, message: "API route not found." });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    routeApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`XProtect camera renamer listening on http://localhost:${PORT}`);
});
