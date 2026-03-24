import { LLMTool, ToolReturnTag } from "../type";
import dotenv from "dotenv";
import { isEmpty } from "lodash";
import { proxyFetch } from "../cloud-api/proxy-fetch";

dotenv.config();

// Web search configuration
const webSearchEnabled = process.env.WEB_SEARCH_ENABLED === "true";
const webSearchProvider = (process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();
const tavilyApiKey = process.env.TAVILY_API_KEY || "";
const serpApiKey = process.env.SERP_API_KEY || "";
const bingApiKey = process.env.BING_SEARCH_API_KEY || "";
const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY || "";
const googleCx = process.env.GOOGLE_SEARCH_CX || "";

// Search result limits
const maxResults = parseInt(process.env.WEB_SEARCH_MAX_RESULTS || "5", 10);
const includeImages = process.env.WEB_SEARCH_INCLUDE_IMAGES === "true";

export const webSearchTools: LLMTool[] = [];

if (webSearchEnabled) {
  // Validate API keys based on provider
  let hasValidConfig = false;
  
  switch (webSearchProvider) {
    case "tavily":
      hasValidConfig = !isEmpty(tavilyApiKey);
      break;
    case "serp":
      hasValidConfig = !isEmpty(serpApiKey);
      break;
    case "bing":
      hasValidConfig = !isEmpty(bingApiKey);
      break;
    case "google":
      hasValidConfig = !isEmpty(googleApiKey) && !isEmpty(googleCx);
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

// Tavily Search Implementation
async function performTavilySearch(query: string): Promise<string> {
  const response = await proxyFetch("https://api.tavily.com/search", {
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
  const response = await proxyFetch("https://api.tavily.com/search", {
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

  const response = await proxyFetch(`https://serpapi.com/search?${params.toString()}`);

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

  const response = await proxyFetch(`https://serpapi.com/search?${params.toString()}`);

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
  const response = await proxyFetch(
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
  const response = await proxyFetch(
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

  const response = await proxyFetch(
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

  const response = await proxyFetch(
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
