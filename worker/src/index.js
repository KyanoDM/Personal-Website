/**
 * Cloudflare Worker — Auth backend (TOTP login met aanmeldlimiet)
 *
 * Secrets (stel in via: wrangler secret put <NAAM>)
 *   SA_CLIENT_EMAIL  →  service account e-mail  (uit Firebase service-account JSON)
 *   SA_PRIVATE_KEY   →  private key als string   (uit Firebase service-account JSON, \n behouden)
 *   TOTP_SECRET      →  base32 TOTP secret voor Google Authenticator
 *
 * Environment vars (in wrangler.toml)
 *   FIREBASE_PROJECT_ID  →  kyanodm-be
 *   ALLOWED_EMAIL        →  kyanodemaertelaere@gmail.com
 *   ALLOWED_ORIGIN       →  https://kyanodm.github.io
 *
 * Aanmeldpogingen worden geteld in Firestore (collectie "authGuard", enkel
 * toegankelijk voor de service account en de eigenaar): max. 5 per IP en
 * 20 in totaal per 15 minuten. De code wordt pas gecontroleerd nadat er een
 * poging is gereserveerd, dus parallelle aanvragen komen er niet omheen.
 */

const TOTP_UID     = 'kyano-totp';   // vaste UID voor TOTP-logins

// ─── Base64url helpers ────────────────────────────────────────────────────────

function b64url(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── RSA key import ───────────────────────────────────────────────────────────

async function importPrivateKey(pem) {
    const clean = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\\n/g, '\n')
        .replace(/\s+/g, '');
    const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
        'pkcs8', der.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['sign']
    );
}

// ─── JWT signing ──────────────────────────────────────────────────────────────

async function signJwt(header, payload, key) {
    const enc = new TextEncoder();
    const h = b64url(enc.encode(JSON.stringify(header)));
    const p = b64url(enc.encode(JSON.stringify(payload)));
    const unsigned = `${h}.${p}`;
    const sig = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)
    );
    return `${unsigned}.${b64url(sig)}`;
}

// ─── Firebase custom token ────────────────────────────────────────────────────

async function createCustomToken(uid, clientEmail, privateKeyPem, additionalClaims) {
    const key = await importPrivateKey(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientEmail,
        sub: clientEmail,
        aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        uid,
        iat: now,
        exp: now + 3600,
    };
    if (additionalClaims) payload.claims = additionalClaims;
    return signJwt({ alg: 'RS256', typ: 'JWT' }, payload, key);
}

// ─── TOTP verificatie ─────────────────────────────────────────────────────────

function base32Decode(str) {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    str = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    const buf = new Uint8Array(Math.floor(str.length * 5 / 8));
    let bits = 0, val = 0, out = 0;
    for (const c of str) {
        const idx = CHARS.indexOf(c);
        if (idx < 0) continue;
        val = (val << 5) | idx;
        bits += 5;
        if (bits >= 8) { buf[out++] = (val >>> (bits - 8)) & 0xff; bits -= 8; }
    }
    return buf;
}

async function generateHOTP(secretBytes, counter) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setUint32(4, counter >>> 0, false);
    const key = await crypto.subtle.importKey(
        'raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
    const offset = sig[19] & 0xf;
    const code = ((sig[offset] & 0x7f) << 24 | (sig[offset+1] & 0xff) << 16 |
                  (sig[offset+2] & 0xff) << 8  | (sig[offset+3] & 0xff)) % 1_000_000;
    return code.toString().padStart(6, '0');
}

async function verifyTOTP(secret, token) {
    const bytes = base32Decode(secret);
    const step  = Math.floor(Date.now() / 1000 / 30);
    for (const offset of [-1, 0, 1]) {
        if (await generateHOTP(bytes, step + offset) === token) return true;
    }
    return false;
}

// ─── Google OAuth2 access token (voor Firestore REST) ────────────────────────

async function getAccessToken(clientEmail, privateKeyPem) {
    const key = await importPrivateKey(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signJwt(
        { alg: 'RS256', typ: 'JWT' },
        {
            iss: clientEmail,
            scope: 'https://www.googleapis.com/auth/datastore',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now,
            exp: now + 3600,
        },
        key
    );
    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`,
    });
    const data = await resp.json();
    if (!data.access_token) throw new Error('Access token ophalen mislukt: ' + JSON.stringify(data));
    return data.access_token;
}

// ─── Aanmeldlimiet (atomische teller in Firestore) ──────────────────────────

const GUARD_WINDOW_MS  = 15 * 60 * 1000;
const MAX_TRIES_PER_IP = 5;
const MAX_TRIES_TOTAL  = 20;

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Verhoogt (of verlaagt) de tellers atomisch en geeft de nieuwe standen terug.
async function bumpAttempts(projectId, accessToken, ids, delta) {
    const base = `projects/${projectId}/databases/(default)/documents`;
    const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            writes: ids.map(id => ({
                transform: {
                    document: `${base}/authGuard/${id}`,
                    fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: String(delta) } }],
                },
            })),
        }),
    });
    if (!resp.ok) throw new Error('Firestore fout ' + resp.status);
    const data = await resp.json();
    return data.writeResults.map(w => parseInt(w.transformResults[0].integerValue, 10));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowedOrigins = [
            'https://kyanodm.be',
            'https://www.kyanodm.be',
            'https://kyanodm.github.io',
            'http://localhost:8080',
            'http://127.0.0.1:8080',
        ];
        const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

        const cors = {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        const json = (data, status = 200) =>
            Response.json(data, { status, headers: { ...cors, 'Content-Type': 'application/json' } });

        const url = new URL(request.url);

        try {
            // ── POST /totp-login ── Google Authenticator code ────────────────────────
            if (url.pathname === '/totp-login' && request.method === 'POST') {
                const { code } = await request.json();
                if (!code || !/^\d{6}$/.test(code)) return json({ error: 'Ongeldige code' }, 400);

                // Eerst een poging reserveren. Is er geen poging meer vrij, dan wordt de
                // code niet eens gecontroleerd (ook niet bij een juiste code).
                const accessToken = await getAccessToken(env.SA_CLIENT_EMAIL, env.SA_PRIVATE_KEY);
                const bucket = Math.floor(Date.now() / GUARD_WINDOW_MS);
                const ip = request.headers.get('CF-Connecting-IP') || 'onbekend';
                const ids = ['ip-' + await sha256Hex(ip) + '-' + bucket, 'total-' + bucket];
                const [ipCount, totalCount] = await bumpAttempts(env.FIREBASE_PROJECT_ID, accessToken, ids, 1);
                if (ipCount > MAX_TRIES_PER_IP || totalCount > MAX_TRIES_TOTAL) {
                    return json({ error: 'Te veel pogingen. Probeer het later opnieuw of log in met Google.' }, 429);
                }

                const valid = await verifyTOTP(env.TOTP_SECRET, code);
                if (!valid) return json({ error: 'Verkeerde code' }, 401);

                await bumpAttempts(env.FIREBASE_PROJECT_ID, accessToken, ids, -1); // geslaagd: telt niet mee

                const customToken = await createCustomToken(
                    TOTP_UID,
                    env.SA_CLIENT_EMAIL,
                    env.SA_PRIVATE_KEY,
                    { email: env.ALLOWED_EMAIL }
                );
                return json({ customToken });
            }

            return json({ error: 'Niet gevonden' }, 404);

        } catch (err) {
            console.error(err);
            return json({ error: err.message }, 500);
        }
    },
};
