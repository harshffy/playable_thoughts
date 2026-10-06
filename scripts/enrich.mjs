#!/usr/bin/env node
// Pulls posters, details and episode lists from TMDB into data/tmdb.json and data/episodes.json.
// Runs in GitHub Actions (TMDB_KEY secret). Incremental: only fetches what is new or stale.
import { readLibrary, readJson, writeJson } from "./lib.mjs";

const KEY = process.env.TMDB_KEY;
if (!KEY) { console.error("TMDB_KEY not set"); process.exit(1); }
const API = "https://api.themoviedb.org/3";
const DAY = 864e5, now = Date.now();
const FORCE = process.argv.includes("--force");

async function get(path, params = {}, tries = 4) {
  const u = new URL(API + path);
  u.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let a = 0; a < tries; a++) {
    const r = await fetch(u);
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); continue; }
    const e = new Error(`TMDB ${r.status} ${path}`); e.status = r.status; throw e;
  }
  throw new Error("TMDB retries exhausted " + path);
}
const yr = (d) => (d || "").slice(0, 4);

async function detail(kind, id) {
  const d = await get(`/${kind}/${id}`, { append_to_response: "credits,external_ids,watch/providers,videos,recommendations,reviews" });
  const prov = d["watch/providers"]?.results?.IN;
  const vids = (d.videos?.results || []).filter((x) => x.site === "YouTube");
  const tr = vids.find((x) => x.type === "Trailer" && x.official) || vids.find((x) => x.type === "Trailer") || vids.find((x) => x.type === "Teaser");
  return {
    t: d.id, k: kind, p: d.poster_path || "", bd: d.backdrop_path || "",
    o: d.overview || "", tg: d.tagline || "",
    y: yr(kind === "movie" ? d.release_date : d.first_air_date),
    rt: kind === "movie" ? d.runtime || 0 : d.episode_run_time?.[0] || 0,
    g: (d.genres || []).slice(0, 4).map((g) => g.name),
    c: (d.credits?.cast || []).slice(0, 10).map((c) => c.name),
    dr: kind === "movie" ? (d.credits?.crew || []).filter((c) => c.job === "Director").slice(0, 2).map((c) => c.name)
                         : (d.created_by || []).slice(0, 3).map((c) => c.name),
    v: d.vote_average ? Math.round(d.vote_average * 10) / 10 : 0,
    im: kind === "movie" ? d.imdb_id || "" : d.external_ids?.imdb_id || "",
    tr, wp: [...new Set((prov?.flatrate || []).map((x) => x.provider_name))].slice(0, 6),
    rc: (d.recommendations?.results || []).slice(0, 10).map((x) => ({ id: x.id, k: x.media_type || kind, n: x.title || x.name || "", y: yr(x.release_date || x.first_air_date), p: x.poster_path || "" })),
    rv: (d.reviews?.results || []).slice(0, 3).map((x) => ({ a: x.author || "", r: x.author_details?.rating || 0, t: (x.content || "").replace(/\s+/g, " ").slice(0, 500) })),
    ns: d.number_of_seasons || 0, ne: d.number_of_episodes || 0,
    sn: (d.seasons || []).filter((x) => x.season_number > 0 && x.episode_count > 0).map((x) => [x.season_number, x.episode_count]),
    st: d.status || "", u: now,
  };
}
async function resolve(item) {
  const kind = item.type === "film" ? "movie" : "tv";
  const names = [...new Set([item.original, item.title].filter(Boolean))];
  const years = kind === "movie" && item.year ? [String(item.year), ""] : [""];
  for (const y of years) for (const n of names) {
    const p = { query: n, include_adult: "false" };
    if (y) p.year = y;
    const r = await get(`/search/${kind}`, p);
    if (r.results?.length) return detail(kind, r.results[0].id);
  }
  return null;
}
async function episodes(m) {
  const seasons = [];
  for (const [n] of m.sn || []) {
    const d = await get(`/tv/${m.t}/season/${n}`);
    seasons.push({ n, eps: (d.episodes || []).map((e) => [e.episode_number, (e.name || "").slice(0, 80), e.air_date || ""]) });
  }
  return { t: m.t, u: now, seasons };
}

const lib = readLibrary();
const meta = readJson("tmdb.json", {});
const eps = readJson("episodes.json", {});
const over = readJson("overrides.json", {}); // { "<id>": { "k": "tv"|"movie", "t": <tmdb id> } }

const live = (m) => m && m.st && !/Ended|Canceled/.test(m.st);
const jobs = lib.filter((it) => {
  const m = meta[it.id], o = over[it.id];
  if (FORCE || !m) return true;
  if (o && (m.t !== o.t || m.k !== o.k)) return true;
  if (m.nf) return now - (m.u || 0) > 30 * DAY;        // retry misses monthly
  if ((m.dp || 0) < 3 && !m.u) return true;
  return live(m) && now - (m.u || 0) > 6 * DAY;         // airing shows refresh weekly
});
console.log(`${jobs.length} of ${lib.length} titles need metadata`);

let idx = 0, done = 0, fail = 0;
async function worker() {
  while (idx < jobs.length) {
    const it = jobs[idx++];
    try {
      const o = over[it.id];
      const m = o ? await detail(o.k, o.t) : await resolve(it);
      meta[it.id] = m || { nf: 1, u: now };
    } catch (e) { fail++; console.error("fail", it.title, e.message); }
    if (++done % 50 === 0) console.log(`  ${done}/${jobs.length}`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

// episode lists for shows
const epJobs = lib.filter((it) => {
  if (it.type !== "show") return false;
  const m = meta[it.id];
  if (!m || !m.t || !m.sn) return false;
  const e = eps[it.id];
  return FORCE || !e || e.t !== m.t || (live(m) && now - (e.u || 0) > 6 * DAY);
});
console.log(`${epJobs.length} shows need episode lists`);
idx = 0; done = 0;
async function epWorker() {
  while (idx < epJobs.length) {
    const it = epJobs[idx++];
    try { eps[it.id] = await episodes(meta[it.id]); } catch (e) { fail++; console.error("ep fail", it.title, e.message); }
    if (++done % 25 === 0) console.log(`  eps ${done}/${epJobs.length}`);
  }
}
await Promise.all([epWorker(), epWorker(), epWorker(), epWorker()]);

writeJson("tmdb.json", meta);
writeJson("episodes.json", eps);
console.log(`done · ${fail} failures`);
if (fail > 20) process.exit(1);
