import React, { useState, useEffect } from 'react';
import {
  FileSpreadsheet,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  HelpCircle,
  Globe,
  Ship,
  Anchor,
  Layers,
} from 'lucide-react';
import {
  getSavedGoogleSheetUrls,
  saveGoogleSheetUrls,
} from '../lib/googleSheetService';
import { DailyPricingStatus } from '../types';
import { getStoredAuthToken } from '../lib/authData';
import { SyncPreviewModal, PriceDiffChange } from './SyncPreviewModal';

interface GoogleSheetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: (status: DailyPricingStatus) => void;
}

export const GoogleSheetConfigModal: React.FC<GoogleSheetConfigModalProps> = ({
  isOpen,
  onClose,
  onSyncComplete,
}) => {
  const [urls, setUrls] = useState(() => getSavedGoogleSheetUrls());
  
  // Master Workbook Link
  const [masterUrl, setMasterUrl] = useState(() => urls.yarnViewUrl.split('#')[0].split('?')[0]);
  const [yarnGid, setYarnGid] = useState('177573931');
  const [fobGid, setFobGid] = useState('1401052388');
  const [freightGid, setFreightGid] = useState('1549189100');

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Preview Sync Dialog State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    count: number;
    changes: PriceDiffChange[];
    hasLargeDiff: boolean;
    message: string;
  } | null>(null);
  const [pendingUrls, setPendingUrls] = useState<any>(null);

  useEffect(() => {
    if (isOpen) {
      const saved = getSavedGoogleSheetUrls();
      setUrls(saved);
      const cleanBase = saved.yarnViewUrl.split('#')[0].split('?')[0];
      setMasterUrl(cleanBase);
      setSyncStatus(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleMasterUrlChange = (val: string) => {
    setMasterUrl(val);
    const gidMatch = val.match(/[?&]gid=([0-9]+)/) || val.match(/#gid=([0-9]+)/);
    if (gidMatch && gidMatch[1]) {
      const extractedGid = gidMatch[1];
      if (!yarnGid || yarnGid === '177573931') {
        setYarnGid(extractedGid);
      }
    }
  };

  const handleInitiateSync = async () => {
    setIsSyncing(true);
    setSyncStatus(null);

    try {
      const cleanBase = masterUrl.trim().replace(/\/edit.*$/, '').replace(/\/export.*$/, '');
      const yarnG = yarnGid.trim() || '177573931';
      const fobG = fobGid.trim() || '1401052388';
      const freightG = freightGid.trim() || '1549189100';

      const yarnFull = `${cleanBase}/edit?gid=${yarnG}#gid=${yarnG}`;
      const fobFull = `${cleanBase}/edit?gid=${fobG}#gid=${fobG}`;
      const freightFull = `${cleanBase}/edit?gid=${freightG}#gid=${freightG}`;

      const updated = saveGoogleSheetUrls({
        yarnUrl: yarnFull,
        fobUrl: fobFull,
        freightUrl: freightFull,
      });
      setUrls(updated);
      setPendingUrls(updated);

      // Fetch preview diff first
      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/google-sheet/preview-sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          yarnCsvUrl: updated.yarnCsvUrl,
          fobCsvUrl: updated.fobCsvUrl,
          freightCsvUrl: updated.freightCsvUrl,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data: any = {};
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        const preview = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
        data = { success: false, error: res.status === 403 ? 'Unauthorized: Only Admin users can publish daily prices. Please log in as Admin.' : `Server returned HTTP ${res.status}: ${preview || 'Non-JSON'}` };
      }

      if (res.ok && data.success) {
        setPreviewData({
          count: data.count || 0,
          changes: data.changes || [],
          hasLargeDiff: Boolean(data.hasLargeDiff),
          message: data.message || '',
        });
        setIsPreviewOpen(true);
      } else {
        setSyncStatus({
          type: 'error',
          message: data.error || 'Could not preview Google Sheet sync. Ensure sheet is set to "Anyone with link can view".',
        });
      }
    } catch (err: any) {
      setSyncStatus({
        type: 'error',
        message: err.message || 'Network error while checking Google Sheet.',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmPublish = async () => {
    if (!pendingUrls) return;
    setIsSyncing(true);

    try {
      const token = getStoredAuthToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/google-sheet/sync-from-sheets', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          yarnCsvUrl: pendingUrls.yarnCsvUrl,
          fobCsvUrl: pendingUrls.fobCsvUrl,
          freightCsvUrl: pendingUrls.freightCsvUrl,
          confirmedBy: 'Admin (Master Google Sheet Sync)',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSyncStatus({
          type: 'success',
          message: 'Master Google Sheet sub-sheets synced & published! Daily prices active for today.',
        });
        setIsPreviewOpen(false);
        if (onSyncComplete && data.status) {
          onSyncComplete(data.status);
        }
        window.dispatchEvent(new CustomEvent('daily-pricing-updated', { detail: data.status }));
      } else {
        setSyncStatus({
          type: 'error',
          message: data.error || 'Could not sync from Master Google Sheet.',
        });
        setIsPreviewOpen(false);
      }
    } catch (err: any) {
      setSyncStatus({
        type: 'error',
        message: err.message || 'Network error while syncing Google Sheet.',
      });
      setIsPreviewOpen(false);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden font-sans">
          {/* Modal Header */}
          <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/40">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-base font-bold">Master Google Sheet Link & Sync</h3>
                <p className="text-xs text-slate-400 font-sans">
                  One single Google Sheet link for all sub-sheets (Yarn, FOB, Freight)
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Content */}
          <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
            {/* Informational Banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 space-y-2">
              <div className="flex items-center space-x-2 font-bold text-amber-900">
                <HelpCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>How to give Google Sheet link to the system:</span>
              </div>
              <p className="leading-relaxed text-amber-800">
                1. Open your Master Google Sheet, click <strong>Share</strong> &gt; set permission to <strong>&quot;Anyone with the link can view&quot;</strong>.
              </p>
              <p className="leading-relaxed text-amber-800">
                2. Paste the single Google Sheet URL below. The system fetches prices from the Yarn, FOB, and Freight sub-sheets.
              </p>
            </div>

            {/* Sync Status Banner */}
            {syncStatus && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center space-x-2 ${
                  syncStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border-rose-200'
                }`}
              >
                {syncStatus.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{syncStatus.message}</span>
              </div>
            )}

            {/* SINGLE MASTER GOOGLE SHEET INPUT */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <Globe className="w-4 h-4 text-emerald-600" />
                  <span>Master Google Sheet Workbook Link</span>
                </label>
                <a
                  href={masterUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                >
                  <span>Open Google Sheet ↗</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
              <input
                type="text"
                value={masterUrl}
                onChange={(e) => handleMasterUrlChange(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1wHihQ-COyhDfU8fbzV5Id8oDRrBbiKvjPWvr3bBxzWE/edit"
                className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
              />
            </div>

            {/* SUB-SHEET TAB CONFIGURATION */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                Sub-Sheet Tab IDs (GIDs inside Master Google Sheet)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1 flex items-center space-x-1">
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Yarn Sub-Sheet GID</span>
                  </label>
                  <input
                    type="text"
                    value={yarnGid}
                    onChange={(e) => setYarnGid(e.target.value)}
                    placeholder="177573931"
                    className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1 flex items-center space-x-1">
                    <Anchor className="w-3.5 h-3.5 text-indigo-600" />
                    <span>FOB Sub-Sheet GID</span>
                  </label>
                  <input
                    type="text"
                    value={fobGid}
                    onChange={(e) => setFobGid(e.target.value)}
                    placeholder="1401052388"
                    className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1 flex items-center space-x-1">
                    <Ship className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Freight Sub-Sheet GID</span>
                  </label>
                  <input
                    type="text"
                    value={freightGid}
                    onChange={(e) => setFreightGid(e.target.value)}
                    placeholder="1549189100"
                    className="w-full text-xs font-mono bg-white border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleInitiateSync}
              disabled={isSyncing}
              className="inline-flex items-center space-x-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Checking Sub-sheets...' : 'Preview & Sync Google Sheet'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog Before Publishing */}
      {previewData && (
        <SyncPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          onConfirmPublish={handleConfirmPublish}
          isPublishing={isSyncing}
          count={previewData.count}
          changes={previewData.changes}
          hasLargeDiff={previewData.hasLargeDiff}
          message={previewData.message}
        />
      )}
    </>
  );
};
