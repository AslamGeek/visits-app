# Google Apps Script setup

The app is already configured for spreadsheet:

`1Zg5Rxn6TNskev1EFwwrZI9gWP1mDyifBg6ACI_YTFxU`

The current web-app deployment is:

`https://script.google.com/macros/s/AKfycbzQItrxiYszeoHIoXC07uhnmiYanvVRwvSoz3QdMuWYU-9jUaoo8mL6Bg2mG3bpwNb8/exec`

1. Open the Apps Script project used for the web-app URL.
2. Replace its `Code.gs` with the included `Code.gs`.
3. Run `setupSpreadsheet` once from the editor and approve spreadsheet access.
4. Choose **Deploy → Manage deployments → Edit**.
5. Select **New version**, execute as **Me**, allow access to **Anyone**, and deploy.
6. Keep the resulting `/exec` URL in `.env` as `VITE_GAS_WEB_APP_URL`. If you updated the supplied deployment, its URL normally remains unchanged.

The setup is non-destructive. A blank `Sheet1` is reused as `Doctors`; only the missing agreed tabs and headers are created. Existing rows are not cleared or replaced.
