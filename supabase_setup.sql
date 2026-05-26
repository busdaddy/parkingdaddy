-- ============================================================
-- Parking Daddy: full database setup
-- Paste this into Supabase SQL Editor and click "Run"
-- ============================================================
-- This creates TWO tables:
--   1. bookings        — every booking the form creates
--   2. contact_messages — every message sent via the Contact page
-- Both are protected by Row Level Security so anonymous visitors
-- can INSERT but not READ. Only you (via the Supabase dashboard
-- or a server-side service-role key) can see the data.
-- ============================================================

-- ------------------------------------------------------------
-- 1. BOOKINGS
-- ------------------------------------------------------------
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  car_info        jsonb not null,           -- {make, model, color, plate}
  current_location text not null,
  sweeping_time   timestamptz not null,
  key_pickup_notes text,
  key_return_notes text,
  calculated_price integer not null,
  payment_status  text not null default 'pending'
                  check (payment_status in ('pending', 'paid', 'failed', 'refunded'))
);

create index if not exists bookings_created_at_idx on public.bookings (created_at desc);

alter table public.bookings enable row level security;

drop policy if exists "Anyone can create a booking" on public.bookings;
create policy "Anyone can create a booking"
  on public.bookings
  for insert
  to anon
  with check (true);

-- ------------------------------------------------------------
-- 2. CONTACT MESSAGES
-- ------------------------------------------------------------
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  message     text not null,
  -- Track whether you've replied yet — flip to true from the dashboard
  handled     boolean not null default false
);

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

drop policy if exists "Anyone can send a contact message" on public.contact_messages;
create policy "Anyone can send a contact message"
  on public.contact_messages
  for insert
  to anon
  with check (true);

-- ============================================================
-- DONE. Check Table Editor in the left sidebar — you should see
-- both tables listed. Try inserting a test row to confirm.
-- ============================================================
