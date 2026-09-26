# SAFAR

Gig worker grievance intake over WhatsApp, built so a worker can file a
complaint by chatting instead of filling out a form. Each conversation is
saved to Supabase and can be exported to Excel for manual filing into
Karnataka's IPGRS portal, or read live by a dashboard tool.

## How it works

A gig worker messages the WhatsApp number. The bot walks them through:

1. Consent to store their message
2. Reason for the complaint (list menu)
3. Platform involved (list menu)
4. A description, typed or as a voice note (voice notes are transcribed
   and translated automatically when Bhashini is configured, otherwise
   they're flagged for manual transcription)
5. A confirmation of that description before moving on
6. Optional evidence photos
7. A reference code (e.g. `SAFAR-0142`) they can quote later

Everything lands in one `grievances` table in Supabase. From there:

- `npm run export` produces a dated `.xlsx` with signed links to any
  photos or voice notes, ready to hand-copy into IPGRS or share with a
  review team.
- The same table can be pointed at Metabase, Looker Studio, or any tool
  that reads Postgres, for a live dashboard.

See the "SAFAR Architecture" and "SAFAR Conversation" artifacts from this
project for the full diagram and a mockup of the chat itself. The code
here mirrors that mockup step for step; if the flow changes, update the
mockup too so they don't drift apart.

## Prerequisites

You'll need, before any of this can run against real traffic:

- **A Meta developer app** with the WhatsApp product added, a test (or
  production) phone number, and a permanent access token
- **A Supabase project** (free tier is enough to pilot)
- **A Bhashini account** (Government of India's ASR/translation API), if
  you want automatic voice-note transcription; without it, voice notes
  are stored and flagged for someone to transcribe by hand
- The Supabase CLI installed locally, to run migrations and deploy the
  function

## Project layout

```
supabase/
  migrations/0001_init.sql        the grievances table + storage bucket
  functions/whatsapp-webhook/     the bot itself (Deno edge function)
    index.ts                      webhook entry point (GET verify, POST handle)
    lib/whatsapp.ts               WhatsApp Cloud API calls
    lib/bhashini.ts               voice transcription + translation
    lib/state-machine.ts          the conversation logic, stage by stage
    lib/copy.ts                   all user-facing message text
    lib/supabase-client.ts        service-role Supabase client
    lib/types.ts                  shared types
scripts/export-grievances.mjs     Excel export
```

## Setup

1. **Create the Supabase project**, then copy `.env.example` to `.env`
   and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
   Project Settings → API.

2. **Run the migration** against your project:

   ```
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   This creates the `grievances` table and a private `evidence` storage
   bucket.

3. **Fill in the rest of `.env`**: your Meta WhatsApp token, phone
   number ID, app secret, and a verify token you make up yourself (used
   in step 5). Add Bhashini credentials if you have them; leave them
   blank otherwise, the bot degrades gracefully.

4. **Push those same secrets to Supabase** (edge functions don't read
   your local `.env`):

   ```
   supabase secrets set --env-file .env
   ```

5. **Deploy the function**:

   ```
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   ```

   Take the resulting URL to the Meta app dashboard's WhatsApp →
   Configuration screen, set it as the webhook callback URL, and enter
   the same verify token from your `.env`. Meta will call the function
   once with a GET request to confirm it, then start sending real
   messages as POSTs.

6. **Send the WhatsApp number a message** to test the flow end to end.

## Exporting to Excel

```
npm install
npm run export
```

Writes `safar-grievances-<date>.xlsx` to the current folder, one row per
completed conversation, with reason and platform translated back to
readable labels and 7-day signed links to any photos or voice notes.
By default this only exports rows still marked `open`; pass
`--status=all` to export everything regardless of review status:

```
npm run export -- --status=all
```

## Known limitations for this pilot

- Signature verification on the webhook only warns (doesn't block) if
  `META_APP_SECRET` is unset. Set it before pointing this at real
  traffic.
- Bhashini's exact pipeline ID and request contract in `lib/bhashini.ts`
  are written from the published API pattern and should be checked
  against live docs once you have real credentials to test with.
- There's no admin UI yet. Reviewing and marking a grievance
  `reviewed` / `filed_with_ipgrs` / `not_eligible` currently means
  updating the `status` column directly in the Supabase table editor.
