-- SAFAR: gig worker grievance intake
-- Core table plus the storage bucket for evidence photos and voice notes.

create extension if not exists pgcrypto;

-- Reference codes look like SAFAR-0001, SAFAR-0002, ...
create sequence if not exists grievance_reference_seq start 1;

create table if not exists grievances (
  id uuid primary key default gen_random_uuid(),

  -- WhatsApp identity for this conversation. wa_phone_number is the
  -- number Meta sends as the sender ("wa_id"), digits only, no "+".
  wa_phone_number text not null,
  wa_profile_name text,

  -- Human-readable code given to the worker once the report is saved.
  reference_code text unique not null
    default ('SAFAR-' || lpad(nextval('grievance_reference_seq')::text, 4, '0')),

  -- Where this conversation is in the flow. See lib/state-machine.ts
  -- in the webhook function for the transitions between these.
  stage text not null default 'awaiting_consent'
    check (stage in (
      'awaiting_consent',
      'awaiting_reason',
      'awaiting_platform',
      'awaiting_description',
      'awaiting_description_confirm',
      'awaiting_evidence',
      'completed'
    )),
  consent_at timestamptz,

  reason text,
  platform text,

  description_original text,
  description_language text,
  description_translated text,
  description_confirmed boolean not null default false,

  audio_url text,
  evidence_urls jsonb not null default '[]'::jsonb,

  -- Review status, set by whoever works the queue. Separate from
  -- "stage", which only tracks the bot conversation itself.
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'filed_with_ipgrs', 'not_eligible')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one open conversation per phone number at a time. Once a report
-- reaches 'completed', the same worker can start a new one.
create unique index if not exists grievances_one_open_per_phone
  on grievances (wa_phone_number)
  where stage <> 'completed';

create index if not exists grievances_status_idx on grievances (status);
create index if not exists grievances_created_at_idx on grievances (created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists grievances_set_updated_at on grievances;
create trigger grievances_set_updated_at
  before update on grievances
  for each row execute function set_updated_at();

-- Row Level Security is on, with no policies. The webhook function and
-- the export script both connect with the service role key, which
-- bypasses RLS by design. Nothing else can read or write this table,
-- including the Supabase client-side libraries with the anon key.
alter table grievances enable row level security;

-- Storage bucket for evidence photos and voice note audio. Kept
-- private; files are only ever fetched through the service role key
-- or a short-lived signed URL, never a public link.
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;
