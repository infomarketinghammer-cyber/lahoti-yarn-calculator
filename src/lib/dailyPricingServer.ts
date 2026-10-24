import fs from 'fs';
import path from 'path';
import {
  DailyPricingStatus,
  SpreadsheetSheetData,
  YarnProductSheetRecord,
  FobSheetRecord,
  FreightSheetRecord,
} from '../types';
import { DEFAULT_PRICING_SNAPSHOT } from './dailyPricingSnapshot';
import { getMongoDb, isMongoConfigured, getMongoDbName } from './mongoDbAdapter';

// MongoDB collection holding the single active pricing document
const COLLECTION_NAME = 'daily_pricing';
const DOCUMENT_ID = 'dailyPricing';

const STORE_FILE_PATHS = [
  path.join(process.cwd(), '.daily_pricing_store.json'),
  '/tmp/.daily_pricing_store.json',
];

const UNCONFIRMED = {
  lastConfirmedDate: null,
  lastConfirmedAt: null,
  lastConfirmedBy: null,
  confirmationType: null,
};

// Last store successfully read from / written to MongoDB. Served during a brief
// MongoDB outage so the dashboard never flips to a stale (locked) local copy.
let lastKnownStore: any = null;

export async function initializeMongoCollectionsAndSeed() {
  if (!isMongoConfigured()) {
    console.log('⚪ MongoDB URI not configured or contains placeholders (using local fallback storage).');
    return;
  }
  try {
    const db = await getMongoDb();
    if (!db) return;

    // 1. Ensure config collection and default dailyPricing document exist
    const configCol = db.collection(COLLECTION_NAME);
    let existingConfig = await configCol.findOne({ _id: DOCUMENT_ID as any });
    if (!existingConfig || !existingConfig.sheets) {
      // A freshly seeded store starts locked: only an explicit admin action may confirm prices
      const snapshotClone = { ...JSON.parse(JSON.stringify(DEFAULT_PRICING_SNAPSHOT)), ...UNCONFIRMED };
      await configCol.updateOne(
        { _id: DOCUMENT_ID as any },
        { $set: snapshotClone },
        { upsert: true }
      );
      existingConfig = snapshotClone;
      console.log(`✨ Seeded default 'dailyPricing' document in MongoDB collection '${COLLECTION_NAME}'.`);
    } else {
      console.log(`🟢 MongoDB collection '${COLLECTION_NAME}' and document '${DOCUMENT_ID}' verified.`);
    }

    // 2. Ensure daily_pricing_history collection exists and has at least current active snapshot if empty
    const historyCol = db.collection(HISTORY_COLLECTION);
    const historyCount = await historyCol.countDocuments({});
    if (historyCount === 0) {
      const todayKey = getTodayDateString('Asia/Kolkata');
      const activeStore = existingConfig || JSON.parse(JSON.stringify(DEFAULT_PRICING_SNAPSHOT));
      await historyCol.updateOne(
        { _id: todayKey as any },
        {
          $set: {
            _id: todayKey,
            id: todayKey,
            confirmedDate: todayKey,
            confirmedAt: activeStore.lastConfirmedAt || new Date().toISOString(),
            confirmedBy: activeStore.lastConfirmedBy || 'Admin',
            confirmationType: activeStore.confirmationType || 'updated_prices',
            sheets: activeStore.sheets,
            summary: `Initial Seed Pricing Snapshot for ${todayKey}`,
          }
        },
        { upsert: true }
      );
      console.log(`✨ Initialized MongoDB collection '${HISTORY_COLLECTION}' with snapshot for ${todayKey}.`);
    } else {
      console.log(`🟢 MongoDB collection '${HISTORY_COLLECTION}' verified (${historyCount} snapshot(s) found).`);
    }
  } catch (err: any) {
    console.warn(`⚠️ Failed to initialize MongoDB collections in '${getMongoDbName()}' on startup:`, err?.message || err);
  }
}

// Documents seeded by the migration script keep the confirmation inside `status`
// rather than at the top level; accept both shapes.
function normalizeStoreDoc(doc: any) {
  if (!doc) return doc;
  const status = doc.status || {};
  return {
    ...doc,
    lastConfirmedDate: doc.lastConfirmedDate ?? status.lastConfirmedDate ?? null,
    lastConfirmedAt: doc.lastConfirmedAt ?? status.lastConfirmedAt ?? null,
    lastConfirmedBy: doc.lastConfirmedBy ?? status.lastConfirmedBy ?? null,
    confirmationType: doc.confirmationType ?? status.confirmationType ?? null,
  };
}

export function getTodayDateString(timeZone: string = 'Asia/Kolkata'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    const istDate = new Date(Date.now() + 5.5 * 3600 * 1000);
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

function tryReadStoreFromDisk(): any | null {
  for (const p of STORE_FILE_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.sheets && parsed.sheets.yarn) {
          return parsed;
        }
      }
    } catch {}
  }
  return null;
}

function saveStoreToDisk(storeData: any) {
  const content = JSON.stringify(storeData, null, 2);
  for (const p of STORE_FILE_PATHS) {
    try {
      fs.writeFileSync(p, content, 'utf-8');
    } catch {}
  }
}

const HISTORY_COLLECTION = 'daily_pricing_history';
const LOCAL_HISTORY_PATH = '/tmp/.daily_pricing_history.json';

async function saveHistorySnapshot(storeData: any): Promise<void> {
  const dateKey = storeData.lastConfirmedDate || getTodayDateString('Asia/Kolkata');
  const historyEntry = {
    _id: dateKey,
    id: dateKey,
    confirmedDate: dateKey,
    confirmedAt: storeData.lastConfirmedAt || new Date().toISOString(),
    confirmedBy: storeData.lastConfirmedBy || 'Admin',
    confirmationType: storeData.confirmationType || 'updated_prices',
    sheets: storeData.sheets,
    summary: `Pricing Snapshot for ${dateKey} (${storeData.confirmationType || 'updated'})`,
  };

  try {
    let historyList: any[] = [];
    if (fs.existsSync(LOCAL_HISTORY_PATH)) {
      historyList = JSON.parse(fs.readFileSync(LOCAL_HISTORY_PATH, 'utf-8'));
    }
    const existingIdx = historyList.findIndex((h: any) => h.confirmedDate === dateKey);
    if (existingIdx >= 0) {
      historyList[existingIdx] = historyEntry;
    } else {
      historyList.unshift(historyEntry);
    }
    fs.writeFileSync(LOCAL_HISTORY_PATH, JSON.stringify(historyList, null, 2), 'utf-8');
  } catch {}

  const db = await getMongoDb();
  if (db) {
    try {
      const col = db.collection(HISTORY_COLLECTION);
      await col.updateOne(
        { _id: dateKey as any },
        { $set: historyEntry },
        { upsert: true }
      );
      console.log(`📚 Archived daily pricing history snapshot for ${dateKey} in MongoDB Atlas.`);
    } catch (err) {
      console.warn('⚠️ Failed to save history snapshot to MongoDB:', err);
    }
  }
}

async function saveStoreToDatabase(
  storeData: {
    lastConfirmedDate: string | null;
    lastConfirmedAt: string | null;
    lastConfirmedBy: string | null;
    confirmationType: 'kept_previous' | 'updated_prices' | null;
    sheets: {
      yarn: SpreadsheetSheetData;
      fob: SpreadsheetSheetData;
      freight: SpreadsheetSheetData;
    };
  },
  options: { allowConfirmationRollback?: boolean } = {}
): Promise<void> {
  const mongoRequired = isMongoConfigured();
  const db = await getMongoDb();
  if (mongoRequired && !db) {
    // Saving only to this container's disk would "unlock" prices until the container is recycled
    throw new PricingStoreUnavailableError('Pricing database is unreachable. Nothing was saved, please try again in a moment.');
  }

  // Never let a write that started from a stale copy (e.g. a fresh server instance
  // that read the bundled defaults) wipe out a newer admin confirmation in MongoDB.
  if (db && !options.allowConfirmationRollback) {
    try {
      const existing = normalizeStoreDoc(await db.collection(COLLECTION_NAME).findOne(
        { _id: DOCUMENT_ID as any },
        { projection: { lastConfirmedDate: 1, lastConfirmedAt: 1, lastConfirmedBy: 1, confirmationType: 1, status: 1 } }
      ));
      if (
        existing?.lastConfirmedDate &&
        (!storeData.lastConfirmedDate || storeData.lastConfirmedDate < existing.lastConfirmedDate)
      ) {
        storeData.lastConfirmedDate = existing.lastConfirmedDate;
        storeData.lastConfirmedAt = existing.lastConfirmedAt || null;
        storeData.lastConfirmedBy = existing.lastConfirmedBy || null;
        storeData.confirmationType = existing.confirmationType || null;
      }
    } catch (err) {
      console.warn('⚠️ Could not verify existing confirmation in MongoDB before write:', err);
    }
  }

  console.log('📝 STORE WRITE - lastConfirmedDate:', storeData.lastConfirmedDate);

  // MongoDB is the single source of truth shared by every server instance, so it is
  // written first and a failure aborts the whole save.
  if (db) {
    try {
      const collection = db.collection(COLLECTION_NAME);
      const todayDate = getTodayDateString('Asia/Kolkata');
      await collection.updateOne(
        { _id: DOCUMENT_ID as any },
        {
          $set: {
            ...storeData,
            id: DOCUMENT_ID,
            // Keep the denormalized status summary in sync for anyone reading the collection directly
            status: {
              isConfirmedForToday: storeData.lastConfirmedDate === todayDate,
              todayDate,
              lastConfirmedDate: storeData.lastConfirmedDate,
              lastConfirmedAt: storeData.lastConfirmedAt,
              lastConfirmedBy: storeData.lastConfirmedBy,
              confirmationType: storeData.confirmationType,
              totalYarnProducts: storeData.sheets.yarn?.rows?.length || 0,
              totalFobLocations: storeData.sheets.fob?.rows?.length || 0,
              totalFreightDestinations: storeData.sheets.freight?.rows?.length || 0,
            },
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      );
      console.log('✅ Successfully persisted store to MongoDB Atlas.');
    } catch (err) {
      console.error('❌ Failed to write pricing store to MongoDB Atlas:', err);
      throw new PricingStoreUnavailableError('Could not save prices to the database. Nothing was changed, please try again.');
    }
    lastKnownStore = JSON.parse(JSON.stringify(storeData));
  }

  // Local copies are only a fallback for development without MongoDB
  saveStoreToDisk(storeData);

  // Archive history snapshot
  await saveHistorySnapshot(storeData);

  // Update in-memory snapshot so prices never revert to initial defaults.
  // (The snapshot .ts source file is intentionally NOT rewritten at runtime: it is
  // imported by the browser bundle, so rewriting it reloads every open dashboard.)
  const snapshot = DEFAULT_PRICING_SNAPSHOT as any;
  Object.assign(snapshot.sheets, storeData.sheets);
  snapshot.lastConfirmedDate = storeData.lastConfirmedDate;
  snapshot.lastConfirmedAt = storeData.lastConfirmedAt;
  snapshot.lastConfirmedBy = storeData.lastConfirmedBy;
  snapshot.confirmationType = storeData.confirmationType;
}

/**
 * Initialize or retrieve daily pricing store.
 * Reads from MongoDB when configured (never from the bundled local file, which is stale
 * and would wrongly lock prices on a fresh container). Without MongoDB it uses the local file.
 */
export async function getDailyPricingStore(): Promise<{
  lastConfirmedDate: string | null;
  lastConfirmedAt: string | null;
  lastConfirmedBy: string | null;
  confirmationType: 'kept_previous' | 'updated_prices' | null;
  sheets: {
    yarn: SpreadsheetSheetData;
    fob: SpreadsheetSheetData;
    freight: SpreadsheetSheetData;
  };
}> {
  let doc: any = null;
  const mongoRequired = isMongoConfigured();
  let mongoReadOk = false;

  const db = await getMongoDb();
  if (db) {
    try {
      const collection = db.collection(COLLECTION_NAME);
      doc = normalizeStoreDoc(await collection.findOne({ _id: DOCUMENT_ID as any }));
      mongoReadOk = true;
    } catch (err) {
      console.warn('⚠️ MongoDB read failed:', err);
    }
  }

  if (mongoRequired && !mongoReadOk) {
    if (!lastKnownStore) {
      throw new PricingStoreUnavailableError();
    }
    console.warn('⚠️ MongoDB unavailable, serving last known pricing store.');
    doc = JSON.parse(JSON.stringify(lastKnownStore));
  }

  if (!mongoRequired && (!doc || !doc.sheets || !doc.sheets.yarn)) {
    // Development without MongoDB: local disk store
    doc = tryReadStoreFromDisk();
  }

  if (!doc || !doc.sheets || !doc.sheets.yarn) {
    console.log('🌱 Seeding daily pricing store from DEFAULT_PRICING_SNAPSHOT (locked until an admin confirms)...');
    doc = { ...JSON.parse(JSON.stringify(DEFAULT_PRICING_SNAPSHOT)), ...UNCONFIRMED };
    await saveStoreToDatabase(doc);
  }

  // Sanitize freight columns
  if (doc.sheets && doc.sheets.freight && Array.isArray(doc.sheets.freight.columns)) {
    doc.sheets.freight.columns = doc.sheets.freight.columns
      .filter((c: any) => c.id !== 'remarks' && !String(c.name || '').toLowerCase().includes('transit'))
      .map((c: any) => {
        if (
          c.id === 'amount' ||
          String(c.name || '').toLowerCase().includes('ocean freight') ||
          String(c.name || '').toLowerCase().includes("40'")
        ) {
          return { ...c, id: 'amount', name: 'Freight(USD)' };
        }
        return c;
      });
  }

  const store = {
    lastConfirmedDate: doc.lastConfirmedDate || null,
    lastConfirmedAt: doc.lastConfirmedAt || null,
    lastConfirmedBy: doc.lastConfirmedBy || null,
    confirmationType: doc.confirmationType || null,
    sheets: doc.sheets,
  };
  if (mongoReadOk) {
    lastKnownStore = JSON.parse(JSON.stringify(store));
  }
  return store;
}

export async function getDailyPricingStatus(): Promise<DailyPricingStatus> {
  const store = await getDailyPricingStore();
  const todayDate = getTodayDateString('Asia/Kolkata');
  const isConfirmedForToday = Boolean(store.lastConfirmedDate && store.lastConfirmedDate === todayDate);

  return {
    isConfirmedForToday,
    todayDate,
    lastConfirmedDate: store.lastConfirmedDate,
    lastConfirmedAt: store.lastConfirmedAt,
    lastConfirmedBy: store.lastConfirmedBy,
    confirmationType: store.confirmationType,
    totalYarnProducts: store.sheets.yarn?.rows?.length || 0,
    totalFobLocations: store.sheets.fob?.rows?.length || 0,
    totalFreightDestinations: store.sheets.freight?.rows?.length || 0,
  };
}

export async function syncDailyPricingStore(clientData: {
  sheets?: { yarn?: SpreadsheetSheetData; fob?: SpreadsheetSheetData; freight?: SpreadsheetSheetData };
  lastConfirmedDate?: string | null;
  lastConfirmedAt?: string | null;
  lastConfirmedBy?: string | null;
  confirmationType?: 'kept_previous' | 'updated_prices' | null;
}): Promise<{ status: DailyPricingStatus; sheets: typeof store.sheets }> {
  const store = await getDailyPricingStore();
  const todayDate = getTodayDateString('Asia/Kolkata');

  // Only restore a confirmation the server lost (e.g. after a restart). If the server
  // is already confirmed for today, or the client's copy is not from today, ignore it
  // so an old browser cache can never overwrite newer prices.
  if (store.lastConfirmedDate === todayDate || clientData?.lastConfirmedDate !== todayDate) {
    const status = await getDailyPricingStatus();
    return { status, sheets: store.sheets };
  }

  if (clientData?.sheets?.yarn?.rows?.length) {
    store.sheets.yarn = clientData.sheets.yarn;
  }
  if (clientData?.sheets?.fob?.rows?.length) {
    store.sheets.fob = clientData.sheets.fob;
  }
  if (clientData?.sheets?.freight?.rows?.length) {
    store.sheets.freight = clientData.sheets.freight;
  }

  store.lastConfirmedDate = todayDate;
  store.lastConfirmedAt = clientData.lastConfirmedAt || new Date().toISOString();
  store.lastConfirmedBy = clientData.lastConfirmedBy || 'Admin';
  store.confirmationType = clientData.confirmationType || 'kept_previous';

  await saveStoreToDatabase(store);

  const status = await getDailyPricingStatus();
  return { status, sheets: store.sheets };
}

export async function confirmPreviousPricesForToday(
  confirmedBy: string,
  clientSheets?: {
    yarn?: SpreadsheetSheetData;
    fob?: SpreadsheetSheetData;
    freight?: SpreadsheetSheetData;
  }
): Promise<DailyPricingStatus> {
  const store = await getDailyPricingStore();
  const todayDate = getTodayDateString('Asia/Kolkata');

  // "Keep previous" keeps the prices already stored on the server. A browser's cached
  // copy may be days old, so it is only used to fill a sheet the server is missing.
  if (!store.sheets.yarn?.rows?.length && clientSheets?.yarn?.rows?.length) {
    store.sheets.yarn = clientSheets.yarn;
  }
  if (!store.sheets.fob?.rows?.length && clientSheets?.fob?.rows?.length) {
    store.sheets.fob = clientSheets.fob;
  }
  if (!store.sheets.freight?.rows?.length && clientSheets?.freight?.rows?.length) {
    store.sheets.freight = clientSheets.freight;
  }

  store.lastConfirmedDate = todayDate;
  store.lastConfirmedAt = new Date().toISOString();
  store.lastConfirmedBy = confirmedBy || 'Admin';
  store.confirmationType = 'kept_previous';

  await saveStoreToDatabase(store);
  return getDailyPricingStatus();
}

export async function saveAndPublishDailyPrices(
  sheets: {
    yarn: SpreadsheetSheetData;
    fob: SpreadsheetSheetData;
    freight: SpreadsheetSheetData;
  },
  confirmedBy: string
): Promise<{ status: DailyPricingStatus; sheets: typeof sheets }> {
  const store = await getDailyPricingStore();
  const todayDate = getTodayDateString('Asia/Kolkata');

  store.sheets = sheets;
  store.lastConfirmedDate = todayDate;
  store.lastConfirmedAt = new Date().toISOString();
  store.lastConfirmedBy = confirmedBy || 'Admin';
  store.confirmationType = 'updated_prices';

  await saveStoreToDatabase(store);
  const status = await getDailyPricingStatus();
  return { status, sheets: store.sheets };
}

export async function simulateMidnightReset(): Promise<DailyPricingStatus> {
  const store = await getDailyPricingStore();
  const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
  nowIST.setUTCDate(nowIST.getUTCDate() - 1);
  const year = nowIST.getUTCFullYear();
  const month = String(nowIST.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowIST.getUTCDate()).padStart(2, '0');

  store.lastConfirmedDate = `${year}-${month}-${day}`;
  store.lastConfirmedAt = new Date().toISOString();
  store.lastConfirmedBy = null;
  store.confirmationType = null;

  await saveStoreToDatabase(store, { allowConfirmationRollback: true });
  return getDailyPricingStatus();
}

export async function getLivePricingRecords() {
  const store = await getDailyPricingStore();
  const status = await getDailyPricingStatus();

  const yarnRows = store.sheets.yarn?.rows || [];
  const yarnRecords: YarnProductSheetRecord[] = yarnRows.map((r, idx) => {
    const rawPrice = r.exMillPrice;
    const priceNum = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' ? Number(rawPrice) : null;
    return {
      yarnCount: String(r.yarnCount || '').trim(),
      quality: String(r.quality || '').trim(),
      category: String(r.category || 'General').trim(),
      exMillPrice: priceNum !== null && !isNaN(priceNum) && priceNum > 0 ? priceNum : null,
      factoryLocation: String(r.factoryLocation || 'Factory Location not available.').trim(),
      rawRow: idx + 1,
    };
  });

  const uniqueCounts: string[] = [];
  yarnRecords.forEach((r) => {
    if (r.yarnCount && !uniqueCounts.includes(r.yarnCount)) {
      uniqueCounts.push(r.yarnCount);
    }
  });

  const fobRows = store.sheets.fob?.rows || [];
  const fobRecords: FobSheetRecord[] = fobRows.map((r, idx) => {
    const rawPrice = r.price;
    const priceNum = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' ? Number(rawPrice) : null;
    return {
      location: String(r.location || '').trim(),
      price: priceNum !== null && !isNaN(priceNum) && priceNum > 0 ? priceNum : null,
      rawRow: idx + 1,
    };
  });
  const fobLocations: string[] = [];
  fobRecords.forEach((r) => {
    if (r.location && !fobLocations.includes(r.location)) {
      fobLocations.push(r.location);
    }
  });

  const freightRows = store.sheets.freight?.rows || [];
  const freightRecords: FreightSheetRecord[] = freightRows.map((r, idx) => {
    const rawAmt = r.amount;
    const amtNum = rawAmt !== null && rawAmt !== undefined && rawAmt !== '' ? Number(rawAmt) : null;
    return {
      destination: String(r.destination || '').trim(),
      amount: amtNum !== null && !isNaN(amtNum) && amtNum > 0 ? amtNum : null,
      rawRow: idx + 1,
    };
  });
  const destinations: string[] = [];
  freightRecords.forEach((r) => {
    if (r.destination && !destinations.includes(r.destination)) {
      destinations.push(r.destination);
    }
  });

  return {
    status,
    yarn: { records: yarnRecords, uniqueCounts },
    fob: { records: fobRecords, locations: fobLocations },
    freight: { records: freightRecords, destinations },
  };
}

export async function addOrUpdateDestination(destination: string, amount?: number | null) {
  const store = await getDailyPricingStore();
  const cleanDest = destination.trim();
  if (!cleanDest) return getLivePricingRecords();

  if (!store.sheets.freight) {
    store.sheets.freight = {
      id: 'freight',
      name: 'Ocean Freight Rates',
      description: 'Port of Discharge (POD) container rates from Mundra (USD)',
      columns: [
        { id: 'destination', name: 'Destination Port', type: 'text', width: 220 },
        { id: 'amount', name: 'Freight(USD)', type: 'number', width: 220 },
      ],
      rows: [],
    };
  }

  const existingRow = store.sheets.freight.rows.find(
    (r: any) => String(r.destination || '').trim().toLowerCase() === cleanDest.toLowerCase()
  );

  if (existingRow) {
    if (amount !== undefined && amount !== null) {
      existingRow.amount = amount;
    }
  } else {
    store.sheets.freight.rows.push({
      id: `freight_row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      destination: cleanDest,
      amount: amount !== undefined && amount !== null && amount > 0 ? amount : null,
    });
  }

  await saveStoreToDatabase(store);
  return getLivePricingRecords();
}

export async function addOrUpdateFobLocation(location: string, price?: number | null) {
  const store = await getDailyPricingStore();
  const cleanLoc = location.trim();
  if (!cleanLoc) return getLivePricingRecords();

  if (!store.sheets.fob) {
    store.sheets.fob = {
      id: 'fob',
      name: 'FOB Direct Rates',
      description: 'Factory and inland terminal direct container transport charges to Mundra/Port (₹/container)',
      columns: [
        { id: 'location', name: 'Port / Mill Location', type: 'text', width: 260 },
        { id: 'price', name: 'FOB Cost (₹/container)', type: 'number', width: 240 },
      ],
      rows: [],
    };
  }

  const existingRow = store.sheets.fob.rows.find(
    (r: any) => String(r.location || '').trim().toLowerCase() === cleanLoc.toLowerCase()
  );

  if (existingRow) {
    if (price !== undefined && price !== null) {
      existingRow.price = price;
    }
  } else {
    store.sheets.fob.rows.push({
      id: `fob_row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      location: cleanLoc,
      price: price !== undefined && price !== null && price > 0 ? price : null,
    });
  }

  await saveStoreToDatabase(store);
  return getLivePricingRecords();
}

export async function addOrUpdateYarnProduct(
  yarnCount: string,
  quality: string,
  exMillPrice?: number | null,
  factoryLocation?: string,
  category?: string
) {
  const store = await getDailyPricingStore();
  const cleanCount = yarnCount.trim();
  const cleanQual = quality.trim();
  if (!cleanCount || !cleanQual) return getLivePricingRecords();

  if (!store.sheets.yarn) {
    store.sheets.yarn = {
      id: 'yarn',
      name: 'Yarn Ex-Mill Prices',
      description: 'Daily Ex-Mill pricing for knitting, weaving, and double cotton yarns (₹/kg)',
      columns: [
        { id: 'yarnCount', name: 'Yarn Count', type: 'text', width: 140 },
        { id: 'quality', name: 'Quality', type: 'text', width: 120 },
        { id: 'category', name: 'Category', type: 'text', width: 160 },
        { id: 'exMillPrice', name: 'Ex-Mill Price (₹/kg)', type: 'number', width: 160 },
        { id: 'factoryLocation', name: 'Factory Location', type: 'text', width: 180 },
      ],
      rows: [],
    };
  }

  const existingRow = store.sheets.yarn.rows.find(
    (r: any) =>
      String(r.yarnCount || '').trim().toLowerCase() === cleanCount.toLowerCase() &&
      String(r.quality || '').trim().toLowerCase() === cleanQual.toLowerCase()
  );

  if (existingRow) {
    if (exMillPrice !== undefined && exMillPrice !== null) existingRow.exMillPrice = exMillPrice;
    if (factoryLocation) existingRow.factoryLocation = factoryLocation;
    if (category) existingRow.category = category;
  } else {
    store.sheets.yarn.rows.push({
      id: `yarn_row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      yarnCount: cleanCount,
      quality: cleanQual,
      category: category || 'General',
      exMillPrice: exMillPrice !== undefined && exMillPrice !== null && exMillPrice > 0 ? exMillPrice : null,
      factoryLocation: factoryLocation || 'Factory Location not available.',
    });
  }

  await saveStoreToDatabase(store);
  return getLivePricingRecords();
}

export async function mergeLiveGoogleSheetData(parsed: {
  yarnRecords?: YarnProductSheetRecord[];
  fobRecords?: FobSheetRecord[];
  freightRecords?: FreightSheetRecord[];
}) {
  const store = await getDailyPricingStore();
  let changed = false;

  if (parsed.freightRecords && parsed.freightRecords.length > 0) {
    if (!store.sheets.freight) {
      store.sheets.freight = {
        id: 'freight',
        name: 'Ocean Freight Rates',
        description: 'Port of Discharge (POD) container rates from Mundra (USD)',
        columns: [
          { id: 'destination', name: 'Destination Port', type: 'text', width: 220 },
          { id: 'amount', name: 'Freight(USD)', type: 'number', width: 220 },
        ],
        rows: [],
      };
    }

    const currentFreightRows = store.sheets.freight.rows || [];
    const googleDestMap = new Map<string, FreightSheetRecord>();
    parsed.freightRecords.forEach((r) => {
      googleDestMap.set(r.destination.trim().toLowerCase(), r);
    });

    const remainingRows = currentFreightRows.filter((r: any) => {
      const destKey = String(r.destination || '').trim().toLowerCase();
      return googleDestMap.has(destKey);
    });
    if (remainingRows.length !== currentFreightRows.length) {
      changed = true;
    }

    const updatedRows: any[] = [];
    for (const rec of parsed.freightRecords) {
      const destKey = rec.destination.trim().toLowerCase();
      const existing = remainingRows.find(
        (r: any) => String(r.destination || '').trim().toLowerCase() === destKey
      );
      if (existing) {
        if (rec.amount !== null && rec.amount !== undefined && rec.amount > 0) {
          if (existing.amount !== rec.amount) {
            existing.amount = rec.amount;
            changed = true;
          }
        }
        updatedRows.push(existing);
      } else {
        updatedRows.push({
          id: `freight_row_gs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          destination: rec.destination.trim(),
          amount: rec.amount !== null && rec.amount !== undefined && rec.amount > 0 ? rec.amount : null,
        });
        changed = true;
      }
    }

    store.sheets.freight.rows = updatedRows;
  }

  if (parsed.fobRecords && parsed.fobRecords.length > 0) {
    if (!store.sheets.fob) {
      store.sheets.fob = {
        id: 'fob',
        name: 'FOB Direct Rates',
        description: 'Factory and inland terminal direct container transport charges to Mundra/Port (₹/container)',
        columns: [
          { id: 'location', name: 'Port / Mill Location', type: 'text', width: 260 },
          { id: 'price', name: 'FOB Cost (₹/container)', type: 'number', width: 240 },
        ],
        rows: [],
      };
    }

    const currentFobRows = store.sheets.fob.rows || [];
    const googleFobMap = new Map<string, FobSheetRecord>();
    parsed.fobRecords.forEach((r) => {
      googleFobMap.set(r.location.trim().toLowerCase(), r);
    });

    const remainingFobRows = currentFobRows.filter((r: any) => {
      const locKey = String(r.location || '').trim().toLowerCase();
      return googleFobMap.has(locKey);
    });
    if (remainingFobRows.length !== currentFobRows.length) {
      changed = true;
    }

    const updatedFobRows: any[] = [];
    for (const rec of parsed.fobRecords) {
      const locKey = rec.location.trim().toLowerCase();
      const existing = remainingFobRows.find(
        (r: any) => String(r.location || '').trim().toLowerCase() === locKey
      );
      if (existing) {
        if (rec.price !== null && rec.price !== undefined && rec.price > 0) {
          if (existing.price !== rec.price) {
            existing.price = rec.price;
            changed = true;
          }
        }
        updatedFobRows.push(existing);
      } else {
        updatedFobRows.push({
          id: `fob_row_gs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          location: rec.location.trim(),
          price: rec.price !== null && rec.price !== undefined && rec.price > 0 ? rec.price : null,
        });
        changed = true;
      }
    }

    store.sheets.fob.rows = updatedFobRows;
  }

  if (parsed.yarnRecords && parsed.yarnRecords.length > 0) {
    if (!store.sheets.yarn) {
      store.sheets.yarn = {
        id: 'yarn',
        name: 'Yarn Ex-Mill Prices',
        description: 'Daily Ex-Mill pricing for knitting, weaving, and double cotton yarns (₹/kg)',
        columns: [
          { id: 'yarnCount', name: 'Yarn Count', type: 'text', width: 140 },
          { id: 'quality', name: 'Quality', type: 'text', width: 120 },
          { id: 'category', name: 'Category', type: 'text', width: 160 },
          { id: 'exMillPrice', name: 'Ex-Mill Price (₹/kg)', type: 'number', width: 160 },
          { id: 'factoryLocation', name: 'Factory Location', type: 'text', width: 180 },
        ],
        rows: [],
      };
    }

    const currentYarnRows = store.sheets.yarn.rows || [];
    const googleYarnMap = new Map<string, YarnProductSheetRecord>();
    parsed.yarnRecords.forEach((r) => {
      googleYarnMap.set(`${r.yarnCount.trim().toLowerCase()}__${r.quality.trim().toLowerCase()}`, r);
    });

    const remainingYarnRows = currentYarnRows.filter((r: any) => {
      const key = `${String(r.yarnCount || '').trim().toLowerCase()}__${String(r.quality || '').trim().toLowerCase()}`;
      return googleYarnMap.has(key);
    });
    if (remainingYarnRows.length !== currentYarnRows.length) {
      changed = true;
    }

    const updatedYarnRows: any[] = [];
    for (const rec of parsed.yarnRecords) {
      const existing = remainingYarnRows.find(
        (r: any) =>
          String(r.yarnCount || '').trim().toLowerCase() === rec.yarnCount.trim().toLowerCase() &&
          String(r.quality || '').trim().toLowerCase() === rec.quality.trim().toLowerCase()
      );
      if (existing) {
        if (rec.factoryLocation && (!existing.factoryLocation || existing.factoryLocation === 'Factory Location not available.')) {
          existing.factoryLocation = rec.factoryLocation;
          changed = true;
        }
        if (rec.exMillPrice !== null && rec.exMillPrice !== undefined && rec.exMillPrice > 0) {
          if (existing.exMillPrice !== rec.exMillPrice) {
            existing.exMillPrice = rec.exMillPrice;
            changed = true;
          }
        }
        updatedYarnRows.push(existing);
      } else {
        updatedYarnRows.push({
          id: `yarn_row_gs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          yarnCount: rec.yarnCount.trim(),
          quality: rec.quality.trim(),
          category: rec.category || 'General',
          exMillPrice: rec.exMillPrice !== null && rec.exMillPrice !== undefined && rec.exMillPrice > 0 ? rec.exMillPrice : null,
          factoryLocation: rec.factoryLocation || 'Gujrat',
        });
        changed = true;
      }
    }

    store.sheets.yarn.rows = updatedYarnRows;
  }

  if (changed) {
    await saveStoreToDatabase(store);
  }

  return getLivePricingRecords();
}

export async function confirmGoogleSheetEditToday(
  confirmedBy: string = 'Admin'
): Promise<DailyPricingStatus> {
  const store = await getDailyPricingStore();
  const todayDate = getTodayDateString('Asia/Kolkata');

  store.lastConfirmedDate = todayDate;
  store.lastConfirmedAt = new Date().toISOString();
  store.lastConfirmedBy = confirmedBy;
  store.confirmationType = 'updated_prices';

  await saveStoreToDatabase(store);
  return getDailyPricingStatus();
}

export class PricingStoreUnavailableError extends Error {
  constructor(message: string = 'Pricing store is temporarily unavailable') {
    super(message);
    this.name = 'PricingStoreUnavailableError';
  }
}

export async function getDailyPricingHistory(): Promise<any[]> {
  try {
    const db = await getMongoDb();
    if (db) {
      const col = db.collection(HISTORY_COLLECTION);
      const docs = await col.find({}).sort({ confirmedDate: -1 }).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => ({ ...d, id: d._id || d.confirmedDate }));
      }
    }
  } catch {}

  try {
    if (fs.existsSync(LOCAL_HISTORY_PATH)) {
      const localDocs = JSON.parse(fs.readFileSync(LOCAL_HISTORY_PATH, 'utf-8'));
      if (localDocs && localDocs.length > 0) {
        return localDocs;
      }
    }
  } catch {}

  const store = await getDailyPricingStore();
  return [
    {
      id: store.lastConfirmedDate || getTodayDateString('Asia/Kolkata'),
      confirmedDate: store.lastConfirmedDate || getTodayDateString('Asia/Kolkata'),
      confirmedAt: store.lastConfirmedAt || new Date().toISOString(),
      confirmedBy: store.lastConfirmedBy || 'Admin',
      confirmationType: store.confirmationType || 'updated_prices',
      sheets: store.sheets,
      summary: 'Current Active Pricing Snapshot',
    },
  ];
}

export async function getDailyPricingHistoryEntry(id: string): Promise<any> {
  try {
    const db = await getMongoDb();
    if (db) {
      const col = db.collection(HISTORY_COLLECTION);
      const doc = await col.findOne({ $or: [{ _id: id as any }, { confirmedDate: id }] });
      if (doc) {
        return doc;
      }
    }
  } catch {}

  try {
    if (fs.existsSync(LOCAL_HISTORY_PATH)) {
      const localDocs = JSON.parse(fs.readFileSync(LOCAL_HISTORY_PATH, 'utf-8'));
      const found = localDocs.find((h: any) => h.id === id || h.confirmedDate === id);
      if (found) return found;
    }
  } catch {}

  const store = await getDailyPricingStore();
  return {
    id,
    sheets: store.sheets,
    confirmedDate: store.lastConfirmedDate,
    confirmedBy: store.lastConfirmedBy,
    confirmationType: store.confirmationType,
  };
}
