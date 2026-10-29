// Service de connexion Google pour Jour : garde le refresh token, sert des jetons d'accès frais.
// Routes : /login?key=…  →  Google  →  /callback  →  retour dans l'app
//          /token (en-tête X-Key ou ?key=) → { token, exp }
const SCOPE = 'https://www.googleapis.com/auth/calendar';
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-Key', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });
    const key = req.headers.get('X-Key') || url.searchParams.get('key') || '';
    const okKey = key && env.APP_SECRET && key === env.APP_SECRET;
    const callback = url.origin + '/callback';
    const loginUrl = url.origin + '/login?key=' + encodeURIComponent(key);

    if (url.pathname === '/login') {
      if (!okKey) return new Response('Clé invalide', { status: 401 });
      const p = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callback, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state: key });
      return Response.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + p, 302);
    }
    if (url.pathname === '/callback') {
      if (url.searchParams.get('state') !== env.APP_SECRET) return new Response('État invalide', { status: 400 });
      const code = url.searchParams.get('code');
      if (!code) return new Response('Google n\'a pas renvoyé de code : ' + (url.searchParams.get('error') || ''), { status: 400 });
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: callback, grant_type: 'authorization_code' }) });
      const t = await r.json();
      if (!t.refresh_token) return new Response('Pas de refresh token reçu : ' + JSON.stringify(t), { status: 500 });
      await env.TOKENS.put('refresh', t.refresh_token);
      await env.TOKENS.put('access', JSON.stringify({ token: t.access_token, exp: Date.now() + t.expires_in * 1000 }));
      return Response.redirect((env.APP_URL || '/') + '#connected', 302);
    }
    if (url.pathname === '/token') {
      if (!okKey) return json({ error: 'Clé invalide' }, 401);
      const cached = JSON.parse((await env.TOKENS.get('access')) || 'null');
      if (cached && cached.exp > Date.now() + 2 * 60000) return json(cached);
      const refresh = await env.TOKENS.get('refresh');
      if (!refresh) return json({ error: 'Non connecté', login: loginUrl }, 401);
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refresh, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
      const t = await r.json();
      if (!t.access_token) { await env.TOKENS.delete('refresh'); return json({ error: 'Connexion Google expirée, reconnecte-toi', detail: t, login: loginUrl }, 401); }
      const out = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
      await env.TOKENS.put('access', JSON.stringify(out));
      return json(out);
    }
    if (url.pathname === '/logout') {
      if (!okKey) return json({ error: 'Clé invalide' }, 401);
      await env.TOKENS.delete('refresh'); await env.TOKENS.delete('access');
      return json({ ok: true });
    }
    return new Response('Jour : service de connexion actif.', { headers: cors });
  }
};
