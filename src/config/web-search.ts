import { LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import { proxyFetch } from "../cloud-api/proxy-fetch";
import { fetch as undiciFetch, ProxyAgent } from "undici";

dotenv.config();

// Web search configuration
const webSearchEnabled = process.env.WEB_SEARCH_ENABLED !== "false";
const webSearchProvider = (process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();
const tavilyApiKey = process.env.TAVILY_API_KEY || "";
const serpApiKey = process.env.SERP_API_KEY || "";
const bingApiKey = process.env.BING_SEARCH_API_KEY || "";
const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY || "";
const googleCx = process.env.GOOGLE_SEARCH_CX || "";
const legacyWebSearchEnabled =
  process.env.WEB_SEARCH_LEGACY_ENABLED === "true" ||
  isConfiguredValue(tavilyApiKey) ||
  isConfiguredValue(serpApiKey) ||
  isConfiguredValue(bingApiKey) ||
  (isConfiguredValue(googleApiKey) && isConfiguredValue(googleCx));

// Search result limits
const maxResults = parseInt(process.env.WEB_SEARCH_MAX_RESULTS || "5", 10);
const includeImages = process.env.WEB_SEARCH_INCLUDE_IMAGES === "true";
const maxPageChars = parseInt(process.env.WEB_PAGE_TEXT_MAX_CHARS || "6000", 10);
const maxPageLinks = parseInt(process.env.WEB_PAGE_LINK_MAX_RESULTS || "30", 10);
const webToolProxy = process.env.WEB_TOOL_PROXY || "";
const webToolTimeoutMs = parseInt(process.env.WEB_TOOL_TIMEOUT_MS || "30000", 10);
const webToolDispatcher = webToolProxy ? new ProxyAgent(webToolProxy) : undefined;

export const webSearchTools: LLMTool[] = [];

type WebLink = { index: number; text: string; url: string };
type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  published?: string;
};

const lastPage: { url: string; links: WebLink[] } = { url: "", links: [] };

if (webSearchEnabled) {
  webSearchTools.push({
    type: "function",
    function: {
      name: "fetch_webpage",
      description:
        "Fetch a web page and return readable text plus links. Can also open a link from the current or previous page by link_text or link_index, e.g. open the Technology section.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Web page URL to fetch. Optional when opening a link from the previous page.",
          },
          current_url: {
            type: "string",
            description: "Base page URL containing the link to open.",
          },
          link_text: {
            type: "string",
            description:
              "Visible link text to open, for example '科技' or 'Technology'.",
          },
          link_index: {
            type: "number",
            description: "1-based link index from a previous fetch_webpage result.",
          },
          max_chars: {
            type: "number",
            description: "Optional maximum readable text characters to return.",
          },
        },
      },
    },
    func: async (params: any) => {
      try {
        const result = await fetchWebpage(params || {});
        return `${ToolReturnTag.Success}${formatFetchWebpageResult(result)}`;
      } catch (error: any) {
        console.error("[WebSearch] fetch_webpage error:", error);
        return `${ToolReturnTag.Error}Failed to fetch webpage: ${error.message}`;
      }
    },
  });

  webSearchTools.push({
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web and return compact result titles and URLs. search_type=web uses DuckDuckGo HTML, search_type=news uses Google News RSS, and search_type=sites uses Google Programmable Search JSON API when configured.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query.",
          },
          num_results: {
            type: "number",
            description: "Optional number of search results to return.",
          },
          search_type: {
            type: "string",
            description: "Optional search type: web, news, or sites.",
            enum: ["web", "news", "sites"],
          },
        },
        required: ["query"],
      },
    },
    func: async (params: any) => {
      try {
        const result = await performUniversalWebSearch(params || {});
        return `${ToolReturnTag.Success}${formatSearchResponse(result)}`;
      } catch (error: any) {
        console.error("[WebSearch] web_search error:", error);
        return `${ToolReturnTag.Error}Failed to search web: ${error.message}`;
      }
    },
  });
}

if (webSearchEnabled && legacyWebSearchEnabled) {
  // Validate API keys based on provider
  let hasValidConfig = false;
  
  switch (webSearchProvider) {
    case "tavily":
      hasValidConfig = isConfiguredValue(tavilyApiKey);
      break;
    case "serp":
      hasValidConfig = isConfiguredValue(serpApiKey);
      break;
    case "bing":
      hasValidConfig = isConfiguredValue(bingApiKey);
      break;
    case "google":
      hasValidConfig = isConfiguredValue(googleApiKey) && isConfiguredValue(googleCx);
      break;
    default:
      console.warn(`[WebSearch] Unknown provider: ${webSearchProvider}`);
  }

  if (hasValidConfig) {
    console.log(`[WebSearch] Enabled with provider: ${webSearchProvider}`);
    
    webSearchTools.push({
      type: "function",
      function: {
        name: "webSearch",
        description: 
          "Search the web for current information, news, facts, or any up-to-date content. " +
          "Use this when the user asks about current events, recent news, weather, " +
          "or any information that may have changed since your training data. " +
          "Returns a summary of search results with titles, snippets, and URLs.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to look up on the web",
            },
          },
          required: ["query"],
        },
      },
      func: async (params: { query: string }) => {
        try {
          const result = await performWebSearch(params.query);
          return `${ToolReturnTag.Success}${result}`;
        } catch (error: any) {
          console.error("[WebSearch] Error:", error);
          return `${ToolReturnTag.Error}Failed to perform web search: ${error.message}`;
        }
      },
    });

    if (includeImages) {
      webSearchTools.push({
        type: "function",
        function: {
          name: "webImageSearch",
          description: 
            "Search for images on the web. Use this when the user asks to find or show images of something. " +
            "Returns URLs of relevant images.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The image search query",
              },
            },
            required: ["query"],
          },
        },
        func: async (params: { query: string }) => {
          try {
            const result = await performWebImageSearch(params.query);
            return `${ToolReturnTag.Success}${result}`;
          } catch (error: any) {
            console.error("[WebSearch] Image search error:", error);
            return `${ToolReturnTag.Error}Failed to search images: ${error.message}`;
          }
        },
      });
    }
  } else {
    console.warn(
      `[WebSearch] Enabled but missing API key for provider: ${webSearchProvider}. ` +
      `Please check your .env configuration.`
    );
  }
}

async function performWebSearch(query: string): Promise<string> {
  switch (webSearchProvider) {
    case "tavily":
      return performTavilySearch(query);
    case "serp":
      return performSerpSearch(query);
    case "bing":
      return performBingSearch(query);
    case "google":
      return performGoogleSearch(query);
    default:
      throw new Error(`Unsupported web search provider: ${webSearchProvider}`);
  }
}

async function performWebImageSearch(query: string): Promise<string> {
  switch (webSearchProvider) {
    case "tavily":
      return performTavilyImageSearch(query);
    case "serp":
      return performSerpImageSearch(query);
    case "bing":
      return performBingImageSearch(query);
    case "google":
      return performGoogleImageSearch(query);
    default:
      throw new Error(`Unsupported image search provider: ${webSearchProvider}`);
  }
}

async function fetchWebpage(params: {
  url?: string;
  current_url?: string;
  link_text?: string;
  link_index?: number;
  max_chars?: number;
}): Promise<{
  url: string;
  status_code: number;
  title: string;
  text: string;
  links: WebLink[];
}> {
  const requestedUrl = `${params.url || ""}`.trim();
  const currentUrl = `${params.current_url || ""}`.trim();
  const linkText = `${params.link_text || ""}`.trim();
  const linkIndex = params.link_index;
  const textLimit = clampNumber(params.max_chars, 256, maxPageChars, maxPageChars);

  let url = "";
  if (linkText || linkIndex !== undefined) {
    let links = lastPage.links;
    let baseUrl = currentUrl || lastPage.url;
    if (requestedUrl) {
      const basePage = await extractPage(normalizeUrl(requestedUrl), maxPageChars);
      links = basePage.links;
      baseUrl = basePage.url;
    }
    if (!links.length) {
      throw new Error("no previous page links are available; pass url first");
    }
    const picked = pickLink(links, linkText, linkIndex);
    url = new URL(picked.url, baseUrl).toString();
  } else {
    url = normalizeUrl(requestedUrl || currentUrl);
  }

  return extractPage(url, textLimit);
}

async function performUniversalWebSearch(params: {
  query?: string;
  num_results?: number;
  search_type?: string;
}): Promise<{
  query: string;
  url: string;
  source: string;
  results: SearchResult[];
}> {
  const query = `${params.query || ""}`.trim();
  if (!query) {
    throw new Error("query is required");
  }
  const limit = clampNumber(params.num_results, 1, maxResults, maxResults);
  const searchType = `${params.search_type || "web"}`.trim().toLowerCase();

  if (searchType === "news" || searchType === "google_news") {
    try {
      const news = await searchGoogleNewsRss(query, limit);
      if (news.results.length) {
        return news;
      }
      console.warn("[WebSearch] Google News RSS returned no results; falling back to DuckDuckGo HTML");
    } catch (error: any) {
      console.warn("[WebSearch] Google News RSS failed; falling back to DuckDuckGo HTML:", error.message);
    }
    return searchDuckDuckGo(query, limit);
  }

  if (["sites", "site", "configured_sites"].includes(searchType)) {
    if (isConfiguredValue(googleApiKey) && isConfiguredValue(googleCx)) {
      try {
        const siteSearch = await searchGoogleProgrammable(query, limit);
        if (siteSearch.results.length) {
          return siteSearch;
        }
        console.warn("[WebSearch] Google site search returned no results; falling back to DuckDuckGo HTML");
      } catch (error: any) {
        console.warn("[WebSearch] Google site search failed; falling back to DuckDuckGo HTML:", error.message);
      }
    } else {
      console.log("[WebSearch] Google site search is not configured; using DuckDuckGo HTML");
    }
    return searchDuckDuckGo(query, limit);
  }

  return searchDuckDuckGo(query, limit);
}

async function extractPage(url: string, maxChars: number) {
  const response = await webToolFetch(url, {
    headers: webHeaders(),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const finalUrl = response.url || url;
  const html = await response.text();
  const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const text = clip(extractReadableText(html), maxChars);
  const links = dedupeLinks(extractLinks(html), finalUrl);
  lastPage.url = finalUrl;
  lastPage.links = links;
  return {
    url: finalUrl,
    status_code: response.status,
    title,
    text,
    links,
  };
}

function extractReadableText(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|h[1-6]|tr|table|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractLinks(html: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html))) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const href = (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1]
      || (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[2]
      || (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[3]
      || "";
    const text = cleanText(body.replace(/<[^>]+>/g, " "));
    if (href && text) {
      links.push({ text, url: decodeHtml(href) });
    }
  }
  return links;
}

function dedupeLinks(links: Array<{ text: string; url: string }>, baseUrl: string): WebLink[] {
  const seen = new Set<string>();
  const result: WebLink[] = [];
  for (const link of links) {
    let absolute = "";
    try {
      absolute = new URL(link.url, baseUrl).toString();
    } catch {
      continue;
    }
    if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) {
      continue;
    }
    const text = cleanText(link.text).slice(0, 100);
    const key = `${text}\n${absolute}`;
    if (!text || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ index: result.length + 1, text, url: absolute });
    if (result.length >= maxPageLinks) {
      break;
    }
  }
  return result;
}

function pickLink(links: WebLink[], linkText?: string, linkIndex?: number): WebLink {
  if (linkIndex !== undefined && linkIndex !== null) {
    const index = Number(linkIndex);
    const link = links.find((item) => item.index === index);
    if (!link) {
      throw new Error(`link_index ${index} was not found`);
    }
    return link;
  }

  const needle = normalizeMatchText(linkText || "");
  if (!needle) {
    throw new Error("link_text or link_index is required");
  }
  const contains: WebLink[] = [];
  for (const link of links) {
    const haystack = normalizeMatchText(link.text);
    if (haystack === needle) {
      return link;
    }
    if (haystack.includes(needle) || needle.includes(haystack)) {
      contains.push(link);
    }
  }
  if (contains.length) {
    return contains[0];
  }
  throw new Error(`link_text '${linkText}' was not found`);
}

async function searchDuckDuckGo(query: string, limit: number) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await webToolFetch(url, { headers: webHeaders() });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search error: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const resultRe = /<a\b([^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRe.exec(html))) {
    const attrs = match[1] || "";
    const href = (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[1]
      || (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[2]
      || (attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[3]
      || "";
    const finalUrl = extractDuckDuckGoUrl(decodeHtml(href));
    const title = cleanText(match[2].replace(/<[^>]+>/g, " "));
    if (!finalUrl || !title || seen.has(finalUrl)) {
      continue;
    }
    seen.add(finalUrl);
    results.push({ title, url: finalUrl });
    if (results.length >= limit) {
      break;
    }
  }
  console.log(`[WebSearch] DuckDuckGo returned ${results.length} result(s)`);
  return { query, url: response.url || url, source: "duckduckgo_html", results };
}

async function searchGoogleNewsRss(query: string, limit: number) {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans";
  const response = await webToolFetch(url, { headers: webHeaders() });
  if (!response.ok) {
    throw new Error(`Google News RSS error: ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const results: SearchResult[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml))) {
    const item = match[1];
    const title = cleanText(extractXmlTag(item, "title"));
    const resultUrl = cleanText(extractXmlTag(item, "link"));
    const snippet = cleanText(extractXmlTag(item, "description").replace(/<[^>]+>/g, " "));
    const source = cleanText(extractXmlTag(item, "source"));
    const published = cleanText(extractXmlTag(item, "pubDate"));
    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet, source, published });
    }
    if (results.length >= limit) {
      break;
    }
  }
  console.log(`[WebSearch] Google News RSS returned ${results.length} result(s)`);
  return { query, url: response.url || url, source: "google_news_rss", results };
}

async function searchGoogleProgrammable(query: string, limit: number) {
  const params = new URLSearchParams({
    key: googleApiKey,
    cx: googleCx,
    q: query,
    num: Math.min(limit, 10).toString(),
    hl: "zh-CN",
  });
  const url = `https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`;
  const response = await webToolFetch(url);
  if (!response.ok) {
    throw new Error(`Google Programmable Search API error: ${response.status} ${response.statusText}`);
  }
  const data: any = await response.json();
  const results = (data.items || []).slice(0, limit).map((item: any) => ({
    title: cleanText(item.title || ""),
    url: cleanText(item.link || ""),
    snippet: cleanText(item.snippet || ""),
    source: item.displayLink || "",
  })).filter((item: SearchResult) => item.title && item.url);
  console.log(`[WebSearch] Google Programmable Search returned ${results.length} result(s)`);
  return { query, url, source: "google_programmable_search_api", results };
}

function formatFetchWebpageResult(result: {
  url: string;
  status_code: number;
  title: string;
  text: string;
  links: WebLink[];
}): string {
  const links = result.links.length
    ? "\n\nLinks:\n" + result.links.map((link) => `[${link.index}] ${link.text}\nURL: ${link.url}`).join("\n")
    : "";
  return [
    `URL: ${result.url}`,
    `Status: ${result.status_code}`,
    result.title ? `Title: ${result.title}` : "",
    "",
    result.text || "(no readable text extracted)",
    links,
  ].filter(Boolean).join("\n");
}

function formatSearchResponse(result: {
  query: string;
  url: string;
  source: string;
  results: SearchResult[];
}): string {
  if (!result.results.length) {
    return `No results found.\nSource: ${result.source}`;
  }
  return `Source: ${result.source}\nSearch Results:\n\n` + result.results.map((item, index) => {
    let text = `[${index + 1}] ${item.title}\nURL: ${item.url}`;
    if (item.snippet) {
      text += `\nSnippet: ${clip(item.snippet, 300)}`;
    }
    if (item.source) {
      text += `\nSource: ${item.source}`;
    }
    if (item.published) {
      text += `\nPublished: ${item.published}`;
    }
    return text;
  }).join("\n\n");
}

function normalizeUrl(url: string): string {
  const value = url.trim();
  if (!value) {
    throw new Error("url is required");
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("url must be an http(s) URL");
  }
  return parsed.toString();
}

function webHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
  };
}

async function webToolFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webToolTimeoutMs);
  const requestOptions = {
    ...(options as any),
    signal: controller.signal,
  };
  try {
    if (!webToolDispatcher) {
      return await proxyFetch(url, requestOptions);
    }
    return await undiciFetch(url, {
      ...requestOptions,
      dispatcher: webToolDispatcher,
    }) as unknown as Response;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`request timed out after ${webToolTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isConfiguredValue(value: string): boolean {
  return !!value && !/^your_/i.test(value) && value !== "your_google_api_key" && value !== "your_google_cx";
}

function clampNumber(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanText(text: string): string {
  return decodeHtml(text).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit).trim()}\n...[truncated ${text.length - limit} chars]`;
}

function normalizeMatchText(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

function extractDuckDuckGoUrl(url: string): string {
  if (!url) {
    return "";
  }
  const withScheme = url.startsWith("//") ? `https:${url}` : url;
  try {
    const parsed = new URL(withScheme);
    if (parsed.hostname.endsWith("duckduckgo.com")) {
      return parsed.searchParams.get("uddg") || "";
    }
    if (["http:", "https:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeHtml((match || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "");
}

// Tavily Search Implementation
async function performTavilySearch(query: string): Promise<string> {
  const response = await webToolFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: query,
      search_depth: "advanced",
      include_answer: true,
      include_images: false,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  return formatTavilyResults(data);
}

async function performTavilyImageSearch(query: string): Promise<string> {
  const response = await webToolFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query: query,
      search_depth: "basic",
      include_answer: false,
      include_images: true,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  
  if (!data.images || data.images.length === 0) {
    return "No images found for this query.";
  }

  return `Found ${data.images.length} images:\n\n` + 
    data.images.map((img: string, i: number) => `${i + 1}. ${img}`).join("\n");
}

function formatTavilyResults(data: any): string {
  let result = "";
  
  // Include AI-generated answer if available
  if (data.answer) {
    result += `Summary: ${data.answer}\n\n`;
  }
  
  if (!data.results || data.results.length === 0) {
    result += "No detailed results found.";
    return result;
  }

  result += "Search Results:\n\n";
  
  data.results.forEach((item: any, index: number) => {
    result += `[${index + 1}] ${item.title}\n`;
    result += `URL: ${item.url}\n`;
    result += `Content: ${item.content?.substring(0, 300)}${item.content?.length > 300 ? "..." : ""}\n`;
    if (item.published_date) {
      result += `Published: ${item.published_date}\n`;
    }
    result += "\n";
  });

  return result.trim();
}

// SerpAPI Implementation
async function performSerpSearch(query: string): Promise<string> {
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: serpApiKey,
    num: maxResults.toString(),
  });

  const response = await webToolFetch(`https://serpapi.com/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  return formatSerpResults(data);
}

async function performSerpImageSearch(query: string): Promise<string> {
  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: serpApiKey,
    num: maxResults.toString(),
  });

  const response = await webToolFetch(`https://serpapi.com/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  
  if (!data.images_results || data.images_results.length === 0) {
    return "No images found for this query.";
  }

  return `Found ${data.images_results.length} images:\n\n` + 
    data.images_results.slice(0, maxResults).map((img: any, i: number) => 
      `${i + 1}. ${img.original || img.thumbnail}`
    ).join("\n");
}

function formatSerpResults(data: any): string {
  let result = "";
  
  // Include answer box if available
  if (data.answer_box?.answer) {
    result += `Quick Answer: ${data.answer_box.answer}\n\n`;
  } else if (data.answer_box?.snippet) {
    result += `Quick Answer: ${data.answer_box.snippet}\n\n`;
  }

  const organicResults = data.organic_results || [];
  
  if (organicResults.length === 0) {
    result += "No search results found.";
    return result;
  }

  result += "Search Results:\n\n";
  
  organicResults.slice(0, maxResults).forEach((item: any, index: number) => {
    result += `[${index + 1}] ${item.title}\n`;
    result += `URL: ${item.link}\n`;
    result += `Snippet: ${item.snippet}\n`;
    if (item.date) {
      result += `Date: ${item.date}\n`;
    }
    result += "\n";
  });

  return result.trim();
}

// Bing Search Implementation
async function performBingSearch(query: string): Promise<string> {
  const response = await webToolFetch(
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": bingApiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  return formatBingResults(data);
}

async function performBingImageSearch(query: string): Promise<string> {
  const response = await webToolFetch(
    `https://api.bing.microsoft.com/v7.0/images/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": bingApiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  
  if (!data.value || data.value.length === 0) {
    return "No images found for this query.";
  }

  return `Found ${data.value.length} images:\n\n` + 
    data.value.map((img: any, i: number) => `${i + 1}. ${img.contentUrl}`).join("\n");
}

function formatBingResults(data: any): string {
  const webPages = data.webPages?.value || [];
  
  if (webPages.length === 0) {
    return "No search results found.";
  }

  let result = "Search Results:\n\n";
  
  webPages.forEach((item: any, index: number) => {
    result += `[${index + 1}] ${item.name}\n`;
    result += `URL: ${item.url}\n`;
    result += `Snippet: ${item.snippet}\n`;
    if (item.dateLastCrawled) {
      result += `Last Updated: ${new Date(item.dateLastCrawled).toLocaleDateString()}\n`;
    }
    result += "\n";
  });

  return result.trim();
}

// Google Custom Search Implementation
async function performGoogleSearch(query: string): Promise<string> {
  const params = new URLSearchParams({
    key: googleApiKey,
    cx: googleCx,
    q: query,
    num: Math.min(maxResults, 10).toString(),
  });

  const response = await webToolFetch(
    `https://www.googleapis.com/customsearch/v1?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  return formatGoogleResults(data);
}

async function performGoogleImageSearch(query: string): Promise<string> {
  const params = new URLSearchParams({
    key: googleApiKey,
    cx: googleCx,
    q: query,
    num: Math.min(maxResults, 10).toString(),
    searchType: "image",
  });

  const response = await webToolFetch(
    `https://www.googleapis.com/customsearch/v1?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  
  if (!data.items || data.items.length === 0) {
    return "No images found for this query.";
  }

  return `Found ${data.items.length} images:\n\n` + 
    data.items.map((item: any, i: number) => `${i + 1}. ${item.link}`).join("\n");
}

function formatGoogleResults(data: any): string {
  const items = data.items || [];
  
  if (items.length === 0) {
    return "No search results found.";
  }

  let result = "Search Results:\n\n";
  
  items.forEach((item: any, index: number) => {
    result += `[${index + 1}] ${item.title}\n`;
    result += `URL: ${item.link}\n`;
    result += `Snippet: ${item.snippet}\n`;
    if (item.pagemap?.metatags?.[0]?.["article:published_time"]) {
      result += `Published: ${item.pagemap.metatags[0]["article:published_time"]}\n`;
    }
    result += "\n";
  });

  return result.trim();
}

export const addWebSearchTools = (tools: LLMTool[]) => {
  if (webSearchTools.length > 0) {
    console.log(
      `[WebSearch] Adding ${webSearchTools.length} search tool(s): ` +
      `${webSearchTools.map((t) => t.function.name).join(", ")}`
    );
    tools.push(...webSearchTools);
  }
};
