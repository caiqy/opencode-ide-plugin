import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../globals";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

/**
 * Lightweight HTTP server that serves the embedded webgui-dist files
 * under the `/app/` prefix and injects `window.__OPENCODE_SERVER_URL__`
 * into index.html so the webgui can reach the opencode REST API.
 */
class WebguiStaticServer {
  private server: http.Server | null = null;
  private port = 0;
  private rootDir = "";
  private serverUrl = "";

  async start(rootDir: string, opencodeServerUrl: string): Promise<string> {
    if (this.server) {
      return `http://127.0.0.1:${this.port}`;
    }

    this.rootDir = rootDir;
    this.serverUrl = opencodeServerUrl.replace(/\/$/, "");

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr !== "string") {
          this.port = addr.port;
          const base = `http://127.0.0.1:${this.port}`;
          logger.appendLine(`WebguiStaticServer started on ${base} serving ${rootDir}`);
          resolve(base);
        } else {
          reject(new Error("Failed to get server port"));
        }
      });
      this.server.on("error", (e) => {
        logger.appendLine(`WebguiStaticServer error: ${e}`);
        reject(e);
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }

  getBaseUrl(): string {
    if (!this.server) {
      return "";
    }
    return `http://127.0.0.1:${this.port}`;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`);
    let pathname = decodeURIComponent(url.pathname);

    // Must start with /app/
    if (!pathname.startsWith("/app")) {
      // Redirect root to /app/
      if (pathname === "/") {
        res.writeHead(302, { Location: "/app/" });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    // Strip /app prefix to get the relative file path within webgui-dist
    let relative = pathname.slice("/app".length);
    if (!relative || relative === "/") {
      relative = "/index.html";
    }

    const file = path.join(this.rootDir, relative);

    // Prevent directory traversal
    if (!file.startsWith(this.rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Check if file exists
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback: serve index.html for non-asset paths
      const index = path.join(this.rootDir, "index.html");
      if (fs.existsSync(index)) {
        this.serveFile(res, index, true);
        return;
      }
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    this.serveFile(res, file, path.basename(file) === "index.html");
  }

  private serveFile(res: http.ServerResponse, file: string, inject: boolean): void {
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";

    if (inject && ext === ".html") {
      // Read, inject global, serve
      let html = fs.readFileSync(file, "utf-8");
      const script = `<script>window.__OPENCODE_SERVER_URL__=${JSON.stringify(this.serverUrl)};</script>`;
      // Insert before the first <script tag so the global is available when app code runs
      const idx = html.indexOf("<script");
      if (idx !== -1) {
        html = html.slice(0, idx) + script + "\n    " + html.slice(idx);
      } else {
        html = html.replace("</head>", `${script}\n</head>`);
      }
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
      res.end(html);
      return;
    }

    // Stream the file
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    fs.createReadStream(file).pipe(res);
  }
}

export const webguiServer = new WebguiStaticServer();
