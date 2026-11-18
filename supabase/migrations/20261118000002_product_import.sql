-- WHISTLE FASE 3: penampung stok awal dan fungsi import master barang (atomik).
--
-- Stok awal dari Excel disimpan dulu di product_opening_stock. Posting transaksi OPENING
-- (satu per SKU) dikerjakan di FASE 4 setelah mesin Moving Average tersedia.

create table public.product_opening_stock (
  product_id uuid primary key references public.products (id) on delete cascade,
  quantity numeric(20,4) not null check (quantity > 0),
  opening_value numeric(20,2) not null check (opening_value >= 0),
  average_cost numeric(20,6) not null check (average_cost >= 0),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.product_opening_stock enable row level security;
revoke all on public.product_opening_stock from anon, authenticated;
grant select on public.product_opening_stock to authenticated;
create policy product_opening_stock_select on public.product_opening_stock
for select to authenticated using (app.can_read());

-- ---------------------------------------------------------------------------
-- import_products: seluruh baris dalam satu transaksi database.
--   p_mode = 'NEW'    -> tambah barang baru (+ stok awal ke penampung)
--   p_mode = 'UPDATE' -> ubah master barang yang sudah ada. Sel kosong = tidak diubah.
--                        Tidak pernah menyentuh saldo, ledger, maupun stok awal.
-- Baris pertama yang gagal membatalkan semuanya (tidak ada data setengah jadi).
-- ---------------------------------------------------------------------------
create function public.import_products(p_rows jsonb, p_mode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  i integer := 0;
  v_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_openings integer := 0;
  v_qty numeric;
  v_val numeric;
begin
  if not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh import master barang' using errcode = '42501';
  end if;
  if p_mode not in ('NEW', 'UPDATE') then
    raise exception 'Mode import tidak valid: %', p_mode using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Data import kosong' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Maksimal 5000 baris per import' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      if nullif(btrim(r ->> 'sku'), '') is null then
        raise exception 'SKU wajib diisi' using errcode = '23514';
      end if;

      if p_mode = 'NEW' then
        v_qty := coalesce(nullif(r ->> 'opening_quantity', '')::numeric, 0);
        v_val := nullif(r ->> 'opening_value', '')::numeric;
        if v_qty < 0 or coalesce(v_val, 0) < 0 then
          raise exception 'Stok awal dan nilai persediaan awal tidak boleh negatif' using errcode = '23514';
        end if;
        if v_qty > 0 and v_val is null then
          raise exception 'Nilai persediaan awal wajib diisi jika stok awal > 0' using errcode = '23514';
        end if;
        if v_qty = 0 and coalesce(v_val, 0) <> 0 then
          raise exception 'Nilai persediaan awal harus 0 jika stok awal 0' using errcode = '23514';
        end if;

        insert into public.products
          (sku, barcode, product_name, category, brand, unit, location, minimum_stock)
        values (
          r ->> 'sku',
          nullif(r ->> 'barcode', ''),
          r ->> 'product_name',
          nullif(r ->> 'category', ''),
          nullif(r ->> 'brand', ''),
          coalesce(nullif(r ->> 'unit', ''), 'PCS'),
          nullif(r ->> 'location', ''),
          coalesce(nullif(r ->> 'minimum_stock', '')::numeric, 0)
        )
        returning id into v_id;
        v_inserted := v_inserted + 1;

        if v_qty > 0 then
          insert into public.product_opening_stock (product_id, quantity, opening_value, average_cost)
          values (v_id, v_qty, v_val, round(v_val / v_qty, 6));
          v_openings := v_openings + 1;
        end if;
      else
        select id into v_id from public.products where sku = r ->> 'sku' for update;
        if v_id is null then
          raise exception 'SKU % tidak ditemukan' , r ->> 'sku' using errcode = 'P0002';
        end if;
        update public.products set
          barcode = coalesce(nullif(r ->> 'barcode', ''), barcode),
          product_name = coalesce(nullif(r ->> 'product_name', ''), product_name),
          category = coalesce(nullif(r ->> 'category', ''), category),
          brand = coalesce(nullif(r ->> 'brand', ''), brand),
          unit = coalesce(nullif(r ->> 'unit', ''), unit),
          location = coalesce(nullif(r ->> 'location', ''), location),
          minimum_stock = coalesce(nullif(r ->> 'minimum_stock', '')::numeric, minimum_stock)
        where id = v_id;
        v_updated := v_updated + 1;
      end if;
    exception
      when unique_violation then
        raise exception 'Baris %: SKU atau barcode duplikat (SKU %)', i, coalesce(r ->> 'sku', '?')
          using errcode = '23505';
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Baris %: format angka tidak valid (SKU %)', i, coalesce(r ->> 'sku', '?')
          using errcode = '22P02';
      when check_violation then
        raise exception 'Baris %: %', i, sqlerrm using errcode = '23514';
      when no_data_found then
        raise exception 'Baris %: SKU % tidak ditemukan', i, coalesce(r ->> 'sku', '?')
          using errcode = 'P0002';
    end;
  end loop;

  insert into public.audit_logs (user_id, action, table_name, new_value)
  values (auth.uid(), 'IMPORT', 'products',
    jsonb_build_object('mode', p_mode, 'rows', i, 'inserted', v_inserted,
                       'updated', v_updated, 'openings_staged', v_openings));

  return jsonb_build_object('mode', p_mode, 'rows', i, 'inserted', v_inserted,
                            'updated', v_updated, 'openings_staged', v_openings);
end;
$$;

revoke all on function public.import_products(jsonb, text) from public, anon, authenticated;
grant execute on function public.import_products(jsonb, text) to authenticated;
