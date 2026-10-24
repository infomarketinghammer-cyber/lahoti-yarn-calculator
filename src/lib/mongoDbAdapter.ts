import { MongoClient, Db } from 'mongodb';

// Shared MongoDB Atlas connection used by every server-side store.
// Env is read lazily so `dotenv/config` (loaded first in server-app.ts) is always applied.

const PLACEHOLDER_MARKERS = ['<username>', '<password>', '<cluster-url>', 'YOUR_USERNAME', 'YOUR_PASSWORD'];
const MONGO_RETRY_COOLDOWN_MS = 30 * 1000;

let cachedClient: MongoClient | null = null;
let connectPromise: Promise<MongoClient> | null = null;
let mongoAuthFailed = false;
// After a transient connection failure, wait briefly and then retry instead of
// disabling MongoDB for the whole lifetime of the server instance.
let mongoRetryAfter = 0;

function isUsableUri(uri: string | undefined): uri is string {
  return Boolean(uri && uri.trim() && !PLACEHOLDER_MARKERS.some((m) => uri.includes(m)));
}

function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/^["']|["']$/g, '').trim() || undefined;
}

export function getMongoUri(): string | null {
  const candidates = [cleanEnv(process.env.MONGODB_URI), cleanEnv(process.env.MONGODB_URL)];
  return candidates.find(isUsableUri) || null;
}

export function getMongoDbName(): string {
  return cleanEnv(process.env.MONGODB_DB_NAME) || 'lahoti_costing_db';
}

export function isMongoConfigured(): boolean {
  return getMongoUri() !== null;
}

/**
 * Returns the connected database, or null when MongoDB is not configured or
 * currently unreachable (callers fall back to their local stores).
 */
export async function getMongoDb(): Promise<Db | null> {
  const uri = getMongoUri();
  if (!uri || mongoAuthFailed || Date.now() < mongoRetryAfter) {
    return null;
  }
  try {
    if (!cachedClient) {
      if (!connectPromise) {
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
        connectPromise = client.connect();
      }
      cachedClient = await connectPromise;
      console.log(`🟢 Connected to MongoDB Atlas database: ${getMongoDbName()}`);
    }
    return cachedClient.db(getMongoDbName());
  } catch (err: any) {
    connectPromise = null;
    const message = String(err?.message || err);
    if (message.includes('bad auth') || message.includes('authentication failed')) {
      mongoAuthFailed = true;
      console.warn('⚠️ MongoDB authentication failed (bad auth). Check MONGODB_URI. Using local fallback storage for this session.');
    } else {
      mongoRetryAfter = Date.now() + MONGO_RETRY_COOLDOWN_MS;
      console.warn('⚠️ MongoDB connection failed, will retry in 30s:', message);
    }
    return null;
  }
}

/** Strips Mongo's internal _id so documents match the app's API shapes. */
export function withoutMongoId<T extends Record<string, any>>(doc: T): Omit<T, '_id'> {
  const { _id, ...rest } = doc;
  return rest;
}

export async function writeAuditLog(action: string, details: string, user?: { id?: string; name?: string }) {
  const db = await getMongoDb();
  if (!db) return;
  try {
    await db.collection('audit_logs').insertOne({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action,
      user_name: user?.name || 'System',
      user_id: user?.id || 'sys',
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('⚠️ Failed to write audit log:', err);
  }
}
