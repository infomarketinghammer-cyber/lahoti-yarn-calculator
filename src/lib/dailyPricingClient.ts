import { DailyPricingStatus, DailyPricingStoreData, SpreadsheetSheetData } from '../types';
import { getStoredAuthToken } from './authData';

const DAILY_PRICING_CACHE_KEY = 'lahoti_daily_pricing_cache_v1';

async function parseJsonResponse(res: Response, fallbackError: string) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  // If content-type isn't explicitly json, attempt parsing text body as JSON before failing
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    throw new Error(`${fallbackError} (Server returned ${res.status}: ${preview || 'Non-JSON'})`);
  }
}

export function getTodayDateStringIST(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    // Exact fallback using IST offset (+5.5 hours = +19800000 ms)
    const istDate = new Date(Date.now() + 5.5 * 3600 * 1000);
    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Recomputes the lock from the confirmation date so a cached or late response can
 * never unlock prices after 12:00 AM IST. "Today" is the later of the server's date
 * and this browser's IST date, so a slow client clock cannot extend the unlock either.
 */
export function resolvePricingStatus(status: DailyPricingStatus): DailyPricingStatus {
  const clientToday = getTodayDateStringIST();
  const today = status.todayDate && status.todayDate > clientToday ? status.todayDate : clientToday;
  return {
    ...status,
    todayDate: today,
    isConfirmedForToday: Boolean(status.lastConfirmedDate && status.lastConfirmedDate === today),
  };
}

/**
 * Applies an incoming status on top of the current one. Prices stay unlocked until
 * 12:00 AM IST once confirmed: there is no way to withdraw a confirmation during the
 * day, so an incoming "locked" status for the same day can only be stale and is ignored.
 */
export function mergePricingStatus(current: DailyPricingStatus | null, incoming: DailyPricingStatus): DailyPricingStatus {
  const next = resolvePricingStatus(incoming);
  if (current) {
    const cur = resolvePricingStatus(current);
    if (cur.isConfirmedForToday && !next.isConfirmedForToday && cur.todayDate === next.todayDate) {
      return cur;
    }
  }
  return next;
}

export function getMsUntilMidnightIST(): number {
  try {
    const now = new Date();
    const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);

    const nextMidnight = new Date(istDate);
    nextMidnight.setHours(24, 0, 0, 0);

    const msRemaining = nextMidnight.getTime() - istDate.getTime();
    return Math.max(1000, msRemaining);
  } catch {
    return 3600 * 1000;
  }
}

/**
 * Fetch daily pricing with automatic retry and local cache fallback
 * to ensure resilience during dev server restarts and network warmups.
 */
export async function fetchDailyPricing(maxRetries = 2): Promise<DailyPricingStoreData> {
  let lastError: any = null;
  const todayIST = getTodayDateStringIST();

  // Check local cache first so we never lose user's customized rates
  let localCacheData: DailyPricingStoreData | null = null;
  try {
    const cached = localStorage.getItem(DAILY_PRICING_CACHE_KEY);
    if (cached) {
      localCacheData = JSON.parse(cached);
    }
  } catch {}

  const endpoint = '/api/daily-pricing';

  // Admins receive the real prices even while locked (to review them before confirming)
  const requestHeaders: Record<string, string> = { 'Accept': 'application/json' };
  const authToken = getStoredAuthToken();
  if (authToken) requestHeaders['Authorization'] = `Bearer ${authToken}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(endpoint, {
        headers: requestHeaders,
      });

      if (res.ok) {
        const json = await parseJsonResponse(res, 'Failed to parse daily pricing JSON');
        if (json && json.success && json.sheets) {
          const finalStatus = json.status;
          let finalSheets = json.sheets;

          // Self-healing check: If local cache had confirmed status for today but server lost it due to container restart
          if (
            localCacheData &&
            localCacheData.status &&
            localCacheData.status.lastConfirmedDate === todayIST &&
            localCacheData.status.isConfirmedForToday &&
            !finalStatus.isConfirmedForToday
          ) {
            console.log('🔄 Self-healing server daily pricing state from local cache...');
            try {
              const syncHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
              const syncToken = getStoredAuthToken();
              if (syncToken) syncHeaders['Authorization'] = `Bearer ${syncToken}`;
              const syncRes = await fetch('/api/daily-pricing/sync', {
                method: 'POST',
                headers: syncHeaders,
                body: JSON.stringify({
                  confirmedBy: localCacheData.status.lastConfirmedBy,
                  sheets: localCacheData.sheets,
                  lastConfirmedDate: localCacheData.status.lastConfirmedDate,
                  lastConfirmedAt: localCacheData.status.lastConfirmedAt,
                  lastConfirmedBy: localCacheData.status.lastConfirmedBy,
                  confirmationType: localCacheData.status.confirmationType,
                }),
              });
              const syncJson = await syncRes.json();
              if (syncJson && syncJson.success && syncJson.status?.isConfirmedForToday) {
                finalStatus.isConfirmedForToday = true;
                finalStatus.lastConfirmedDate = syncJson.status.lastConfirmedDate;
                finalStatus.lastConfirmedAt = syncJson.status.lastConfirmedAt;
                finalStatus.lastConfirmedBy = syncJson.status.lastConfirmedBy;
                finalStatus.confirmationType = syncJson.status.confirmationType;
                if (syncJson.sheets) {
                  finalSheets = syncJson.sheets;
                }
              }
            } catch {}
          }

          const storeData: DailyPricingStoreData = {
            status: finalStatus,
            sheets: finalSheets,
          };

          try {
            localStorage.setItem(DAILY_PRICING_CACHE_KEY, JSON.stringify(storeData));
          } catch {}

          return storeData;
        } else if (json && json.error) {
          throw new Error(json.error);
        }
      } else {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        // Wait briefly for server ready before retry
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
  }

  // If network / server call failed after retries, return cached data
  if (localCacheData && localCacheData.sheets && localCacheData.status) {
    console.warn('Backend daily pricing temporarily unavailable; serving from local cache:', lastError?.message);
    return { ...localCacheData, status: resolvePricingStatus(localCacheData.status) };
  }

  // If neither server nor cache is available, create baseline fallback so application never crashes
  // Ensure isConfirmedForToday is FALSE so unconfirmed/previous prices are NEVER auto-accepted!
  let todayStr = new Date().toISOString().split('T')[0];
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    todayStr = formatter.format(new Date());
  } catch {}

  console.warn('Falling back to baseline pricing structure (unconfirmed):', lastError?.message);
  return {
    status: {
      isConfirmedForToday: false,
      todayDate: todayStr,
      lastConfirmedDate: null,
      lastConfirmedAt: null,
      lastConfirmedBy: null,
      confirmationType: null,
      totalYarnProducts: 0,
      totalFobLocations: 0,
      totalFreightDestinations: 0,
    },
    sheets: {
      yarn: {
        id: 'yarn',
        name: 'Yarn Products & Mills',
        description: 'Ex-mill yarn rate card with mill locations',
        columns: [
          { id: 'yarnCount', name: 'Yarn Count', type: 'text', width: 140 },
          { id: 'quality', name: 'Quality', type: 'text', width: 140 },
          { id: 'category', name: 'Category', type: 'text', width: 140 },
          { id: 'exMillPrice', name: 'Ex-Mill Price (₹/Kg)', type: 'number', width: 140 },
          { id: 'factoryLocation', name: 'Factory Location', type: 'text', width: 160 },
        ],
        rows: [],
      },
      fob: {
        id: 'fob',
        name: 'FOB Direct Rates',
        description: 'Factory and inland terminal direct container transport charges to Mundra/Port (₹/container)',
        columns: [
          { id: 'location', name: 'Port / Mill Location', type: 'text', width: 260 },
          { id: 'price', name: 'FOB Cost (₹/container)', type: 'number', width: 240 },
        ],
        rows: [],
      },
      freight: {
        id: 'freight',
        name: 'Ocean Freight Rates',
        description: 'Port of Discharge (POD) container rates from Mundra (USD/40\' HC)',
        columns: [
          { id: 'destination', name: 'Destination Port', type: 'text', width: 220 },
          { id: 'amount', name: 'Freight(USD)', type: 'number', width: 220 },
        ],
        rows: [],
      },
    },
  };
}

export async function keepPreviousPricesForToday(
  confirmedBy: string = 'Admin',
  explicitSheets?: {
    yarn: SpreadsheetSheetData;
    fob: SpreadsheetSheetData;
    freight: SpreadsheetSheetData;
  }
): Promise<DailyPricingStatus> {
  // Always include the latest sheets so previous revisions are never lost
  let sheetsToSend = explicitSheets;
  if (!sheetsToSend) {
    try {
      const cached = localStorage.getItem(DAILY_PRICING_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.sheets && (parsed.sheets.yarn?.rows?.length || parsed.sheets.fob?.rows?.length || parsed.sheets.freight?.rows?.length)) {
          sheetsToSend = parsed.sheets;
        }
      }
    } catch {}
  }

  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/daily-pricing/keep-previous', {
    method: 'POST',
    headers,
    body: JSON.stringify({ confirmedBy, sheets: sheetsToSend }),
  });
  const json = await parseJsonResponse(res, 'Failed to confirm previous prices');
  if (!json.success) {
    throw new Error(json.error || 'Failed to confirm previous prices');
  }

  const finalSheets = json.sheets || sheetsToSend;
  try {
    const cached = localStorage.getItem(DAILY_PRICING_CACHE_KEY);
    const prev = cached ? JSON.parse(cached) : {};
    const updated = {
      ...prev,
      status: json.status,
      sheets: finalSheets || prev.sheets,
    };
    localStorage.setItem(DAILY_PRICING_CACHE_KEY, JSON.stringify(updated));
  } catch {}

  // Dispatch custom event for reactive refresh across components
  window.dispatchEvent(new CustomEvent('daily-pricing-updated', { detail: json.status }));
  return json.status;
}

export async function saveAndPublishDailyPrices(
  sheets: {
    yarn: SpreadsheetSheetData;
    fob: SpreadsheetSheetData;
    freight: SpreadsheetSheetData;
  },
  confirmedBy: string = 'Admin'
): Promise<{ status: DailyPricingStatus; sheets: typeof sheets }> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/daily-pricing/save-and-publish', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sheets, confirmedBy }),
  });
  const json = await parseJsonResponse(res, 'Failed to save daily prices');
  if (!json.success) {
    throw new Error(json.error || 'Failed to save and publish daily prices');
  }
  try {
    localStorage.setItem(DAILY_PRICING_CACHE_KEY, JSON.stringify({ status: json.status, sheets: json.sheets }));
  } catch {}
  window.dispatchEvent(new CustomEvent('daily-pricing-updated', { detail: json.status }));
  return { status: json.status, sheets: json.sheets };
}

export async function simulateMidnightReset(): Promise<DailyPricingStatus> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/daily-pricing/simulate-midnight-reset', {
    method: 'POST',
    headers,
  });
  const json = await parseJsonResponse(res, 'Failed to simulate midnight reset');
  if (!json.success) {
    throw new Error(json.error || 'Failed to simulate midnight reset');
  }
  try {
    const cached = localStorage.getItem(DAILY_PRICING_CACHE_KEY);
    const prev = cached ? JSON.parse(cached) : {};
    localStorage.setItem(DAILY_PRICING_CACHE_KEY, JSON.stringify({
      ...prev,
      status: json.status,
    }));
  } catch {}
  window.dispatchEvent(new CustomEvent('daily-pricing-updated', { detail: json.status }));
  return json.status;
}
