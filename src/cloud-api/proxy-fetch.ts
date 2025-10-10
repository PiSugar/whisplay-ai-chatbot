import fetch, { RequestInit, Response } from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { Agent } from "http";
import dotenv from "dotenv";

dotenv.config();

/**
 * Automatically creates a proxy-enabled version of node-fetch
 * based on system environment variables (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY).
 */
function createProxyFetch() {
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const allProxy = process.env.ALL_PROXY || process.env.all_proxy;

  let agent: Agent | undefined;

  const proxy = httpsProxy || httpProxy || allProxy;

  if (proxy) {
    if (proxy.startsWith("socks")) {
      agent = new SocksProxyAgent(proxy);
    } else {
      agent = new HttpsProxyAgent(proxy);
    }
  }

  return async function proxyFetch(
    url: string, 
    options: RequestInit = {}
  ): Promise<Response> {
    return fetch(url, { agent, ...options });
  };
}

export const proxyFetch = createProxyFetch();
