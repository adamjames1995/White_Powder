# Snowline

A personal snow-forecast web app for your phone's home screen. It shows a 16-day snowfall forecast at the base and summit of each resort, current conditions, observed new snow, webcams and powder alerts.

Resorts: Palisades Tahoe, Kirkwood, Whistler Blackcomb, Stevens Pass, Crystal Mountain. To add one, add an entry to `lib/resorts.js`.

## How the forecast works

- **Models:** It pulls GFS (blended with HRRR for the first 48 h in the US), ECMWF IFS 0.25° and Canadian GEM from Open-Meteo in a single request. Each resort's base and summit gets its own request point.
- **Downscaling:** Open-Meteo adjusts temperature to the exact base and summit elevations. Snowfall comes from precipitation using two rules:
  - Rain/snow split: all snow at or below 0 °C, all rain at or above +2 °C, with a linear blend in between.
  - A Kuchera-style snow-to-liquid ratio (colder means fluffier), clamped to between 5:1 and 25:1.
- **Blend:** The daily blend is the mean of the models that have data for that day. The whisker on the chart shows the model range (GEM ends at about 10 days).
- **Snow level:** The models' freezing level minus 1,000 ft.
- **Observed snow:** The rise in depth at the nearest SNOTEL station over the last 24 and 72 hours. Whistler has no SNOTEL station, so it shows modeled snow instead.

Limitations: base and summit share one model grid cell, so their precipitation is the same. Only the rain/snow split and density differ between them. This setup won't capture localized orographic bands (for example Stevens convergence zones) as well as a tuned model would. Treat numbers more than 7 days out as trend signals.

## Deploy (about 15 minutes)

1. **GitHub:** Create a private repo (for example `snowline`) and upload this folder.
2. **Vercel:** Sign up at vercel.com with GitHub, then go to Add New → Project → import the repo. There's no framework or build step, so leave the defaults and click Deploy.
3. **Redis for alert subscriptions:** In your Vercel project, go to Storage → Create → Upstash for Redis (free tier) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
4. **VAPID keys for push:** On any computer with Node, run `npx web-push generate-vapid-keys`.
5. **Environment variables:** Add these in Vercel under Settings → Environment Variables:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: from step 4
   - `VAPID_SUBJECT`: `mailto:you@example.com`
   - `CRON_SECRET`: any long random string
   - `WINDY_WEBCAMS_KEY` (optional): a free key from api.windy.com/keys (choose the Webcams API)

   Then redeploy.
6. **Alert schedule:** In GitHub, go to repo Settings → Secrets and variables → Actions and add:
   - `APP_URL`: your Vercel URL, for example `https://snowline-xyz.vercel.app`
   - `CRON_SECRET`: the same value as in Vercel

   The workflow runs at about 6 am and 6 pm Pacific. Trigger it manually from Actions → Powder alerts → Run workflow to test it.
7. **On each iPhone:** Open the URL in Safari, tap Share → **Add to Home Screen**, and open Snowline from the home screen. Then tap 🔔 → *Turn on alerts* → *Send test alert*.

## Notes

- **Licensing:** Open-Meteo's free API is for non-commercial use only. If this ever earns money, get an Open-Meteo API key and set `OPEN_METEO_API_KEY`. The alert job already supports it, and the app uses the same `forecastUrl(..., { apiKey })` option.
- **Scheduled workflows:** GitHub pauses scheduled workflows after 60 days without repo activity. Re-enable it from the Actions tab if alerts stop.
- **Windy free tier:** Image links expire after 10 minutes, so the app requests fresh ones on each visit and credits Windy as required.
- **Tests:** `npm install && npm test`

## Files

```
index.html, app.js, styles.css   app UI (no build step)
sw.js, manifest.webmanifest       home-screen install, offline shell, push handler
lib/resorts.js                    resort list
lib/snow.js                       forecast engine (shared by app + alert job)
api/snotel.js                     SNOTEL proxy and parser
api/webcams.js                    Windy webcams proxy
api/vapid.js, api/subscribe.js    push subscription
api/check-alerts.js               powder alert job
.github/workflows/alerts.yml      twice-daily trigger
```
