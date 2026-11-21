select md5(string_agg(x, '|' order by x)) fp, count(*) n from (
 select 'h:'||hash x from drizzle.__drizzle_migrations
 union all select 'c:'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') from information_schema.columns where table_schema='public'
 union all select 'p:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public'
 union all select 'f:'||p.proname||':'||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 union all select 'i:'||indexname||':'||md5(indexdef) from pg_indexes where schemaname='public'
 union all select 't:'||event_object_table||'.'||trigger_name||':'||event_manipulation from information_schema.triggers where trigger_schema='public'
 union all select 'g:'||table_name||':'||privilege_type from information_schema.role_table_grants where grantee='ringportal_app'
 union all select 'r:'||relname||':'||relrowsecurity||relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'
 union all select 'k:'||conname||':'||md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace='public'::regnamespace
) s
