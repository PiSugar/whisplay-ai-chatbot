const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildGoogleSearchUrl } = require("../../dist/config/google-search-url.js");

const GOOGLE = "https://www.googleapis.com/customsearch/v1";
const CUSTOM = "https://example.com/customsearch/v1?tenant=demo";

const webParams = () => new URLSearchParams({ key: "k", cx: "c", q: "raspberry pi", num: "5" });
const imageParams = () => new URLSearchParams({ key: "k", cx: "c", q: "raspberry pi", num: "5", searchType: "image" });
const sitesParams = () => new URLSearchParams({ key: "k", cx: "c", q: "raspberry pi", num: "5", hl: "zh-CN" });

const query = (url) => Object.fromEntries(new URL(url).searchParams);

test("default endpoint gets the search parameters", () => {
  const url = buildGoogleSearchUrl(GOOGLE, webParams());
  assert.equal(url, `${GOOGLE}?key=k&cx=c&q=raspberry+pi&num=5`);
});

test("a base URL with a query string keeps its parameters: web search", () => {
  const url = buildGoogleSearchUrl(CUSTOM, webParams());
  assert.equal(new URL(url).pathname, "/customsearch/v1");
  assert.deepEqual(query(url), { tenant: "demo", key: "k", cx: "c", q: "raspberry pi", num: "5" });
  assert.equal(url.split("?").length, 2);
});

test("a base URL with a query string keeps its parameters: image search", () => {
  const url = buildGoogleSearchUrl(CUSTOM, imageParams());
  assert.deepEqual(query(url), { tenant: "demo", key: "k", cx: "c", q: "raspberry pi", num: "5", searchType: "image" });
});

test("a base URL with a query string keeps its parameters: sites search", () => {
  const url = buildGoogleSearchUrl(CUSTOM, sitesParams());
  assert.deepEqual(query(url), { tenant: "demo", key: "k", cx: "c", q: "raspberry pi", num: "5", hl: "zh-CN" });
});

test("a fragment on the base URL is dropped", () => {
  const url = buildGoogleSearchUrl("https://example.com/customsearch/v1?tenant=demo#top", webParams());
  assert.equal(new URL(url).hash, "");
  assert.equal(query(url).tenant, "demo");
});

test("a search parameter replaces the same parameter on the base URL", () => {
  const url = buildGoogleSearchUrl("https://example.com/customsearch/v1?num=1", webParams());
  assert.deepEqual(new URL(url).searchParams.getAll("num"), ["5"]);
});

test("a trailing slash on the base URL path is dropped", () => {
  const url = buildGoogleSearchUrl("https://example.com/customsearch/v1/?tenant=demo", webParams());
  assert.equal(new URL(url).pathname, "/customsearch/v1");
  assert.equal(query(url).tenant, "demo");
});

test("an invalid base URL is reported by name", () => {
  assert.throws(() => buildGoogleSearchUrl("not a url", webParams()), /GOOGLE_SEARCH_BASE_URL is not a valid URL/);
});
