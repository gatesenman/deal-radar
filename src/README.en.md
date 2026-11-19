# AI Deal Radar (全网优惠雷达) — User Guide · v2.5.0

[中文说明](README.md) · English

A Windows desktop app that **monitors the latest offers from AI / software vendors in real time** — ChatGPT, Claude, Gemini, Cursor, DeepSeek and more: free trials, student offers, API credits, price cuts, new-user deals, limited-time promotions, startup programs and changes on official pricing pages. Every vendor has its own official channels (blog, pricing page, changelog, status page, YouTube, GitHub releases, community forums, Reddit), plus web-wide aggregator sources (Google/Bing News, Hacker News, Reddit, V2EX, Slickdeals…). New offers trigger a desktop notification. Product deals (Apple, Nike…) are optional and off by default.

## 1. Install / run

- **Installer**: run `DealRadar-Setup-2.5.0-x64.exe` and follow the prompts.
- **Portable**: run `DealRadar-Portable-2.5.0-x64.exe` directly.

> The app is not code-signed. If Windows SmartScreen shows "Windows protected your PC", click "More info → Run anyway".
> Upgrades keep favorites, settings, custom vendors and channels. Data is migrated automatically.

## 2. Language

- The interface is available in **简体中文** and **English**. On first launch it follows the system language (Chinese system → Chinese, anything else → English).
- Switch any time in **Settings → Appearance & window → Language**, or from the picker at the top of the welcome screen. The window refreshes instantly; no restart needed. Tray menu, notifications and the daily digest follow the selected language.
- **Offer titles** are shown in the selected language: in English mode, English items show their original title; Chinese items are translated by AI when an AI key is configured (Settings → AI assistant). Translations are cached per language, so nothing is translated twice. The original title is always shown underneath.
- Dates and numbers use the locale of the selected language.
- Adding a language: copy `src/locales/en.json` to e.g. `src/locales/ja.json`, translate the values (keys are the Chinese source strings) and add the language to `LANGS` in `src/renderer/i18n.js`. Run `node scripts/i18n-extract.js --check` to find missing strings.

## 3. Quick start

1. **Welcome screen**: choose vendors (all AI vendors are on by default), optionally product deals, and the network mode, then click **Start monitoring**. Real offers appear within about a minute.
2. **Today** (home): count tiles, top offers ranked by importance × trust × freshness, official pricing-page changes, offers ending soon and the most active vendors this week. Each row has **Open / Claimed / Ignore / Not an offer**.
3. **AI Offers**: every offer is tagged with its type (free trial, discount, bonus credits, student, startup, limited-time, new plan, pricing change) and key facts — amount, who qualifies, region / eligibility (e.g. "Available in China", "May need overseas account / payment", "Third-party reseller (unofficial)"), deadline, how to claim and source trust. Filter by vendor, type, region, status; search with Ctrl+F; cards / timeline / table views; export to CSV.
4. **Vendors & channels**: every vendor shows its **logo** and a short description. Enable/disable vendors, mute notifications per vendor, open a vendor to see each channel's health, and add channels (RSS/Atom, page-change monitor, JS-rendered page, sitemap, GitHub, Reddit, Discourse, YouTube, Bluesky, App Store / Google Play, news search…). **AI-assisted add** finds a vendor's official site and channels by name and tests each one; the vendor's favicon is fetched automatically and cached locally.
5. **Notifications**: minimum confidence, quiet hours (held offers are summarized afterwards) and a daily digest time.
6. **Background**: closing the window minimizes to the tray; right-click the tray icon to refresh, pause or quit.

## 4. Logos

- Logos for all 58 preset vendors are bundled in `assets/logos/` (128×128 PNG, downloaded from each vendor's official favicon / apple-touch-icon at build time with `python3 scripts/fetch-logos.py`, each decoded and validated). They work offline and stay crisp on HiDPI screens.
- Vendors you add (manually with an official-site channel, or via AI-assisted add) get their favicon fetched once and cached in the data folder (`logos/`). If a logo can't be loaded, a colored initials avatar is shown instead.

## 5. Precision & cross-language (v2.5)
- Extra noise rules (price-war commentary, podcasts, non-AI shopping, trial how-tos). Optional **AI offer classifier** when a key is set.
- Chinese + English reports of the **same offer** merge into one card with N sources (conservative anchor matching).
- Better translation prompts; configurable batch size; language badge on translated titles.
- Home empty-state hints, hide-resellers toggle, stronger expiry badges.

## 6. Data location

`%APPDATA%\全网优惠雷达\` — `config.json`, `deals.json`, `logos/` and caches. The folder name stays the same in every language so upgrades keep your data.

See [CHANGELOG.md](CHANGELOG.md) for version history and [DESIGN.md](DESIGN.md) for technical notes.
