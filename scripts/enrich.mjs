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
    t: d.id, k: kind, nm: d.title || d.name || "", p: d.poster_path || "", bd: d.backdrop_path || "",
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
const RV = 2; // bump to retry previously unmatched titles with improved matching
function nameVariants(raw) {
  const out = [];
  const add = (x) => { x = (x || "").replace(/\s+/g, " ").trim(); if (x.length > 1 && !out.includes(x)) out.push(x); };
  const ym = raw.match(/\((\d{4})\)\s*$/);
  const base = raw.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  add(base);
  add(base.replace(/^the\s+/i, ""));
  add(base.replace(/,?\s*part\s*\d+\s*$/i, ""));
  const head = base.split(/\s*[:\-–—]\s*/)[0];
  if (head && head.length > 3) add(head);
  return { names: out, year: ym ? ym[1] : "" };
}
async function resolve(item) {
  if (item.tvdb) {
    const f = await get(`/find/${item.tvdb}`, { external_source: "tvdb_id" });
    const hit = f.tv_results?.[0];
    if (hit) return detail("tv", hit.id);
  }
  const isFilm = item.type === "film";
  const raws = [...new Set([item.original, item.title].filter((x) => x && !x.startsWith("(unidentified")))];
  const kinds = isFilm ? ["movie"] : ["tv", "movie"]; // some "shows" in TV Time are really films/OVAs
  for (const kind of kinds) {
    for (const raw of raws) {
      const { names, year } = nameVariants(raw);
      const y = isFilm && item.year ? String(item.year) : year;
      for (const n of names) {
        const tries = y ? [y, ""] : [""];
        for (const yy of tries) {
          const p = { query: n, include_adult: "false" };
          if (yy) p[kind === "movie" ? "year" : "first_air_date_year"] = yy;
          const r = await get(`/search/${kind}`, p);
          if (r.results?.length) return detail(kind, r.results[0].id);
        }
      }
    }
  }
  // last resort: multi search on the cleanest name
  for (const raw of raws) {
    const { names } = nameVariants(raw);
    const r = await get("/search/multi", { query: names[0], include_adult: "false" });
    const hit = (r.results || []).find((x) => x.media_type === "movie" || x.media_type === "tv");
    if (hit) return detail(hit.media_type, hit.id);
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
  if (m.nf) return (m.rv || 0) < RV || now - (m.u || 0) > 30 * DAY; // retry misses when matching improves, or monthly
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
      meta[it.id] = m ? { ...m, rv: RV } : { nf: 1, u: now, rv: RV };
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
