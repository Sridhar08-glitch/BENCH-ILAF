import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

/** A solid-colour PNG for upload tests (the API re-encodes pictures, so it must be a real, decodable image). */
export async function pngBuffer(width = 600, height = 300, colour = "#2563eb"): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
}

export interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** A small web server that records what it receives: the "customer system" a webhook points at. */
export async function startReceiver(): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Marks a test as waiting for a page that another team is still building. */
export function skipReason(route: string) {
  return `the page ${route} does not exist in this build yet`;
}
