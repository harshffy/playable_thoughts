#!/usr/bin/env node
// Edit the library from the command line (this is what Claude runs when you ask it to add/update things).
//   node scripts/add.mjs film "Digger" 2026 [--alt "English title"] [--status 1]
//   node scripts/add.mjs show "Severance" [--anime] [--eps 9] [--status 0]
//   node scripts/add.mjs set "Rick and Morty" w+=10 r=9 f=1 x=1 s=1 n="note"
// Fields: w episodes watched, s status (0 watching, 1 finished, 2 backlog, 3 dropped),
//         f favourite 0/1, r rating 1-10, x film rewatch count, n note, last "S5E9".
import { makeId, readLibrary, writeLibrary } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const k = rest[i].slice(2);
    flags[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
  } else pos.push(rest[i]);
}
const lib = readLibrary();
const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const nextSeq = () => Math.max(0, ...lib.map((i) => i.seq || 0)) + 1;

if (cmd === "film" || cmd === "show") {
  const title = pos[0];
  if (!title) throw new Error("title required");
  const type = cmd;
  const hit = lib.find((i) => i.type === type && (norm(i.title) === norm(title) || norm(i.original) === norm(title)));
  if (hit) { console.log("ALREADY EXISTS:", JSON.stringify(hit)); process.exit(1); }
  const it = {
    id: makeId(type === "show" ? "s:" : "m:", title), title,
    type, shelf: type === "film" ? "film" : flags.anime ? "anime" : "tv",
    w: Number(flags.eps || 0), s: Number(flags.status ?? (type === "film" ? 1 : 0)), f: 0, r: 0, n: "", x: 0, seq: nextSeq(),
  };
  if (type === "film" && pos[1]) it.year = String(pos[1]);
  if (flags.alt) { it.original = title; it.title = flags.alt; }
  lib.push(it); writeLibrary(lib); console.log("ADDED", JSON.stringify(it));
} else if (cmd === "set") {
  const [q, ...kv] = pos;
  const hits = lib.filter((i) => i.id === q || norm(i.title) === norm(q) || norm(i.original) === norm(q));
  if (hits.length !== 1) { console.log(hits.length ? "AMBIGUOUS:" : "NOT FOUND:", hits.map((h) => h.id + " " + h.type)); process.exit(1); }
  const it = hits[0];
  for (const pair of kv) {
    const m = pair.match(/^(\w+)(\+=|=)(.*)$/);
    if (!m) throw new Error("bad assignment " + pair);
    const [, k, op, v] = m;
    const val = ["w", "s", "f", "r", "x", "seq"].includes(k) ? Number(v) : v;
    it[k] = op === "+=" ? (it[k] || 0) + val : val;
    if (op === "+=" || k === "w") it.seq = nextSeq(); // touched titles float to the top of "Recently added"
  }
  writeLibrary(lib); console.log("UPDATED", JSON.stringify(it));
} else {
  console.log("usage: add.mjs film|show|set ... (see header)"); process.exit(1);
}
