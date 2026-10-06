# Playable Thoughts · The Archive

My watch history (films, shows, anime) as plain data, with a read-only page on GitHub Pages.

**Live page:** https://harshffy.github.io/playable_thoughts/

## How it works
- `data/library.json` is the source of truth: every title plus my progress (episodes watched, status, rating, favourite, rewatches, notes).
- `scripts/enrich.mjs` runs in GitHub Actions and pulls posters, details, trailers, reviews and full episode lists from TMDB into `data/tmdb.json` and `data/episodes.json`.
- `index.html` reads those files and renders the archive.

## Updating
I tell Claude in chat ("add Dune", "Severance season 2 done, rate it 9") and it edits `data/library.json` with `scripts/add.mjs`, commits, and the workflow does the rest. See `CLAUDE.md`.

## One-time setup
1. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `TMDB_KEY`, value = TMDB API key (v3).
2. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. **Actions → Enrich from TMDB → Run workflow** once to fetch all posters and episode lists.

Metadata by [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
