import { ObjectId } from 'mongodb';
import { SavedQuote } from '../types';
import { SavedCostingRecord } from './rpcHandlers';
import { getMongoDb, withoutMongoId } from './mongoDbAdapter';

// Both saved costing calculations (save_costing / replay_costing) and saved quotes
// live in `costing_records`, told apart by `kind`.
const COLLECTION = 'costing_records';

export async function persistCostingRecord(record: SavedCostingRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).updateOne(
      { reference_no: record.reference_no },
      { $set: { ...record, kind: 'costing' } },
      { upsert: true }
    );
  } catch (err) {
    console.warn('⚠️ Failed to persist costing record to MongoDB:', err);
  }
}

export async function loadCostingRecord(referenceNo: string): Promise<SavedCostingRecord | null> {
  const db = await getMongoDb();
  if (!db) return null;
  try {
    const doc = await db.collection(COLLECTION).findOne({ reference_no: referenceNo, kind: 'costing' });
    return doc ? (withoutMongoId(doc) as unknown as SavedCostingRecord) : null;
  } catch (err) {
    console.warn('⚠️ Failed to load costing record from MongoDB:', err);
    return null;
  }
}

export async function persistSavedQuote(quote: SavedQuote): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).updateOne(
      { id: quote.id },
      { $set: { ...quote, reference_no: quote.quote_number, kind: 'quote' } },
      { upsert: true }
    );
  } catch (err) {
    console.warn('⚠️ Failed to persist saved quote to MongoDB:', err);
  }
}

/** Returns saved quotes from MongoDB, or null when MongoDB is unavailable. */
export async function listSavedQuotes(): Promise<SavedQuote[] | null> {
  const db = await getMongoDb();
  if (!db) return null;
  try {
    const docs = await db.collection(COLLECTION)
      .find({ kind: { $ne: 'costing' } })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map((d) => {
      const { kind, reference_no, outputs, ...rest } = withoutMongoId(d) as any;
      return { ...rest, id: rest.id || String(d._id), results: rest.results || outputs || {} } as SavedQuote;
    });
  } catch (err) {
    console.warn('⚠️ Failed to list saved quotes from MongoDB:', err);
    return null;
  }
}

export async function deleteSavedQuote(id: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) return;
  try {
    const filters: any[] = [{ id }];
    if (ObjectId.isValid(id) && /^[0-9a-f]{24}$/i.test(id)) {
      filters.push({ _id: new ObjectId(id) });
    }
    await db.collection(COLLECTION).deleteOne({ $or: filters, kind: { $ne: 'costing' } });
  } catch (err) {
    console.warn('⚠️ Failed to delete saved quote from MongoDB:', err);
  }
}
