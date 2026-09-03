# Google Apps Script setup

The app is already configured for spreadsheet:

`1Zg5Rxn6TNskev1EFwwrZI9gWP1mDyifBg6ACI_YTFxU`

The current web-app deployment is:

`https://script.google.com/macros/s/AKfycbzKQC-4sk9A-7K3C32W5CZwGkvggkp_jM_p93QJTgcgO_TQX9dSyY3KymzcM3HAHOx4/exec`

1. Open the Apps Script project used for the web-app URL.
2. Replace its `Code.gs` with the included `Code.gs`.
3. Run `setupSpreadsheet` once from the editor and approve spreadsheet access.
4. Run `normalizeProductIds` once. This safely converts legacy product IDs to
   `PROD-001`, `PROD-002`, ... and updates matching doctor references.
5. Choose **Deploy → Manage deployments → Edit**.
6. Select **New version**, execute as **Me**, allow access to **Anyone**, and deploy.
7. Keep the resulting `/exec` URL in `.env` as `VITE_GAS_WEB_APP_URL`. If you updated the supplied deployment, its URL normally remains unchanged.

The setup is non-destructive. A blank `Sheet1` is reused as `Doctors`; only the missing agreed tabs and headers are created. Existing rows are not cleared or replaced.

After migration, editing or pasting product rows in the `Products` tab automatically
assigns any missing or invalid IDs in the same `PROD-###` format.
