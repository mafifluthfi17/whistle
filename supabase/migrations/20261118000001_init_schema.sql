-- WHISTLE FASE 2: skema database, autentikasi, dan RLS.
-- Presisi: qty NUMERIC(20,4), unit cost NUMERIC(20,6), nilai NUMERIC(20,2), average cost NUMERIC(20,6).
-- Dilarang FLOAT/DOUBLE. Perhitungan Moving Average dikerjakan di FASE 4 (fungsi PostgreSQL).
--
-- BOOTSTRAP ADMIN PERTAMA: semua pengguna baru otomatis berperan VIEWER (hak paling kecil).
-- Setelah akun pertama dibuat, jadikan ADMIN lewat Supabase SQL Editor:
--   update public.user_roles set role = 'ADMIN'
--   where user_id = (select id from auth.users where email = 'email-anda@contoh.com');

-- ---------------------------------------------------------------------------
-- Schema internal untuk fungsi bantu (tidak diekspos sebagai API tabel)
-- ---------------------------------------------------------------------------
create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- A. profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- B. user_roles (satu role per pengguna)
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role text not null check (role in ('ADMIN', 'WAREHOUSE', 'VIEWER')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- C. warehouses (versi pertama: tepat satu gudang aktif)
-- ---------------------------------------------------------------------------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  warehouse_code text not null unique check (btrim(warehouse_code) <> ''),
  warehouse_name text not null check (btrim(warehouse_name) <> ''),
  address text,
  is_active boolean not null default true
);
create unique index warehouses_single_active on public.warehouses ((true)) where is_active;

-- ---------------------------------------------------------------------------
-- D. products (SKU dan barcode selalu teks)
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (btrim(sku) <> ''),
  barcode text unique check (barcode is null or btrim(barcode) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  category text,
  brand text,
  unit text not null default 'PCS' check (btrim(unit) <> ''),
  location text,
  minimum_stock numeric(20,4) not null default 0 check (minimum_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_name_idx on public.products (lower(product_name));
create index products_category_idx on public.products (category);

-- ---------------------------------------------------------------------------
-- E. stock_balances (hasil pembukuan; dapat dibangun ulang dari ledger)
-- ---------------------------------------------------------------------------
create table public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(20,4) not null default 0 check (quantity >= 0),
  average_cost numeric(20,6) not null default 0 check (average_cost >= 0),
  inventory_value numeric(20,2) not null default 0 check (inventory_value >= 0),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, product_id)
);
create index stock_balances_product_idx on public.stock_balances (product_id);

-- ---------------------------------------------------------------------------
-- F. inventory_transactions
-- ---------------------------------------------------------------------------
create sequence public.inventory_posting_seq;
create sequence public.inventory_movement_seq;

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text not null unique,
  client_transaction_id uuid not null unique,
  transaction_type text not null
    check (transaction_type in ('OPENING', 'IN', 'OUT', 'ADJUSTMENT', 'REVERSAL')),
  transaction_date timestamptz not null default now(),
  posting_sequence bigint unique,
  reference_number text,
  supplier_or_recipient text,
  notes text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'POSTED', 'REJECTED', 'REVERSED')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  check (status not in ('POSTED', 'REVERSED') or (posted_at is not null and posting_sequence is not null))
);
create index inv_tx_date_idx on public.inventory_transactions (transaction_date);
create index inv_tx_status_idx on public.inventory_transactions (status);
create index inv_tx_created_by_idx on public.inventory_transactions (created_by);
create index inv_tx_reference_idx on public.inventory_transactions (reference_number);

-- ---------------------------------------------------------------------------
-- G. inventory_transaction_items (banyak SKU per dokumen)
-- ---------------------------------------------------------------------------
create table public.inventory_transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.inventory_transactions (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(20,4) not null check (quantity > 0),
  unit_cost numeric(20,6) not null default 0 check (unit_cost >= 0),
  total_value numeric(20,2) not null default 0 check (total_value >= 0),
  average_cost_before numeric(20,6) check (average_cost_before is null or average_cost_before >= 0),
  average_cost_after numeric(20,6) check (average_cost_after is null or average_cost_after >= 0),
  created_at timestamptz not null default now()
);
create index inv_items_tx_idx on public.inventory_transaction_items (transaction_id);
create index inv_items_product_idx on public.inventory_transaction_items (product_id);

-- ---------------------------------------------------------------------------
-- H. inventory_movements (ledger append-only)
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  transaction_item_id uuid not null references public.inventory_transaction_items (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  movement_sequence bigint not null unique,
  movement_date timestamptz not null,
  movement_type text not null
    check (movement_type in ('OPENING', 'IN', 'OUT', 'ADJUSTMENT', 'REVERSAL')),
  quantity_in numeric(20,4) not null default 0 check (quantity_in >= 0),
  quantity_out numeric(20,4) not null default 0 check (quantity_out >= 0),
  unit_cost numeric(20,6) not null default 0 check (unit_cost >= 0),
  value_in numeric(20,2) not null default 0 check (value_in >= 0),
  value_out numeric(20,2) not null default 0 check (value_out >= 0),
  balance_quantity numeric(20,4) not null check (balance_quantity >= 0),
  balance_value numeric(20,2) not null check (balance_value >= 0),
  average_cost numeric(20,6) not null check (average_cost >= 0),
  created_at timestamptz not null default now(),
  check (quantity_in = 0 or quantity_out = 0)
);
create index inv_mov_product_seq_idx on public.inventory_movements (product_id, movement_sequence);
create index inv_mov_date_idx on public.inventory_movements (movement_date);
create index inv_mov_wh_product_idx on public.inventory_movements (warehouse_id, product_id);
create index inv_mov_item_idx on public.inventory_movements (transaction_item_id);

-- ---------------------------------------------------------------------------
-- I. audit_logs (append-only; tanpa FK agar riwayat tidak ikut terhapus)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_table_record_idx on public.audit_logs (table_name, record_id);
create index audit_created_idx on public.audit_logs (created_at);
create index audit_user_idx on public.audit_logs (user_id);

-- ---------------------------------------------------------------------------
-- Fungsi bantu role (SECURITY DEFINER agar RLS tidak rekursif)
-- Pengguna nonaktif atau tanpa role dianggap tidak punya akses sama sekali.
-- ---------------------------------------------------------------------------
create function app.current_role_name() returns text
language sql stable security definer set search_path = ''
as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active
$$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(app.current_role_name() = 'ADMIN', false) $$;

create function app.can_transact() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(app.current_role_name() in ('ADMIN', 'WAREHOUSE'), false) $$;

create function app.can_read() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(app.current_role_name() in ('ADMIN', 'WAREHOUSE', 'VIEWER'), false) $$;

-- ---------------------------------------------------------------------------
-- Trigger: profil dan role default dari auth.users
-- ---------------------------------------------------------------------------
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'VIEWER')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trigger: updated_at
-- ---------------------------------------------------------------------------
create function app.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function app.set_updated_at();
create trigger products_updated_at before update on public.products
for each row execute function app.set_updated_at();
create trigger stock_balances_updated_at before update on public.stock_balances
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: non-admin hanya boleh mengubah full_name pada profilnya sendiri.
-- auth.uid() null = konteks server (SQL Editor / service role), diizinkan.
-- ---------------------------------------------------------------------------
create function app.guard_profile_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.is_admin() then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.is_active is distinct from old.is_active then
      raise exception 'Hanya ADMIN yang boleh mengubah email atau status aktif pengguna'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
for each row execute function app.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Trigger: ledger dan audit trail bersifat append-only (berlaku untuk semua role)
-- ---------------------------------------------------------------------------
create function app.block_mutation() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Tabel % bersifat append-only: % langsung tidak diizinkan', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create trigger inventory_movements_no_update_delete
before update or delete on public.inventory_movements
for each row execute function app.block_mutation();
create trigger inventory_movements_no_truncate
before truncate on public.inventory_movements
for each statement execute function app.block_mutation();

create trigger audit_logs_no_update_delete
before update or delete on public.audit_logs
for each row execute function app.block_mutation();
create trigger audit_logs_no_truncate
before truncate on public.audit_logs
for each statement execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Trigger: audit trail otomatis untuk master dan administrasi
-- ---------------------------------------------------------------------------
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
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

create trigger products_audit after insert or update or delete on public.products
for each row execute function app.audit_row();
create trigger warehouses_audit after insert or update or delete on public.warehouses
for each row execute function app.audit_row();
create trigger user_roles_audit after insert or update or delete on public.user_roles
for each row execute function app.audit_row();
-- profil baru dibuat otomatis oleh trigger auth, jadi hanya update/delete yang dicatat
create trigger profiles_audit after update or delete on public.profiles
for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Hak akses tingkat tabel (RLS membatasi baris; GRANT membatasi operasi)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on
  public.profiles, public.user_roles, public.warehouses, public.products,
  public.stock_balances, public.inventory_transactions,
  public.inventory_transaction_items, public.inventory_movements, public.audit_logs
to authenticated;

grant update on public.profiles to authenticated;
grant insert, update, delete on public.user_roles, public.warehouses, public.products to authenticated;
grant insert on public.inventory_transactions, public.inventory_transaction_items to authenticated;

grant execute on function
  app.current_role_name(), app.is_admin(), app.can_transact(), app.can_read()
to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.stock_balances enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.inventory_transaction_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: lihat profil sendiri; ADMIN lihat dan ubah semua (kolom sensitif dijaga trigger)
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or app.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
using (app.is_admin()) with check (app.is_admin());

-- user_roles: perubahan role hanya ADMIN; pengguna hanya boleh melihat role sendiri
create policy user_roles_select on public.user_roles for select to authenticated
using (user_id = auth.uid() or app.is_admin());
create policy user_roles_insert on public.user_roles for insert to authenticated
with check (app.is_admin());
create policy user_roles_update on public.user_roles for update to authenticated
using (app.is_admin()) with check (app.is_admin());
create policy user_roles_delete on public.user_roles for delete to authenticated
using (app.is_admin());

-- warehouses dan products: semua role aktif boleh membaca; ADMIN yang mengelola
create policy warehouses_select on public.warehouses for select to authenticated
using (app.can_read());
create policy warehouses_write on public.warehouses for all to authenticated
using (app.is_admin()) with check (app.is_admin());

create policy products_select on public.products for select to authenticated
using (app.can_read());
create policy products_write on public.products for all to authenticated
using (app.is_admin()) with check (app.is_admin());

-- stock_balances dan inventory_movements: baca saja. Penulisan hanya lewat fungsi
-- posting SECURITY DEFINER (FASE 4).
create policy stock_balances_select on public.stock_balances for select to authenticated
using (app.can_read());
create policy inventory_movements_select on public.inventory_movements for select to authenticated
using (app.can_read());

-- inventory_transactions: pembuat boleh membuat DRAFT/PENDING atas namanya sendiri.
-- POSTED hanya bisa dihasilkan fungsi posting. OPENING/ADJUSTMENT/REVERSAL khusus ADMIN.
create policy inv_tx_select on public.inventory_transactions for select to authenticated
using (app.can_read());
create policy inv_tx_insert on public.inventory_transactions for insert to authenticated
with check (
  app.can_transact()
  and created_by = auth.uid()
  and status in ('DRAFT', 'PENDING')
  and posted_at is null
  and posting_sequence is null
  and approved_by is null
  and (transaction_type in ('IN', 'OUT') or app.is_admin())
);

create policy inv_items_select on public.inventory_transaction_items for select to authenticated
using (app.can_read());
create policy inv_items_insert on public.inventory_transaction_items for insert to authenticated
with check (
  app.can_transact()
  and exists (
    select 1 from public.inventory_transactions t
    where t.id = transaction_id
      and t.created_by = auth.uid()
      and t.status in ('DRAFT', 'PENDING')
  )
);

-- audit_logs: hanya ADMIN yang boleh membaca; penulisan lewat trigger/fungsi server
create policy audit_logs_select on public.audit_logs for select to authenticated
using (app.is_admin());

-- ---------------------------------------------------------------------------
-- Data awal: satu gudang aktif
-- ---------------------------------------------------------------------------
insert into public.warehouses (warehouse_code, warehouse_name)
values ('WH-01', 'Gudang Utama');
