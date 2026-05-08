/**
 * Cloudflare Worker — Auth backend (TOTP + QR login)
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
 */

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minuten
const TOTP_UID     = 'kyano-totp';   // vaste UID voor TOTP-logins

// ─── Base64url helpers ────────────────────────────────────────────────────────

function b64url(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf;
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

// ─── Firebase ID token verificatie ───────────────────────────────────────────

async function verifyIdToken(idToken, projectId) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Ongeldig token formaat');

    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) throw new Error('Token verlopen');
    if (payload.aud !== projectId) throw new Error('Verkeerde audience');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Verkeerde issuer');

    // Google public keys ophalen
    const keysResp = await fetch(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
        { cf: { cacheTtl: 3600 } } // Cloudflare cache
    );
    const { keys } = await keysResp.json();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('Public key niet gevonden');

    const publicKey = await crypto.subtle.importKey(
        'jwk', jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false, ['verify']
    );

    const valid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', publicKey,
        b64urlDecode(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) throw new Error('Ongeldige handtekening');

    return payload;
}

// ─── Firestore REST ───────────────────────────────────────────────────────────

async function firestorePatch(projectId, collection, docId, fields, accessToken) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Firestore fout ${resp.status}: ${text}`);
    }
    return resp.json();
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
            // ── POST /totp-login ── Google Authenticator code ────────────────
            if (url.pathname === '/totp-login' && request.method === 'POST') {
                const { code } = await request.json();
                if (!code || !/^\d{6}$/.test(code)) return json({ error: 'Ongeldige code' }, 400);

                const valid = await verifyTOTP(env.TOTP_SECRET, code);
                if (!valid) return json({ error: 'Verkeerde code' }, 401);

                const customToken = await createCustomToken(
                    TOTP_UID,
                    env.SA_CLIENT_EMAIL,
                    env.SA_PRIVATE_KEY,
                    { email: env.ALLOWED_EMAIL }
                );
                return json({ customToken });
            }

            // ── POST /create-nonce ── desktop start van de QR-flow ──────────
            if (url.pathname === '/create-nonce' && request.method === 'POST') {
                const nonce = crypto.randomUUID();
                const accessToken = await getAccessToken(env.SA_CLIENT_EMAIL, env.SA_PRIVATE_KEY);

                await firestorePatch(env.FIREBASE_PROJECT_ID, 'loginRequests', nonce, {
                    status:    { stringValue: 'pending' },
                    createdAt: { integerValue: String(Date.now()) },
                    expiresAt: { integerValue: String(Date.now() + NONCE_TTL_MS) },
                }, accessToken);

                return json({ nonce });
            }

            // ── POST /approve ── telefoon keurt login goed ───────────────────
            if (url.pathname === '/approve' && request.method === 'POST') {
                const { nonce, idToken } = await request.json();
                if (!nonce || !idToken) return json({ error: 'nonce en idToken vereist' }, 400);

                // Verifieer de identiteit van de telefoon
                const decoded = await verifyIdToken(idToken, env.FIREBASE_PROJECT_ID);
                if (decoded.email !== env.ALLOWED_EMAIL) {
                    return json({ error: 'Niet geautoriseerd' }, 403);
                }

                // Genereer custom token voor de desktop
                const customToken = await createCustomToken(
                    decoded.uid,
                    env.SA_CLIENT_EMAIL,
                    env.SA_PRIVATE_KEY
                );

                // Schrijf approved-status naar Firestore → desktop listener pakt dit op
                const accessToken = await getAccessToken(env.SA_CLIENT_EMAIL, env.SA_PRIVATE_KEY);
                await firestorePatch(env.FIREBASE_PROJECT_ID, 'loginRequests', nonce, {
                    status:      { stringValue: 'approved' },
                    customToken: { stringValue: customToken },
                    approvedAt:  { integerValue: String(Date.now()) },
                }, accessToken);

                return json({ ok: true });
            }

            return json({ error: 'Niet gevonden' }, 404);

        } catch (err) {
            console.error(err);
            return json({ error: err.message }, 500);
        }
    },
};
