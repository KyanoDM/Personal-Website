// ─── Dashboard API Worker (Notion to-do + Google Agenda feed) ──────────
// Verifieert een Firebase ID-token (zelfde account als het dashboard),
// en praat dan met Notion / de agenda namens de gebruiker. Alle geheimen
// (Notion-token, geheim iCal-adres) blijven volledig server-side.
//
// Env vars nodig (Settings > Variables and Secrets):
//   NOTION_TOKEN        (secret)  - Notion internal integration token
//   NOTION_DATABASE_ID  (text)    - c470d3695903414abe1be813355a0b6a
//   CALENDAR_ICS_URL    (secret)  - Google Agenda "Geheim adres in iCal-indeling"

const FIREBASE_PROJECT_ID = 'kyanodm-be';
const ALLOWED_EMAIL = 'kyanodemaertelaere@gmail.com';
const TOTP_UID = 'kyano-totp';
const ALLOWED_ORIGIN = 'https://kyanodm.be';
const NOTION_VERSION = '2022-06-28';
const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// ── CORS helpers ──────────────────────────────────────────────────────
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

// ── base64url helpers ─────────────────────────────────────────────────
function b64urlToUint8Array(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function b64urlDecodeJson(b64url) {
    return JSON.parse(new TextDecoder().decode(b64urlToUint8Array(b64url)));
}

// ── Firebase ID token verification ────────────────────────────────────
let _cachedJwks = null;
let _cachedJwksAt = 0;

async function getGoogleJwks() {
    const now = Date.now();
    if (_cachedJwks && now - _cachedJwksAt < 60 * 60 * 1000) return _cachedJwks;
    const r = await fetch(GOOGLE_JWK_URL);
    if (!r.ok) throw new Error('Kon Google JWKS niet ophalen');
    const data = await r.json();
    _cachedJwks = data.keys || [];
    _cachedJwksAt = now;
    return _cachedJwks;
}

async function verifyFirebaseToken(idToken) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Ongeldig token-formaat');
    const [headerB64, payloadB64, sigB64] = parts;

    const header = b64urlDecodeJson(headerB64);
    const payload = b64urlDecodeJson(payloadB64);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) throw new Error('Token verlopen');
    if (payload.iat > now + 60) throw new Error('Token iat in de toekomst');
    if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('Verkeerde audience');
    if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) throw new Error('Verkeerde issuer');
    if (!payload.sub) throw new Error('Geen subject in token');

    const jwks = await getGoogleJwks();
    const jwk = jwks.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('Onbekende signing key (kid)');

    const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const signedData = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const signature = b64urlToUint8Array(sigB64);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
    if (!valid) throw new Error('Ongeldige handtekening');

    const allowed = payload.email === ALLOWED_EMAIL || payload.user_id === TOTP_UID || payload.sub === TOTP_UID;
    if (!allowed) throw new Error('Niet geautoriseerd');

    return payload;
}

async function requireAuth(request) {
    const authHeader = request.headers.get('Authorization') || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) throw new Error('Geen token meegegeven');
    return verifyFirebaseToken(match[1]);
}

// ── Notion helpers ────────────────────────────────────────────────────
function notionFetch(path, env, options = {}) {
    return fetch('https://api.notion.com/v1' + path, {
        ...options,
        headers: {
            Authorization: 'Bearer ' + env.NOTION_TOKEN,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
}

let _schemaCache = null;
let _schemaCacheAt = 0;

async function getSchema(env) {
    const now = Date.now();
    if (_schemaCache && now - _schemaCacheAt < 10 * 60 * 1000) return _schemaCache;

    const r = await notionFetch('/databases/' + env.NOTION_DATABASE_ID, env);
    if (!r.ok) throw new Error('Kon Notion database-schema niet ophalen (' + r.status + ')');
    const data = await r.json();

    let titleProp = null;
    let statusProp = null;
    let statusType = null;

    const entries = Object.entries(data.properties || {});
    for (const [name, prop] of entries) {
        if (prop.type === 'title') titleProp = name;
    }

    // Een property die exact "status" heet wint altijd, ongeacht type
    // (databases hebben soms zowel een eigen "Status"-select als een
    // automatisch aangemaakte "Status 1" van het status-type).
    const exact = entries.find(([name, prop]) => name.toLowerCase() === 'status' && (prop.type === 'select' || prop.type === 'status'));
    if (exact) {
        statusProp = exact[0];
        statusType = exact[1].type;
    } else {
        for (const [name, prop] of entries) {
            if (prop.type === 'status') {
                statusProp = name;
                statusType = 'status';
                break;
            }
        }
        if (!statusProp) {
            for (const [name, prop] of entries) {
                if (prop.type === 'select' && /status/i.test(name)) {
                    statusProp = name;
                    statusType = 'select';
                    break;
                }
            }
        }
    }
    if (!titleProp) throw new Error('Geen title-property gevonden in Notion database');

    _schemaCache = { titleProp, statusProp, statusType };
    _schemaCacheAt = now;
    return _schemaCache;
}

function statusPropertyValue(statusType, name) {
    return statusType === 'status' ? { status: { name } } : { select: { name } };
}

function readStatus(page, statusProp, statusType) {
    const prop = page.properties[statusProp];
    if (!prop) return null;
    return statusType === 'status' ? prop.status?.name || null : prop.select?.name || null;
}

function readTitle(page, titleProp) {
    const rich = page.properties[titleProp]?.title || [];
    return rich.map((t) => t.plain_text).join('');
}

// ── Route handlers: to-do ──────────────────────────────────────────────
const NEW_TASK_STATUS = 'Next Up';
const DONE_STATUS = 'Completed';

async function handleGetTodos(env) {
    const { titleProp, statusProp, statusType } = await getSchema(env);

    const body = { page_size: 100, sorts: [{ timestamp: 'created_time', direction: 'descending' }] };
    if (statusProp) {
        body.filter = { property: statusProp, [statusType]: { equals: NEW_TASK_STATUS } };
    }

    const r = await notionFetch('/databases/' + env.NOTION_DATABASE_ID + '/query', env, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (!r.ok) return json({ error: 'Notion query mislukt', detail: await r.text() }, r.status);

    const data = await r.json();
    const todos = (data.results || []).map((page) => ({
        id: page.id,
        title: readTitle(page, titleProp),
        status: readStatus(page, statusProp, statusType),
        done: false,
    }));

    return json({ todos, statusProp, statusType });
}

async function handleAddTodo(request, env) {
    const { titleProp, statusProp, statusType } = await getSchema(env);
    const body = await request.json();
    const title = (body.title || '').trim();
    if (!title) return json({ error: 'title is verplicht' }, 400);

    const properties = { [titleProp]: { title: [{ text: { content: title } }] } };
    if (statusProp) properties[statusProp] = statusPropertyValue(statusType, NEW_TASK_STATUS);

    const r = await notionFetch('/pages', env, {
        method: 'POST',
        body: JSON.stringify({ parent: { database_id: env.NOTION_DATABASE_ID }, properties }),
    });
    if (!r.ok) return json({ error: 'Aanmaken mislukt', detail: await r.text() }, r.status);

    const page = await r.json();
    return json({ id: page.id, title, status: NEW_TASK_STATUS });
}

async function handleSetStatus(request, env, pageId) {
    const { statusProp, statusType } = await getSchema(env);
    if (!statusProp) return json({ error: 'Geen status-property in deze database' }, 400);

    const body = await request.json();
    const status = body.status || DONE_STATUS;

    const r = await notionFetch('/pages/' + pageId, env, {
        method: 'PATCH',
        body: JSON.stringify({ properties: { [statusProp]: statusPropertyValue(statusType, status) } }),
    });
    if (!r.ok) return json({ error: 'Status bijwerken mislukt', detail: await r.text() }, r.status);

    return json({ ok: true, status });
}

// ── Route handler: agenda (geheim iCal-adres) ──────────────────────────
// Het geheime adres verlaat de Worker nooit. De browser krijgt enkel een
// ingekorte iCal-tekst terug (hoofding, tijdzones, en alleen afspraken
// rond de komende week of terugkerende afspraken), zodat het klein blijft.
function unfoldIcs(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function ymd(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function icsDateOf(line) {
    const m = line.slice(line.indexOf(':') + 1).match(/^(\d{8})/);
    return m ? m[1] : null;
}

function keepIcsEvent(block, lo, hi) {
    let start = null;
    let end = null;
    for (const line of block) {
        if (line.startsWith('RRULE') || line.startsWith('RDATE') || line.startsWith('RECURRENCE-ID')) return true;
        if (line.startsWith('DTSTART')) start = icsDateOf(line);
        else if (line.startsWith('DTEND')) end = icsDateOf(line);
    }
    if (!start) return false;
    return (end || start) >= lo && start <= hi;
}

function filterIcs(raw, now) {
    const lo = ymd(new Date(now - 24 * 60 * 60 * 1000));
    const hi = ymd(new Date(now + 8 * 24 * 60 * 60 * 1000));
    const out = [];
    let block = null;
    for (const line of unfoldIcs(raw).split('\n')) {
        if (line === 'BEGIN:VEVENT') {
            block = [line];
            continue;
        }
        if (block) {
            block.push(line);
            if (line === 'END:VEVENT') {
                if (keepIcsEvent(block, lo, hi)) out.push(...block);
                block = null;
            }
            continue;
        }
        if (line) out.push(line);
    }
    return out.join('\r\n') + '\r\n';
}

async function handleCalendar(env) {
    if (!env.CALENDAR_ICS_URL) return json({ error: 'CALENDAR_ICS_URL ontbreekt' }, 503);

    let r;
    try {
        r = await fetch(env.CALENDAR_ICS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    } catch (err) {
        return json({ error: 'Kalender ophalen mislukt' }, 502);
    }
    if (!r.ok) return json({ error: 'Kalender ophalen mislukt (' + r.status + ')' }, 502);

    return new Response(filterIcs(await r.text(), Date.now()), {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8', ...corsHeaders() },
    });
}

// ── Entry point ─────────────────────────────────────────────────────────
export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);

        try {
            await requireAuth(request);
        } catch (err) {
            return json({ error: 'Unauthorized: ' + err.message }, 401);
        }

        try {
            if (request.method === 'GET' && url.pathname === '/calendar') {
                return await handleCalendar(env);
            }
            if (request.method === 'GET' && url.pathname === '/todos') {
                return await handleGetTodos(env);
            }
            if (request.method === 'POST' && url.pathname === '/todos') {
                return await handleAddTodo(request, env);
            }
            const statusMatch = url.pathname.match(/^\/todos\/([^/]+)\/status$/);
            if (request.method === 'POST' && statusMatch) {
                return await handleSetStatus(request, env, statusMatch[1]);
            }
            return json({ error: 'Not found' }, 404);
        } catch (err) {
            return json({ error: err.message }, 500);
        }
    },
};
