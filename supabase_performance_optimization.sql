-- ==============================================================================
-- Gabay PhilNITS: query performance optimization
--
-- Run this ONCE in the Supabase SQL editor (safe to re-run).
--   1. Indexes for every hot query the app makes (skipped automatically if a table/column is missing)
--   2. get_home_dashboard()  -> replaces ~10 separate Home requests with ONE round trip
--   3. get_leaderboard()     -> top-N + names in ONE round trip, no full-table scans from the client
--
-- The app works without this file (it falls back to the old queries), it is just slower.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. INDEXES
-- ------------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create or replace function pg_temp.mk_idx(
  p_table text, p_name text, p_cols text, p_req text[], p_include text default null, p_where text default null
) returns void language plpgsql as $$
declare c text; sql text;
begin
  if to_regclass('public.' || quote_ident(p_table)) is null then
    raise notice 'skip %: table % missing', p_name, p_table; return;
  end if;
  foreach c in array p_req loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = p_table and column_name = c) then
      raise notice 'skip %: column %.% missing', p_name, p_table, c; return;
    end if;
  end loop;
  sql := format('create index if not exists %I on public.%I (%s)', p_name, p_table, p_cols);
  if p_include is not null then sql := sql || format(' include (%s)', p_include); end if;
  if p_where   is not null then sql := sql || ' where ' || p_where; end if;
  execute sql;
end $$;

-- Practice history (Home, Performance, streaks): always "this user's latest rows"
select pg_temp.mk_idx('multiple_choice_results', 'idx_mcq_results_user_answered',  'user_id, answered_at desc', array['user_id','answered_at']);
select pg_temp.mk_idx('true_false_results',       'idx_tf_results_user_answered',   'user_id, answered_at desc', array['user_id','answered_at']);
select pg_temp.mk_idx('flashcard_sessions',       'idx_fc_sessions_user_started',   'user_id, started_at desc',  array['user_id','started_at']);
select pg_temp.mk_idx('flashcard_sessions',       'idx_fc_sessions_user_created',   'user_id, created_at desc',  array['user_id','created_at']);
select pg_temp.mk_idx('matching_results',         'idx_matching_user_created',      'user_id, created_at desc',  array['user_id','created_at']);
select pg_temp.mk_idx('mock_exam_attempts',       'idx_mock_attempts_user_status',  'user_id, status, completed_at desc', array['user_id','status','completed_at']);
select pg_temp.mk_idx('mock_exam_attempts',       'idx_mock_attempts_user_created', 'user_id, created_at desc',  array['user_id','created_at']);
select pg_temp.mk_idx('mock_exam_answer_logs',    'idx_mock_answer_logs_attempt',   'attempt_id',                array['attempt_id']);

-- Points / leaderboard: weekly + monthly views filter on created_at then group by user
select pg_temp.mk_idx('points_ledger', 'idx_points_ledger_user_cat_created', 'user_id, category, created_at desc', array['user_id','category','created_at']);
select pg_temp.mk_idx('points_ledger', 'idx_points_ledger_created_cover',    'created_at desc', array['created_at','user_id','points'], 'user_id, points');
select pg_temp.mk_idx('points_ledger', 'idx_points_ledger_user_cover',       'user_id',        array['user_id','points'], 'points');

-- Reading / library
select pg_temp.mk_idx('user_reading_progress', 'idx_user_reading_progress_user_material', 'user_id, reading_material_id', array['user_id','reading_material_id']);
select pg_temp.mk_idx('reading_materials',     'idx_reading_materials_published_order',  'subject, sort_order', array['subject','sort_order','is_published'], null, 'is_published');
select pg_temp.mk_idx('video_lectures',        'idx_video_lectures_published_order',     'sort_order',          array['sort_order','is_published'], null, 'is_published');

-- Joins used by practice / readiness queries
select pg_temp.mk_idx('multiple_choice_questions', 'idx_mcq_questions_category', 'category_id', array['category_id']);
select pg_temp.mk_idx('true_false_questions',       'idx_tf_questions_category',  'category_id', array['category_id']);
select pg_temp.mk_idx('flashcards',                 'idx_flashcards_deck',        'deck_id',     array['deck_id']);
select pg_temp.mk_idx('flashcard_decks',            'idx_flashcard_decks_category','category_id', array['category_id']);
select pg_temp.mk_idx('mock_exam_questions',        'idx_mock_questions_config',  'config_id, sort_order', array['config_id','sort_order']);

-- Misc lists
select pg_temp.mk_idx('notifications',  'idx_notifications_created',        'created_at desc',            array['created_at']);
select pg_temp.mk_idx('app_ratings',    'idx_app_ratings_user',             'user_id',                    array['user_id']);
select pg_temp.mk_idx('app_ratings',    'idx_app_ratings_created',          'created_at desc',            array['created_at']);
select pg_temp.mk_idx('user_reports',   'idx_user_reports_user_created',    'user_id, created_at desc',   array['user_id','created_at']);
select pg_temp.mk_idx('diagnostic_assessment_attempts', 'idx_diag_assessment_user', 'user_id',            array['user_id']);

-- The app looks users up with  .ilike('email', ...)  (case-insensitive). A plain btree can't serve ILIKE,
-- a trigram index can (and also serves equality), so login / PIN / profile lookups stop scanning the table.
do $$
begin
  if to_regclass('public.users') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='email') then
    execute 'create index if not exists idx_users_email_trgm on public.users using gin (email extensions.gin_trgm_ops)';
    execute 'create index if not exists idx_users_email_lower on public.users (lower(email))';
  end if;
end $$;

-- Refresh planner statistics so the new indexes are used right away
do $$
declare t text;
begin
  foreach t in array array[
    'multiple_choice_results','true_false_results','flashcard_sessions','matching_results',
    'mock_exam_attempts','points_ledger','user_reading_progress','users'
  ] loop
    if to_regclass('public.' || t) is not null then execute format('analyze public.%I', t); end if;
  end loop;
end $$;

-- ------------------------------------------------------------------------------
-- 2. HOME DASHBOARD: one request instead of ~10
--    Returns the same row shapes the app already used from PostgREST, so the app logic is unchanged.
--    Runs as the signed-in user (security invoker) so your existing RLS policies still apply.
-- ------------------------------------------------------------------------------
create or replace function public.get_home_dashboard(p_days integer default 63)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 63), 1));
begin
  if v_uid is null then
    return null;
  end if;

  return jsonb_build_object(
    -- Distinct Philippine-time dates with any activity (for the streak)
    'activity_dates', (
      select coalesce(jsonb_agg(distinct d), '[]'::jsonb) from (
        select to_char((coalesce(completed_at, started_at, created_at) at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as d
          from flashcard_sessions where user_id = v_uid and created_at >= v_since
        union
        select to_char((answered_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
          from multiple_choice_results where user_id = v_uid and answered_at >= v_since
        union
        select to_char((answered_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
          from true_false_results where user_id = v_uid and answered_at >= v_since
        union
        select to_char((coalesce(completed_at, created_at) at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
          from matching_results where user_id = v_uid and created_at >= v_since
        union
        select to_char((coalesce(completed_at, started_at, created_at) at time zone 'Asia/Manila')::date, 'YYYY-MM-DD')
          from mock_exam_attempts where user_id = v_uid and created_at >= v_since
        union
        select coalesce(metadata->>'date', to_char((created_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD'))
          from points_ledger where user_id = v_uid and category = 'streak' and created_at >= v_since
      ) a where d is not null
    ),

    'mcq', (
      select coalesce(jsonb_agg(x order by x.answered_at desc), '[]'::jsonb) from (
        select r.is_correct, r.question_id, r.answered_at,
               jsonb_build_object(
                 'category_id', q.category_id, 'exam_level', q.exam_level, 'fe_section', q.fe_section,
                 'practice_categories', jsonb_build_object('name', c.name, 'exam_level', c.exam_level, 'fe_section', c.fe_section)
               ) as multiple_choice_questions
          from multiple_choice_results r
          left join multiple_choice_questions q on q.id = r.question_id
          left join practice_categories c on c.id = q.category_id
         where r.user_id = v_uid
         order by r.answered_at desc
         limit 200
      ) x
    ),

    'tf', (
      select coalesce(jsonb_agg(x order by x.answered_at desc), '[]'::jsonb) from (
        select r.is_correct, r.question_id, r.answered_at,
               jsonb_build_object(
                 'category_id', q.category_id, 'exam_level', q.exam_level, 'fe_section', q.fe_section,
                 'practice_categories', jsonb_build_object('name', c.name, 'exam_level', c.exam_level, 'fe_section', c.fe_section)
               ) as true_false_questions
          from true_false_results r
          left join true_false_questions q on q.id = r.question_id
          left join practice_categories c on c.id = q.category_id
         where r.user_id = v_uid
         order by r.answered_at desc
         limit 200
      ) x
    ),

    'attempts', (
      select coalesce(jsonb_agg(x order by x.completed_at desc), '[]'::jsonb) from (
        select a.score, a.total_questions, a.correct_count, a.completed_at,
               jsonb_build_object('title', cfg.title, 'level_key', cfg.level_key) as mock_exam_configs
          from mock_exam_attempts a
          left join mock_exam_configs cfg on cfg.id = a.config_id
         where a.user_id = v_uid and a.status = 'completed'
         order by a.completed_at desc
         limit 20
      ) x
    ),

    'matching', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
        select m.id, m.pairs_matched, m.pairs_total, m.mistakes, m.set_title, m.created_at
          from matching_results m
         where m.user_id = v_uid
         order by m.created_at desc
         limit 50
      ) x
    ),

    'flashcards', (
      select coalesce(jsonb_agg(x order by x.started_at desc), '[]'::jsonb) from (
        select s.id, s.cards_seen, s.cards_total, s.completed, s.started_at,
               jsonb_build_object(
                 'exam_level', d.exam_level, 'fe_section', d.fe_section, 'title', d.title,
                 'practice_categories', jsonb_build_object('name', c.name, 'exam_level', c.exam_level, 'fe_section', c.fe_section)
               ) as flashcard_decks
          from flashcard_sessions s
          left join flashcard_decks d on d.id = s.deck_id
          left join practice_categories c on c.id = d.category_id
         where s.user_id = v_uid
         order by s.started_at desc
         limit 50
      ) x
    )
  );
end;
$$;

revoke all on function public.get_home_dashboard(integer) from public;
grant execute on function public.get_home_dashboard(integer) to authenticated;

-- ------------------------------------------------------------------------------
-- 3. LEADERBOARD: top N with display names in one request
-- ------------------------------------------------------------------------------
create or replace function public.get_leaderboard(p_timeframe text default 'all_time', p_limit integer default 20)
returns table (user_id uuid, total_points bigint, user_name text)
language sql
stable
security invoker
set search_path = public
as $$
  with top as (
    select l.user_id, sum(l.points)::bigint as total_points
      from points_ledger l
     where case p_timeframe
             when 'monthly' then l.created_at >= date_trunc('month', now())
             when 'weekly'  then l.created_at >= date_trunc('week',  now())
             else true
           end
     group by l.user_id
     order by total_points desc
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  select t.user_id,
         t.total_points,
         coalesce(
           (select r.user_name from app_ratings r
             where r.user_id::text = t.user_id::text and r.user_name is not null
             order by r.created_at desc limit 1),
           (select l2.metadata->>'user_name' from points_ledger l2
             where l2.user_id = t.user_id and l2.metadata ? 'user_name'
             order by l2.created_at desc limit 1)
         ) as user_name
    from top t
   order by t.total_points desc;
$$;

revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

-- Make PostgREST pick up the new functions immediately
notify pgrst, 'reload schema';
