import { fetch as UndiciFetch, ProxyAgent } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import dotenv from "dotenv";

dotenv.config();

/**
 * Uses Node.js native fetch (available in Node 18+).
 * For proxy support, we use undici's ProxyAgent.
 */
function createProxyFetch() {
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;

  const proxy = httpsProxy || httpProxy || allProxy;

  if (proxy) {
    // Use undici fetch with proxy
    const dispatcher = new ProxyAgent(proxy);
    return async function proxyFetch(
      url: string | URL | Request,
      options: RequestInit = {}
    ): Promise<Response> {
      return UndiciFetch(url as string, { dispatcher, ...options } as any) as unknown as Promise<Response>;
    };
  }

  // No proxy - use native fetch
  return async function proxyFetch(
    url: string | URL | Request,
    options: RequestInit = {}
  ): Promise<Response> {
    return fetch(url, options);
  };
}

export const proxyFetch = createProxyFetch();

function createUndiciProxyFetch() {
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;

  const proxyUrl = httpsProxy || httpProxy || allProxy;

  let dispatcher = undefined;

  if (proxyUrl) {
    console.log("[undici] Using proxy:", proxyUrl);
    dispatcher = new ProxyAgent(proxyUrl);
  } else {
    console.log("[undici] No proxy configured");
  }

  return async function undiciProxyFetch(
    url: string,
    options: RequestInit = {}
  ) {
    // @ts-ignore
    return UndiciFetch(url, { dispatcher, ...options });
  };
}

export const undiciProxyFetch = createUndiciProxyFetch();
