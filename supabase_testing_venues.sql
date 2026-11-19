-- ==============================================================================
-- PhilNITS Testing Venues
--
-- Creates ONE new table (public.philnits_testing_venues) that the app's
-- "PhilNITS Testing Venues" screen reads, and seeds it with the 14 venues that
-- were previously hardcoded in the app. Existing tables are not touched.
-- Safe to re-run: venues are matched by name and never duplicated or overwritten,
-- so edits you make in the dashboard are kept.
--
-- Run once in: Supabase dashboard -> SQL Editor.
-- To add / edit / hide a venue afterwards, just edit the table (set is_active = false to hide).
-- ==============================================================================

create table if not exists public.philnits_testing_venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  city        text,
  region      text,
  latitude    double precision,
  longitude   double precision,
  phone       text,
  email       text,
  website     text,
  notes       text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint philnits_testing_venues_name_key unique (name),
  constraint philnits_testing_venues_lat_chk check (latitude  is null or latitude  between -90  and 90),
  constraint philnits_testing_venues_lng_chk check (longitude is null or longitude between -180 and 180)
);

create index if not exists idx_testing_venues_active_order
  on public.philnits_testing_venues (sort_order, name) where is_active;

-- Keep updated_at fresh on edits
create or replace function public.touch_testing_venues_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_testing_venues on public.philnits_testing_venues;
create trigger trg_touch_testing_venues
  before update on public.philnits_testing_venues
  for each row execute function public.touch_testing_venues_updated_at();

-- Read-only for the app (signed-in or not); only you (dashboard / service role) can change venues
alter table public.philnits_testing_venues enable row level security;

drop policy if exists "Anyone can read active testing venues" on public.philnits_testing_venues;
create policy "Anyone can read active testing venues"
  on public.philnits_testing_venues
  for select
  to anon, authenticated
  using (is_active);

grant select on public.philnits_testing_venues to anon, authenticated;

-- Seed: the venues that used to be hardcoded in the app
insert into public.philnits_testing_venues (name, address, city, region, latitude, longitude, phone, sort_order) values
  ('PhilNITS Foundation Headquarters',        '3/F Oppen Bldg, 349 Sen. Gil Puyat Ave, Makati City',      'Makati City',          'NCR',               14.5606, 121.0189, '(02) 8890-5026', 1),
  ('UP Diliman (Dept. of Computer Science)',  'Engineering Complex, UP Diliman, Quezon City',             'Quezon City',          'NCR',               14.6538, 121.0685, '(02) 8981-8500', 2),
  ('Ateneo de Manila University (DISCS)',     'Katipunan Ave, Loyola Heights, Quezon City',               'Quezon City',          'NCR',               14.6396, 121.0775, '(02) 8426-6001', 3),
  ('De La Salle University (CCS)',            '2401 Taft Ave, Malate, Manila',                            'Manila',               'NCR',               14.5648, 120.9932, '(02) 8524-4611', 4),
  ('University of Santo Tomas (CICS)',        'España Blvd, Sampaloc, Manila',                            'Manila',               'NCR',               14.6095, 120.9898, '(02) 8786-1611', 5),
  ('Mapúa University (School of IT)',         'Muralla St, Intramuros, Manila',                           'Manila',               'NCR',               14.5905, 120.9779, '(02) 8247-5000', 6),
  ('Saint Louis University (Baguio)',         'A. Bonifacio St, Baguio City, Benguet',                    'Baguio City',          'Cordillera',        16.4178, 120.5985, '(074) 442-2793', 7),
  ('Angeles University Foundation (AUF)',     'MacArthur Hwy, Angeles City, Pampanga',                    'Angeles City',         'Central Luzon',     15.1451, 120.5935, '(045) 625-2888', 8),
  ('University of Saint Louis (Tuguegarao)',  'Mabini St, Tuguegarao City, Cagayan',                      'Tuguegarao City',      'Cagayan Valley',    17.6186, 121.7303, '(078) 844-1872', 9),
  ('Cebu Institute of Technology - University','N. Bacalso Ave, Cebu City',                               'Cebu City',            'Central Visayas',   10.2946, 123.8809, '(032) 261-7741', 10),
  ('University of San Carlos (Talamban)',     'Gov. M. Cuenco Ave, Cebu City',                            'Cebu City',            'Central Visayas',   10.3541, 123.9130, '(032) 230-0100', 11),
  ('Iloilo Science & Technology University',  'Burgos St, La Paz, Iloilo City',                           'Iloilo City',          'Western Visayas',   10.7169, 122.5648, '(033) 320-7190', 12),
  ('Ateneo de Davao University',              'E. Jacinto St, Poblacion District, Davao City',            'Davao City',           'Davao Region',       7.0722, 125.6128, '(082) 221-2411', 13),
  ('Xavier University - Ateneo de Cagayan',   '73 Corrales Ave, Cagayan de Oro City',                     'Cagayan de Oro City',  'Northern Mindanao',  8.4776, 124.6468, '(088) 853-9800', 14)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
