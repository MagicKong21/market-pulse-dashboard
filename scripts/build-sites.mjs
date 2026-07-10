import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
let source = await readFile(join(root, "server.mjs"), "utf8");
const staticAssets = {};

async function collectStaticAssets(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await collectStaticAssets(absolute, relative);
    else staticAssets[`/${relative}`] = Buffer.from(await readFile(absolute)).toString("base64");
  }
}

await collectStaticAssets(join(root, "public"));

source = source
  .replace(/^import http[^\n]+\nimport \{ readFile[^\n]+\nimport \{ dirname[^\n]+\nimport \{ fileURLToPath[^\n]+\n/, "")
  .replace(/const ROOT =[\s\S]*?const HOST =[^\n]+\n/, "")
  .replace(/const CACHE_FILE =[^\n]+\n/, "")
  .replace(/let diskCache = \{\};\n\ntry \{ diskCache =[\s\S]*?\n\n/, "let diskCache = {};\n\n")
  .replace(/let persistTimer;\nfunction persistCache\(\) \{[\s\S]*?\n\}\n\nasync function mapConcurrent/, "function persistCache() {}\n\nasync function mapConcurrent")
  .replace(/async function serveStatic[\s\S]*$/, "");

source += `
const STATIC_ASSETS = new Map(Object.entries(${JSON.stringify(staticAssets)}));
const staticMime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
function serveEmbeddedAsset(pathname) {
  const path = pathname === "/" ? "/index.html" : pathname;
  const encoded = STATIC_ASSETS.get(path);
  if (!encoded) return null;
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": staticMime[extension] || "application/octet-stream", "cache-control": path === "/index.html" ? "no-cache" : "public, max-age=300" } });
}
const workerJsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: workerJsonHeaders });

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/market") {
        const period = url.searchParams.get("period") || "1mo";
        if (!isPeriod(period)) return json({ error: "不支持的周期" }, 400);
        const force = url.searchParams.get("force") === "1";
        const page = Number(url.searchParams.get("page") || 0);
        const pageSize = Number(url.searchParams.get("pageSize") || 48);
        if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) return json({ error: "分页参数无效" }, 400);
        let requestedInstruments;
        try { requestedInstruments = resolveInstruments(url.searchParams.get("symbols")); }
        catch (error) { return json({ error: error.message }, 400); }
        const maxAge = autoRefreshMaxAge(period, url.searchParams.get("refreshMs"), url.searchParams.has("refreshMs"));
        return json(await dashboard(period, force, requestedInstruments, page, pageSize, url.searchParams.get("sort") !== "none", maxAge));
      }
      if (request.method === "GET" && url.pathname === "/api/lookup") {
        try { return json(await lookupInstrument(url.searchParams.get("symbol"))); }
        catch (error) { return json({ error: error.message }, 404); }
      }
      if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, instruments: INSTRUMENTS.length });
      if (request.method === "POST" && url.pathname === "/api/shutdown") return json({ error: "分享版网站无需关闭后台服务" }, 405);
      if (request.method === "GET") {
        const asset = serveEmbeddedAsset(url.pathname);
        if (asset) return asset;
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message || "服务器错误" }, 500);
    }
  }
};
`;

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "server"), { recursive: true });
await cp(join(root, "public"), join(dist, "public"), { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });
await cp(join(root, "market.mjs"), join(dist, "server", "market.mjs"));
await writeFile(join(dist, "server", "index.js"), source);

const hostingPath = join(root, ".openai", "hosting.json");
try {
  const hosting = await readFile(hostingPath, "utf8");
  await mkdir(join(dist, ".openai"), { recursive: true });
  await writeFile(join(dist, ".openai", "hosting.json"), hosting);
} catch {}
