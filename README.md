# Onyx Stock List

A WhatsApp bot plus a storefront, both running on Vercel.

1. **Capture.** The bot reads your reseller WhatsApp groups. When someone posts stock (text, photos or both), Claude turns it into listings: brand, model, storage, color, condition, quantity and price, **exactly as posted** (no markup by default; set `MARKUP_DOLLARS` to add one).
2. **Directory.** Everything appears on the website, organised by brand and category with search and filters. Each listing shows the seller, the group it came from and the original post, plus a **Message Seller** button that opens WhatsApp with an "is it still available?" message. Deals happen directly between buyer and seller.
   **Members only:** every page needs a free Clerk account; signed-out visitors are sent to `/sign-up` and returned to the page they wanted (see `src/proxy.ts`).
3. **Stays fresh.** Reposts update the existing listing instead of duplicating it, "sold" messages take items down, and anything not re-posted within `LISTING_TTL_DAYS` drops off.
4. **Buyer tools.**
   - **Find a Deal** (`/find`): item + max price. Shows matches at or under budget (with how much under), ones up to 15% over ("make an offer"), and matches posted without a price.
   - **Deal alerts** (`/alerts`): save any search; every new post and price drop is checked against it, with an optional WhatsApp message from the bot (max 10 per alert per day).
   - **Smart search** understands reseller shorthand (`16 pm`, `s25u`, `mbp`, `ip15`) and prices in the box (`ps5 under 400`, `$300-$450`); filter by price range and "last 24 hours".
   - **Price check** on each item: lowest-of-N-sellers badge, every other seller's price with a one-tap message, **Make an offer** (prefilled WhatsApp with your price), Share, and "alert me if it drops".
5. **Opt-out.** A seller texts **"opt out"** to the bot's number (or types it in a group): their listings come down, future posts are skipped (no AI call), they get a private confirmation, and you get a WhatsApp ping. **"opt in"** undoes it. Admin → Listings → **Remove seller** does the same by hand, and so does the API:
   ```
   curl -X POST https://<your-domain>/api/sellers/opt-out -H "Authorization: Bearer $ADMIN_API_KEY" -d '{"phone":"+1 555 123 4567"}'
   curl -X POST ... -d '{"phone":"+1 555 123 4567","action":"in"}'   # opt back in
   curl https://<your-domain>/api/sellers/opt-out -H "Authorization: Bearer $ADMIN_API_KEY"   # list
   ```
   (`ADMIN_API_KEY` falls back to `WHATSAPP_WEBHOOK_SECRET` if unset.)

> The earlier ordering flow (orders, Stripe payments, automatic seller verification) is still in the code but no longer shown on the public site.

## How it fits together

```
WhatsApp groups ──> Whapi.cloud (keeps the bot's WhatsApp session online)
                          │ webhook
                          ▼
Vercel ── /api/whatsapp/webhook ──> Claude ──> Postgres ──> storefront
       ── /api/stripe/webhook   <── Stripe
       ── Clerk (accounts)
```

Vercel functions can't hold a WhatsApp connection open, so a gateway (Whapi.cloud) does that and forwards each message to our webhook. Everything we run is on Vercel.

## Setup

### 1. Database
In Vercel, open **Storage** and create a Postgres database (Neon). Copy the **pooled** URL into `DATABASE_URL`, then create the tables:

```bash
cp .env.example .env.local   # fill in DATABASE_URL
DATABASE_URL=... npm run db:migrate
```

### 2. WhatsApp bot (Whapi.cloud)
1. Use a **dedicated phone number** for the bot (not your personal one), and add that number to your 4 reseller groups.
2. Create a channel at whapi.cloud and link the number by scanning the QR code (WhatsApp → Linked devices).
3. In the channel settings, set the webhook URL to `https://<your-domain>/api/whatsapp/webhook?secret=<WHATSAPP_WEBHOOK_SECRET>`, with the **messages** event (method POST).
4. Put the channel token in `WHAPI_TOKEN`.
5. After deploying, open **Admin → WhatsApp inbox**. It lists the bot's groups with their ids. Copy your 4 reseller group ids into `WHATSAPP_GROUP_IDS`.

> WhatsApp does not offer an official API for reading groups you don't own. Gateways like Whapi use a linked device, which is against WhatsApp's terms and carries some risk of the number being banned. That's why the bot should use a spare number. The bot only reads groups and DMs sellers when a buyer requests their item.

### 3. Claude
Create an API key at console.anthropic.com and set `ANTHROPIC_API_KEY`.

### 4. Clerk (accounts)
Create a Clerk app, then set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `ADMIN_EMAILS` (your email, so you can open `/admin`).

### 5. Stripe (payments)
1. Set `STRIPE_SECRET_KEY`.
2. In **Developers → Webhooks**, add `https://<your-domain>/api/stripe/webhook` with the events `checkout.session.completed` and `payment_intent.succeeded`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

Cards are saved with Stripe Checkout (setup mode) and charged off-session once availability is confirmed. If the bank asks for 3-D Secure, or the card is declined, the buyer gets a **Pay** button on their order page.

### 6. Deploy
Push to GitHub, import the repo in Vercel, add the env vars, and deploy. The WhatsApp webhook waits briefly so a burst of photos plus the price text becomes a single AI call, so it needs up to 120s of function time. That's within Vercel's limits with Fluid compute (on by default).

## Admin (`/admin`)
- **Listings:** everything captured, with seller name, WhatsApp link, group, original message, and seller price vs. sale price. Edit the title, price or quantity, hide, mark sold, or delete.
- **Orders:** each order with the seller's verification reply, buyer details and address, and your margin. Buttons to charge, re-ask the seller, mark shipped (with tracking), mark delivered, or cancel (refunds if already charged).
- **WhatsApp inbox:** every captured message with how it was handled (`done`, `ignored`, `failed`), with a re-run button.

## Behaviour details
- **Duplicates:** when the same seller re-posts the same product (same brand, model, storage, color and condition), the existing listing is updated with the new price, quantity and photos instead of creating a new one.
- **Expiry:** listings drop off the storefront if not re-posted within `LISTING_TTL_DAYS` (default 7).
- **Photos without text:** a photo burst is paired with the seller's text within 5 minutes, in either order. Price-list screenshots with no text are read too.
- **Ignored:** chatter, "WTB/looking for" posts, and items without a price.

## Development
```bash
npm install
npm run dev               # http://localhost:3000
npm run db:seed:demo      # sample listings on an empty local DB
npm run typecheck && npm run lint
npm test                  # unit tests
TEST_DATABASE_URL=postgres://... npm test   # + end-to-end pipeline tests on a throwaway DB
```
Stack: Next.js 16 (App Router), Drizzle + Postgres, Claude (`@anthropic-ai/sdk`, structured outputs), Clerk, Stripe, Tailwind 4.
