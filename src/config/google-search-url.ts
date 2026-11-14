// Builds the request URL for the Google Custom Search JSON API request format.
// The base URL may already carry query parameters (for example ?tenant=demo);
// they are kept, and the search parameters are added to them.
export function buildGoogleSearchUrl(baseUrl: string, params: URLSearchParams): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`GOOGLE_SEARCH_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  params.forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}
