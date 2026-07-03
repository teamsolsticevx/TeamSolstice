// _worker.js — Cloudflare Pages "Advanced Mode" worker.
// This single file replaces a /functions folder, because Cloudflare Pages'
// drag-and-drop dashboard upload does NOT support /functions (CLI-only).
// A root-level _worker.js IS supported by drag-and-drop.
//
// Requires (set in Cloudflare Pages project settings):
//   - KV namespace binding named SOLSTICE_KV
//   - Environment variable ADMIN_CODE (set as a secret)

const HIVE_API = 'https://api.playhive.com/v0';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// ---------- Scoring engine ----------
function extractNumber(obj, patterns) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val !== 'number') continue;
    for (const p of patterns) { if (p.test(key)) return val; }
  }
  return 0;
}

function scoreMode(modeObj) {
  if (!modeObj || typeof modeObj !== 'object') {
    return { score: 0, wins: 0, losses: 0, kills: 0, deaths: 0, played: 0, kd: 0, winrate: 0, empty: true };
  }
  const wins = extractNumber(modeObj, [/^wins?$/i, /games?_?won/i, /victories/i]);
  const losses = extractNumber(modeObj, [/^loss(es)?$/i, /games?_?lost/i]);
  const kills = extractNumber(modeObj, [/^kills$/i, /player_?kills/i, /^kos$/i]);
  const deaths = extractNumber(modeObj, [/^deaths$/i]);
  let played = extractNumber(modeObj, [/^(games?_?)?played$/i, /^matches$/i, /^rounds?_?played$/i]);
  if (!played) played = wins + losses;
  const kd = deaths > 0 ? kills / deaths : kills;
  const winrate = played > 0 ? wins / played : 0;
  const base = wins * 3 + kills * 1 + winrate * played * 0.5;
  const activity = Math.sqrt(played) * 0.75;
  const empty = (wins === 0 && kills === 0 && played === 0);
  return {
    score: Math.round(base + activity), wins, losses, kills, deaths, played,
    kd: Number(kd.toFixed(2)), winrate: Number((winrate * 100).toFixed(1)), empty
  };
}

function computeOverallScore(mainStats) {
  const breakdown = {};
  let total = 0;
  for (const key of Object.keys(mainStats || {})) {
    const r = scoreMode(mainStats[key]);
    if (r.empty) continue;
    breakdown[key] = r;
    total += r.score;
  }
  return { total: Math.round(total), breakdown };
}

// ---------- Hive API calls (server-side — browser CORS rules don't apply here) ----------
async function resolvePlayer(query) {
  let uuid = null, usernameCC = query;
  if (query.length >= 4) {
    try {
      const res = await fetch(`${HIVE_API}/player/search/${encodeURIComponent(query)}`);
      if (res.ok) {
        const list = await res.json();
        const exact = Array.isArray(list)
          ? list.find(p => (p.username || '').toLowerCase() === query.toLowerCase())
          : null;
        if (exact) { uuid = exact.UUID; usernameCC = exact.username_cc || exact.username; }
      }
    } catch (e) { /* fall through to direct lookup */ }
  }
  return { uuid, usernameCC };
}

async function fetchMainStats(identifier) {
  const res = await fetch(`${HIVE_API}/game/all/main/${encodeURIComponent(identifier)}`);
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (!res.ok) throw new Error('API_ERROR_' + res.status);
  const data = await res.json();
  return (data && typeof data === 'object' && data.main) ? data.main : data;
}

// ---------- /api/players handlers ----------
async function handleGetPlayers(env) {
  const listing = await env.SOLSTICE_KV.list({ prefix: 'player:' });
  const players = [];
  for (const k of listing.keys) {
    const raw = await env.SOLSTICE_KV.get(k.name);
    if (raw) { try { players.push(JSON.parse(raw)); } catch (e) { /* skip corrupt entry */ } }
  }
  players.sort((a, b) => (b.score || 0) - (a.score || 0));
  return json(players);
}

async function handleAddPlayer(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid request body' }, 400); }
  const { adminCode, username } = body || {};

  if (!env.ADMIN_CODE || adminCode !== env.ADMIN_CODE) {
    return json({ error: 'Invalid admin code' }, 401);
  }
  const clean = (username || '').trim();
  if (clean.length < 3) return json({ error: 'Username must be at least 3 characters' }, 400);

  try {
    const { uuid, usernameCC } = await resolvePlayer(clean);
    const identifier = uuid || clean;
    const mainStats = await fetchMainStats(identifier);
    const score = computeOverallScore(mainStats);
    const player = {
      uuid, username: usernameCC || clean, usernameCC: usernameCC || clean,
      score: score.total, breakdown: score.breakdown, addedAt: Date.now()
    };
    const key = `player:${(uuid || clean).toLowerCase()}`;
    await env.SOLSTICE_KV.put(key, JSON.stringify(player));
    return json(player, 201);
  } catch (e) {
    if (e.message === 'NOT_FOUND') return json({ error: 'No Hive player found with that username' }, 404);
    return json({ error: 'Could not fetch stats from The Hive API right now' }, 502);
  }
}

async function handleRemovePlayer(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid request body' }, 400); }
  const { adminCode, id } = body || {};
  if (!env.ADMIN_CODE || adminCode !== env.ADMIN_CODE) return json({ error: 'Invalid admin code' }, 401);
  if (!id) return json({ error: 'Missing player id' }, 400);
  await env.SOLSTICE_KV.delete(`player:${String(id).toLowerCase()}`);
  return json({ ok: true });
}

// ---------- Entry point ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/players') {
      if (request.method === 'GET') return handleGetPlayers(env);
      if (request.method === 'POST') return handleAddPlayer(request, env);
      if (request.method === 'DELETE') return handleRemovePlayer(request, env);
      return json({ error: 'Method not allowed' }, 405);
    }

    // Everything else falls through to the static asset (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};
