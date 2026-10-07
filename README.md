# The Petrol Price Puzzle

An interactive explainer on why UK petrol is so expensive while oil companies post big profits, with live prices that update automatically.

## How it works

```
GitHub Action (07:15 and 15:15 UK-ish, daily)
  └─ scripts/update-prices.mjs
       ├─ UK pump prices  ← retailer open data feeds (Asda, Esso, Motor Fuel Group, SGN…)
       ├─ Brent crude     ← Yahoo Finance (BZ=F futures)
       └─ £/$ rate        ← European Central Bank via frankfurter.dev
     writes site/data/prices.json  (and keeps a daily history)
  └─ publishes the site/ folder to GitHub Pages
```

The page (`site/index.html`) loads `data/prices.json` when it opens. If that fails, it shows the built-in figures from 28 September 2026, so it never breaks.

No API keys, accounts or paid services are needed.

## One-time setup on GitHub

1. Create a new **public** repository on GitHub (for example `petrol-price-puzzle`).
2. Push this folder to it:

   ```bash
   git init && git add . && git commit -m "Petrol Price Puzzle"
   ```

   ```bash
   git branch -M main && git remote add origin https://github.com/YOUR-USERNAME/petrol-price-puzzle.git && git push -u origin main
   ```

3. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Go to the **Actions** tab, open **Update prices and deploy**, and click **Run workflow**.

After a minute the site is live at `https://YOUR-USERNAME.github.io/petrol-price-puzzle/`. From then on it refreshes itself twice a day.

## Running it locally

```bash
node scripts/update-prices.mjs
```

```bash
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000. (Opening `index.html` directly as a file also works, but then it can't load the live data and shows the built-in figures.)

## Things to keep an eye on

- **Fuel duty** isn't published in any feed. The schedule is in `DUTY_SCHEDULE` at the top of `scripts/update-prices.mjs`. Check it after each Budget.
- **Retailer feeds** come and go. Feeds that haven't updated for 4 days are skipped automatically and the Action log lists which were used. Add new ones to `FEEDS`.
- **Brent crude** comes from Yahoo Finance's unofficial endpoint. If it ever stops working, the page keeps showing the last good value with its date, and the Action log will say so.
- The UK pump price chart appears once 14 days of history have built up.

`index.html` in the project root is the earlier claude.ai artifact version (no live data). The website is the one in `site/`.
