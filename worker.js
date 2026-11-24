/**
 * Cloudflare Worker: Student ID + guardianPhone verification and Firebase custom token minting.
 * Store the Google service-account email and private key as Cloudflare Worker secrets.
 */
const ALLOWED_ORIGIN = 'https://sonarbanglaadarshoschool.github.io';
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function json(data, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'vary': 'Origin',
      'cache-control': 'no-store'
    }
  });
}
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
async function signJwt(payload, env) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(env.SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}
async function googleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 60) return cachedAccessToken;
  const assertion = await signJwt({
    iss: env.SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }, env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`Google token error (${response.status})`);
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = now + Number(data.expires_in || 3600);
  return cachedAccessToken;
}
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = decodeValue(value);
  return out;
}
async function queryCollection(env, accessToken, collection, filters) {
  const fieldFilters = filters.map(([field, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: String(value) } }
  }));
  const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: 'AND', filters: fieldFilters } };
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where, limit: 2 } })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Firestore query error (${response.status})`);
  return (data || []).filter(x => x.document).map(x => ({
    id: x.document.name.split('/').pop(), data: decodeFields(x.document.fields || {})
  }));
}
function normalizePhone(value) { return String(value || '').replace(/\D/g, '').replace(/^880/, '0'); }
async function firebaseCustomToken(env, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: env.SERVICE_ACCOUNT_EMAIL,
    sub: env.SERVICE_ACCOUNT_EMAIL,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims
  }, env);
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': ALLOWED_ORIGIN,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400', vary: 'Origin'
      }});
    }
    if (origin !== ALLOWED_ORIGIN) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    try {
      const body = await request.json();
      const studentId = String(body.studentId || '').trim().toUpperCase();
      const phone = normalizePhone(body.phone);
      if (!/^ST[A-Z0-9-]{1,28}$/.test(studentId) || phone.length < 10 || phone.length > 14) {
        return json({ error: 'Student ID or guardian phone number is incorrect.' }, 401);
      }
      const accessToken = await googleAccessToken(env);
      const matches = await queryCollection(env, accessToken, 'students', [['studentId', studentId]]);
      if (matches.length !== 1) return json({ error: 'Student ID or guardian phone number is incorrect.' }, 401);
      const record = matches[0];
      const student = record.data;
      if (String(student.status || 'active').toLowerCase() === 'inactive' || normalizePhone(student.guardianPhone) !== phone) {
        return json({ error: 'Student ID or guardian phone number is incorrect.' }, 401);
      }
      let classId = String(student.classId || '');
      if (!classId && student.className) {
        const classFilters = [['className', student.className]];
        if (student.group) classFilters.push(['group', student.group]);
        const classes = await queryCollection(env, accessToken, 'classes', classFilters);
        if (classes.length === 1) classId = classes[0].id;
      }
      const token = await firebaseCustomToken(env, `student_${record.id}`, {
        role: 'student', studentDocId: record.id, studentId,
        ...(classId ? { classId } : {})
      });
      return json({ token });
    } catch (error) {
      console.error('Student portal login failed:', error && error.message ? error.message : 'unknown error');
      return json({ error: 'Login service is temporarily unavailable. Please try again later.' }, 500);
    }
  }
};
