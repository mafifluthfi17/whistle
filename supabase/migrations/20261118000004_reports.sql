-- WHISTLE FASE 7: kartu stok, laporan persediaan, dan dashboard.
--
-- Semua angka dihitung di database dari ledger/saldo resmi (bukan di frontend) sehingga total laporan
-- dapat direkonsiliasi. Nilai NUMERIC dikirim sebagai teks (presisi utuh). Hanya mutasi dari transaksi
-- yang sudah POSTED yang ada di ledger; transaksi PENDING/DRAFT tidak pernah dihitung sebagai saldo.
-- Tanggal dihitung pada kalender Asia/Jakarta. Semua fungsi memerlukan peran aktif (ADMIN/WAREHOUSE/VIEWER).

create function app.jakarta_date(ts timestamptz) returns date
language sql stable
as $$ select (ts at time zone 'Asia/Jakarta')::date $$;

-- format angka konsisten: qty 4 desimal, nilai 2 desimal, biaya/average 6 desimal
create function app.q4(n numeric) returns text language sql immutable as $$ select round(coalesce(n, 0), 4)::text $$;
create function app.v2(n numeric) returns text language sql immutable as $$ select round(coalesce(n, 0), 2)::text $$;
create function app.c6(n numeric) returns text language sql immutable as $$ select round(coalesce(n, 0), 6)::text $$;

-- pola LIKE aman dari input pengguna (karakter % dan _ dianggap huruf biasa)
create function app.like_pattern(p text) returns text
language sql immutable
as $$ select '%' || replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') || '%' $$;

-- ---------------------------------------------------------------------------
-- Kartu stok per SKU
--  Saldo awal  = jumlah mutasi bertanggal sebelum p_from
--  Saldo akhir = saldo awal + masuk - keluar pada periode (identitas aritmetika selalu berlaku)
--  Setiap baris memuat transaction_id/movement_id untuk ditelusuri ke transaksi sumber.
-- ---------------------------------------------------------------------------
create function public.stock_card(p_sku text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_p record;
  v_oq numeric := 0;
  v_ov numeric := 0;
  v_oa numeric := 0;
  v_rows jsonb;
  v_qin numeric; v_vin numeric; v_qout numeric; v_vout numeric;
  v_cavg numeric;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat kartu stok' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Tanggal awal tidak boleh setelah tanggal akhir' using errcode = 'WS003';
  end if;

  select id, sku, product_name, unit, category, brand, minimum_stock, is_active
  into v_p from public.products where sku = p_sku;
  if not found then
    raise exception 'SKU % tidak ditemukan', p_sku using errcode = 'WS003';
  end if;

  if p_from is not null then
    select coalesce(sum(quantity_in - quantity_out), 0), coalesce(sum(value_in - value_out), 0)
    into v_oq, v_ov
    from public.inventory_movements
    where product_id = v_p.id and app.jakarta_date(movement_date) < p_from;

    select coalesce((
      select average_cost from public.inventory_movements
      where product_id = v_p.id and app.jakarta_date(movement_date) < p_from
      order by movement_sequence desc limit 1), 0)
    into v_oa;
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.movement_sequence), '[]'::jsonb)
  into v_rows
  from (
    select m.movement_sequence,
           m.id as movement_id,
           m.movement_date,
           tr.id as transaction_id,
           tr.transaction_number,
           m.movement_type,
           tr.status as transaction_status,
           tr.reference_number,
           tr.notes,
           tr.supplier_or_recipient,
           tr.reason,
           v_p.sku as sku,
           v_p.product_name as product_name,
           m.quantity_in::text as qty_in,
           case when m.quantity_in > 0 then m.unit_cost::text end as unit_cost_in,
           m.value_in::text as value_in,
           m.quantity_out::text as qty_out,
           case when m.quantity_out > 0 then m.unit_cost::text end as unit_cost_out,
           m.value_out::text as value_out,
           m.balance_quantity::text as balance_qty,
           m.average_cost::text as average_cost,
           m.balance_value::text as balance_value,
           coalesce(nullif(pr.full_name, ''), pr.email) as user_name
    from public.inventory_movements m
    join public.inventory_transaction_items it on it.id = m.transaction_item_id
    join public.inventory_transactions tr on tr.id = it.transaction_id
    left join public.profiles pr on pr.id = tr.created_by
    where m.product_id = v_p.id
      and (p_from is null or app.jakarta_date(m.movement_date) >= p_from)
      and (p_to is null or app.jakarta_date(m.movement_date) <= p_to)
  ) t;

  select coalesce(sum(quantity_in), 0), coalesce(sum(value_in), 0), coalesce(sum(quantity_out), 0), coalesce(sum(value_out), 0)
  into v_qin, v_vin, v_qout, v_vout
  from public.inventory_movements
  where product_id = v_p.id
    and (p_from is null or app.jakarta_date(movement_date) >= p_from)
    and (p_to is null or app.jakarta_date(movement_date) <= p_to);

  select coalesce((
    select average_cost from public.inventory_movements
    where product_id = v_p.id and (p_to is null or app.jakarta_date(movement_date) <= p_to)
    order by movement_sequence desc limit 1), 0)
  into v_cavg;

  return jsonb_build_object(
    'product', jsonb_build_object('sku', v_p.sku, 'product_name', v_p.product_name, 'unit', v_p.unit,
                                  'category', v_p.category, 'brand', v_p.brand, 'is_active', v_p.is_active,
                                  'minimum_stock', v_p.minimum_stock::text),
    'from', p_from,
    'to', p_to,
    'opening', jsonb_build_object('qty', app.q4(v_oq), 'value', app.v2(v_ov), 'average_cost', app.c6(v_oa)),
    'rows', v_rows,
    'totals', jsonb_build_object('qty_in', app.q4(v_qin), 'value_in', app.v2(v_vin), 'qty_out', app.q4(v_qout), 'value_out', app.v2(v_vout)),
    'closing', jsonb_build_object('qty', app.q4(v_oq + v_qin - v_qout), 'value', app.v2(v_ov + v_vin - v_vout),
                                  'average_cost', app.c6(v_cavg))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- A. Stock Summary (juga dipakai untuk Low Stock dan Zero Stock lewat p_status)
--   Status: HABIS (qty <= 0), RENDAH (0 < qty < minimum), AMAN
--   p_status: 'LOW' = minimum > 0 dan qty < minimum (termasuk habis); 'ZERO' = qty <= 0;
--             'HABIS' | 'RENDAH' | 'AMAN' = persis status itu.
-- ---------------------------------------------------------------------------
create function public.report_stock_summary(
  p_search text default null,
  p_category text default null,
  p_status text default null,
  p_include_inactive boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_totals jsonb;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('LOW', 'ZERO', 'HABIS', 'RENDAH', 'AMAN') then
    raise exception 'Status tidak valid: %', p_status using errcode = 'WS003';
  end if;

  with base as (
    select p.sku, p.barcode, p.product_name, p.category, p.brand, p.unit, p.location, p.is_active,
           coalesce(sb.quantity, 0) as quantity,
           coalesce(sb.average_cost, 0) as average_cost,
           coalesce(sb.inventory_value, 0) as inventory_value,
           p.minimum_stock,
           case when coalesce(sb.quantity, 0) <= 0 then 'HABIS'
                when p.minimum_stock > 0 and coalesce(sb.quantity, 0) < p.minimum_stock then 'RENDAH'
                else 'AMAN' end as status
    from public.products p
    left join public.stock_balances sb on sb.product_id = p.id
    where (p_include_inactive or p.is_active)
      and (p_category is null or p.category = p_category)
      and (p_search is null or p_search = ''
           or p.sku ilike app.like_pattern(p_search)
           or p.product_name ilike app.like_pattern(p_search)
           or p.barcode ilike app.like_pattern(p_search))
  ), filtered as (
    select * from base
    where p_status is null
       or (p_status = 'LOW' and minimum_stock > 0 and quantity < minimum_stock)
       or (p_status = 'ZERO' and quantity <= 0)
       or status = p_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', sku, 'barcode', barcode, 'product_name', product_name, 'category', category, 'brand', brand,
           'unit', unit, 'location', location, 'is_active', is_active,
           'quantity', app.q4(quantity), 'average_cost', app.c6(average_cost), 'inventory_value', app.v2(inventory_value),
           'minimum_stock', app.q4(minimum_stock), 'shortage', app.q4(greatest(minimum_stock - quantity, 0)),
           'status', status) order by sku), '[]'::jsonb),
         jsonb_build_object('count', count(*), 'total_qty', app.q4(sum(quantity)),
                            'total_value', app.v2(sum(inventory_value)))
  into v_rows, v_totals
  from filtered;

  return jsonb_build_object('rows', v_rows, 'totals', v_totals);
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Inventory Valuation (+ bukti rekonsiliasi dengan ledger)
-- ---------------------------------------------------------------------------
create function public.report_valuation(p_category text default null, p_include_zero boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_totals jsonb;
  v_lq numeric;
  v_lv numeric;
  v_bq numeric;
  v_bv numeric;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_name', p.product_name, 'category', p.category, 'unit', p.unit,
           'quantity', sb.quantity::text, 'average_cost', sb.average_cost::text,
           'inventory_value', sb.inventory_value::text) order by p.sku), '[]'::jsonb),
         jsonb_build_object('count', count(*), 'total_qty', app.q4(sum(sb.quantity)),
                            'total_value', app.v2(sum(sb.inventory_value)))
  into v_rows, v_totals
  from public.stock_balances sb
  join public.products p on p.id = sb.product_id
  where (p_include_zero or sb.quantity > 0 or sb.inventory_value > 0)
    and (p_category is null or p.category = p_category);

  select coalesce(sum(quantity_in - quantity_out), 0), coalesce(sum(value_in - value_out), 0) into v_lq, v_lv
  from public.inventory_movements;
  select coalesce(sum(quantity), 0), coalesce(sum(inventory_value), 0) into v_bq, v_bv from public.stock_balances;

  return jsonb_build_object(
    'rows', v_rows,
    'totals', v_totals || jsonb_build_object(
      'all_balance_qty', app.q4(v_bq), 'all_balance_value', app.v2(v_bv),
      'ledger_qty', app.q4(v_lq), 'ledger_value', app.v2(v_lv),
      'reconciled', (v_bq = v_lq and v_bv = v_lv))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Stock Movement per periode: saldo awal, masuk, keluar (HPP), saldo akhir per SKU
--    "Masuk" = seluruh mutasi quantity_in (saldo awal, pembelian, penyesuaian masuk, koreksi reversal);
--    rincian per jenis mutasi ada di totals.by_type.
-- ---------------------------------------------------------------------------
create function public.report_movement(p_from date, p_to date, p_category text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_totals jsonb;
  v_types jsonb;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Periode (tanggal awal dan akhir) wajib diisi' using errcode = 'WS003';
  end if;
  if p_from > p_to then
    raise exception 'Tanggal awal tidak boleh setelah tanggal akhir' using errcode = 'WS003';
  end if;

  with per as (
    select m.product_id,
           coalesce(sum(m.quantity_in - m.quantity_out) filter (where app.jakarta_date(m.movement_date) < p_from), 0) as open_qty,
           coalesce(sum(m.value_in - m.value_out) filter (where app.jakarta_date(m.movement_date) < p_from), 0) as open_val,
           coalesce(sum(m.quantity_in) filter (where app.jakarta_date(m.movement_date) between p_from and p_to), 0) as qty_in,
           coalesce(sum(m.value_in) filter (where app.jakarta_date(m.movement_date) between p_from and p_to), 0) as value_in,
           coalesce(sum(m.quantity_out) filter (where app.jakarta_date(m.movement_date) between p_from and p_to), 0) as qty_out,
           coalesce(sum(m.value_out) filter (where app.jakarta_date(m.movement_date) between p_from and p_to), 0) as value_out
    from public.inventory_movements m
    where app.jakarta_date(m.movement_date) <= p_to
    group by m.product_id
  ), rows as (
    select p.sku, p.product_name, p.category, p.unit,
           per.open_qty, per.open_val, per.qty_in, per.value_in, per.qty_out, per.value_out,
           per.open_qty + per.qty_in - per.qty_out as close_qty,
           per.open_val + per.value_in - per.value_out as close_val
    from per
    join public.products p on p.id = per.product_id
    where (p_category is null or p.category = p_category)
      and (per.open_qty <> 0 or per.open_val <> 0 or per.qty_in <> 0 or per.value_in <> 0
           or per.qty_out <> 0 or per.value_out <> 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', sku, 'product_name', product_name, 'category', category, 'unit', unit,
           'opening_qty', app.q4(open_qty), 'opening_value', app.v2(open_val),
           'qty_in', app.q4(qty_in), 'value_in', app.v2(value_in),
           'qty_out', app.q4(qty_out), 'value_out', app.v2(value_out),
           'closing_qty', app.q4(close_qty), 'closing_value', app.v2(close_val)) order by sku), '[]'::jsonb),
         jsonb_build_object('count', count(*),
           'opening_qty', app.q4(sum(open_qty)), 'opening_value', app.v2(sum(open_val)),
           'qty_in', app.q4(sum(qty_in)), 'value_in', app.v2(sum(value_in)),
           'qty_out', app.q4(sum(qty_out)), 'value_out', app.v2(sum(value_out)),
           'closing_qty', app.q4(sum(close_qty)), 'closing_value', app.v2(sum(close_val)))
  into v_rows, v_totals
  from rows;

  select coalesce(jsonb_agg(jsonb_build_object(
           'movement_type', t.movement_type, 'count', t.cnt,
           'qty_in', app.q4(t.qin), 'value_in', app.v2(t.vin), 'qty_out', app.q4(t.qout), 'value_out', app.v2(t.vout))
           order by t.movement_type), '[]'::jsonb)
  into v_types
  from (
    select m.movement_type, count(*) as cnt, sum(m.quantity_in) as qin, sum(m.value_in) as vin,
           sum(m.quantity_out) as qout, sum(m.value_out) as vout
    from public.inventory_movements m
    join public.products p on p.id = m.product_id
    where app.jakarta_date(m.movement_date) between p_from and p_to
      and (p_category is null or p.category = p_category)
    group by m.movement_type
  ) t;

  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows,
                            'totals', v_totals || jsonb_build_object('by_type', v_types));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Transaction History (header dokumen) dengan filter tanggal, pengguna, jenis, status
--    Total nilai hanya menjumlah transaksi POSTED (PENDING/DRAFT/REJECTED/REVERSED tidak dihitung).
-- ---------------------------------------------------------------------------
create function public.report_transactions(
  p_from date default null,
  p_to date default null,
  p_user uuid default null,
  p_type text default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total bigint;
  v_value numeric;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('OPENING', 'IN', 'OUT', 'ADJUSTMENT', 'REVERSAL') then
    raise exception 'Jenis transaksi tidak valid: %', p_type using errcode = 'WS003';
  end if;
  if p_status is not null and p_status not in ('DRAFT', 'PENDING', 'POSTED', 'REJECTED', 'REVERSED') then
    raise exception 'Status tidak valid: %', p_status using errcode = 'WS003';
  end if;

  with f as (
    select t.*,
           coalesce(nullif(c.full_name, ''), c.email) as created_by_name,
           coalesce(nullif(a.full_name, ''), a.email) as approved_by_name,
           (select count(*) from public.inventory_transaction_items i where i.transaction_id = t.id) as item_count,
           (select coalesce(sum(i.total_value), 0) from public.inventory_transaction_items i where i.transaction_id = t.id) as total_value,
           o.transaction_number as reversal_of_number
    from public.inventory_transactions t
    left join public.profiles c on c.id = t.created_by
    left join public.profiles a on a.id = t.approved_by
    left join public.inventory_transactions o on o.id = t.reversal_of
    where (p_from is null or app.jakarta_date(t.transaction_date) >= p_from)
      and (p_to is null or app.jakarta_date(t.transaction_date) <= p_to)
      and (p_user is null or t.created_by = p_user)
      and (p_type is null or t.transaction_type = p_type)
      and (p_status is null or t.status = p_status)
      and (p_search is null or p_search = ''
           or t.transaction_number ilike app.like_pattern(p_search)
           or t.reference_number ilike app.like_pattern(p_search)
           or t.supplier_or_recipient ilike app.like_pattern(p_search))
  )
  select (select count(*) from f),
         (select coalesce(sum(total_value), 0) from f where status = 'POSTED'),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'transaction_number', x.transaction_number, 'transaction_type', x.transaction_type,
             'status', x.status, 'transaction_date', x.transaction_date, 'posted_at', x.posted_at,
             'reference_number', x.reference_number, 'supplier_or_recipient', x.supplier_or_recipient,
             'notes', x.notes, 'reason', x.reason, 'created_by', x.created_by, 'created_by_name', x.created_by_name,
             'approved_by_name', x.approved_by_name, 'item_count', x.item_count, 'total_value', app.v2(x.total_value),
             'reversal_of_number', x.reversal_of_number)
             order by x.posting_sequence desc nulls last, x.created_at desc)
           from (select * from f order by posting_sequence desc nulls last, created_at desc
                 limit p_limit offset greatest(p_offset, 0)) x), '[]'::jsonb)
  into v_total, v_value, v_rows;

  return jsonb_build_object('rows', v_rows, 'total_count', v_total,
                            'totals', jsonb_build_object('posted_total_value', app.v2(v_value)));
end;
$$;

-- Baris item per transaksi masuk/keluar (untuk export Barang Masuk dan Barang Keluar)
create function public.report_transaction_lines(p_type text, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_totals jsonb;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;
  if p_type not in ('IN', 'OUT') then
    raise exception 'Jenis harus IN atau OUT' using errcode = 'WS003';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Periode tidak valid' using errcode = 'WS003';
  end if;

  with lines as (
    select t.transaction_date, t.transaction_number, t.status, t.reference_number, t.supplier_or_recipient,
           t.notes, p.sku, p.product_name, p.unit, i.quantity, i.unit_cost, i.total_value,
           coalesce(nullif(c.full_name, ''), c.email) as created_by_name, t.posting_sequence, i.created_at
    from public.inventory_transaction_items i
    join public.inventory_transactions t on t.id = i.transaction_id
    join public.products p on p.id = i.product_id
    left join public.profiles c on c.id = t.created_by
    where t.transaction_type = p_type
      and t.status in ('POSTED', 'REVERSED')
      and app.jakarta_date(t.transaction_date) between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'transaction_date', transaction_date, 'transaction_number', transaction_number, 'status', status,
           'reference_number', reference_number, 'supplier_or_recipient', supplier_or_recipient, 'notes', notes,
           'sku', sku, 'product_name', product_name, 'unit', unit,
           'quantity', quantity::text, 'unit_cost', unit_cost::text, 'total_value', total_value::text,
           'created_by_name', created_by_name)
           order by posting_sequence nulls last, created_at), '[]'::jsonb),
         jsonb_build_object('count', count(*) filter (where status = 'POSTED'),
                            'total_qty', app.q4(sum(quantity) filter (where status = 'POSTED')),
                            'total_value', app.v2(sum(total_value) filter (where status = 'POSTED')),
                            'excluded_count', count(*) filter (where status <> 'POSTED'))
  into v_rows, v_totals
  from lines;

  return jsonb_build_object('from', p_from, 'to', p_to, 'type', p_type, 'rows', v_rows, 'totals', v_totals);
end;
$$;

-- Daftar pengguna pembuat transaksi (untuk filter)
create function public.report_transaction_users() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat laporan' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name)
    from (
      select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name
      from public.inventory_transactions t join public.profiles p on p.id = t.created_by
    ) x), '[]'::jsonb);
end;
$$;

-- Detail satu transaksi untuk penelusuran dari kartu stok
create function public.transaction_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t record;
  v_items jsonb;
  v_rev text;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat transaksi' using errcode = '42501';
  end if;
  select t.*, coalesce(nullif(c.full_name, ''), c.email) as created_by_name,
         coalesce(nullif(a.full_name, ''), a.email) as approved_by_name,
         o.transaction_number as reversal_of_number
  into v_t
  from public.inventory_transactions t
  left join public.profiles c on c.id = t.created_by
  left join public.profiles a on a.id = t.approved_by
  left join public.inventory_transactions o on o.id = t.reversal_of
  where t.id = p_id;
  if not found then
    raise exception 'Transaksi tidak ditemukan' using errcode = 'WS003';
  end if;

  select transaction_number into v_rev from public.inventory_transactions where reversal_of = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', p.sku, 'product_name', p.product_name, 'unit', p.unit,
           'quantity', i.quantity::text, 'unit_cost', i.unit_cost::text, 'total_value', i.total_value::text,
           'average_cost_before', i.average_cost_before::text, 'average_cost_after', i.average_cost_after::text,
           'movement_type', m.movement_type, 'qty_in', m.quantity_in::text, 'qty_out', m.quantity_out::text,
           'value_in', m.value_in::text, 'value_out', m.value_out::text,
           'balance_qty', m.balance_quantity::text, 'balance_value', m.balance_value::text)
           order by m.movement_sequence nulls last, i.created_at), '[]'::jsonb)
  into v_items
  from public.inventory_transaction_items i
  join public.products p on p.id = i.product_id
  left join public.inventory_movements m on m.transaction_item_id = i.id
  where i.transaction_id = p_id;

  return jsonb_build_object(
    'id', v_t.id, 'transaction_number', v_t.transaction_number, 'transaction_type', v_t.transaction_type,
    'status', v_t.status, 'transaction_date', v_t.transaction_date, 'posted_at', v_t.posted_at,
    'posting_sequence', v_t.posting_sequence, 'reference_number', v_t.reference_number,
    'supplier_or_recipient', v_t.supplier_or_recipient, 'notes', v_t.notes, 'reason', v_t.reason,
    'created_by_name', v_t.created_by_name, 'approved_by_name', v_t.approved_by_name,
    'reversal_of_number', v_t.reversal_of_number, 'reversed_by_number', v_rev, 'items', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard. Transaksi PENDING tidak masuk saldo, nilai, maupun jumlah masuk/keluar hari ini.
-- ---------------------------------------------------------------------------
create function public.dashboard_summary() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := app.jakarta_date(now());
  v_in jsonb;
  v_out jsonb;
  v_recent jsonb;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat dashboard' using errcode = '42501';
  end if;

  select jsonb_build_object('count', count(distinct tr.id), 'qty', app.q4(sum(m.quantity_in)),
                            'value', app.v2(sum(m.value_in)))
  into v_in
  from public.inventory_movements m
  join public.inventory_transaction_items it on it.id = m.transaction_item_id
  join public.inventory_transactions tr on tr.id = it.transaction_id
  where m.movement_type = 'IN' and tr.status = 'POSTED' and app.jakarta_date(m.movement_date) = v_today;

  select jsonb_build_object('count', count(distinct tr.id), 'qty', app.q4(sum(m.quantity_out)),
                            'value', app.v2(sum(m.value_out)))
  into v_out
  from public.inventory_movements m
  join public.inventory_transaction_items it on it.id = m.transaction_item_id
  join public.inventory_transactions tr on tr.id = it.transaction_id
  where m.movement_type = 'OUT' and tr.status = 'POSTED' and app.jakarta_date(m.movement_date) = v_today;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'transaction_number', x.transaction_number, 'transaction_type', x.transaction_type,
           'status', x.status, 'transaction_date', x.transaction_date, 'user_name', x.user_name,
           'item_count', x.item_count, 'total_value', app.v2(x.total_value), 'reference_number', x.reference_number)
           order by x.created_at desc), '[]'::jsonb)
  into v_recent
  from (
    select t.id, t.transaction_number, t.transaction_type, t.status, t.transaction_date, t.created_at,
           t.reference_number, coalesce(nullif(c.full_name, ''), c.email) as user_name,
           (select count(*) from public.inventory_transaction_items i where i.transaction_id = t.id) as item_count,
           (select coalesce(sum(i.total_value), 0) from public.inventory_transaction_items i where i.transaction_id = t.id) as total_value
    from public.inventory_transactions t
    left join public.profiles c on c.id = t.created_by
    order by t.created_at desc
    limit 10
  ) x;

  return jsonb_build_object(
    'today', v_today,
    'active_sku', (select count(*) from public.products where is_active),
    'total_qty', (select app.q4(sum(quantity)) from public.stock_balances),
    'total_value', (select app.v2(sum(inventory_value)) from public.stock_balances),
    'in_today', v_in,
    'out_today', v_out,
    'pending_count', (select count(*) from public.inventory_transactions where status = 'PENDING'),
    'low_stock_count', (
      select count(*) from public.products p left join public.stock_balances sb on sb.product_id = p.id
      where p.is_active and p.minimum_stock > 0 and coalesce(sb.quantity, 0) < p.minimum_stock),
    'zero_stock_count', (
      select count(*) from public.products p left join public.stock_balances sb on sb.product_id = p.id
      where p.is_active and coalesce(sb.quantity, 0) <= 0),
    'recent', v_recent
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------------
revoke all on function app.jakarta_date(timestamptz), app.like_pattern(text), app.q4(numeric), app.v2(numeric), app.c6(numeric) from public, anon, authenticated;

revoke all on function
  public.stock_card(text, date, date),
  public.report_stock_summary(text, text, text, boolean),
  public.report_valuation(text, boolean),
  public.report_movement(date, date, text),
  public.report_transactions(date, date, uuid, text, text, text, integer, integer),
  public.report_transaction_lines(text, date, date),
  public.report_transaction_users(),
  public.transaction_detail(uuid),
  public.dashboard_summary()
from public, anon, authenticated;

grant execute on function
  public.stock_card(text, date, date),
  public.report_stock_summary(text, text, text, boolean),
  public.report_valuation(text, boolean),
  public.report_movement(date, date, text),
  public.report_transactions(date, date, uuid, text, text, text, integer, integer),
  public.report_transaction_lines(text, date, date),
  public.report_transaction_users(),
  public.transaction_detail(uuid),
  public.dashboard_summary()
to authenticated;
