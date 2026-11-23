# Stashd: project brief

## What Stashd is
A mobile app (iPhone and Android) where you save products you spot in social media ads and online stores, sort them into boards like Pinterest, and mark them as bought. Tagline: "Like it. Stash it. Buy it."

**The problem:** the founder sees products in ads across many platforms and saves them, but they get lost. She ends up sending links to her own WhatsApp chat.

**Who it is for (assumption, to confirm with 10 interviews):** women who shop from Instagram, TikTok, and online fashion stores. Start with one country.

**How it differs from Moonsift and similar apps:** personal shopping instead of gift lists; marks items as bought and shows what is left to spend; back-in-stock alerts for sold-out items; works with local stores and currencies (to be tested).

## MVP (version 1)
- Save a link, by pasting it or from the iPhone and Android share menu.
- Auto-fill photo, title, store, price, old price, and sold-out status.
- Boards, and a Pinterest-style two-column photo grid.
- To buy and Bought tabs; "left to spend" total.
- Tags on cards: Sold out, percent off.
- Item screen: photo, price, size, note, board, sold-out switch, Mark as bought, Open store page.

**Later (version 2):** price tracking and drop alerts, back-in-stock alerts, push notifications, shared boards, a Pro plan.

## Example item used in the prototype
Nesaa, "Embroidered Gabardine Pants in Beige": EGP 2,699 (was 2,850, 5% off), sold out. Page: https://www.nesaaonline.com/products/embroidered-gabardine-pants-in-beige

## Brand and design
- Header is plain text: "Stash" in bold with the "d" in the accent color. No logo for now (an app icon is still to be decided).
- Theme (neutral beige and brown, no pink): background #F3EBDD, cards #FBF7F0, text #3F2A1E, accent #8A5A3C, border #E2D5C1. Dark mode: background #1C1612, cards #271F19, text #F3EBDD, accent #D6A97E.
- Tone: friendly, short, a little cheeky.

## Tech plan
- App: Expo (React Native, TypeScript, Expo Router), one codebase for iOS and Android.
- Backend: Supabase (login, Postgres, photo storage, edge functions). Row-level security so users see only their own data.
- Builds: Expo EAS cloud builds; test on iPhone through TestFlight.
- Building with: Claude Code on the web (claude.ai/code or the Claude app Code tab), connected to the private GitHub repository `stashd-app`. The founder works from an iPad and tests on an iPhone.

**Data model:**
- boards: id, user_id, name
- items: id, user_id, board_id, url, title, brand, image_url, price, was_price, currency, size, note, sold_out, bought, created_at

## Plan and milestones (start 30 Nov 2026; edit in the workbook)
1. Ready to build: 13 Dec 2026
2. Working MVP on the phone: 17 Jan 2027
3. Beta approved by testers: 7 Feb 2027
4. Approved in both stores: 21 Feb 2027
5. Public launch: 28 Mar 2027
6. Version 2 live: 9 May 2027

Marketing milestones: accounts live (13 Dec), waitlist reached (7 Feb), beta testers recruited (31 Jan), launch kit ready (28 Feb), launch week done (14 Mar), first 30 days reviewed (9 May).

## Accounts
Stashd Gmail (2-step on), Instagram (Professional), TikTok, Apple Developer Program (individual), Google Play Console, GitHub, Expo, Supabase. Claude Pro is subscribed.

## Status so far
Done: web prototype, UX flow, brand direction, launch plan workbook, accounts set up. Next: Apple and Google enrollment, then Prompt 1 in Claude Code (see the Prompts sheet).

## Open questions
- Is the handle "stashd" free on Instagram and TikTok, and is the name clear of trademarks in the founder's region?
- How many testers and days does Google Play currently require for a new personal account?
- Does link import work with Egyptian stores and EGP prices? (Test with Nesaa.)
- App icon: still to be decided.

## How Claude should work in this project
- Answer in short, mobile-friendly messages; lead with the answer.
- Ask before big decisions; do not assume a store, price, or rule that may have changed. Check current official docs.
- Label estimates, and never present a guess as a verified price.
- Keep the beige and brown theme, and the plain-text "Stashd" header.
- When writing code, keep changes small and explain each step briefly.

## Files and links
- stashd-launch-plan.xlsx: Gantt, milestones, social setup, marketing, budget, prompts (budget is kept out of this repo)
- UX flow: https://claude.ai/artifact/Aiw3qfrvriAXSXYWGgc1me
- Working prototype: https://claude.ai/artifact/KhPyTqo4vY1C7aN3DgNq7h

## What's in this repository now: the web app
A plain HTML/CSS/JS web version of the MVP, published with GitHub Pages, for testing the flow on a phone before the Expo app exists.
- `index.html`, `app.css`, `app.js`: the app (sign up / sign in, boards, grid, To buy / Bought, left to spend, item screen, Save to Stashd sheet).
- `config.js`: Supabase project URL (https://fmwwzixstqlytalqwuda.supabase.co) and publishable key. With no key, the app runs in local test mode (localStorage).
- `supabase/schema.sql`: tables `boards` and `items` (as in the data model, plus `sizes text[]` for size chips), row-level security, a public `photos` storage bucket with per-user folders, and `delete_my_account()`. Run it in the Supabase SQL editor.
- Supabase JS is loaded from jsDelivr, pinned to @supabase/supabase-js@2.118.0.
- `manifest.webmanifest`, `icons/`: installable on Android; `share_target` puts Stashd in the Android share menu. iPhone sharing uses a Shortcut that opens `?url=<link>`.
- Link reading: first the Supabase Edge Function `read-link` (`supabase/functions/read-link/index.ts`, deployed from the Supabase dashboard editor, JWT verification on): Shopify `.js` data, then JSON-LD / Open Graph on the page, with SSRF guards. If it isn't deployed or fails, the browser falls back to Shopify `.js`, page meta and Microlink. Stores with bot protection (e.g. Zara) may still block it; the app then says so and asks for details by hand.
- iPhone Safari Shortcut (2 actions: Run JavaScript on Web Page → Open URLs): `shortcut.js` runs in the user's own Safari (so bot-protected stores like Zara still work) and returns the full link `STASHD + '?d=' + <url-encoded JSON {u,t,b,i,p,c,s,pt,wt}>`; the app's Copy script button swaps in this site's address. The app parses `?d=` (`fromShortcut`) and only calls the reader if the price is missing. Instagram/TikTok: Copy link → + → Paste. Steps live in the app's "Share to Stashd" sheet.
- Sign-up rules (client side, mirror them in Supabase Auth settings): password 8–72 characters, letters and a number, not a common password or the email name; live checklist and strength bar; email typo suggestions; existing emails detected via empty `identities` from `signUp`; "Check your inbox" screen with resend.
- Social (cloud only): `profiles` (unique lowercase username, made by a trigger on sign-up; Google users pick one after first sign-in), `follows` (anyone can follow; follows are public), boards have `visibility` private/public and `link_token` ("anyone with the link can view"), `board_members` with role `viewer` ("View only") or `editor` ("Can add"). Policies use security-definer helpers `board_role()` / `board_is_public()`; `shared_board(bid, k)` serves link views without notes. Existing projects run `supabase/002_social.sql`; `schema.sql` is the full setup.
- UI: bottom tab bar (Stash · Search · + · Profile). Board header is Pinterest-style: name + lock if secret, collaborator avatars with +, "In my budget" pill, Share and ⋯ (edit). Create/Edit board sheet: name, "Keep this board secret", "Count in my budget", collaborators. Share sheet: copy link, WhatsApp, more, "Anyone with the link can view". Invite sheet: Can add / View only, people you follow first, search.
- Sign-up asks only email + password; name + username come next in "Set up your profile" (same step for Google).
- Budget: `boards.in_budget` and `items.in_budget` (both default true). Left to spend counts an item only if both are on and the board is yours. Existing projects run `supabase/003_budget.sql`.
- Money (`supabase/004_money.sql`): `boards.budget` (in the owner's currency) shows a budget card in the board header: Left = budget − spent (bought) − to buy (planned); "over" when negative. Items keep the original `price`/`currency` plus `home_price`/`home_currency` (converted at save time, editable). Rates: ExchangeRate-API open access `open.er-api.com/v6/latest/<HOME>` (attribution link "Rates By Exchange Rate API" required), backup `latest.currency-api.pages.dev`, cached per device for 12 h. Totals use `homeAmt()`. Currency guessed from the store address (e.g. .co.uk → GBP) when the page doesn't say. "Private" switch = `visibility`; "Include in my totals" = `boards.in_budget`.
- Copy / move: item screen board chips move the item; "Copy to another board" and "Save to my board" (from public/shared boards) copy it without re-reading the link (`copyItem`).
- Profiles show public boards plus secret boards you were invited to ("Shared with you").
- Routes: `?u=<username>` profile, `?b=<board>[&k=<link key>]` board link, `?url=` incoming share. Lists shared with you appear as dashed chips and don't count in your own All / left to spend.
- Google / Apple sign-in buttons are built in and switched on with `providers` in `config.js` once each provider is configured in Supabase.
- Newsletter opt-in on sign-up posts to the Brevo form (address is in `app.js`).
- `index.html` loads `app.css`, `config.js` and `app.js` with `?v=<version>`: bump it on every change so phones don't run a cached copy.
- `privacy.html`: draft; contact email and date still to fill in.
- `_config.yml` stops GitHub Pages from publishing this file.
