-- ==============================================================================
-- Official PhilNITS exam sites (source: https://philnits.org/exam-site/)
--
-- * Adds / refreshes the 19 official exam sites listed on philnits.org.
-- * Venues that are NOT on the official list are HIDDEN (is_active = false), never deleted,
--   so you can re-enable any of them from the Table Editor.
-- * Coordinates: OpenStreetMap (same map the app shows). Phone numbers are not published on
--   the official page, so they are left empty.
-- * Safe to re-run. No columns, tables or policies are changed.
--
-- Run in: Supabase dashboard -> SQL Editor.  Requires supabase_testing_venues.sql (already run).
-- ==============================================================================

begin;

insert into public.philnits_testing_venues
  (name, address, city, region, latitude, longitude, phone, website, sort_order)
values
  ('Philippine Christian University (PCU)', '1648 Taft Ave, Malate, Manila, 1004 Metro Manila', 'Manila', 'NCR', 14.575564, 120.989159, null, 'https://philnits.org/exam-site/', 1),
  ('University of St. La Salle - Bacolod City', 'La Salle Avenue corner San Agustin Dr, Bacolod, 6100 Negros Occidental', 'Bacolod City', 'Western Visayas', 10.678417, 122.962484, null, 'https://philnits.org/exam-site/', 2),
  ('University of Negros Occidental – Recoletos', '#51 Lizares St, Bacolod, 6100 Negros Occidental', 'Bacolod City', 'Western Visayas', 10.656413, 122.947967, null, 'https://philnits.org/exam-site/', 3),
  ('University of the Cordilleras (UC)', 'Gov. Pack Road, Baguio City, Benguet', 'Baguio City', 'Cordillera', 16.408455, 120.597928, null, 'https://philnits.org/exam-site/', 4),
  ('Batangas State University - Lipa Campus', 'Lipa City, Batangas', 'Lipa City', 'CALABARZON', 13.956658, 121.163273, null, 'https://philnits.org/exam-site/', 5),
  ('Batangas State University - Malvar Campus', 'Malvar, Batangas', 'Malvar', 'CALABARZON', 14.044912, 121.156329, null, 'https://philnits.org/exam-site/', 6),
  ('Batangas State University - Nasugbu Campus', 'R. Martinez St, Bucana, Nasugbu, Batangas', 'Nasugbu', 'CALABARZON', 14.067242, 120.626724, null, 'https://philnits.org/exam-site/', 7),
  ('Holy Name University - Dampas Campus', 'Dampas, Tagbilaran City, Bohol 6300', 'Tagbilaran City', 'Central Visayas', 9.649598, 123.8679, null, 'https://philnits.org/exam-site/', 8),
  ('Camarines Sur Polytechnic Colleges', 'San Miguel, Nabua, Camarines Sur', 'Nabua', 'Bicol', 13.405818, 123.376338, null, 'https://philnits.org/exam-site/', 9),
  ('University of San Carlos - Talamban Campus', 'Talamban, Cebu City', 'Cebu City', 'Central Visayas', 10.355938, 123.907154, null, 'https://philnits.org/exam-site/', 10),
  ('University of Cebu - Main Campus', 'Sanciangko St, Cebu City, 6000 Cebu', 'Cebu City', 'Central Visayas', 10.297446, 123.896292, null, 'https://philnits.org/exam-site/', 11),
  ('University of Cebu - Banilad Campus', 'Gov. M. Cuenco Ave, Banilad, Cebu City, 6000 Cebu', 'Cebu City', 'Central Visayas', 10.338154, 123.911471, null, 'https://philnits.org/exam-site/', 12),
  ('Foundation University', 'Dr. Meciano Road, Dumaguete City, Negros Oriental', 'Dumaguete City', 'Central Visayas', 9.305209, 123.299915, null, 'https://philnits.org/exam-site/', 13),
  ('Colegio de Santa Rita', 'San Carlos City, Negros Occidental', 'San Carlos City', 'Western Visayas', 10.495526, 123.424692, null, 'https://philnits.org/exam-site/', 14),
  ('Don Mariano Marcos Memorial State University - Mid La Union Campus (College of Information Technology)', 'Catbangen, San Fernando City, La Union', 'San Fernando City', 'Ilocos', 16.613938, 120.314431, null, 'https://philnits.org/exam-site/', 15),
  ('Saint Joseph College of Maasin', 'Tunga-tunga, Maasin City, Southern Leyte 6600', 'Maasin City', 'Eastern Visayas', 10.133433, 124.837676, null, 'https://philnits.org/exam-site/', 16),
  ('La Salle University - Ozamiz', 'Valconcha St., Ozamiz City, Misamis Occidental', 'Ozamiz City', 'Northern Mindanao', 8.149351, 123.8471, null, 'https://philnits.org/exam-site/', 17),
  ('Carlos Hilado Memorial State University - Talisay', 'Mabini Street, Talisay City, Negros Occidental', 'Talisay City', 'Western Visayas', 10.742615, 122.970323, null, 'https://philnits.org/exam-site/', 18),
  ('Visayas State University', 'Visca, Baybay City, Leyte', 'Baybay City', 'Eastern Visayas', 10.745887, 124.794771, null, 'https://philnits.org/exam-site/', 19)
on conflict (name) do update set
  address    = excluded.address,
  city       = excluded.city,
  region     = excluded.region,
  latitude   = excluded.latitude,
  longitude  = excluded.longitude,
  website    = excluded.website,
  sort_order = excluded.sort_order,
  is_active  = true;

-- Hide venues that are not on the official exam-site list (kept in the table, just not shown)
update public.philnits_testing_venues
   set is_active = false
 where name not in ('Philippine Christian University (PCU)', 'University of St. La Salle - Bacolod City', 'University of Negros Occidental – Recoletos', 'University of the Cordilleras (UC)', 'Batangas State University - Lipa Campus', 'Batangas State University - Malvar Campus', 'Batangas State University - Nasugbu Campus', 'Holy Name University - Dampas Campus', 'Camarines Sur Polytechnic Colleges', 'University of San Carlos - Talamban Campus', 'University of Cebu - Main Campus', 'University of Cebu - Banilad Campus', 'Foundation University', 'Colegio de Santa Rita', 'Don Mariano Marcos Memorial State University - Mid La Union Campus (College of Information Technology)', 'Saint Joseph College of Maasin', 'La Salle University - Ozamiz', 'Carlos Hilado Memorial State University - Talisay', 'Visayas State University');

commit;

-- Check: should list the 19 official sites
select sort_order, name, city, latitude, longitude
  from public.philnits_testing_venues
 where is_active
 order by sort_order;
