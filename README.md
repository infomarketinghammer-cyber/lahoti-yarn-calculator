# Cotton Yarn Export Costing Engine

A production-grade export costing and pricing application for **Cotton Yarn**, featuring a three-panel spreadsheet layout, dynamic FX rate integration, reverse target buyer calculation, and automated system validation.

---

## 📌 Technical & Architecture Deliverables

1. **Express RPC Server (`/server-app.ts`)**: `/api/rpc/*` endpoints (`calculate_costing`, `get_freight_rate`, `get_freight_origins`, `get_freight_destinations`, `get_fob_locations`, `get_quantity_options`, `get_margin_terms`, `save_costing`, `replay_costing`, `refresh_exchange_rates`) plus daily pricing, lead drip campaign and Zoho CRM endpoints.
2. **MongoDB Atlas Persistence (`/src/lib/mongoDbAdapter.ts`)**: Shared connection used by every server store. Collections in `lahoti_costing_db`:
   * `daily_pricing`, `daily_pricing_history` — active pricing sheets and per-day snapshots
   * `costing_records` — saved costings (`kind: 'costing'`) and saved quotes (`kind: 'quote'`)
   * `leads`, `campaign_templates`, `lead_campaign_workflows` — drip campaign
   * `products`, `yarn_counts`, `container_configs`, `exchange_rates` — master data and daily FX
   * `zoho_accounts`, `audit_logs`
3. **React + TypeScript Frontend (`/src/components/ThreePanelCostingView.tsx`)**: Responsive three-panel layout matching spreadsheet workflow.
4. **Validation Page (`/validation`)**: Interactive test matrix running 100% PASS on reference cases, target cases, and system behavior edge cases (tolerance: `0.0001`).

---

## 🔑 Core Formula Specs & Business Logic

### 1. The +$25 Freight Surcharge Rule
* The `$25` surcharge applies to the **raw USD per-FCL ocean freight rate** *before* INR conversion.
* **Formula**:
  $$\text{Selected Freight USD} = \text{Base Freight USD} + 25$$
  $$\text{Freight Cost (₹/kg)} = \frac{\text{Selected Freight USD} \times (\text{USD/INR Rate} + 0.50)}{\text{Qty per FCL (kg)}}$$
* *Example*: Base `$950` + `$25` = `$975`. Converted at ₹95.40 + ₹0.50 = ₹95.90. For 21,000 kg, Freight per kg = ₹4.4525.

### 2. USD/EUR Formula Asymmetry (Intentional)
* The calculation formula between USD and EUR export pricing is intentionally asymmetrical:
  * **USD Price (Full Stack)**: Derived after factoring in net ex-mill, FOB logistics, ocean freight, BCI/Org charges, interest/commission, and trader margin, divided by the unpadded USD/INR exchange rate.
    $$\text{USD Price} = \frac{\text{Total INR Cost Breakdown}}{\text{USD/INR Exchange Rate}}$$
  * **EUR Price (Pre-Freight / Spot Metric)**: Calculated as the INR Ex-Mill cost + Margin divided directly by the EUR/INR exchange rate (independent of ocean freight conversion).
  * If the EUR exchange rate is missing or unavailable, `usd_price` still returns normally while `eur_price` returns `null` without raising errors.

### 3. Biratnagar Row Business Naming Clarification
* In master port logistics data, two distinct "23 tons" entries exist for **Biratnagar**:
  1. **Biratnagar (23 tons - Via Kolkata Port)**: Handles Eastern Nepal transit via Haldia / Kolkata.
  2. **Biratnagar (23 tons - Via Visakhapatnam Port)**: Handles deep-draft vessel transit via Vizag.
* Disambiguated in the master database using explicit location and variant labels (`Biratnagar - Kolkata Route` vs `Biratnagar - Vizag Route`).

### 4. Daily FX Policy & Fallback Mechanics
* **Frequency**: Fetched on server start and whenever an admin refreshes rates.
* **Storage Constraint**: Rates are upserted into `exchange_rates` by `(currency_pair, rate_date)`, so there is exactly one row per currency per day. Subsequent runs on the same day update the existing row.
* **Fallback Behavior**:
  * Primary FX rate source: Live rate from Frankfurter API.
  * Secondary fallback: Most recent stored database exchange rate.
  * Hardcoded emergency fallback: `95.40` for USD/INR and `102.50` for EUR/INR.

---

## 🧪 System Validation Matrix (`/validation`)

Visit `/validation` in the application to execute the live validation suite. All calculations use a strict tolerance of **0.0001**.

| Test Group | Item / Case | Expected | Status |
| :--- | :--- | :--- | :---: |
| **Reference Case** | Selected freight USD | `975` | **PASS** |
| **Reference Case** | DDB & RoDTEP | `16.9` | **PASS** |
| **Reference Case** | Net Ex-Mill | `321.1` | **PASS** |
| **Reference Case** | FOB cost per kg | `3.3333333333` | **PASS** |
| **Reference Case** | Freight per kg | `4.4525` | **PASS** |
| **Reference Case** | Total cost | `328.8858333333` | **PASS** |
| **Reference Case** | USD price | `3.5508638190` | **PASS** |
| **Target Case** | Allowed Ex-Mill | `271.7361666667` | **PASS** |
| **Target Case** | With 5% buffer | `285.3229750000` | **PASS** |
| **Target Case** | After interest | `285.3229750000` | **PASS** |
| **Target Case** | Final target ex-mill | `276.7632857500` | **PASS** |
| **Behaviour** | Freight table stores Chittagong | `950` (not `975`) | **PASS** |
| **Behaviour** | Origin = Mah destination list | `Casablanca, Port Louis` | **PASS** |
| **Behaviour** | Origin = Guj, destination = Santos | Calculation Blocked | **PASS** |
| **Behaviour** | EUR rate missing | `usd_price` returns, `eur_price` null | **PASS** |
| **Behaviour** | Same inputs at USD/INR 90.0 | Freight per kg = `4.2017857143` | **PASS** |
| **Behaviour** | Save then replay after rate change | Replayed output identical to original | **PASS** |
| **Behaviour** | FX refresh run twice same day | 1 row per currency per day | **PASS** |

---

## 🚀 Running the Project

Copy `.env.example` to `.env` and set `MONGODB_URI` (and optionally `MONGODB_DB_NAME`, default `lahoti_costing_db`). Without a reachable MongoDB the server falls back to local JSON files.

```bash
# Install dependencies
npm install

# Start development server on port 3000
npm run dev

# Run linter
npm run lint

# Build production bundle
npm run build
```
