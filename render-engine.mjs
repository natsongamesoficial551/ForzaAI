import http from "node:http";
import engineHandler, { ENGINE_VERSION } from "./netlify/functions/generate-site-background.mjs";

const port = Number(process.env.PORT || 3000);
const autoPingUrl = process.env.AUTO_PING;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      send(res, 200, { ok: true, service: "forza-engine", version: ENGINE_VERSION });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/generate-site-background") {
      send(res, 404, { error: "Not found" });
      return;
    }

    const body = await readBody(req);
    const request = new Request(`http://localhost${url.pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "x-generation-secret": req.headers["x-generation-secret"] || "",
      },
      body,
    });

    send(res, 202, { ok: true, accepted: true });

    engineHandler(request)
      .then(async (response) => {
        const responseText = await response.text();
        console.log(`[render engine] generation finished ${response.status}: ${responseText.slice(0, 300)}`);
      })
      .catch((error) => {
        console.error("[render engine] generation failed", error);
      });
  } catch (error) {
    console.error("[render engine] request failed", error);
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`[render engine] listening on ${port}`);
});

if (autoPingUrl) {
  const ping = async () => {
    try {
      const response = await fetch(autoPingUrl, { method: "GET" });
      console.log(`[render engine] auto-ping ${autoPingUrl} -> ${response.status}`);
    } catch (error) {
      console.error("[render engine] auto-ping failed", error);
    }
  };

  setInterval(ping, 7 * 60 * 1000);
  setTimeout(ping, 30 * 1000);
}
