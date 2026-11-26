// The company domain a request is served on, as the middleware decided (lib/domains/route.ts). Only the middleware sets these headers
// (it removes any that a visitor sent), so a page may trust them.
import { headers } from "next/headers";
import { CUSTOM_HOST_HEADER, CUSTOM_ROOT_HEADER } from "@/lib/domains/route";

type HeaderReader = { get(name: string): string | null };

export interface CustomHostInfo {
  /** The domain, or null on the Bench host. */
  host: string | null;
  /** The visitor asked for "/" and got the company card or directory under it. */
  root: boolean;
}

export function customHostFrom(h: HeaderReader): CustomHostInfo {
  return { host: h.get(CUSTOM_HOST_HEADER) || null, root: h.get(CUSTOM_ROOT_HEADER) === "1" };
}

export async function getCustomHost(): Promise<CustomHostInfo> {
  return customHostFrom(await headers());
}
