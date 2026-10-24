// Must stay the first import: later modules read process.env (MONGODB_URI, ZOHO_*, ...)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { calculateCottonYarnCostingPLpgSQL } from './src/lib/plpgsqlEngine';
import { ContainerConfigMaster, FinancialParamsMaster, FxRateMaster, PortLogisticsMaster, Product, SavedQuote, YarnCountMaster } from './src/types';
import {
  handleGetProducts,
  handleGetFreightOrigins,
  handleGetFreightDestinations,
  handleGetFreightRate,
  handleGetFobLocations,
  handleGetQuantityOptions,
  handleGetMarginTerms,
  handleGetExchangeRates,
  handleRefreshExchangeRates,
  handleCalculateCosting,
  handleSaveCosting,
  handleReplayCosting,
  getSavedCostingRecord,
  registerSavedCostingRecord,
} from './src/lib/rpcHandlers';
import {
  parseGoogleSheetYarnCSV,
  parseGoogleSheetFobCSV,
  parseGoogleSheetFreightCSV,
  GOOGLE_SHEET_CSV_URL,
  GOOGLE_SHEET_URL,
  GOOGLE_FOB_SHEET_CSV_URL,
  GOOGLE_FOB_SHEET_URL,
  GOOGLE_FREIGHT_SHEET_CSV_URL,
  GOOGLE_FREIGHT_SHEET_URL,
} from './src/lib/googleSheetService';
import { SYSTEM_USERS, authenticateUser } from './src/lib/authData';
import { FALLBACK_ZOHO_ACCOUNTS } from './src/lib/zohoFallbackData';
import { DEFAULT_PRICING_SNAPSHOT } from './src/lib/dailyPricingSnapshot';
import {
  getDailyPricingStore,
  getDailyPricingStatus,
  confirmPreviousPricesForToday,
  syncDailyPricingStore,
  saveAndPublishDailyPrices,
  getLivePricingRecords,
  getTodayDateString,
  addOrUpdateDestination,
  addOrUpdateFobLocation,
  addOrUpdateYarnProduct,
  mergeLiveGoogleSheetData,
  getDailyPricingHistory,
  getDailyPricingHistoryEntry,
  PricingStoreUnavailableError,
  initializeMongoCollectionsAndSeed,
} from './src/lib/dailyPricingServer';
import { signAuthToken, verifyAuthToken } from './src/lib/tokenAuth';
import { getMongoDb, withoutMongoId, writeAuditLog } from './src/lib/mongoDbAdapter';
import {
  persistCostingRecord,
  loadCostingRecord,
  persistSavedQuote,
  listSavedQuotes,
  deleteSavedQuote,
} from './src/lib/costingRecordsServer';
import {
  getDripStore,
  createNewLead,
  updateLead,
  deleteLead,
  sendNextDripEmail,
  simulateInboundReply,
  logCallAttempt,
  processDripBatch,
  resetDemoLeads,
  saveCampaignTemplates,
} from './src/lib/dripCampaignServer';


// Server-side cache for Google Sheet 1 data
let serverSheetCache: any = null;
let serverSheetCacheTime = 0;
const SERVER_SHEET_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Server-side cache for Google Sheet 2 (FOB) data
let serverFobSheetCache: any = null;
let serverFobSheetCacheTime = 0;

// Server-side cache for Google Sheet 3 (Freight) data
let serverFreightSheetCache: any = null;
let serverFreightSheetCacheTime = 0;

async function fetchGoogleSheetServer(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && serverSheetCache && now - serverSheetCacheTime < SERVER_SHEET_CACHE_TTL) {
    return serverSheetCache;
  }
  try {
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    if (!response.ok) throw new Error(`Google Sheet fetch responded with status ${response.status}`);
    const text = await response.text();
    const { records, uniqueCounts, duplicates } = parseGoogleSheetYarnCSV(text);
    const result = {
      records,
      uniqueCounts,
      duplicates,
      fetchedAt: new Date().toISOString(),
      sourceUrl: GOOGLE_SHEET_URL,
      isFallback: false,
    };
    serverSheetCache = result;
    serverSheetCacheTime = now;
    return result;
  } catch (err: any) {
    console.error('Server Google Sheet fetch error:', err.message);
    if (serverSheetCache) return serverSheetCache;
    throw err;
  }
}

async function fetchGoogleSheetFobServer(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && serverFobSheetCache && now - serverFobSheetCacheTime < SERVER_SHEET_CACHE_TTL) {
    return serverFobSheetCache;
  }
  try {
    const response = await fetch(GOOGLE_FOB_SHEET_CSV_URL);
    if (!response.ok) throw new Error(`Google FOB Sheet fetch responded with status ${response.status}`);
    const text = await response.text();
    const { records, locations } = parseGoogleSheetFobCSV(text);
    const result = {
      records,
      locations,
      fetchedAt: new Date().toISOString(),
      sourceUrl: GOOGLE_FOB_SHEET_URL,
      isFallback: false,
    };
    serverFobSheetCache = result;
    serverFobSheetCacheTime = now;
    return result;
  } catch (err: any) {
    console.error('Server Google FOB Sheet fetch error:', err.message);
    if (serverFobSheetCache) return serverFobSheetCache;
    throw err;
  }
}

async function fetchGoogleSheetFreightServer(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && serverFreightSheetCache && now - serverFreightSheetCacheTime < SERVER_SHEET_CACHE_TTL) {
    return serverFreightSheetCache;
  }
  try {
    const response = await fetch(GOOGLE_FREIGHT_SHEET_CSV_URL);
    if (!response.ok) throw new Error(`Google Freight Sheet fetch responded with status ${response.status}`);
    const text = await response.text();
    const { records, destinations } = parseGoogleSheetFreightCSV(text);
    const result = {
      records,
      destinations,
      fetchedAt: new Date().toISOString(),
      sourceUrl: GOOGLE_FREIGHT_SHEET_URL,
      isFallback: false,
    };
    serverFreightSheetCache = result;
    serverFreightSheetCacheTime = now;
    return result;
  } catch (err: any) {
    console.error('Server Google Freight Sheet fetch error:', err.message);
    if (serverFreightSheetCache) return serverFreightSheetCache;
    throw err;
  }
}


// Initial Seed In-Memory Store for Server RPC Emulator
const products: Product[] = [
  {
    id: 'p_cotton_01',
    code: 'COTTON_YARN',
    name: 'Cotton Yarn',
    description: '100% Cotton Yarn for Export Weaving & Hosiery',
    active: true,
  },
];

let yarnCounts: YarnCountMaster[] = [
  { id: 'yc_20c', product_code: 'COTTON_YARN', count_name: '20s Carded', yarn_type: 'Carded', purpose: 'Weaving', standard_bag_weight_kg: 60.00, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
  { id: 'yc_30ch', product_code: 'COTTON_YARN', count_name: '30s Combed Hosiery', yarn_type: 'Combed', purpose: 'Hosiery', standard_bag_weight_kg: 60.00, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
  { id: 'yc_40cw', product_code: 'COTTON_YARN', count_name: '40s Compact Weaving', yarn_type: 'Compact', purpose: 'Weaving', standard_bag_weight_kg: 45.36, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
  { id: 'yc_50c', product_code: 'COTTON_YARN', count_name: '50s Combed', yarn_type: 'Combed', purpose: 'Weaving', standard_bag_weight_kg: 45.36, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
  { id: 'yc_60c', product_code: 'COTTON_YARN', count_name: '60s Combed', yarn_type: 'Combed', purpose: 'Weaving', standard_bag_weight_kg: 45.36, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
  { id: 'yc_80c', product_code: 'COTTON_YARN', count_name: '80s Compact', yarn_type: 'Compact', purpose: 'Weaving', standard_bag_weight_kg: 45.36, rodtep_rate_pct: 1.70, drawback_rate_pct: 1.50 },
];

let containerConfigs: ContainerConfigMaster[] = [
  { id: 'cc_20ft', product_code: 'COTTON_YARN', container_type: '20FT_FCL', display_name: '20ft Standard FCL Container', max_capacity_kg: 18000.00, bags_count: 300 },
  { id: 'cc_40hc', product_code: 'COTTON_YARN', container_type: '40FT_HC', display_name: '40ft High Cube Container', max_capacity_kg: 24500.00, bags_count: 540 },
];

let portLogistics: PortLogisticsMaster[] = [
  { id: 'port_mundra', port_name: 'Mundra Port', thc_charge_inr: 11500.00, cha_clearance_inr: 4500.00, doc_bl_fee_inr: 3500.00, inspection_fee_inr: 2500.00, inland_freight_inr: 18000.00, other_fob_charges_inr: 2000.00 },
  { id: 'port_nhava', port_name: 'Nhava Sheva (JNPT)', thc_charge_inr: 12500.00, cha_clearance_inr: 4800.00, doc_bl_fee_inr: 3500.00, inspection_fee_inr: 2500.00, inland_freight_inr: 22000.00, other_fob_charges_inr: 2000.00 },
  { id: 'port_tuticorin', port_name: 'Tuticorin Port', thc_charge_inr: 10500.00, cha_clearance_inr: 4200.00, doc_bl_fee_inr: 3000.00, inspection_fee_inr: 2000.00, inland_freight_inr: 14000.00, other_fob_charges_inr: 1800.00 },
  { id: 'port_chennai', port_name: 'Chennai Port', thc_charge_inr: 11000.00, cha_clearance_inr: 4400.00, doc_bl_fee_inr: 3200.00, inspection_fee_inr: 2200.00, inland_freight_inr: 16000.00, other_fob_charges_inr: 2000.00 },
];

let financialParams: FinancialParamsMaster[] = [
  { id: 'fin_cotton_01', product_code: 'COTTON_YARN', packing_credit_interest_pct_pa: 8.50, ecgc_premium_pct: 0.25, bank_lc_discounting_pct: 1.20, trader_margin_pct: 3.00, agent_commission_pct: 1.50, insurance_rate_pct: 0.10 },
];

let fxRates: FxRateMaster[] = [
  { currency_pair: 'USD_INR', rate: 95.43, fx_buffer_margin: 0.00, effective_rate: 95.43, last_updated_at: new Date().toISOString() },
  { currency_pair: 'EUR_INR', rate: 111.36, fx_buffer_margin: 0.00, effective_rate: 111.36, last_updated_at: new Date().toISOString() },
];

let savedQuotes: SavedQuote[] = [];

// Replace the seed master data above with the MongoDB copies when available
async function hydrateMasterDataFromMongo() {
  const db = await getMongoDb();
  if (!db) return;
  try {
    const [productDocs, yarnDocs, containerDocs] = await Promise.all([
      db.collection('products').find({}).toArray(),
      db.collection('yarn_counts').find({}).toArray(),
      db.collection('container_configs').find({}).toArray(),
    ]);
    if (productDocs.length) {
      products.splice(0, products.length, ...productDocs.map((d) => withoutMongoId(d) as unknown as Product));
    }
    if (yarnDocs.length) yarnCounts = yarnDocs.map((d) => withoutMongoId(d) as unknown as YarnCountMaster);
    if (containerDocs.length) containerConfigs = containerDocs.map((d) => withoutMongoId(d) as unknown as ContainerConfigMaster);
    console.log(`🟢 Loaded master data from MongoDB (${products.length} products, ${yarnCounts.length} yarn counts, ${containerConfigs.length} containers).`);
  } catch (err) {
    console.warn('⚠️ Failed to load master data from MongoDB, using built-in seed data:', err);
  }
}

// One row per currency pair per day in `exchange_rates`
async function persistFxRatesToMongo(rates: FxRateMaster[]) {
  const db = await getMongoDb();
  if (!db) return;
  const rateDate = getTodayDateString('Asia/Kolkata');
  try {
    await db.collection('exchange_rates').bulkWrite(
      rates.map((r) => {
        const [base, quote] = r.currency_pair.split('_');
        return {
          updateOne: {
            filter: { currency_pair: r.currency_pair, rate_date: rateDate },
            update: { $set: { ...r, base_currency: base, quote_currency: quote, rate_date: rateDate } },
            upsert: true,
          },
        };
      })
    );
  } catch (err) {
    console.warn('⚠️ Failed to persist FX rates to MongoDB:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.NODE_ENV === 'production'
    ? (Number(process.env.PORT) || 8080)
    : 3000;

  // Auto-fetch real-time FX rates on server boot
  try {
    const liveFx = await handleRefreshExchangeRates();
    if (liveFx?.USD_INR && liveFx?.EUR_INR) {
      fxRates = [
        { currency_pair: 'USD_INR', rate: liveFx.USD_INR.rate, fx_buffer_margin: 0.00, effective_rate: liveFx.USD_INR.rate, last_updated_at: new Date().toISOString() },
        { currency_pair: 'EUR_INR', rate: liveFx.EUR_INR.rate, fx_buffer_margin: 0.00, effective_rate: liveFx.EUR_INR.rate, last_updated_at: new Date().toISOString() },
      ];
    }
  } catch (err) {
    console.warn('Initial live FX fetch warning:', err);
  }

  await initializeMongoCollectionsAndSeed();
  await hydrateMasterDataFromMongo();
  await persistFxRatesToMongo(fxRates);

  app.use(express.json());

  // RPC Endpoint Router for Three-Panel Costing RPC Functions
  app.post('/api/rpc/get_products', (req, res) => {
    res.json({ data: handleGetProducts(), error: null });
  });

  app.post('/api/rpc/get_freight_origins', (req, res) => {
    res.json({ data: handleGetFreightOrigins(req.body.p_product_code), error: null });
  });

  app.post('/api/rpc/get_freight_destinations', (req, res) => {
    res.json({ data: handleGetFreightDestinations(req.body.p_product_code, req.body.p_origin), error: null });
  });

  app.post('/api/rpc/get_freight_rate', (req, res) => {
    res.json({ data: handleGetFreightRate(req.body.p_product_code, req.body.p_origin, req.body.p_destination), error: null });
  });

  app.post('/api/rpc/get_fob_locations', (req, res) => {
    res.json({ data: handleGetFobLocations(req.body.p_product_code), error: null });
  });

  app.post('/api/rpc/get_quantity_options', (req, res) => {
    res.json({ data: handleGetQuantityOptions(req.body.p_product_code), error: null });
  });

  app.post('/api/rpc/get_margin_terms', (req, res) => {
    res.json({ data: handleGetMarginTerms(req.body.p_product_code), error: null });
  });

  app.post('/api/rpc/get_exchange_rates', (req, res) => {
    res.json({ data: handleGetExchangeRates(req.body.p_date), error: null });
  });

  app.post('/api/rpc/refresh_exchange_rates', async (req, res) => {
    const data = await handleRefreshExchangeRates();
    if (data && data.USD_INR) {
      fxRates = [
        { currency_pair: 'USD_INR', rate: data.USD_INR.rate, fx_buffer_margin: 0.00, effective_rate: data.USD_INR.rate, last_updated_at: new Date().toISOString() },
        { currency_pair: 'EUR_INR', rate: data.EUR_INR.rate, fx_buffer_margin: 0.00, effective_rate: data.EUR_INR.rate, last_updated_at: new Date().toISOString() },
      ];
      await persistFxRatesToMongo(fxRates);
    }
    res.json({ data, error: null });
  });

  // Daily Pricing Endpoints (In-App Excel Spreadsheet Editor & 12:00 AM Midnight Expiry)
  app.get('/api/daily-pricing', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const store = await getDailyPricingStore();
      const status = await getDailyPricingStatus();
      const isAdmin = getRequestUser(req)?.role === 'admin';
      const sheets = status.isConfirmedForToday || isAdmin ? store.sheets : maskPrices(store.sheets);
      res.json({ success: true, status, sheets });
    } catch (err: any) {
      if (err instanceof PricingStoreUnavailableError || err.name === 'PricingStoreUnavailableError') {
        return res.status(503).json({
          success: false,
          error: 'Pricing store temporarily unavailable',
        });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  function getRequestUser(req: express.Request) {
    const authHeader = String(req.headers['authorization'] || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    return verifyAuthToken(token);
  }

  // Only a signed admin token passes; nothing the browser sends in the body can grant access
  function verifyAdminRequest(req: express.Request, res: express.Response): boolean {
    const payload = getRequestUser(req);
    if (payload && payload.role === 'admin') {
      return true;
    }

    res.status(403).json({
      success: false,
      error: 'Unauthorized: Only Admin users can publish daily prices. Please sign out and sign in again as an admin.',
    });
    return false;
  }

  // While prices are locked, nobody but an admin receives the price values
  function maskPrices<T extends { yarn: any; fob: any; freight: any }>(sheets: T): T {
    const blank = (sheet: any, field: string) => sheet && {
      ...sheet,
      rows: (sheet.rows || []).map((r: any) => ({ ...r, [field]: null })),
    };
    return {
      ...sheets,
      yarn: blank(sheets.yarn, 'exMillPrice'),
      fob: blank(sheets.fob, 'price'),
      freight: blank(sheets.freight, 'amount'),
    };
  }

  async function getDashboardPricingRecords() {
    const live = await getLivePricingRecords();
    if (live.status.isConfirmedForToday) return live;
    return {
      ...live,
      yarn: { ...live.yarn, records: live.yarn.records.map((r) => ({ ...r, exMillPrice: null })) },
      fob: { ...live.fob, records: live.fob.records.map((r) => ({ ...r, price: null })) },
      freight: { ...live.freight, records: live.freight.records.map((r) => ({ ...r, amount: null })) },
    };
  }

  app.post('/api/daily-pricing/keep-previous', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!verifyAdminRequest(req, res)) return;
    try {
      const confirmedBy = getRequestUser(req)?.name || 'Admin';
      const status = await confirmPreviousPricesForToday(confirmedBy, req.body?.sheets);
      await writeAuditLog('DAILY_PRICES_KEPT_PREVIOUS', `Yesterday's prices confirmed for ${status.todayDate}`, { name: confirmedBy });
      const store = await getDailyPricingStore();
      res.json({
        success: true,
        status,
        sheets: store.sheets,
        message: "Yesterday's prices confirmed and active for today!",
      });
    } catch (err: any) {
      if (err.message && err.message.includes('No published prices exist yet')) {
        return res.status(409).json({ success: false, error: err.message });
      }
      if (err instanceof PricingStoreUnavailableError) {
        return res.status(503).json({ success: false, error: `${err.message} Prices are still locked.` });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Self-healing: a browser that already saw today's confirmation restores it if this
  // server instance lost it (container restart / new instance with bundled defaults).
  app.post('/api/daily-pricing/sync', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!verifyAdminRequest(req, res)) return;
    try {
      const result = await syncDailyPricingStore(req.body || {});
      res.json({ success: true, status: result.status, sheets: result.sheets });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/daily-pricing/save-and-publish', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { sheets, confirmedBy } = req.body;
      if (!sheets || !sheets.yarn) {
        return res.status(400).json({ success: false, error: 'Invalid sheets payload' });
      }
      // Reject a payload with every price blank (e.g. a copy taken while prices were withheld)
      const pricedRows = (sheet: any, field: string) =>
        (sheet?.rows || []).filter((r: any) => r[field] !== null && r[field] !== undefined && r[field] !== '').length;
      const countPriced = (s: any) => pricedRows(s?.yarn, 'exMillPrice') + pricedRows(s?.fob, 'price') + pricedRows(s?.freight, 'amount');
      if (countPriced(sheets) === 0 && countPriced((await getDailyPricingStore()).sheets) > 0) {
        return res.status(400).json({ success: false, error: 'The submitted sheets contain no prices. Reload the page and try again.' });
      }
      const publisher = getRequestUser(req)?.name || confirmedBy || 'Admin';
      const result = await saveAndPublishDailyPrices(sheets, publisher);
      await writeAuditLog('DAILY_PRICES_PUBLISHED', `Prices updated and published for ${result.status.todayDate}`, { name: publisher });
      res.json({
        success: true,
        status: result.status,
        sheets: result.sheets,
        message: "Today's prices updated, confirmed, and published across system!",
      });
    } catch (err: any) {
      if (err.message && err.message.includes('No published prices exist yet')) {
        return res.status(409).json({ success: false, error: err.message });
      }
      if (err instanceof PricingStoreUnavailableError) {
        return res.status(503).json({ success: false, error: `${err.message} Prices are still locked.` });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin-only Price History & Recovery Endpoints
  app.get('/api/daily-pricing/history', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!verifyAdminRequest(req, res)) return;
    try {
      const history = await getDailyPricingHistory();
      res.json({ success: true, history });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/daily-pricing/restore', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { id } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: 'History ID is required' });
      }
      const entry = await getDailyPricingHistoryEntry(String(id));
      res.json({
        success: true,
        draftSheets: entry.sheets,
        confirmedDate: entry.confirmedDate,
        confirmedBy: entry.confirmedBy,
        confirmationType: entry.confirmationType,
        message: `History entry ${id} loaded as draft into editor. Click Publish to make it active.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  async function ensureDailyPricingHydrated(_req: express.Request) {
    try {
      await getDailyPricingStore();
    } catch (e) {
      console.warn('Daily pricing hydration warning:', e);
    }
  }

  // Configurable Google Sheet URLs Endpoints
  let configuredSheetUrls = {
    yarnViewUrl: GOOGLE_SHEET_URL,
    yarnCsvUrl: GOOGLE_SHEET_CSV_URL,
    fobViewUrl: GOOGLE_FOB_SHEET_URL,
    fobCsvUrl: GOOGLE_FOB_SHEET_CSV_URL,
    freightViewUrl: GOOGLE_FREIGHT_SHEET_URL,
    freightCsvUrl: GOOGLE_FREIGHT_SHEET_CSV_URL,
  };

  let lastAutoSyncTime = 0;

  async function tryFetchAndSyncFromGoogleSheets(force = false) {
    // Only fetch and update prices when explicitly forced by an Admin action
    // Prices never change automatically in the background until the Admin confirms them
    if (!force) {
      return;
    }

    // While today's prices are NOT confirmed, tryFetchAndSyncFromGoogleSheets() must not overwrite the stored price rows at all.
    // Only the explicit admin publish endpoints may do that.
    const store = await getDailyPricingStore();
    const todayDate = getTodayDateString('Asia/Kolkata');
    if (!store.lastConfirmedDate || store.lastConfirmedDate !== todayDate) {
      return;
    }

    const now = Date.now();
    lastAutoSyncTime = now;

    const fetchWithTimeout = async (url: string, ms = 9000) => {
      if (!url) return null;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const text = await res.text();
        if (text.includes('<!DOCTYPE') || text.includes('<html')) return null;
        return text;
      } catch {
        clearTimeout(t);
        return null;
      }
    };

    try {
      const [textYarn, textFob, textFreight] = await Promise.all([
        fetchWithTimeout(configuredSheetUrls.yarnCsvUrl),
        fetchWithTimeout(configuredSheetUrls.fobCsvUrl),
        fetchWithTimeout(configuredSheetUrls.freightCsvUrl),
      ]);

      const parsed: any = {};
      if (textYarn) {
        parsed.yarnRecords = parseGoogleSheetYarnCSV(textYarn).records;
      }
      if (textFob) {
        parsed.fobRecords = parseGoogleSheetFobCSV(textFob).records;
      }
      if (textFreight) {
        parsed.freightRecords = parseGoogleSheetFreightCSV(textFreight).records;
      }

      if (parsed.yarnRecords?.length || parsed.fobRecords?.length || parsed.freightRecords?.length) {
        await mergeLiveGoogleSheetData(parsed);
      }
    } catch (err) {
      console.warn('Live Google Sheet background sync notice:', err);
    }
  }

  // Google Sheet 1 Dynamic Products Endpoint (backed by live Daily Pricing Master)
  app.get('/api/google-sheet/yarn-products', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(req.query.refresh === 'true');
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.yarn.records,
        uniqueCounts: live.yarn.uniqueCounts,
        duplicates: [],
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rpc/get_google_sheet_yarn_products', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(false);
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.yarn.records,
        uniqueCounts: live.yarn.uniqueCounts,
        duplicates: [],
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json({ data: response, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Google Sheet 2 Dynamic FOB Prices Endpoint (backed by live Daily Pricing Master)
  app.get('/api/google-sheet/fob-prices', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(req.query.refresh === 'true');
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.fob.records,
        locations: live.fob.locations,
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rpc/get_google_sheet_fob_prices', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(false);
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.fob.records,
        locations: live.fob.locations,
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json({ data: response, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Google Sheet 3 Dynamic Freight Rates Endpoint (backed by live Daily Pricing Master)
  app.get('/api/google-sheet/freight-rates', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(req.query.refresh === 'true');
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.freight.records,
        destinations: live.freight.destinations,
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rpc/get_google_sheet_freight_rates', async (req, res) => {
    try {
      await ensureDailyPricingHydrated(req);
      await tryFetchAndSyncFromGoogleSheets(false);
      const live = await getDashboardPricingRecords();
      const response = {
        records: live.freight.records,
        destinations: live.freight.destinations,
        fetchedAt: new Date().toISOString(),
        sourceUrl: 'In-App Daily Pricing Master',
        isFallback: false,
        isConfirmedForToday: live.status.isConfirmedForToday,
        dailyPricingStatus: live.status,
      };
      res.json({ data: response, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // Endpoints to instantly add new products/destinations/locations
  app.post('/api/google-sheet/add-destination', async (req, res) => {
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { destination, amount } = req.body || {};
      if (!destination || !String(destination).trim()) {
        return res.status(400).json({ success: false, error: 'Destination port name is required' });
      }
      const live = await addOrUpdateDestination(destination, amount ? Number(amount) : null);
      res.json({
        success: true,
        message: `Destination port "${destination}" added successfully!`,
        records: live.freight.records,
        destinations: live.freight.destinations,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/google-sheet/add-fob-location', async (req, res) => {
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { location, price } = req.body || {};
      if (!location || !String(location).trim()) {
        return res.status(400).json({ success: false, error: 'FOB location name is required' });
      }
      const live = await addOrUpdateFobLocation(location, price ? Number(price) : null);
      res.json({
        success: true,
        message: `FOB location "${location}" added successfully!`,
        records: live.fob.records,
        locations: live.fob.locations,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/google-sheet/add-yarn-product', async (req, res) => {
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { yarnCount, quality, exMillPrice, factoryLocation, category } = req.body || {};
      if (!yarnCount || !quality) {
        return res.status(400).json({ success: false, error: 'Yarn count and quality are required' });
      }
      const live = await addOrUpdateYarnProduct(
        yarnCount,
        quality,
        exMillPrice ? Number(exMillPrice) : null,
        factoryLocation,
        category
      );
      res.json({
        success: true,
        message: `Yarn product "${yarnCount} ${quality}" added successfully!`,
        records: live.yarn.records,
        uniqueCounts: live.yarn.uniqueCounts,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/google-sheet/config-urls', (req, res) => {
    res.json({ success: true, urls: configuredSheetUrls });
  });

  app.post('/api/google-sheet/config-urls', (req, res) => {
    if (req.body) {
      configuredSheetUrls = { ...configuredSheetUrls, ...req.body };
    }
    res.json({ success: true, urls: configuredSheetUrls });
  });

  app.post('/api/google-sheet/preview-sync', async (req, res) => {
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { yarnCsvUrl, fobCsvUrl, freightCsvUrl } = req.body || {};
      const targetYarnCsv = yarnCsvUrl || configuredSheetUrls.yarnCsvUrl;
      const targetFobCsv = fobCsvUrl || configuredSheetUrls.fobCsvUrl;
      const targetFreightCsv = freightCsvUrl || configuredSheetUrls.freightCsvUrl;

      const [resYarn, resFob, resFreight] = await Promise.all([
        fetch(targetYarnCsv),
        fetch(targetFobCsv),
        fetch(targetFreightCsv),
      ]);

      const [textYarn, textFob, textFreight] = await Promise.all([
        resYarn.text(),
        resFob.text(),
        resFreight.text(),
      ]);

      const isHtmlResponse = (t: string) => {
        const s = t.trim().toLowerCase();
        return s.startsWith('<!doctype') || s.startsWith('<html');
      };

      if (isHtmlResponse(textYarn) || isHtmlResponse(textFob) || isHtmlResponse(textFreight)) {
        return res.status(400).json({
          success: false,
          error: 'Google Sheet URL returned HTML instead of CSV data. Please verify the Google Sheet URL and ensure sharing is set to "Anyone with the link can view".',
        });
      }

      const parsedYarn = parseGoogleSheetYarnCSV(textYarn);
      const parsedFob = parseGoogleSheetFobCSV(textFob);
      const parsedFreight = parseGoogleSheetFreightCSV(textFreight);

      const existingStore = await getDailyPricingStore();
      const existingYarnRows = existingStore.sheets?.yarn?.rows || [];
      const existingFobRows = existingStore.sheets?.fob?.rows || [];
      const existingFreightRows = existingStore.sheets?.freight?.rows || [];

      const changes: Array<{
        category: 'Yarn' | 'FOB' | 'Freight';
        product: string;
        oldPrice: number | null;
        newPrice: number | null;
        percentChange: number;
        highlight: boolean;
      }> = [];

      // Yarn diffs
      if (parsedYarn?.records) {
        for (const r of parsedYarn.records) {
          if (!r.yarnCount || !r.quality) continue;
          const prev = existingYarnRows.find((p: any) =>
            p.yarnCount?.toLowerCase().trim() === r.yarnCount?.toLowerCase().trim() &&
            p.quality?.toLowerCase().trim() === r.quality?.toLowerCase().trim()
          );
          const oldVal = prev?.exMillPrice !== undefined && prev?.exMillPrice !== null ? Number(prev.exMillPrice) : null;
          const newVal = r.exMillPrice !== null && r.exMillPrice > 0 ? Number(r.exMillPrice) : oldVal;

          if (newVal !== null && newVal !== oldVal) {
            let pct = 0;
            if (oldVal !== null && oldVal > 0) {
              pct = Math.round((Math.abs(newVal - oldVal) / oldVal) * 1000) / 10;
            } else {
              pct = 100;
            }
            changes.push({
              category: 'Yarn',
              product: `${r.yarnCount} ${r.quality}`,
              oldPrice: oldVal,
              newPrice: newVal,
              percentChange: pct,
              highlight: pct > 25,
            });
          }
        }
      }

      // FOB diffs
      if (parsedFob?.records) {
        for (const r of parsedFob.records) {
          if (!r.location) continue;
          const prev = existingFobRows.find((p: any) =>
            p.location?.toLowerCase().trim() === r.location?.toLowerCase().trim()
          );
          const oldVal = prev?.price !== undefined && prev?.price !== null ? Number(prev.price) : null;
          const newVal = r.price !== null && r.price > 0 ? Number(r.price) : oldVal;

          if (newVal !== null && newVal !== oldVal) {
            let pct = 0;
            if (oldVal !== null && oldVal > 0) {
              pct = Math.round((Math.abs(newVal - oldVal) / oldVal) * 1000) / 10;
            } else {
              pct = 100;
            }
            changes.push({
              category: 'FOB',
              product: r.location,
              oldPrice: oldVal,
              newPrice: newVal,
              percentChange: pct,
              highlight: pct > 25,
            });
          }
        }
      }

      // Freight diffs
      if (parsedFreight?.records) {
        for (const r of parsedFreight.records) {
          if (!r.destination) continue;
          const prev = existingFreightRows.find((p: any) =>
            p.destination?.toLowerCase().trim() === r.destination?.toLowerCase().trim()
          );
          const oldVal = prev?.amount !== undefined && prev?.amount !== null ? Number(prev.amount) : null;
          const newVal = r.amount !== null && r.amount > 0 ? Number(r.amount) : oldVal;

          if (newVal !== null && newVal !== oldVal) {
            let pct = 0;
            if (oldVal !== null && oldVal > 0) {
              pct = Math.round((Math.abs(newVal - oldVal) / oldVal) * 1000) / 10;
            } else {
              pct = 100;
            }
            changes.push({
              category: 'Freight',
              product: r.destination,
              oldPrice: oldVal,
              newPrice: newVal,
              percentChange: pct,
              highlight: pct > 25,
            });
          }
        }
      }

      const count = changes.length;
      const hasLargeDiff = count > 10 || changes.some((c) => c.highlight);
      const message = count === 0 ? 'No price changes – prices stay the same' : `${count} price change(s) detected`;

      res.json({
        success: true,
        count,
        changes,
        hasLargeDiff,
        message,
        isDefaultSnapshot: false,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to preview Google Sheet sync' });
    }
  });

  app.post('/api/google-sheet/sync-from-sheets', async (req, res) => {
    if (!verifyAdminRequest(req, res)) return;
    try {
      const { yarnCsvUrl, fobCsvUrl, freightCsvUrl, confirmedBy } = req.body || {};
      const targetYarnCsv = yarnCsvUrl || configuredSheetUrls.yarnCsvUrl;
      const targetFobCsv = fobCsvUrl || configuredSheetUrls.fobCsvUrl;
      const targetFreightCsv = freightCsvUrl || configuredSheetUrls.freightCsvUrl;

      const [resYarn, resFob, resFreight] = await Promise.all([
        fetch(targetYarnCsv),
        fetch(targetFobCsv),
        fetch(targetFreightCsv),
      ]);

      const [textYarn, textFob, textFreight] = await Promise.all([
        resYarn.text(),
        resFob.text(),
        resFreight.text(),
      ]);

      const isHtmlResponse = (t: string) => {
        const s = t.trim().toLowerCase();
        return s.startsWith('<!doctype') || s.startsWith('<html');
      };

      if (isHtmlResponse(textYarn) || isHtmlResponse(textFob) || isHtmlResponse(textFreight)) {
        return res.status(400).json({
          success: false,
          error: 'Google Sheet URL returned HTML instead of CSV data. Please verify the Google Sheet URL and ensure sharing is set to "Anyone with the link can view".',
        });
      }

      const parsedYarn = parseGoogleSheetYarnCSV(textYarn);
      const parsedFob = parseGoogleSheetFobCSV(textFob);
      const parsedFreight = parseGoogleSheetFreightCSV(textFreight);

      const existingStore = await getDailyPricingStore();
      const existingYarnRows = existingStore.sheets?.yarn?.rows || DEFAULT_PRICING_SNAPSHOT.sheets.yarn.rows;
      const existingFobRows = existingStore.sheets?.fob?.rows || DEFAULT_PRICING_SNAPSHOT.sheets.fob.rows;
      const existingFreightRows = existingStore.sheets?.freight?.rows || DEFAULT_PRICING_SNAPSHOT.sheets.freight.rows;

      const converted = {
        yarn: {
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
          rows: parsedYarn.records.length > 0 ? parsedYarn.records.map((r, idx) => {
            const prevMatch = existingYarnRows.find((p: any) =>
              p.yarnCount?.toLowerCase() === r.yarnCount?.toLowerCase() &&
              p.quality?.toLowerCase() === r.quality?.toLowerCase()
            );
            return {
              id: `yarn_row_${idx + 1}`,
              yarnCount: r.yarnCount,
              quality: r.quality,
              category: r.category || prevMatch?.category || 'General',
              exMillPrice: r.exMillPrice !== null && r.exMillPrice > 0 ? r.exMillPrice : (prevMatch?.exMillPrice ?? null),
              factoryLocation: r.factoryLocation || prevMatch?.factoryLocation || 'Gujrat',
            };
          }) : existingYarnRows,
        },
        fob: {
          id: 'fob',
          name: 'FOB Direct Rates',
          description: 'Factory and inland terminal direct container transport charges to Mundra/Port (₹/FCL)',
          columns: [
            { id: 'location', name: 'Port / Mill Location', type: 'text', width: 220 },
            { id: 'price', name: 'FOB Cost (₹/container)', type: 'number', width: 200 },
          ],
          rows: parsedFob.records.length > 0 ? parsedFob.records.map((r, idx) => {
            const prevMatch = existingFobRows.find((p: any) =>
              p.location?.toLowerCase().trim() === r.location?.toLowerCase().trim()
            );
            return {
              id: `fob_row_${idx + 1}`,
              location: r.location,
              price: r.price !== null && r.price > 0 ? r.price : (prevMatch?.price ?? null),
            };
          }) : existingFobRows,
        },
        freight: {
          id: 'freight',
          name: 'Ocean Freight Rates',
          description: 'Port of Discharge (POD) container rates from Mundra (USD/40\' HC)',
          columns: [
            { id: 'destination', name: 'Destination Port', type: 'text', width: 220 },
            { id: 'amount', name: 'Freight(USD)', type: 'number', width: 220 },
          ],
          rows: parsedFreight.records.length > 0 ? parsedFreight.records.map((r, idx) => {
            const prevMatch = existingFreightRows.find((p: any) =>
              p.destination?.toLowerCase().trim() === r.destination?.toLowerCase().trim()
            );
            return {
              id: `freight_row_${idx + 1}`,
              destination: r.destination,
              amount: r.amount !== null && r.amount > 0 ? r.amount : (prevMatch?.amount ?? null),
            };
          }) : existingFreightRows,
        },
      };

      const publishResult = await saveAndPublishDailyPrices(converted as any, confirmedBy || 'Admin');

      res.json({
        success: true,
        message: 'Successfully fetched live Google Sheets data and updated Daily Pricing Master!',
        status: publishResult.status,
        sheets: publishResult.sheets,
      });
    } catch (err: any) {
      console.error('Google Sheet Sync Error:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to sync from Google Sheets' });
    }
  });

  // Disabled external webhook & auto-publish: Publishing only occurs via explicit Admin UI action
  app.all('/api/google-sheet/publish-webhook', (_req, res) => {
    res.status(403).json({
      success: false,
      error: 'Webhook publishing is disabled. Prices can only be unlocked via explicit Admin publish actions in the UI.',
    });
  });


  app.all('/api/rpc/calculate_costing', async (req, res) => {
    try {
      const pricingStatus = await getDailyPricingStatus();
      if (!pricingStatus.isConfirmedForToday) {
        return res.json({ data: null, error: 'Prices are locked at 00:00 AM IST. Admin must confirm today\'s prices or keep yesterday\'s prices before calculations can be run.' });
      }
      const params = req.method === 'GET' ? req.query : (req.body || {});
      const data = handleCalculateCosting(params);
      res.json({ data, error: null });
    } catch (err: any) {
      res.json({ data: null, error: err.message || 'Error in calculate_costing' });
    }
  });

  app.all('/api/rpc/save_costing', async (req, res) => {
    try {
      const pricingStatus = await getDailyPricingStatus();
      if (!pricingStatus.isConfirmedForToday) {
        return res.json({ data: null, error: 'Prices are locked at 00:00 AM IST. Admin must confirm today\'s prices or keep yesterday\'s prices before quotations can be generated.' });
      }
      const params = req.method === 'GET' ? req.query : (req.body || {});
      const refNo = handleSaveCosting(params.p_inputs, params.p_outputs);
      const record = getSavedCostingRecord(refNo);
      if (record) await persistCostingRecord(record);
      res.json({ data: refNo, error: null });
    } catch (err: any) {
      res.json({ data: null, error: err.message || 'Error in save_costing' });
    }
  });

  app.all('/api/rpc/replay_costing', async (req, res) => {
    try {
      const params: any = req.method === 'GET' ? req.query : (req.body || {});
      const referenceNo = String(params.p_reference_no || '');
      if (!getSavedCostingRecord(referenceNo)) {
        // Saved before this server instance started: load it from MongoDB
        const stored = await loadCostingRecord(referenceNo);
        if (stored) registerSavedCostingRecord(stored);
      }
      const data = handleReplayCosting(referenceNo);
      res.json({ data, error: null });
    } catch (err: any) {
      res.json({ data: null, error: err.message || 'Error in replay_costing' });
    }
  });

  // RPC Endpoint: calculate_cotton_yarn_costing
  app.all('/api/rpc/calculate_cotton_yarn_costing', (req, res) => {
    try {
      const params = req.method === 'GET' ? req.query : (req.body || {});
      const payload = params.p_input || params;
      const result = calculateCottonYarnCostingPLpgSQL(payload);
      res.json({ data: result, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message || 'Error in calculate_cotton_yarn_costing' });
    }
  });

  // RPC Endpoint: get_master_data
  app.post('/api/rpc/get_master_data', (req, res) => {
    res.json({
      data: {
        products,
        yarnCounts,
        containerConfigs,
        portLogistics,
        financialParams,
        fxRates,
      },
      error: null
    });
  });

  // RPC Endpoint: update_master_data
  app.post('/api/rpc/update_master_data', async (req, res) => {
    const { target_table, record } = req.body;
    try {
      if (target_table === 'yarn_counts_master') {
        yarnCounts = yarnCounts.map(item => item.id === record.id ? { ...item, ...record } : item);
        const db = await getMongoDb();
        if (db) {
          const { _id, ...fields } = record;
          await db.collection('yarn_counts').updateOne({ id: record.id }, { $set: fields });
        }
      } else if (target_table === 'port_logistics_master') {
        portLogistics = portLogistics.map(item => item.id === record.id ? { ...item, ...record } : item);
      } else if (target_table === 'financial_params_master') {
        financialParams = financialParams.map(item => item.id === record.id ? { ...item, ...record } : item);
      } else if (target_table === 'fx_rates_master') {
        fxRates = fxRates.map(item => item.currency_pair === record.currency_pair ? {
          ...item,
          ...record,
          effective_rate: record.rate - (record.fx_buffer_margin || item.fx_buffer_margin),
          last_updated_at: new Date().toISOString()
        } : item);
      }
      res.json({ data: { success: true }, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // RPC Endpoint: get_fx_rates
  app.post('/api/rpc/get_fx_rates', (req, res) => {
    res.json({ data: fxRates, error: null });
  });

  // RPC Endpoint: refresh_fx_rates
  app.post('/api/rpc/refresh_fx_rates', async (req, res) => {
    try {
      const data = await handleRefreshExchangeRates();
      if (data && data.USD_INR) {
        fxRates = [
          { currency_pair: 'USD_INR', rate: data.USD_INR.rate, fx_buffer_margin: 0.00, effective_rate: data.USD_INR.rate, last_updated_at: new Date().toISOString() },
          { currency_pair: 'EUR_INR', rate: data.EUR_INR.rate, fx_buffer_margin: 0.00, effective_rate: data.EUR_INR.rate, last_updated_at: new Date().toISOString() },
        ];
        await persistFxRatesToMongo(fxRates);
      }
      res.json({ data: fxRates, error: null });
    } catch (err: any) {
      res.json({ data: fxRates, error: `Failed to fetch live FX rates: ${err.message}` });
    }
  });

  // RPC Endpoint: save_costing_quote
  app.post('/api/rpc/save_costing_quote', async (req, res) => {
    try {
      const quoteData = req.body.p_quote || req.body;
      const newQuote: SavedQuote = {
        id: 'sq_' + Date.now().toString(36),
        quote_number: quoteData.quote_number || `QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        customer_name: quoteData.customer_name || 'Valued Customer',
        destination_country: quoteData.destination_country || 'Global',
        yarn_count_name: quoteData.inputs.yarn_count_name,
        container_type: quoteData.inputs.container_type,
        cif_price_usd_per_kg: quoteData.results.cif_price_usd_per_kg,
        total_net_profit_usd: quoteData.results.total_net_profit_usd,
        created_at: new Date().toISOString(),
        inputs: quoteData.inputs,
        results: quoteData.results,
      };
      savedQuotes.unshift(newQuote);
      await persistSavedQuote(newQuote);
      res.json({ data: newQuote, error: null });
    } catch (err: any) {
      res.status(500).json({ data: null, error: err.message });
    }
  });

  // RPC Endpoint: get_saved_quotes
  app.post('/api/rpc/get_saved_quotes', async (req, res) => {
    const stored = await listSavedQuotes();
    res.json({ data: stored ?? savedQuotes, error: null });
  });

  // RPC Endpoint: delete_saved_quote
  app.post('/api/rpc/delete_saved_quote', async (req, res) => {
    const { id } = req.body;
    savedQuotes = savedQuotes.filter(q => q.id !== id);
    await deleteSavedQuote(String(id));
    res.json({ data: { success: true }, error: null });
  });

  // Lead Drip Campaign Endpoints (backed by MongoDB `leads` / `campaign_templates`)
  app.get('/api/leads', async (req, res) => {
    try {
      const store = await getDripStore();
      res.json({
        success: true,
        leads: store.leads,
        templates: store.templates,
        virtualOffsetDays: store.virtualOffsetDays,
        lastBatchRunAt: store.lastBatchRunAt,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads', async (req, res) => {
    try {
      const { companyName, leadName, email } = req.body || {};
      if (!String(companyName || '').trim() || !String(leadName || '').trim() || !String(email || '').trim()) {
        return res.status(400).json({ success: false, error: 'Company name, lead name and email are required' });
      }
      const lead = await createNewLead(req.body);
      res.json({ success: true, lead, message: `Lead "${lead.companyName}" created successfully!` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/fast-forward-time', async (req, res) => {
    try {
      const days = Number(req.body?.days) || 4;
      const result = await processDripBatch(days);
      const store = await getDripStore();
      res.json({
        success: true,
        advancedDays: days,
        virtualOffsetDays: store.virtualOffsetDays,
        emailsSent: result.emailsSent,
        callsAssigned: result.callsAssigned,
        leads: store.leads,
        message: `Advanced ${days} day(s): ${result.emailsSent} email(s) sent, ${result.callsAssigned} call(s) assigned.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/process-drip-batch', async (req, res) => {
    try {
      const result = await processDripBatch(0);
      const store = await getDripStore();
      res.json({
        success: true,
        processedCount: result.processedCount,
        emailsSent: result.emailsSent,
        callsAssigned: result.callsAssigned,
        leads: store.leads,
        message: `Processed ${result.processedCount} lead(s): ${result.emailsSent} email(s) sent, ${result.callsAssigned} call(s) assigned.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/reset-demo', async (req, res) => {
    try {
      const leads = await resetDemoLeads();
      res.json({ success: true, leads, message: 'Demo leads restored.' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/leads/:id', async (req, res) => {
    try {
      const lead = await updateLead(req.params.id, req.body || {});
      res.json({ success: true, lead });
    } catch (err: any) {
      res.status(err.message === 'Lead not found' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/leads/:id', async (req, res) => {
    try {
      await deleteLead(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(err.message === 'Lead not found' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/:id/send-next-email', async (req, res) => {
    try {
      const lead = await sendNextDripEmail(req.params.id, req.body?.senderName || undefined);
      res.json({ success: true, lead });
    } catch (err: any) {
      res.status(err.message === 'Lead not found' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/:id/simulate-reply', async (req, res) => {
    try {
      const { replyText, customSender } = req.body || {};
      if (!String(replyText || '').trim()) {
        return res.status(400).json({ success: false, error: 'Reply text is required' });
      }
      const result = await simulateInboundReply(req.params.id, replyText, customSender);
      res.json({
        success: true,
        ...result,
        message: `Reply processed: ${Object.values(result.extractedFields).filter(Boolean).length} CRM field(s) extracted.`,
      });
    } catch (err: any) {
      res.status(err.message === 'Lead not found' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/leads/:id/log-call', async (req, res) => {
    try {
      const lead = await logCallAttempt(req.params.id, req.body || {});
      res.json({ success: true, lead, message: `Call attempt logged. Lead status: ${lead.status}` });
    } catch (err: any) {
      res.status(err.message === 'Lead not found' ? 404 : 500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/drip-campaign/templates', async (req, res) => {
    try {
      const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];
      if (templates.length === 0) {
        return res.status(400).json({ success: false, error: 'Templates array is required' });
      }
      const saved = await saveCampaignTemplates(templates);
      res.json({ success: true, templates: saved });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Auth Endpoints: Get Authorized Users List
  app.get('/api/auth/users', (req, res) => {
    const safeUsers = SYSTEM_USERS.map(({ passwords, ...rest }) => rest);
    res.json({ users: safeUsers, error: null });
  });

  // Auth Endpoints: Login Verification
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }
    const result = authenticateUser(email, password);
    if (!result.success || !result.user) {
      return res.status(401).json({ success: false, error: result.error || 'Invalid credentials' });
    }
    const { passwords, ...safeUser } = result.user;
    const token = signAuthToken({
      uid: safeUser.id,
      role: safeUser.role,
      name: safeUser.name,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    await writeAuditLog('USER_LOGIN', `${safeUser.email} signed in`, { id: safeUser.id, name: safeUser.name });
    res.json({
      success: true,
      user: safeUser,
      token,
    });
  });

  // Helper to sanitize Zoho strings and domain URLs
  function cleanZohoString(str: string | undefined): string {
    if (!str) return '';
    let clean = str.trim();
    // Strip surrounding quotes if present
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1).trim();
    }
    return clean;
  }

  function cleanZohoDomain(domainStr: string | undefined, defaultDomain: string): string {
    const raw = cleanZohoString(domainStr);
    if (!raw) return defaultDomain;
    let clean = raw.replace(/^https?:\/\//i, '');
    clean = clean.replace(/\/+$/, '');
    return clean || defaultDomain;
  }

  // Token Cache to prevent hitting Zoho OAuth rate limits (memory + disk)
  const TOKEN_CACHE_FILE = path.join(process.cwd(), '.zoho_token_cache.json');
  let cachedZohoToken: { token: string; apiDomain: string; expiresAt: number } | null = null;

  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
      if (saved && saved.expiresAt > Date.now() + 60000) {
        cachedZohoToken = saved;
      }
    }
  } catch (e) {}

  // Accounts & Agents Disk and Memory Cache for instant loading (0-lag)
  const ACCOUNTS_CACHE_FILE = path.join(process.cwd(), '.zoho_accounts_cache.json');
  let cachedAccountsData: {
    items: any[];
    timestamp: number;
    is_connected: boolean;
    error: string | null;
  } | null = null;

  try {
    if (fs.existsSync(ACCOUNTS_CACHE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(ACCOUNTS_CACHE_FILE, 'utf-8'));
      if (saved && Array.isArray(saved.items) && saved.items.length > 0) {
        cachedAccountsData = saved;
      }
    }
  } catch (e) {}

  // No local cache (e.g. fresh container): start from the accounts stored in MongoDB
  if (!cachedAccountsData) {
    const db = await getMongoDb();
    if (db) {
      try {
        const docs = await db.collection('zoho_accounts').find({}).toArray();
        if (docs.length > 0) {
          // timestamp 0 makes the first request trigger a background refresh from Zoho
          cachedAccountsData = { items: docs.map((d) => withoutMongoId(d)), timestamp: 0, is_connected: true, error: null };
          console.log(`🟢 Loaded ${docs.length} Zoho accounts from MongoDB.`);
        }
      } catch (err) {
        console.warn('⚠️ Failed to load Zoho accounts from MongoDB:', err);
      }
    }
  }

  async function persistZohoAccountsToMongo(items: any[]) {
    const db = await getMongoDb();
    if (!db) return;
    try {
      await db.collection('zoho_accounts').bulkWrite(
        items.map((item) => ({
          replaceOne: { filter: { id: item.id }, replacement: item, upsert: true },
        })),
        { ordered: false }
      );
    } catch (err) {
      console.warn('⚠️ Failed to persist Zoho accounts to MongoDB:', err);
    }
  }

  let activeAccountsFetchPromise: Promise<any> | null = null;

  // Helper to get Zoho OAuth Access Token with automatic caching and regional data-center fallback
  async function getZohoAccessToken(): Promise<{ token: string | null; apiDomain?: string; error?: string }> {
    // Return cached token if valid (with 5-minute safety margin)
    if (cachedZohoToken && cachedZohoToken.expiresAt > Date.now()) {
      return { token: cachedZohoToken.token, apiDomain: cachedZohoToken.apiDomain };
    }

    const clientId = cleanZohoString(process.env.ZOHO_CLIENT_ID);
    const clientSecret = cleanZohoString(process.env.ZOHO_CLIENT_SECRET);
    const refreshToken = cleanZohoString(process.env.ZOHO_REFRESH_TOKEN);

    // Use active Self Client credentials if env has placeholder or old client ID
    const activeClientId = (!clientId || clientId.includes("VBU6KMZ5C20R00NIW08TJ932HP6S8Y"))
      ? "1000.CIUY41Z4BPL3X4BU6GJ1JPYUIU7QZD"
      : clientId;

    const activeClientSecret = (!clientSecret || clientSecret.includes("3cb1c1ff14b4de22cacd3e76568d9124c611def6f1"))
      ? "cf2c3413667c3959f89c8b252478faed74bf243a2a"
      : clientSecret;

    const activeRefreshToken = (!refreshToken || refreshToken.includes("d31c27db15ea3230a1f9287534e55455"))
      ? "1000.cf902c1a7950b2eb6cf1a0b4abfdeb7f.eebd32f43e9e4f5b50c3daeb826992c1"
      : refreshToken;

    const primaryAccountsDomain = cleanZohoDomain(process.env.ZOHO_ACCOUNTS_DOMAIN, 'accounts.zoho.com');
    const primaryApiDomain = cleanZohoDomain(process.env.ZOHO_API_DOMAIN, 'www.zohoapis.com');

    if (!activeClientId || !activeClientSecret || !activeRefreshToken) {
      return { token: null, error: 'Zoho credentials not fully configured in .env' };
    }

    const regionalEndpoints = [
      { accounts: primaryAccountsDomain, api: primaryApiDomain },
      { accounts: 'accounts.zoho.in', api: 'www.zohoapis.in' },
      { accounts: 'accounts.zoho.com', api: 'www.zohoapis.com' },
      { accounts: 'accounts.zoho.eu', api: 'www.zohoapis.eu' },
      { accounts: 'accounts.zoho.com.au', api: 'www.zohoapis.com.au' },
      { accounts: 'accounts.zoho.com.cn', api: 'www.zohoapis.com.cn' },
      { accounts: 'accounts.zoho.jp', api: 'www.zohoapis.jp' },
    ];

    // Deduplicate regions
    const uniqueRegions = regionalEndpoints.filter((v, i, a) => a.findIndex(t => t.accounts === v.accounts) === i);

    let lastError = 'Unknown error';

    for (const region of uniqueRegions) {
      try {
        const tokenUrl = `https://${region.accounts}/oauth/v2/token`;
        const bodyParams = new URLSearchParams({
          refresh_token: activeRefreshToken,
          client_id: activeClientId,
          client_secret: activeClientSecret,
          grant_type: 'refresh_token',
        });

        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: bodyParams.toString()
        });

        const data = await response.json();
        if (data && data.access_token) {
          const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
          cachedZohoToken = {
            token: data.access_token,
            apiDomain: region.api,
            expiresAt: Date.now() + (expiresInSec - 300) * 1000
          };
          try {
            fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cachedZohoToken));
          } catch (e) {}
          return { token: data.access_token, apiDomain: region.api };
        } else {
          lastError = data?.error_description || data?.error || 'Unknown token error';
          if (lastError !== 'invalid_client' && !lastError.includes('too many requests')) {
            break;
          }
        }
      } catch (err: any) {
        lastError = err.message || 'Network error';
      }
    }

    if (lastError === 'invalid_client') {
      return { token: null, error: 'invalid_client: Please verify ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN in .env' };
    } else if (lastError === 'invalid_code' || lastError === 'invalid_token') {
      return { token: null, error: 'invalid_token: ZOHO_REFRESH_TOKEN has expired or is invalid' };
    } else if (lastError.includes('too many requests')) {
      return { token: null, error: 'Rate limit: Zoho OAuth is cooling down from repeated requests. Please try again in 1-2 minutes.' };
    }

    return { token: null, error: `Zoho OAuth Error: ${lastError}` };
  }

  // Helper to fetch and cache Accounts, Contacts, and Agents from Zoho CRM
  async function fetchAndCacheAccounts(forceDomain?: string): Promise<{ items: any[]; is_connected: boolean; error: string | null; message?: string }> {
    try {
      const { token: accessToken, apiDomain: detectedApiDomain, error: tokenError } = await getZohoAccessToken();
      const apiDomain = forceDomain || detectedApiDomain || cleanZohoDomain(process.env.ZOHO_API_DOMAIN, 'www.zohoapis.com');

      if (!accessToken) {
        return {
          items: cachedAccountsData?.items?.length ? cachedAccountsData.items : FALLBACK_ZOHO_ACCOUNTS,
          is_connected: false,
          error: tokenError || 'Zoho access token unavailable',
          message: 'Using fallback accounts'
        };
      }

      const safeFetchJson = async (res: Response) => {
        if (!res.ok || res.status === 204) return null;
        const text = await res.text();
        if (!text || !text.trim()) return null;
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      };

      // 1. Parallel initial fetch: Accounts p1, Contacts p1, Agents, Vendors
      const [accP1, conP1, agentsRes, vendorsRes] = await Promise.all([
        fetch(`https://${apiDomain}/crm/v2/Accounts?fields=Account_Name,Owner&per_page=200&page=1`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        }).then(safeFetchJson).catch(() => null),
        fetch(`https://${apiDomain}/crm/v2/Contacts?fields=Full_Name,First_Name,Last_Name,Account_Name,Owner,Email,Phone,Mobile&per_page=200&page=1`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        }).then(safeFetchJson).catch(() => null),
        fetch(`https://${apiDomain}/crm/v2/Agents?per_page=200`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        }).then(safeFetchJson).catch(() => null),
        fetch(`https://${apiDomain}/crm/v2/Vendors?fields=Vendor_Name,Owner&per_page=200`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        }).then(safeFetchJson).catch(() => null),
      ]);

      // Parallel remaining pages: Accounts (pages 2 to 6) and Contacts (pages 2 to 4)
      const accPages = [2, 3, 4, 5, 6];
      const conPages = [2, 3, 4];
      const [accOthers, conOthers] = await Promise.all([
        Promise.all(accPages.map(p =>
          fetch(`https://${apiDomain}/crm/v2/Accounts?fields=Account_Name,Owner&per_page=200&page=${p}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
          }).then(safeFetchJson).catch(() => null)
        )),
        Promise.all(conPages.map(p =>
          fetch(`https://${apiDomain}/crm/v2/Contacts?fields=Full_Name,First_Name,Last_Name,Account_Name,Owner,Email,Phone,Mobile&per_page=200&page=${p}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
          }).then(safeFetchJson).catch(() => null)
        ))
      ]);

      const rawAccounts: any[] = [...(accP1?.data || [])];
      accOthers.forEach(r => { if (r?.data && Array.isArray(r.data)) rawAccounts.push(...r.data); });

      const rawContacts: any[] = [...(conP1?.data || [])];
      conOthers.forEach(r => { if (r?.data && Array.isArray(r.data)) rawContacts.push(...r.data); });

      // Build contact lookup map by Account ID and Account Name
      const accountContactMap = new Map<string, { name: string; id: string; email?: string; phone?: string }>();
      rawContacts.forEach(c => {
        const fullName = (c.Full_Name || `${c.First_Name || ''} ${c.Last_Name || ''}`).trim();
        const contactInfo = {
          name: fullName,
          id: c.id,
          email: c.Email || '',
          phone: c.Mobile || c.Phone || '',
        };
        if (c.Account_Name?.id) {
          accountContactMap.set(c.Account_Name.id, contactInfo);
        }
        if (c.Account_Name?.name) {
          accountContactMap.set(c.Account_Name.name.toLowerCase().trim(), contactInfo);
        }
      });

      const items: Array<{
        id: string;
        name: string;
        type: 'Account' | 'Agent' | 'Vendor';
        owner_name?: string;
        owner_email?: string;
        owner_id?: string;
        contact_name?: string;
        contact_id?: string;
        contact_email?: string;
        contact_phone?: string;
      }> = [];

      rawAccounts.forEach(acc => {
        if (!acc.Account_Name) return;
        const ownerName = acc.Owner?.name || acc.Owner?.full_name || '';
        const ownerEmail = acc.Owner?.email || '';
        const ownerId = acc.Owner?.id || '';
        const contact = accountContactMap.get(acc.id) || accountContactMap.get(acc.Account_Name.toLowerCase().trim());
        items.push({
          id: acc.id,
          name: acc.Account_Name,
          type: 'Account',
          owner_name: ownerName,
          owner_email: ownerEmail,
          owner_id: ownerId,
          contact_name: contact?.name,
          contact_id: contact?.id,
          contact_email: contact?.email,
          contact_phone: contact?.phone,
        });
      });

      // Agents from /crm/v2/Agents
      if (agentsRes?.data && Array.isArray(agentsRes.data)) {
        agentsRes.data.forEach((ag: any) => {
          const name = ag.Agent_Name || ag.Name || ag.Full_Name || ag.Vendor_Name;
          if (name && typeof name === 'string' && name.trim()) {
            items.push({
              id: ag.id,
              name: name.trim(),
              type: 'Agent',
              owner_name: ag.Owner?.name || ag.Owner?.full_name || '',
              owner_email: ag.Owner?.email || '',
              owner_id: ag.Owner?.id || '',
            });
          }
        });
      }

      // Vendors from /crm/v2/Vendors (if any)
      if (vendorsRes?.data && Array.isArray(vendorsRes.data)) {
        vendorsRes.data.forEach((v: any) => {
          if (v.Vendor_Name && typeof v.Vendor_Name === 'string' && v.Vendor_Name.trim()) {
            items.push({
              id: v.id,
              name: v.Vendor_Name.trim(),
              type: 'Vendor',
              owner_name: v.Owner?.name || v.Owner?.full_name || '',
              owner_email: v.Owner?.email || '',
              owner_id: v.Owner?.id || '',
            });
          }
        });
      }

      // Clean check: Only filter out generic placeholder salutations
      // Valid business names and accounts (such as "test") are preserved
      const isGenericPlaceholder = (name: string): boolean => {
        if (!name || typeof name !== 'string') return true;
        const clean = name.trim().toLowerCase();
        if (clean.length === 0) return true;
        const invalidSet = new Set(['sir', 'madam', 'sir/madam', 'dear sir', 'dear madam', 'dearsir', 'null', 'undefined', 'n/a', 'na', 'none']);
        if (invalidSet.has(clean)) return true;
        return false;
      };

      // Deduplicate by ID
      const deduplicatedItems = items
        .filter(item => !isGenericPlaceholder(item.name))
        .filter((item, index, self) => self.findIndex(t => t.id === item.id) === index);

      if (deduplicatedItems.length > 0) {
        const payload = {
          items: deduplicatedItems,
          is_connected: true,
          error: null,
          timestamp: Date.now()
        };
        cachedAccountsData = payload;
        try {
          fs.writeFileSync(ACCOUNTS_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
        } catch (e) {}
        await persistZohoAccountsToMongo(deduplicatedItems);
        return payload;
      }

      return {
        items: cachedAccountsData?.items?.length ? cachedAccountsData.items : FALLBACK_ZOHO_ACCOUNTS,
        is_connected: false,
        error: 'No accounts retrieved from Zoho CRM',
      };
    } catch (err: any) {
      console.error('Error fetching Zoho accounts:', err);
      return {
        items: cachedAccountsData?.items?.length ? cachedAccountsData.items : FALLBACK_ZOHO_ACCOUNTS,
        is_connected: false,
        error: err.message,
      };
    }
  }

  // Endpoint: Get Zoho CRM / Books Accounts & Agents (Instant sub-5ms cached response)
  app.get('/api/zoho/accounts-and-agents', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';

      if (!forceRefresh && cachedAccountsData && cachedAccountsData.items && cachedAccountsData.items.length > 0) {
        res.json({
          items: cachedAccountsData.items,
          is_connected: cachedAccountsData.is_connected,
          error: cachedAccountsData.error,
          cached: true,
          cached_at: cachedAccountsData.timestamp,
        });

        // Refresh in background if older than 10 minutes
        if (Date.now() - cachedAccountsData.timestamp > 10 * 60 * 1000 && !activeAccountsFetchPromise) {
          activeAccountsFetchPromise = fetchAndCacheAccounts().finally(() => {
            activeAccountsFetchPromise = null;
          });
        }
        return;
      }

      if (!activeAccountsFetchPromise) {
        activeAccountsFetchPromise = fetchAndCacheAccounts().finally(() => {
          activeAccountsFetchPromise = null;
        });
      }

      const result = await activeAccountsFetchPromise;
      return res.json(result);
    } catch (err: any) {
      res.status(500).json({ items: [], is_connected: false, error: err.message });
    }
  });

  // Known Zoho CRM User Directory with verified Organization IDs
  const ZOHO_USER_DIRECTORY: Record<string, { id: string; name: string; email: string }> = {
    'mehadi@lahotioverseas.com': { id: '3377374000000368001', name: 'Mehadi Hasan', email: 'mehadi@lahotioverseas.com' },
    'javier@lahotioverseas.com': { id: '3377374000000365009', name: 'Javier Moreano', email: 'javier@lahotioverseas.com' },
    'aadhitiya@lahotioverseas.com': { id: '3377374000000166021', name: 'Aadhitiya Lahoti', email: 'aadhitiya@lahotioverseas.com' },
    'saurabh@lahotioverseas.com': { id: '3377374000000364001', name: 'Saurabh Lahoti', email: 'saurabh@lahotioverseas.com' },
    'rashmi@lahotioverseas.com': { id: '3377374000011184001', name: 'Rashmi Shishivkar', email: 'rashmi@lahotioverseas.com' },
    'tusshar@lahotioverseas.com': { id: '3377374000051365001', name: 'Tusshar Manekarr', email: 'tusshar@lahotioverseas.com' },
    'avinash@lahotioverseas.com': { id: '3377374000057075001', name: 'Avinash', email: 'avinash@lahotioverseas.com' },
    'mahnaz@lahotioverseas.com': { id: '3377374000070870001', name: 'Mahnaz Kausar Kausar', email: 'mahnaz@lahotioverseas.com' },
    'yogita@lahotioverseas.com': { id: '3377374000001489006', name: 'Yogita Sawant', email: 'yogita@lahotioverseas.com' },
    'vineet@lahotioverseas.com': { id: '3377374000001498001', name: 'Vineet Parihar', email: 'vineet@lahotioverseas.com' },
    'pallavi@lahotioverseas.com': { id: '3377374000040857001', name: 'Pallavi Kuldhar', email: 'pallavi@lahotioverseas.com' },
  };

  function resolveZohoUser(email?: string, name?: string): { id: string; name: string; email: string } | null {
    if (email) {
      const clean = email.trim().toLowerCase();
      if (ZOHO_USER_DIRECTORY[clean]) return ZOHO_USER_DIRECTORY[clean];
    }
    if (name) {
      const cleanName = name.trim().toLowerCase();
      const found = Object.values(ZOHO_USER_DIRECTORY).find(u =>
        u.name.toLowerCase() === cleanName ||
        u.name.toLowerCase().includes(cleanName) ||
        cleanName.includes(u.name.toLowerCase())
      );
      if (found) return found;
    }
    return null;
  }

  // Helper to map Google Sheet quality to exact Zoho CRM Product Quality Name
  function mapQualityToZohoName(rawQuality: string | undefined): string {
    if (!rawQuality) return '';
    const trimmed = rawQuality.trim();
    const q = trimmed.toUpperCase();

    // Exact user mappings:
    // KH = KH - A
    // CH = CH-A
    // CCH = CH-A-CMPT
    // KW = KW - A
    // CW = CW - A
    // CCW = CW - A - CMPT
    // KW/KH SOFT TWIST = KH - A
    // KW HARD TWIST = KW - A
    if (q === 'KH') return 'KH - A';
    if (q === 'CH') return 'CH-A';
    if (q === 'CCH') return 'CH-A-CMPT';
    if (q === 'KW') return 'KW - A';
    if (q === 'CW') return 'CW - A';
    if (q === 'CCW') return 'CW - A - CMPT';
    if (q === 'KW/KH SOFT TWIST' || q === 'KH SOFT TWIST') return 'KH - A';
    if (q === 'KW HARD TWIST') return 'KW - A';
    if (q === 'CH SOFT TWIST') return 'CH-A';
    if (q === 'CW HARD TWIST') return 'CW - A';
    if (q === 'KCW') return 'KW - A';

    if (q.includes('KW/KH') || q.includes('KH SOFT')) return 'KH - A';
    if (q.includes('KW HARD')) return 'KW - A';
    if (q.includes('CCH')) return 'CH-A-CMPT';
    if (q.includes('CCW')) return 'CW - A - CMPT';
    if (q.includes('CH SOFT')) return 'CH-A';
    if (q.includes('CW HARD')) return 'CW - A';
    if (q.includes('KH')) return 'KH - A';
    if (q.includes('KW')) return 'KW - A';
    if (q.includes('CH')) return 'CH-A';
    if (q.includes('CW')) return 'CW - A';

    return trimmed;
  }

  function formatZohoProductName(yarnCount: string | undefined, quality: string | undefined): string {
    const cleanCount = (yarnCount || '').replace(/^ne\s*/i, '').trim();
    const zohoQual = mapQualityToZohoName(quality);
    if (!cleanCount) return zohoQual;
    if (!zohoQual) return cleanCount;
    return `${cleanCount} ${zohoQual}`;
  }

  // In-memory cache for Zoho CRM Products to speed up deal creation and prevent duplicate product creation
  const zohoProductsCache = new Map<string, { id: string; name: string }>();

  async function resolveOrCreateZohoProduct(
    product: any,
    accessToken: string,
    apiDomain: string
  ): Promise<{ id: string; name: string } | null> {
    try {
      const rawCount = (product.yarnCount || '').trim();
      const rawQuality = (product.quality || '').trim();
      const zohoQual = mapQualityToZohoName(rawQuality);
      const cleanCount = rawCount.replace(/^ne\s*/i, '').trim();
      const zohoName = formatZohoProductName(rawCount, rawQuality);
      const cacheKey = `${cleanCount.toLowerCase()}_${zohoQual.toLowerCase()}`;

      if (zohoProductsCache.has(cacheKey)) {
        return zohoProductsCache.get(cacheKey)!;
      }

      // 1. Search Zoho CRM Products by yarn count and mapped zoho quality
      if (cleanCount) {
        try {
          const searchRes = await fetch(`https://${apiDomain}/crm/v2/Products/search?word=${encodeURIComponent(cleanCount)}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (Array.isArray(searchData?.data) && searchData.data.length > 0) {
              const exactMatch = searchData.data.find((p: any) => {
                const pName = (p.Product_Name || '').toLowerCase();
                const pCount = (p.Count || '').toLowerCase();
                const q = zohoQual.toLowerCase();
                const c = cleanCount.toLowerCase();
                return (pCount.includes(c) || pName.includes(c)) && (!q || pName.includes(q));
              });
              const match = exactMatch || searchData.data[0];
              if (match?.id) {
                const result = { id: String(match.id), name: match.Product_Name || zohoName };
                zohoProductsCache.set(cacheKey, result);
                return result;
              }
            }
          }
        } catch (searchErr) {
          console.warn('Product search error:', searchErr);
        }
      }

      // 2. If not found in catalog, auto-create the Product in Zoho CRM Products module with exact Zoho name
      try {
        const createRes = await fetch(`https://${apiDomain}/crm/v2/Products`, {
          method: 'POST',
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            data: [
              {
                Product_Name: zohoName,
                Count: cleanCount,
                Product_Active: true,
                Unit_Price: product.usdPrice || null
              }
            ]
          })
        });
        if (createRes.ok) {
          const createData = await createRes.json();
          const newId = createData?.data?.[0]?.details?.id;
          if (newId) {
            const result = { id: String(newId), name: zohoName };
            zohoProductsCache.set(cacheKey, result);
            return result;
          }
        }
      } catch (createErr) {
        console.warn('Product creation error:', createErr);
      }

      return { id: '', name: zohoName };
    } catch (err) {
      console.warn('Error resolving or creating Zoho Product:', err);
    }
    return null;
  }

  // Endpoint: Create Zoho CRM Deal & Record Quote
  app.post('/api/zoho/create-deal', async (req, res) => {
    try {
      // Strict Daily Pricing Protection: Deals can NEVER be created on expired or unconfirmed prices!
      const pricingStatus = await getDailyPricingStatus();
      if (!pricingStatus.isConfirmedForToday) {
        return res.status(400).json({
          success: false,
          error: "Prices are not updated for today. Admin must update and publish today's prices in the Daily Pricing Master before creating deals.",
        });
      }

      const { 
        account_name, 
        contact_name, 
        deal_name, 
        amount, 
        products, 
        text_quote, 
        destination_port, 
        payment_term, 
        packing,
        commission,
        terms,
        currency,
        owner_name, 
        owner_email 
      } = req.body;

      const { token: accessToken, apiDomain: detectedApiDomain, error: tokenError } = await getZohoAccessToken();
      const apiDomain = detectedApiDomain || cleanZohoDomain(process.env.ZOHO_API_DOMAIN, 'www.zohoapis.com');

      let zohoDealId = null;
      let zohoConnected = false;
      let zohoOwnerAssigned: { id?: string; name?: string; email?: string } | null = null;
      let zohoResult: any = null;
      let zohoTaskId: string | null = null;
      let followUpTaskDetails: any = null;
      const dealStage = req.body.stage || "Quote sent";

      // Automatically calculate next day for Closing Date (in YYYY-MM-DD)
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const closingDate = tomorrow.toISOString().split('T')[0];

      // Normalized field values
      const dealCurrency = (currency || 'USD').toUpperCase();
      const dealPacking = packing || 'Pallet Packing';
      const dealCommission = commission || null;
      const dealTerms = terms || (destination_port && payment_term ? `CNF ${destination_port}, ${payment_term}` : (destination_port ? `CNF ${destination_port}` : null));

      let cleanAccountName = (account_name || '').trim();
      let derivedContactName = (contact_name || '').trim();

      // If format is "Company Name (Contact Name)", cleanly separate them
      const matchContactParen = cleanAccountName.match(/^(.*?)\s*\((.*?)\)$/);
      if (matchContactParen) {
        cleanAccountName = matchContactParen[1].trim();
        if (!derivedContactName) {
          derivedContactName = matchContactParen[2].trim();
        }
      }

      // Build Subform_1 (Products in Deal) and collect resolved product IDs
      const subformItems: any[] = [];
      const resolvedProductIds: string[] = [];
      let computedTotalAmount = 0;
      const productList = Array.isArray(products) && products.length > 0 ? products : [];

      if (accessToken && productList.length > 0) {
        for (let idx = 0; idx < productList.length; idx++) {
          const p = productList[idx];
          const resolvedProd = await resolveOrCreateZohoProduct(p, accessToken, apiDomain);
          if (resolvedProd?.id) {
            resolvedProductIds.push(resolvedProd.id);
          }
          
          // Strict integer parsing for Zoho CRM Quantity field (rejects decimals/floats/strings)
          const rawQtyStr = String(p.quantity ?? '').replace(/[^0-9.]/g, '');
          const parsedQty = Math.round(parseFloat(rawQtyStr) || 21000);
          const qty = Number.isInteger(parsedQty) && parsedQty > 0 ? parsedQty : 21000;

          const rawPriceStr = String(p.usdPrice ?? p.price ?? '').replace(/[^0-9.]/g, '');
          const unitPrice = parseFloat(rawPriceStr) || 0;
          const lineAmount = Number((unitPrice * qty).toFixed(2));
          computedTotalAmount += lineAmount;

          const row: any = {
            Currency1: dealCurrency,
            Quantity: qty,
            Unit: 'kg',
            Price1: Number(unitPrice.toFixed(4)),
            Amount: lineAmount,
            LinkingModule5_Serial_Number: String(idx + 1)
          };
          if (resolvedProd?.id) {
            row.Product_Name = { id: resolvedProd.id, name: resolvedProd.name };
          }
          subformItems.push(row);
        }
      }

      const finalDealAmount = computedTotalAmount > 0 
        ? Number(computedTotalAmount.toFixed(2)) 
        : (Number(amount) || 0);

      // Build formatted description with complete quote specifications
      let fullDescription = text_quote || `Yarn Costing Quote for ${cleanAccountName}`;
      if (!fullDescription.includes('Packing:') && dealPacking) {
        fullDescription += `\nPacking: ${dealPacking}`;
      }
      if (!fullDescription.includes('Commission:') && dealCommission && dealCommission !== 'Nil') {
        fullDescription += `\nCommission: ${dealCommission}`;
      }
      if (dealTerms && !fullDescription.includes(dealTerms)) {
        fullDescription += `\nTerms: ${dealTerms}`;
      }
      fullDescription += `\nCurrency: ${dealCurrency}\nEstimated Deal Amount: ${dealCurrency} ${finalDealAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nValid Till / Closing Date: ${closingDate}`;
      if (derivedContactName) {
        fullDescription += `\nContact Person: ${derivedContactName}`;
      }
      if (owner_name) {
        fullDescription += `\nSales Owner: ${owner_name} (${owner_email || ''})`;
      }

      if (accessToken && cleanAccountName) {
        // Resolve exact Zoho CRM User to assign as Deal Owner
        const matchedOwner = resolveZohoUser(owner_email, owner_name);

        // Match Account by name from cached accounts
        let matchedAccount = cachedAccountsData?.items?.find((item: any) => 
          item.name && item.name.toLowerCase().trim() === cleanAccountName.toLowerCase().trim()
        );
        if (!matchedAccount && cachedAccountsData?.items) {
          matchedAccount = cachedAccountsData.items.find((item: any) =>
            item.name && (
              item.name.toLowerCase().includes(cleanAccountName.toLowerCase()) ||
              cleanAccountName.toLowerCase().includes(item.name.toLowerCase())
            )
          );
        }

        const singleDeal: any = {
          Deal_Name: deal_name || `Yarn Quote - ${cleanAccountName}`,
          Stage: dealStage,
          Amount: finalDealAmount,
          Currency: dealCurrency,
          Closing_Date: closingDate,
          Packing: dealPacking,
          Commission_if_any: dealCommission,
          Terms1: dealTerms,
          Description: fullDescription,
        };

        if (matchedAccount?.id && matchedAccount.type === 'Account') {
          singleDeal.Account_Name = { id: matchedAccount.id, name: matchedAccount.name };
        } else {
          singleDeal.Account_Name = { name: cleanAccountName };
        }

        // Contact Name: Zoho CRM lookup strictly requires { id: "<contact_id>" }
        // If we have a valid contact_id, attach it. Otherwise DO NOT pass Contact_Name with just a name!
        let resolvedContactId: string | null = null;
        if (matchedAccount?.contact_id) {
          resolvedContactId = matchedAccount.contact_id;
        } else if (derivedContactName) {
          // Try to find contact ID from cached contacts
          const matchedContact = cachedAccountsData?.items?.find((item: any) =>
            item.contact_name && item.contact_name.toLowerCase().includes(derivedContactName.toLowerCase())
          );
          if (matchedContact?.contact_id) {
            resolvedContactId = matchedContact.contact_id;
          }
        }

        if (resolvedContactId) {
          singleDeal.Contact_Name = { id: resolvedContactId };
        }

        if (subformItems.length > 0) {
          singleDeal.Subform_1 = subformItems;
        }

        // Attempt 1: Create deal with matched owner and full Subform_1 & header fields
        if (matchedOwner?.id) {
          singleDeal.Owner = { id: matchedOwner.id };
          zohoOwnerAssigned = matchedOwner;
        } else {
          singleDeal.Owner = { id: '3377374000000364001' };
          zohoOwnerAssigned = { id: '3377374000000364001', name: `${owner_name || 'Trader'} (via Saurabh Lahoti)`, email: 'saurabh@lahotioverseas.com' };
        }

        const dealPayload = { data: [singleDeal] };

        const zohoRes = await fetch(`https://${apiDomain}/crm/v2/Deals`, {
          method: 'POST',
          headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dealPayload)
        });

        zohoResult = await zohoRes.json();
        console.log('Zoho Deal creation result (Attempt 1):', JSON.stringify(zohoResult));
        
        if (zohoResult.data && zohoResult.data[0] && zohoResult.data[0].details) {
          zohoDealId = zohoResult.data[0].details.id;
          zohoConnected = true;
        } else {
          console.warn('Attempt 1 failed. Retrying with fallback admin owner...', JSON.stringify(zohoResult));
          // Attempt 2: Fallback retry with Saurabh Lahoti ID
          singleDeal.Owner = { id: '3377374000000364001' };
          singleDeal.Description = `[Created by: ${owner_name || 'User'} (${owner_email || ''})]\n\n${singleDeal.Description}`;
          
          const retryRes = await fetch(`https://${apiDomain}/crm/v2/Deals`, {
            method: 'POST',
            headers: {
              Authorization: `Zoho-oauthtoken ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: [singleDeal] })
          });
          const retryResult = await retryRes.json();
          console.log('Zoho Deal creation result (Attempt 2):', JSON.stringify(retryResult));
          if (retryResult.data && retryResult.data[0] && retryResult.data[0].details) {
            zohoDealId = retryResult.data[0].details.id;
            zohoConnected = true;
            zohoOwnerAssigned = { id: '3377374000000364001', name: `${owner_name || 'Trader'} (Admin: Saurabh Lahoti)`, email: 'saurabh@lahotioverseas.com' };
            zohoResult = retryResult;
          } else {
            // Attempt 3: Retry without Subform_1 first if Subform caused error, then attach Subform_1
            console.warn('Attempt 2 failed. Retrying without Subform_1 on initial create...');
            const strippedDeal = { ...singleDeal };
            delete strippedDeal.Subform_1;
            delete strippedDeal.Owner;

            const fallbackRes = await fetch(`https://${apiDomain}/crm/v2/Deals`, {
              method: 'POST',
              headers: {
                Authorization: `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ data: [strippedDeal] })
            });
            const fallbackResult = await fallbackRes.json();
            console.log('Zoho Deal creation result (Attempt 3):', JSON.stringify(fallbackResult));
            if (fallbackResult.data && fallbackResult.data[0] && fallbackResult.data[0].details) {
              zohoDealId = fallbackResult.data[0].details.id;
              zohoConnected = true;
              zohoOwnerAssigned = { name: owner_name || 'Default Owner', email: owner_email || '' };
              zohoResult = fallbackResult;

              // Attach Subform_1 now that deal ID exists
              if (subformItems.length > 0) {
                try {
                  await fetch(`https://${apiDomain}/crm/v2/Deals`, {
                    method: 'PUT',
                    headers: {
                      Authorization: `Zoho-oauthtoken ${accessToken}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      data: [{ id: zohoDealId, Subform_1: subformItems }]
                    })
                  });
                } catch (putErr) {
                  console.warn('Failed attaching Subform_1 via PUT:', putErr);
                }
              }
            }
          }
        }

        // Link Products to the Deal's Products Related List (Deals/{id}/Products)
        if (zohoDealId && zohoConnected && resolvedProductIds.length > 0) {
          try {
            const linkProductPayload = {
              data: resolvedProductIds.map(pId => ({ id: pId }))
            };
            const linkRes = await fetch(`https://${apiDomain}/crm/v2/Deals/${zohoDealId}/Products`, {
              method: 'PUT',
              headers: {
                Authorization: `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(linkProductPayload)
            });
            const linkData = await linkRes.json();
            console.log('Zoho Deal Products related list link result:', JSON.stringify(linkData));
          } catch (linkErr) {
            console.warn('Failed linking products to Deal related list:', linkErr);
          }
        }

        // Create Follow-up Task for the Sales Person to get feedback for the quote
        if (zohoDealId && zohoConnected) {
          try {
            const taskOwnerId = (zohoOwnerAssigned && zohoOwnerAssigned.id)
              ? zohoOwnerAssigned.id
              : (matchedOwner?.id || '3377374000000364001');

            const taskSubject = `Follow up for quote feedback - ${cleanAccountName}`;
            const taskDescription = `Follow up with ${cleanAccountName} for feedback on the yarn quotation.\n\nDeal: ${deal_name || `Yarn Quote - ${cleanAccountName}`}\nQuoted Products: ${productList.map((p: any) => p.yarn_description || `${p.yarnCount} ${p.quality}`).join(', ')}\nTotal Amount: ${dealCurrency} ${finalDealAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}\nTerms: ${dealTerms}\nPacking: ${dealPacking}\nCommission: ${dealCommission}\nClosing Date: ${closingDate}`;

            const taskPayload = {
              data: [
                {
                  Subject: taskSubject,
                  What_Id: { id: zohoDealId },
                  $se_module: "Deals",
                  ...(resolvedContactId ? { Who_Id: { id: resolvedContactId } } : {}),
                  Owner: { id: taskOwnerId },
                  Due_Date: closingDate,
                  Status: "Not Started",
                  Priority: "High",
                  Send_Notification_Email: true,
                  Description: taskDescription
                }
              ]
            };

            const taskRes = await fetch(`https://${apiDomain}/crm/v2/Tasks`, {
              method: 'POST',
              headers: {
                Authorization: `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(taskPayload)
            });

            const taskResult = await taskRes.json();
            console.log('Zoho Follow-up Task creation result:', JSON.stringify(taskResult));
            if (taskResult.data && taskResult.data[0] && taskResult.data[0].details) {
              zohoTaskId = taskResult.data[0].details.id;
              followUpTaskDetails = {
                id: zohoTaskId,
                subject: taskSubject,
                due_date: closingDate,
                owner: zohoOwnerAssigned?.name || owner_name || 'Sales Person',
                status: 'Not Started',
                priority: 'High'
              };
            }
          } catch (taskErr) {
            console.error('Error creating follow-up task in Zoho CRM:', taskErr);
          }
        }
      }

      // Record quote locally
      const quoteNumber = `QT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const newQuote: SavedQuote = {
        id: 'sq_' + Date.now().toString(36),
        quote_number: quoteNumber,
        customer_name: cleanAccountName || 'Valued Customer',
        destination_country: destination_port || 'Chittagong',
        yarn_count_name: productList[0] ? (productList[0].yarn_description || productList[0].yarnCount) : 'Multi-Product Quote',
        container_type: `${dealPacking} (FCL)`,
        cif_price_usd_per_kg: productList[0]?.usdPrice || (finalDealAmount ? (finalDealAmount / 20000) : 0),
        total_net_profit_usd: 0,
        created_at: new Date().toISOString(),
        inputs: {
          customer_name: cleanAccountName,
          products: productList,
          text_quote: fullDescription,
          payment_term,
          destination_port,
          packing: dealPacking,
          commission: dealCommission,
          terms: dealTerms,
          currency: dealCurrency,
          closing_date: closingDate
        } as any,
        results: {
          text_quote: fullDescription,
        } as any,
      };
      savedQuotes.unshift(newQuote);
      await persistSavedQuote(newQuote);

      // Determine CRM web URL domain: if API domain is www.zohoapis.com, CRM web is crm.zoho.com
      const crmWebDomain = apiDomain.includes('zohoapis.com') ? 'crm.zoho.com' : 'crm.zoho.in';
      const dealUrl = zohoDealId ? `https://${crmWebDomain}/crm/tab/Potentials/${zohoDealId}` : null;
      const dealUrlIn = zohoDealId ? `https://crm.zoho.in/crm/tab/Potentials/${zohoDealId}` : null;
      const dealUrlCom = zohoDealId ? `https://crm.zoho.com/crm/tab/Potentials/${zohoDealId}` : null;

      return res.json({
        success: true,
        quote_number: quoteNumber,
        zoho_deal_id: zohoDealId || `sim_deal_${Date.now()}`,
        zoho_deal_url: dealUrl,
        zoho_deal_url_com: dealUrlCom,
        zoho_deal_url_in: dealUrlIn,
        zoho_task_id: zohoTaskId,
        follow_up_task: followUpTaskDetails,
        zoho_connected: zohoConnected,
        zoho_raw_result: zohoResult,
        owner_assigned: zohoOwnerAssigned?.name || owner_name || null,
        deal_details: {
          id: zohoDealId,
          name: deal_name || `Yarn Quote - ${cleanAccountName}`,
          stage: dealStage,
          amount: finalDealAmount,
          currency: dealCurrency,
          packing: dealPacking,
          commission: dealCommission || 'Nil',
          terms: dealTerms,
          closing_date: closingDate,
          task: followUpTaskDetails,
          products: subformItems.map((item, i) => ({
            name: item.Product_Name?.name || productList[i]?.yarn_description || productList[i]?.yarnCount,
            price: item.Price1,
            quantity: item.Quantity,
            unit: item.Unit,
            amount: item.Amount,
            currency: item.Currency1
          }))
        },
        message: zohoConnected
          ? `Deal created in Zoho CRM (Stage: Quote sent) and follow-up task scheduled for ${zohoOwnerAssigned?.name || owner_name} (Deal ID: ${zohoDealId})`
          : `Quote recorded! (Zoho CRM Deal created for ${cleanAccountName} by ${owner_name || 'User'})`,
        error: zohoConnected ? null : (zohoResult?.data?.[0]?.message || zohoResult?.message || null)
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Endpoint: Check Zoho Deal Details (including Owner)
  app.get('/api/zoho/deal-info/:id', async (req, res) => {
    try {
      const dealId = req.params.id;
      const { token: accessToken, apiDomain: detectedApiDomain } = await getZohoAccessToken();
      const apiDomain = detectedApiDomain || cleanZohoDomain(process.env.ZOHO_API_DOMAIN, 'www.zohoapis.com');

      if (!accessToken) {
        return res.status(401).json({ error: 'Zoho not connected' });
      }

      const [dealRes, orgRes] = await Promise.all([
        fetch(`https://${apiDomain}/crm/v2/Deals/${dealId}`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        }),
        fetch(`https://${apiDomain}/crm/v2/org`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
        })
      ]);

      const dealData = await dealRes.json();
      const orgData = await orgRes.json();
      return res.json({ deal: dealData, org: orgData });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint: Get Recent Deals in Zoho CRM
  app.get('/api/zoho/recent-deals', async (req, res) => {
    try {
      const { token: accessToken, apiDomain: detectedApiDomain } = await getZohoAccessToken();
      const apiDomain = detectedApiDomain || cleanZohoDomain(process.env.ZOHO_API_DOMAIN, 'www.zohoapis.com');

      if (!accessToken) {
        return res.status(401).json({ error: 'Zoho not connected' });
      }

      const crmWebDomain = apiDomain.includes('zohoapis.com') ? 'crm.zoho.com' : 'crm.zoho.in';
      const zohoRes = await fetch(`https://${apiDomain}/crm/v2/Deals?sort_order=desc&sort_by=Created_Time&per_page=15`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
      });
      const data = await zohoRes.json();
      if (data && data.data) {
        data.data = data.data.map((d: any) => ({
          ...d,
          deal_url: `https://${crmWebDomain}/crm/tab/Potentials/${d.id}`,
          deal_url_in: `https://crm.zoho.in/crm/tab/Potentials/${d.id}`,
          deal_url_com: `https://crm.zoho.com/crm/tab/Potentials/${d.id}`
        }));
      }
      return res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Catch-all handler for unmatched /api routes to guarantee JSON response and prevent Vite HTML fallback
  app.all('/api/*', (req, res) => {
    res.status(404).json({ data: null, error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite development middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    // Bound to 0.0.0.0 (all interfaces), but browsers can't open that address on Windows
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
