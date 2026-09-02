# MedRep Field Companion

A mobile-first, installable Progressive Web App for a single medical representative. The app works from IndexedDB first, so search, editing, and visit logging remain fast and available without a network connection. Changes synchronize with Google Sheets in the background through Google Apps Script.

## Included

- Fast local doctor search and multi-select filters
- Saved filter presets stored privately on the device
- Total, Rx, NRx, hospital, and pharmacy metrics
- Rx highlighting and prescribing products on doctor cards
- Add/edit doctor with sheet-controlled master values
- Doctor profile, recent visit context, and quick visit entry
- Camp-based doctor selection ordered by oldest/never visited
- Automatic linked-pharmacy derivation and live bundle preview
- Sunday, Holiday, and Leave logging without doctor selection
- Local-first save, automatic retry, and short Undo
- Visit history and monthly calendar
- Light/dark mode and installable offline app shell
- Legacy doctor-header adapter without rewriting existing rows

## Data flow

`UI ↔ IndexedDB ↔ background queue ↔ Apps Script ↔ Google Sheets`

The spreadsheet is human-readable and contains only:

- `Doctors`
- `Visits`
- `Settings`
- `Products`

Spreadsheet ID: `1Zg5Rxn6TNskev1EFwwrZI9gWP1mDyifBg6ACI_YTFxU`

## First-time Google setup

The target spreadsheet is currently blank. The included setup safely reuses a blank `Sheet1` as `Doctors`, creates the other three agreed tabs, and adds headers. It never clears an existing row.

1. Open the Apps Script project associated with the web-app deployment.
2. Replace its `Code.gs` with [`gas/Code.gs`](gas/Code.gs).
3. Run `setupSpreadsheet` once in the Apps Script editor and approve access.
4. Update the web-app deployment to a new version, executing as **Me**, with access for **Anyone**.
5. Confirm that opening the `/exec` URL shows `"API is ready."`.

The supplied Apps Script URL is the app’s default. To use a different deployment, copy `.env.example` to `.env` and set `VITE_GAS_WEB_APP_URL`. The URL is configured in one place only.

Because the deployment is public, anyone who obtains its URL can call the API. No Google credentials or private service credentials are placed in the browser.

## Local development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Production check:

```bash
npm run build
```

## Vercel

Push this folder to GitHub, import it in Vercel, and keep the defaults:

- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

If the Apps Script URL changes, add `VITE_GAS_WEB_APP_URL` to the Vercel project’s environment variables and redeploy.

## Master-data behavior

Areas, specialties, camps, potentials, stockists, OP timings, and call schedules come only from the `Settings` sheet. Products come only from the `Products` sheet. The app intentionally provides no Settings screen; edit these lists directly in Google Sheets, then reopen the PWA online.
