-- WHISTLE FASE 9: backup, restore, validasi integritas, dan audit trail.
--
-- BACKUP CLOUD (file JSON dari database, untuk pemulihan) BERBEDA dari EXPORT EXCEL (laporan untuk dibaca).
-- Aplikasi ini TIDAK mengaktifkan atau mengklaim backup otomatis Supabase; itu diatur di dashboard Supabase
-- (Database > Backups) dan tergantung paket langganan.
--
-- Backup dikembalikan sebagai TEKS JSON agar angka NUMERIC tidak pernah melewati float JavaScript.
-- Restore penuh bersifat atomik: validasi file -> titik pemulihan otomatis -> ganti data -> cek integritas
-- ulang. Jika langkah mana pun gagal, seluruh transaksi dibatalkan dan data lama tetap utuh.
-- Ledger (inventory_movements) tetap append-only; hanya fungsi restore yang boleh menggantinya.

-- ---------------------------------------------------------------------------
-- Gerbang restore: baris hanya ada di dalam transaksi restore yang sedang berjalan.
-- Tidak dapat diakses atau dipalsukan pengguna (tanpa hak akses; baris belum terlihat oleh sesi lain).
-- ---------------------------------------------------------------------------
create table app.restore_gate (
  txid bigint primary key,
  created_at timestamptz not null default now()
);
revoke all on table app.restore_gate from public, anon, authenticated;

create function app.restore_active() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from app.restore_gate where txid = txid_current()) $$;

-- Perbarui pelindung agar restore yang sah dapat mengganti data (di luar restore tetap diblokir)
create or replace function app.block_mutation() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if app.restore_active() then
    if tg_level = 'STATEMENT' then return null; end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Tabel % bersifat append-only: % langsung tidak diizinkan', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create or replace function app.guard_posted_transaction() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if app.restore_active() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('POSTED', 'REVERSED') then
      raise exception 'Transaksi % sudah diposting dan tidak boleh dihapus', old.transaction_number
        using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status in ('POSTED', 'REVERSED') then
    if old.status = 'POSTED' and new.status = 'REVERSED'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'Transaksi % sudah diposting dan tidak boleh diubah; gunakan adjustment atau reversal', old.transaction_number
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app.guard_posted_items() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
begin
  if app.restore_active() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.inventory_transactions
  where id = coalesce(old.transaction_id, new.transaction_id);
  if v_status in ('POSTED', 'REVERSED') then
    raise exception 'Item transaksi yang sudah diposting tidak boleh diubah atau dihapus'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Restore dicatat sebagai satu entri audit ringkas, bukan ribuan perubahan baris
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if app.restore_active() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, action, table_name, record_id, new_value)
    values (auth.uid(), tg_op, tg_table_name, to_jsonb(new) ->> 'id', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) = to_jsonb(old) then
      return new;
    end if;
    insert into public.audit_logs (user_id, action, table_name, record_id, old_value, new_value)
    values (auth.uid(), tg_op, tg_table_name, to_jsonb(new) ->> 'id', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_logs (user_id, action, table_name, record_id, old_value)
    values (auth.uid(), tg_op, tg_table_name, to_jsonb(old) ->> 'id', to_jsonb(old));
    return old;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Titik pemulihan (salinan otomatis sebelum setiap restore). Hanya lewat fungsi ADMIN.
-- ---------------------------------------------------------------------------
create table public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  scope text not null,
  reason text not null,
  counts jsonb not null,
  size_bytes integer not null,
  payload text not null
);
alter table public.backup_snapshots enable row level security;
revoke all on table public.backup_snapshots from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Definisi tabel yang dicadangkan
-- ---------------------------------------------------------------------------
create function app.scope_tables(p_scope text) returns text[]
language sql immutable
as $$
  select case p_scope
    when 'MASTER' then array['warehouses', 'products', 'product_opening_stock']
    when 'TRANSACTIONS' then array['inventory_transactions', 'inventory_transaction_items']
    when 'MOVEMENTS' then array['inventory_movements', 'stock_balances']
    when 'FULL' then array['warehouses', 'products', 'product_opening_stock', 'inventory_transactions',
                           'inventory_transaction_items', 'inventory_movements', 'stock_balances',
                           'profiles', 'user_roles', 'audit_logs']
  end
$$;

create function app.table_key(p_table text) returns text
language sql immutable
as $$ select case when p_table = 'product_opening_stock' then 'product_id' else 'id' end $$;

create function app.backup_payload(p_scope text, p_note text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t text;
  v_tables jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_md5 jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_scope_tables text[] := app.scope_tables(p_scope);
  v_totals jsonb := '{}'::jsonb;
begin
  if v_scope_tables is null then
    raise exception 'Lingkup backup tidak valid: % (MASTER, TRANSACTIONS, MOVEMENTS, FULL)', p_scope using errcode = 'WS003';
  end if;
  foreach t in array v_scope_tables loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) order by x.%1$I::text), ''[]''::jsonb) from public.%2$I x',
      app.table_key(t), t) into v_rows;
    v_tables := v_tables || jsonb_build_object(t, v_rows);
    v_counts := v_counts || jsonb_build_object(t, jsonb_array_length(v_rows));
    v_md5 := v_md5 || jsonb_build_object(t, md5(v_rows::text));
  end loop;
  if 'stock_balances' = any (v_scope_tables) then
    v_totals := jsonb_build_object(
      'inventory_value', (select coalesce(sum(inventory_value), 0)::text from public.stock_balances),
      'quantity', (select coalesce(sum(quantity), 0)::text from public.stock_balances));
  end if;
  return jsonb_build_object(
    'meta', jsonb_build_object(
      'format', 'whistle-backup', 'version', 1, 'schema_version', '5', 'app', 'WHISTLE',
      'scope', p_scope, 'created_at', now(), 'created_by', auth.uid(), 'note', p_note,
      'counts', v_counts, 'md5', v_md5, 'totals', v_totals),
    'tables', v_tables)::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pemeriksaan integritas (dipakai untuk database hidup dan untuk isi file backup)
-- ---------------------------------------------------------------------------
create function app.q_count(p_sql text) returns bigint
language plpgsql stable set search_path = ''
as $$
declare n bigint;
begin
  execute p_sql into n;
  return coalesce(n, 0);
end;
$$;

create function app.integrity_report(
  p_tx text, p_items text, p_mov text, p_bal text, p_prod text, p_wh text, p_open text
) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  checks jsonb := '[]'::jsonb;
  n bigint;
begin
  -- 1. rantai saldo ledger per SKU: saldo = saldo sebelumnya + masuk - keluar
  n := app.q_count(format($q$
    select count(*) from (
      select balance_quantity, balance_value,
             lag(balance_quantity, 1, 0::numeric) over w + quantity_in - quantity_out as eq,
             lag(balance_value, 1, 0::numeric) over w + value_in - value_out as ev
      from %1$s window w as (partition by product_id order by movement_sequence)) x
    where balance_quantity <> eq or balance_value <> ev$q$, p_mov));
  checks := checks || jsonb_build_object('name', 'ledger_chain', 'label', 'Rantai saldo ledger konsisten', 'ok', n = 0, 'count', n);

  -- 2. saldo resmi = saldo terakhir di ledger
  n := app.q_count(format($q$
    select count(*) from %1$s b
    left join lateral (select balance_quantity as q, balance_value as v, average_cost as a
                       from %2$s m where m.product_id = b.product_id order by movement_sequence desc limit 1) l on true
    where b.quantity is distinct from coalesce(l.q, 0)
       or b.inventory_value is distinct from coalesce(l.v, 0)
       or (l.q is not null and b.average_cost is distinct from l.a)$q$, p_bal, p_mov));
  checks := checks || jsonb_build_object('name', 'balances_match_ledger', 'label', 'Saldo resmi sama dengan saldo terakhir ledger', 'ok', n = 0, 'count', n);

  -- 3. jumlah mutasi ledger = jumlah saldo (qty dan nilai)
  n := app.q_count(format($q$
    select case when (select coalesce(sum(quantity_in - quantity_out), 0) from %1$s) = (select coalesce(sum(quantity), 0) from %2$s)
                 and (select coalesce(sum(value_in - value_out), 0) from %1$s) = (select coalesce(sum(inventory_value), 0) from %2$s)
                then 0 else 1 end$q$, p_mov, p_bal));
  checks := checks || jsonb_build_object('name', 'ledger_totals', 'label', 'Total ledger sama dengan total saldo', 'ok', n = 0, 'count', n);

  -- 4. tidak ada saldo negatif
  n := app.q_count(format('select count(*) from %1$s where quantity < 0 or inventory_value < 0 or average_cost < 0', p_bal));
  checks := checks || jsonb_build_object('name', 'no_negative', 'label', 'Tidak ada saldo negatif', 'ok', n = 0, 'count', n);

  -- 5. referensi tidak yatim
  n := app.q_count(format($q$
    select (select count(*) from %1$s i where not exists (select 1 from %2$s t where t.id = i.transaction_id))
         + (select count(*) from %1$s i where not exists (select 1 from %3$s p where p.id = i.product_id))
         + (select count(*) from %4$s m where not exists (select 1 from %1$s i where i.id = m.transaction_item_id))
         + (select count(*) from %4$s m where not exists (select 1 from %3$s p where p.id = m.product_id))
         + (select count(*) from %4$s m where not exists (select 1 from %5$s w where w.id = m.warehouse_id))
         + (select count(*) from %6$s b where not exists (select 1 from %3$s p where p.id = b.product_id))
         + (select count(*) from %6$s b where not exists (select 1 from %5$s w where w.id = b.warehouse_id))
         + (select count(*) from %7$s o where not exists (select 1 from %3$s p where p.id = o.product_id))
         + (select count(*) from %2$s t where t.reversal_of is not null and not exists (select 1 from %2$s o where o.id = t.reversal_of))$q$,
    p_items, p_tx, p_prod, p_mov, p_wh, p_bal, p_open));
  checks := checks || jsonb_build_object('name', 'references', 'label', 'Semua referensi (relasi transaksi) lengkap', 'ok', n = 0, 'count', n);

  -- 6. aturan status transaksi
  n := app.q_count(format($q$
    select (select count(*) from %1$s t where t.status in ('POSTED', 'REVERSED') and (t.posted_at is null or t.posting_sequence is null))
         + (select count(*) from %1$s t where t.status = 'POSTED' and t.transaction_type <> 'REVERSAL'
              and not exists (select 1 from %2$s i where i.transaction_id = t.id))
         + (select count(*) from %1$s t where t.status = 'REVERSED'
              and not exists (select 1 from %1$s r where r.reversal_of = t.id))$q$, p_tx, p_items));
  checks := checks || jsonb_build_object('name', 'status_rules', 'label', 'Aturan status transaksi terpenuhi', 'ok', n = 0, 'count', n);

  -- 7. urutan posting dan mutasi unik
  n := app.q_count(format($q$
    select (select count(*) from (select posting_sequence from %1$s where posting_sequence is not null group by 1 having count(*) > 1) a)
         + (select count(*) from (select movement_sequence from %2$s group by 1 having count(*) > 1) b)$q$, p_tx, p_mov));
  checks := checks || jsonb_build_object('name', 'sequences_unique', 'label', 'Urutan posting dan mutasi unik', 'ok', n = 0, 'count', n);

  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where (c ->> 'ok')::boolean = false), 'checks', checks);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cek integritas database hidup (ADMIN)
-- ---------------------------------------------------------------------------
create function public.verify_integrity() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rep jsonb;
  drift bigint;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh memeriksa integritas' using errcode = '42501';
  end if;
  rep := app.integrity_report('public.inventory_transactions', 'public.inventory_transaction_items', 'public.inventory_movements',
                              'public.stock_balances', 'public.products', 'public.warehouses', 'public.product_opening_stock');
  select count(*) into drift from public.reconcile_inventory() r where not r.ok;
  rep := jsonb_set(rep, '{checks}', (rep -> 'checks') || jsonb_build_object(
    'name', 'replay', 'label', 'Saldo sama dengan hasil replay penuh ledger', 'ok', drift = 0, 'count', drift));
  rep := jsonb_set(rep, '{ok}', to_jsonb((rep ->> 'ok')::boolean and drift = 0));
  return rep || jsonb_build_object('checked_at', now(), 'counts', jsonb_build_object(
    'products', (select count(*) from public.products),
    'transactions', (select count(*) from public.inventory_transactions),
    'movements', (select count(*) from public.inventory_movements),
    'balances', (select count(*) from public.stock_balances)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Buat backup (ADMIN). Mengembalikan TEKS JSON utuh.
-- ---------------------------------------------------------------------------
create function public.create_backup(p_scope text, p_note text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_payload text;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh membuat backup' using errcode = '42501';
  end if;
  v_payload := app.backup_payload(p_scope, p_note);
  insert into public.audit_logs (user_id, action, table_name, record_id, new_value)
  values (auth.uid(), 'BACKUP', 'database', p_scope,
          jsonb_build_object('scope', p_scope, 'note', p_note, 'size_bytes', length(v_payload),
                             'counts', (v_payload::jsonb) #> '{meta,counts}'));
  return v_payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- Validasi file backup SEBELUM restore (ADMIN). Memuat isi file ke tabel sementara dan memeriksanya.
-- ---------------------------------------------------------------------------
create function public.validate_backup(p_payload text, p_remap_users boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb;
  m jsonb;
  t text;
  v_tables text[];
  v_scope text;
  checks jsonb := '[]'::jsonb;
  v_ok boolean;
  n bigint;
  v_missing bigint := 0;
  rep jsonb;
  v_struct_ok boolean := true;
  v_load_error text;
  v_dups bigint := 0;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh memvalidasi backup' using errcode = '42501';
  end if;

  begin
    p := p_payload::jsonb;
  exception when others then
    return jsonb_build_object('ok', false, 'restorable', false, 'meta', null,
      'checks', jsonb_build_array(jsonb_build_object('name', 'format', 'label', 'File dapat dibaca sebagai JSON', 'ok', false, 'detail', 'File bukan JSON yang valid')));
  end;

  m := p -> 'meta';
  v_scope := m ->> 'scope';
  v_ok := coalesce(m ->> 'format' = 'whistle-backup', false) and (m ->> 'version') = '1';
  checks := checks || jsonb_build_object('name', 'format', 'label', 'Format file backup WHISTLE versi 1', 'ok', v_ok,
                                        'detail', case when v_ok then null else 'Bukan file backup WHISTLE yang dikenal' end);
  v_struct_ok := v_ok;
  if not v_ok then
    return jsonb_build_object('ok', false, 'restorable', false, 'meta', m, 'checks', checks);
  end if;

  v_ok := (m ->> 'schema_version') = '5';
  checks := checks || jsonb_build_object('name', 'schema', 'label', 'Versi skema database sama', 'ok', v_ok,
                                        'detail', case when v_ok then null else format('Backup skema %s, database skema 5', m ->> 'schema_version') end);
  v_struct_ok := v_struct_ok and v_ok;

  v_tables := app.scope_tables(v_scope);
  v_ok := v_tables is not null;
  checks := checks || jsonb_build_object('name', 'scope', 'label', 'Lingkup backup dikenal', 'ok', v_ok, 'detail', v_scope);
  if not v_ok then
    return jsonb_build_object('ok', false, 'restorable', false, 'meta', m, 'checks', checks);
  end if;

  -- tabel lengkap, jumlah baris, dan checksum per tabel
  foreach t in array v_tables loop
    v_ok := jsonb_typeof(p #> array['tables', t]) = 'array'
            and md5((p #> array['tables', t])::text) = (m #>> array['md5', t])
            and jsonb_array_length(p #> array['tables', t]) = (m #>> array['counts', t])::int;
    checks := checks || jsonb_build_object('name', 'table_' || t, 'label', 'Tabel ' || t || ': checksum dan jumlah baris sesuai', 'ok', coalesce(v_ok, false),
      'detail', jsonb_array_length(coalesce(p #> array['tables', t], '[]'::jsonb))::text || ' baris');
    v_struct_ok := v_struct_ok and coalesce(v_ok, false);
  end loop;

  if v_scope not in ('FULL', 'MASTER') then
    checks := checks || jsonb_build_object('name', 'restorable', 'label', 'Lingkup dapat dipulihkan', 'ok', false,
      'detail', 'Backup ' || v_scope || ' hanya untuk arsip; pemulihan dilakukan dari backup FULL atau MASTER agar relasi dan saldo konsisten');
    return jsonb_build_object('ok', v_struct_ok, 'restorable', false, 'meta', m, 'checks', checks);
  end if;

  if not v_struct_ok then
    return jsonb_build_object('ok', false, 'restorable', false, 'meta', m, 'checks', checks);
  end if;

  -- muat isi file ke tabel sementara (tidak menyentuh data asli)
  begin
    foreach t in array array['warehouses', 'products', 'product_opening_stock', 'inventory_transactions', 'inventory_transaction_items', 'inventory_movements', 'stock_balances'] loop
      continue when not (t = any (v_tables));
      execute format('drop table if exists pg_temp.bk_%1$s', t);
      execute format('create temp table bk_%1$s (like public.%1$I) on commit drop', t);
      execute format('insert into pg_temp.bk_%1$s select * from jsonb_populate_recordset(null::public.%1$I, $1)', t) using p #> array['tables', t];
    end loop;
  exception when others then
    v_load_error := sqlerrm;
  end;
  if v_load_error is not null then
    checks := checks || jsonb_build_object('name', 'load', 'label', 'Isi tabel cocok dengan skema database', 'ok', false, 'detail', v_load_error);
    return jsonb_build_object('ok', false, 'restorable', false, 'meta', m, 'checks', checks);
  end if;
  checks := checks || jsonb_build_object('name', 'load', 'label', 'Isi tabel cocok dengan skema database', 'ok', true);

  -- kunci tidak boleh ganda (tabel sementara tidak membawa primary key)
  v_dups := 0;
  foreach t in array array['warehouses', 'products', 'product_opening_stock', 'inventory_transactions', 'inventory_transaction_items', 'inventory_movements', 'stock_balances'] loop
    continue when not (t = any (v_tables));
    execute format('select count(*) from (select 1 from pg_temp.bk_%1$s group by %2$I having count(*) > 1) d', t, app.table_key(t)) into n;
    v_dups := v_dups + n;
  end loop;
  checks := checks || jsonb_build_object('name', 'unique_keys', 'label', 'Tidak ada kunci (ID) ganda di dalam file', 'ok', v_dups = 0, 'count', v_dups);

  if v_scope = 'FULL' then
    rep := app.integrity_report('pg_temp.bk_inventory_transactions', 'pg_temp.bk_inventory_transaction_items', 'pg_temp.bk_inventory_movements',
                                'pg_temp.bk_stock_balances', 'pg_temp.bk_products', 'pg_temp.bk_warehouses', 'pg_temp.bk_product_opening_stock');
    checks := checks || (rep -> 'checks');

    -- pengguna pembuat transaksi harus ada di database tujuan (atau dipetakan ke ADMIN yang memulihkan)
    select count(distinct u) into v_missing from (
      select created_by as u from pg_temp.bk_inventory_transactions
      union select approved_by from pg_temp.bk_inventory_transactions where approved_by is not null) x
    where u not in (select id from public.profiles);
    checks := checks || jsonb_build_object('name', 'users', 'label', 'Pengguna pembuat/penyetuju transaksi ada di database',
      'ok', v_missing = 0 or p_remap_users, 'count', v_missing,
      'detail', case when v_missing > 0 and not p_remap_users then v_missing || ' pengguna tidak dikenal; aktifkan opsi pemetaan ke ADMIN yang memulihkan' end);
  end if;

  v_ok := not exists (select 1 from jsonb_array_elements(checks) c where (c ->> 'ok')::boolean = false);
  return jsonb_build_object('ok', v_ok, 'restorable', v_ok, 'meta', m, 'checks', checks,
                            'missing_users', v_missing);
end;
$$;

-- ---------------------------------------------------------------------------
-- Restore (ADMIN). Atomik. Konfirmasi: p_confirm = 'PULIHKAN'.
--   FULL   : mengganti seluruh data persediaan (master, transaksi, ledger, saldo) dengan isi backup
--   MASTER : memperbarui/menambah master barang dan gudang; tidak menyentuh transaksi, ledger, dan saldo
-- Pengguna/role dan audit trail tidak diganti; restore dicatat di audit trail.
-- ---------------------------------------------------------------------------
create function public.restore_database(p_payload text, p_confirm text, p_remap_users boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
  v_scope text;
  v_point uuid;
  v_uid uuid := auth.uid();
  v_failed text;
  v_post jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_remapped bigint := 0;
  v_drift bigint;
  v_maxn bigint;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh memulihkan data' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'PULIHKAN' then
    raise exception 'Konfirmasi tidak sesuai: ketik PULIHKAN untuk melanjutkan' using errcode = 'WS003';
  end if;

  -- blokir posting selama restore
  lock table public.stock_balances, public.inventory_transactions, public.inventory_transaction_items,
             public.inventory_movements, public.product_opening_stock, public.products, public.warehouses
    in access exclusive mode;

  v := public.validate_backup(p_payload, p_remap_users);
  if not (v ->> 'restorable')::boolean then
    select string_agg(c ->> 'label', '; ') into v_failed
    from jsonb_array_elements(v -> 'checks') c where (c ->> 'ok')::boolean = false;
    raise exception 'Backup tidak lolos validasi: %', coalesce(v_failed, 'tidak dapat dipulihkan') using errcode = 'WS004';
  end if;
  v_scope := v #>> '{meta,scope}';

  -- titik pemulihan otomatis (keadaan sebelum restore)
  insert into public.backup_snapshots (created_by, scope, reason, counts, size_bytes, payload)
  select v_uid, 'FULL', 'Titik pemulihan otomatis sebelum restore ' || v_scope, (x::jsonb) #> '{meta,counts}', length(x), x
  from (select app.backup_payload('FULL', 'Titik pemulihan otomatis sebelum restore') as x) s
  returning id into v_point;
  delete from public.backup_snapshots
  where id in (select id from public.backup_snapshots order by created_at desc offset 5);

  if v_scope = 'MASTER' then
    insert into public.warehouses select * from pg_temp.bk_warehouses
    on conflict (id) do update set warehouse_code = excluded.warehouse_code, warehouse_name = excluded.warehouse_name,
                                   address = excluded.address, is_active = excluded.is_active;
    insert into public.products select * from pg_temp.bk_products
    on conflict (id) do update set sku = excluded.sku, barcode = excluded.barcode, product_name = excluded.product_name,
      category = excluded.category, brand = excluded.brand, unit = excluded.unit, location = excluded.location,
      minimum_stock = excluded.minimum_stock, is_active = excluded.is_active;
    v_counts := jsonb_build_object('warehouses', (select count(*) from pg_temp.bk_warehouses),
                                   'products', (select count(*) from pg_temp.bk_products));
  else
    -- pemetaan pengguna yang tidak dikenal ke ADMIN yang memulihkan
    if p_remap_users then
      update pg_temp.bk_inventory_transactions set created_by = v_uid where created_by not in (select id from public.profiles);
      get diagnostics v_remapped = row_count;
      update pg_temp.bk_inventory_transactions set approved_by = v_uid
      where approved_by is not null and approved_by not in (select id from public.profiles);
    end if;

    insert into app.restore_gate (txid) values (txid_current());

    delete from public.inventory_movements;
    delete from public.inventory_transaction_items;
    delete from public.inventory_transactions where reversal_of is not null;
    delete from public.inventory_transactions;
    delete from public.stock_balances;
    delete from public.product_opening_stock;
    delete from public.products;
    delete from public.warehouses;

    insert into public.warehouses select * from pg_temp.bk_warehouses;
    insert into public.products select * from pg_temp.bk_products;
    insert into public.product_opening_stock select * from pg_temp.bk_product_opening_stock;
    insert into public.inventory_transactions select * from pg_temp.bk_inventory_transactions where reversal_of is null;
    insert into public.inventory_transactions select * from pg_temp.bk_inventory_transactions where reversal_of is not null;
    insert into public.inventory_transaction_items select * from pg_temp.bk_inventory_transaction_items;
    insert into public.inventory_movements select * from pg_temp.bk_inventory_movements;
    insert into public.stock_balances select * from pg_temp.bk_stock_balances;

    -- lanjutkan urutan agar transaksi berikutnya tidak bentrok
    perform setval('public.inventory_posting_seq',
      greatest(coalesce((select max(posting_sequence) from public.inventory_transactions), 1), 1),
      exists (select 1 from public.inventory_transactions where posting_sequence is not null));
    perform setval('public.inventory_movement_seq',
      greatest(coalesce((select max(movement_sequence) from public.inventory_movements), 1), 1),
      exists (select 1 from public.inventory_movements));
    select max(substring(transaction_number from '(\d+)$')::bigint) into v_maxn from public.inventory_transactions;
    perform setval('public.transaction_number_seq', greatest(coalesce(v_maxn, 1), 1), v_maxn is not null);

    delete from app.restore_gate where txid = txid_current();

    v_counts := jsonb_build_object(
      'warehouses', (select count(*) from public.warehouses), 'products', (select count(*) from public.products),
      'transactions', (select count(*) from public.inventory_transactions), 'items', (select count(*) from public.inventory_transaction_items),
      'movements', (select count(*) from public.inventory_movements), 'balances', (select count(*) from public.stock_balances));
  end if;

  -- validasi integritas SESUDAH restore: gagal = seluruh restore dibatalkan
  v_post := app.integrity_report('public.inventory_transactions', 'public.inventory_transaction_items', 'public.inventory_movements',
                                 'public.stock_balances', 'public.products', 'public.warehouses', 'public.product_opening_stock');
  select count(*) into v_drift from public.reconcile_inventory() r where not r.ok;
  if not (v_post ->> 'ok')::boolean or v_drift > 0 then
    select string_agg(c ->> 'label', '; ') into v_failed
    from jsonb_array_elements(v_post -> 'checks') c where (c ->> 'ok')::boolean = false;
    raise exception 'Integritas setelah restore gagal, restore dibatalkan: %', coalesce(v_failed, 'saldo tidak sama dengan replay ledger') using errcode = 'WS004';
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_value)
  values (v_uid, 'RESTORE', 'database', v_point::text,
          jsonb_build_object('scope', v_scope, 'backup_created_at', v #>> '{meta,created_at}', 'backup_created_by', v #>> '{meta,created_by}',
                             'backup_note', v #>> '{meta,note}', 'restore_point_id', v_point, 'counts', v_counts,
                             'remapped_transactions', v_remapped));

  return jsonb_build_object('ok', true, 'scope', v_scope, 'restore_point_id', v_point, 'counts', v_counts,
                            'remapped_transactions', v_remapped, 'post_check', v_post);
end;
$$;

-- ---------------------------------------------------------------------------
-- Titik pemulihan
-- ---------------------------------------------------------------------------
create function public.list_restore_points() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at, 'scope', s.scope, 'reason', s.reason,
                                        'counts', s.counts, 'size_bytes', s.size_bytes,
                                        'created_by_name', coalesce(nullif(p.full_name, ''), p.email)) order by s.created_at desc)
    from public.backup_snapshots s left join public.profiles p on p.id = s.created_by), '[]'::jsonb);
end;
$$;

create function public.get_restore_point(p_id uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v text;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN' using errcode = '42501';
  end if;
  select payload into v from public.backup_snapshots where id = p_id;
  if v is null then
    raise exception 'Titik pemulihan tidak ditemukan' using errcode = 'WS003';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit trail (ADMIN)
-- ---------------------------------------------------------------------------
create function public.audit_trail(
  p_from date default null,
  p_to date default null,
  p_user uuid default null,
  p_action text default null,
  p_table text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_total bigint;
  v_rows jsonb;
begin
  if not app.is_admin() then
    raise exception 'Audit trail hanya dapat dilihat ADMIN' using errcode = '42501';
  end if;
  with f as (
    select a.*, coalesce(nullif(p.full_name, ''), p.email) as user_name
    from public.audit_logs a left join public.profiles p on p.id = a.user_id
    where (p_from is null or app.jakarta_date(a.created_at) >= p_from)
      and (p_to is null or app.jakarta_date(a.created_at) <= p_to)
      and (p_user is null or a.user_id = p_user)
      and (p_action is null or a.action = p_action)
      and (p_table is null or a.table_name = p_table)
      and (p_search is null or p_search = ''
           or a.record_id ilike app.like_pattern(p_search)
           or a.action ilike app.like_pattern(p_search)
           or a.table_name ilike app.like_pattern(p_search)
           or a.new_value::text ilike app.like_pattern(p_search)
           or a.old_value::text ilike app.like_pattern(p_search))
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'created_at', x.created_at, 'user_id', x.user_id, 'user_name', x.user_name, 'action', x.action,
             'table_name', x.table_name, 'record_id', x.record_id, 'old_value', x.old_value, 'new_value', x.new_value)
             order by x.created_at desc, x.id)
           from (select * from f order by created_at desc, id limit p_limit offset greatest(p_offset, 0)) x), '[]'::jsonb)
  into v_total, v_rows;
  return jsonb_build_object('rows', v_rows, 'total_count', v_total);
end;
$$;

create function public.audit_filters() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Audit trail hanya dapat dilihat ADMIN' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', coalesce((select jsonb_agg(a order by a) from (select distinct action as a from public.audit_logs) x), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(t order by t) from (select distinct table_name as t from public.audit_logs) x), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
                       from (select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name
                             from public.audit_logs a join public.profiles p on p.id = a.user_id) u), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------------
revoke all on function
  app.restore_active(), app.scope_tables(text), app.table_key(text), app.backup_payload(text, text), app.q_count(text),
  app.integrity_report(text, text, text, text, text, text, text)
from public, anon, authenticated;

revoke all on function
  public.verify_integrity(), public.create_backup(text, text), public.validate_backup(text, boolean),
  public.restore_database(text, text, boolean), public.list_restore_points(), public.get_restore_point(uuid),
  public.audit_trail(date, date, uuid, text, text, text, integer, integer), public.audit_filters()
from public, anon, authenticated;

grant execute on function
  public.verify_integrity(), public.create_backup(text, text), public.validate_backup(text, boolean),
  public.restore_database(text, text, boolean), public.list_restore_points(), public.get_restore_point(uuid),
  public.audit_trail(date, date, uuid, text, text, text, integer, integer), public.audit_filters()
to authenticated;
