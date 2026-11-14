# Minty website

Static site: `index.html`, `privacy.html`, `style.css`, `assets/`.

## Publish (Netlify, free)
1. Go to https://app.netlify.com/drop (log in with GitHub).
2. Drag this whole folder onto the page. You get `https://<name>.netlify.app`.
3. Site settings → Change site name → e.g. `minty-app` → `https://minty-app.netlify.app`.



## Before Play Store
Fill the yellow `[placeholders]` in `privacy.html` (developer name, contact email, date, URL).
Source of truth: `My Pill Companion/docs/privacy-policy.md`.

## When Minty is live on Google Play
In `index.html`, find `Coming soon to Google Play`: set the link `href` to your Play Store URL, remove `soon` from its class and `aria-disabled`, and change the text to `Get it on Google Play`. Point the hero button (`Get Minty · ₱100`) to the same URL.
