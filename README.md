# Onyx Stock List

A WhatsApp bot plus a storefront, both running on Vercel.

1. **Capture.** The bot sits in your reseller WhatsApp groups. When someone posts stock with prices (text, photos, or both), Claude reads it and creates listings with brand, model, storage, color, condition, quantity and price. Each listing's sale price is the seller's price **+ $10**.
2. **Storefront.** Listings appear on the website, organised by brand and category, with search, filters and photos. Buyers never see who the seller is, which group the item came from, or the seller's price.
3. **Accounts.** Buyers sign up (Clerk), add a shipping address, and save a card (Stripe).
4. **Order and verify.** When a buyer requests an item, the bot DMs the original seller with their post and photo and asks if it's still available and whether anything has changed. Claude reads the reply:
   - **Available, same or lower price:** the buyer's saved card is charged automatically.
   - **Price went up, fewer units, or the condition changed:** the listing is updated and the buyer is asked to accept or cancel.
   - **Sold out:** the order is cancelled (never charged) and the listing comes down.
   - **Unclear reply, or no reply:** it's flagged for you on the admin page.
5. **Fulfil.** You buy from the seller, ship to the buyer, and enter tracking. You get WhatsApp alerts along the way.

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
