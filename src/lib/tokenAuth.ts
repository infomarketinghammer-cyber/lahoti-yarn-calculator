import crypto from 'crypto';

export interface TokenPayload {
  id?: string;
  uid?: string;
  name: string;
  email?: string;
  role: 'admin' | 'employee';
  exp?: number;
}

// Tokens are signed with HMAC so a browser cannot forge an admin role.
// The secret must be identical on every server instance; when AUTH_TOKEN_SECRET is
// not set it is derived from the MongoDB connection string (already a shared secret).
function getTokenSecret(): string {
  const explicit = (process.env.AUTH_TOKEN_SECRET || '').trim();
  if (explicit) return explicit;
  const mongoUri = (process.env.MONGODB_URI || process.env.MONGODB_URL || '').trim();
  return crypto.createHash('sha256').update(`lahoti-auth-token:${mongoUri}`).digest('hex');
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getTokenSecret()).update(body).digest('base64url');
}

export function signAuthToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (!parsed || !parsed.role) return null;
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
