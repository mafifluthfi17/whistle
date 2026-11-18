-- WHISTLE FASE 4: Perpetual Moving Weighted Average engine.
--
-- Seluruh pembukuan saldo dilakukan di sini (bukan di frontend):
--   public.post_transaction(...)   -> OPENING, IN, OUT, ADJUSTMENT (atomik, idempoten)
--   public.reverse_transaction(...)-> REVERSAL dengan replay penuh rangkaian mutasi SKU
--   public.post_pending_openings() -> posting stok awal hasil import FASE 3 yang belum diposting
--   public.reconcile_inventory()   -> rekonsiliasi stock_balances vs replay vs ledger
--
-- Rumus (qty NUMERIC(20,4), unit cost/avg NUMERIC(20,6), nilai NUMERIC(20,2)):
--   IN : nilai = round(qty * unit_cost, 2); avg_baru = round((nilai_lama + nilai) / (qty_lama + qty), 6)
--   OUT: HPP = round(qty * avg_sebelum, 2); saldo nilai = nilai_lama - HPP; avg tidak berubah.
--        Jika qty keluar = seluruh stok, HPP = seluruh sisa nilai (sisa pembulatan tidak tertinggal).
-- Saldo nilai selalu hasil penjumlahan mutasi nilai yang telah dibukukan (tanpa pembulatan ulang).
--
-- Kode error kustom: WS001 stok tidak mencukupi, WS002 tanggal tidak valid/mundur,
-- WS003 validasi data, WS004 reversal ditolak.

alter table public.inventory_transactions
  add column reason text,
  add column reversal_of uuid references public.inventory_transactions (id) on delete restrict;

-- satu transaksi hanya dapat direversal satu kali
create unique index inv_tx_reversal_of_unique
  on public.inventory_transactions (reversal_of) where reversal_of is not null;

create sequence public.transaction_number_seq;
revoke all on sequence public.transaction_number_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transaksi POSTED/REVERSED tidak boleh diedit atau dihapus langsung.
-- Satu-satunya perubahan yang diizinkan: POSTED -> REVERSED (oleh fungsi reversal).
-- ---------------------------------------------------------------------------
create function app.guard_posted_transaction() returns trigger
language plpgsql set search_path = ''
as $$
begin
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

create trigger inventory_transactions_guard
before update or delete on public.inventory_transactions
for each row execute function app.guard_posted_transaction();

create function app.guard_posted_items() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.inventory_transactions
  where id = coalesce(old.transaction_id, new.transaction_id);
  if v_status in ('POSTED', 'REVERSED') then
    raise exception 'Item transaksi yang sudah diposting tidak boleh diubah atau dihapus'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger inventory_transaction_items_guard
before update or delete on public.inventory_transaction_items
for each row execute function app.guard_posted_items();

-- ---------------------------------------------------------------------------
-- Hasil transaksi sebagai JSON (nilai NUMERIC dikirim sebagai teks agar presisi utuh)
-- ---------------------------------------------------------------------------
create function app.tx_result(p_tx uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'transaction_number', t.transaction_number,
    'type', t.transaction_type,
    'status', t.status,
    'posting_sequence', t.posting_sequence,
    'duplicate', p_duplicate,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sku', p.sku,
        'quantity', it.quantity::text,
        'unit_cost', it.unit_cost::text,
        'total_value', it.total_value::text,
        'average_cost_before', it.average_cost_before::text,
        'average_cost_after', it.average_cost_after::text,
        'balance_quantity', mv.balance_quantity::text,
        'balance_value', mv.balance_value::text
      ) order by mv.movement_sequence, it.created_at)
      from public.inventory_transaction_items it
      join public.products p on p.id = it.product_id
      left join public.inventory_movements mv on mv.transaction_item_id = it.id
      where it.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.inventory_transactions t
  where t.id = p_tx
$$;

-- ---------------------------------------------------------------------------
-- Replay: hitung ulang saldo satu SKU dari ledger efektif.
-- Ledger efektif = mutasi dari transaksi POSTED yang bukan REVERSAL (transaksi yang
-- sudah direversal dan dokumen reversalnya keluar dari perhitungan).
-- ---------------------------------------------------------------------------
create function app.replay_product(p_product uuid, p_exclude uuid default null)
returns table (r_qty numeric, r_val numeric, r_avg numeric, r_ok boolean, r_msg text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  m record;
  q numeric := 0;
  v numeric := 0;
  a numeric := 0;
  hpp numeric;
begin
  for m in
    select mv.quantity_in, mv.quantity_out, mv.value_in, t.transaction_number
    from public.inventory_movements mv
    join public.inventory_transaction_items it on it.id = mv.transaction_item_id
    join public.inventory_transactions t on t.id = it.transaction_id
    where mv.product_id = p_product
      and t.status = 'POSTED'
      and t.transaction_type <> 'REVERSAL'
      and t.id is distinct from p_exclude
    order by mv.movement_sequence
  loop
    if m.quantity_in > 0 then
      q := q + m.quantity_in;
      v := v + m.value_in;
      a := round(v / q, 6);
    else
      if m.quantity_out > q then
        return query select q, v, a, false,
          format('stok menjadi negatif pada transaksi %s (tersedia %s, keluar %s)', m.transaction_number, q, m.quantity_out);
        return;
      end if;
      hpp := case when m.quantity_out = q then v else round(m.quantity_out * a, 2) end;
      if hpp > v then hpp := v; end if;
      q := q - m.quantity_out;
      v := v - hpp;
    end if;
  end loop;
  return query select q, v, a, true, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Posting dokumen OPENING / IN / OUT / ADJUSTMENT (internal; tanpa cek hak akses)
-- Item: {sku, quantity, unit_cost}            untuk IN
--       {sku, quantity}                        untuk OUT
--       {sku, quantity, total_value}           untuk OPENING
--       {sku, quantity, direction, unit_cost?} untuk ADJUSTMENT (direction IN/OUT)
-- ---------------------------------------------------------------------------
create function app.post_document(
  p_user uuid,
  p_client_id uuid,
  p_type text,
  p_date timestamptz,
  p_reference text,
  p_party text,
  p_notes text,
  p_reason text,
  p_items jsonb,
  p_allow_backdate boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_prod record;
  v_wh uuid;
  v_tx uuid;
  v_number text;
  v_prefix text;
  v_seq bigint;
  v_pids uuid[] := '{}';
  v_dir text;
  v_existing uuid;
  v_creator uuid;
  v_last timestamptz;
  v_backdated boolean := false;
  v_item uuid;
  q numeric; uc numeric; tv numeric;
  bq numeric; ba numeric; bv numeric;
  nq numeric; nv numeric; na numeric;
  hpp numeric;
begin
  if p_type not in ('OPENING', 'IN', 'OUT', 'ADJUSTMENT') then
    raise exception 'Jenis transaksi tidak valid: %', p_type using errcode = 'WS003';
  end if;
  if p_client_id is null then
    raise exception 'client_transaction_id wajib diisi' using errcode = 'WS003';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dokumen harus memiliki minimal satu item' using errcode = 'WS003';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Maksimal 500 item per dokumen' using errcode = 'WS003';
  end if;

  -- Idempotensi: retry dengan client_transaction_id yang sama mengembalikan hasil yang sama
  select id, created_by into v_existing, v_creator
  from public.inventory_transactions where client_transaction_id = p_client_id;
  if v_existing is not null then
    if v_creator <> p_user then
      raise exception 'client_transaction_id sudah dipakai pengguna lain' using errcode = 'WS003';
    end if;
    return app.tx_result(v_existing, true);
  end if;

  if p_type = 'ADJUSTMENT'
     and (btrim(coalesce(p_reason, '')) = '' or btrim(coalesce(p_reference, '')) = '') then
    raise exception 'Adjustment wajib memiliki alasan dan nomor referensi' using errcode = 'WS003';
  end if;
  if p_date > now() + interval '1 day' then
    raise exception 'Tanggal transaksi tidak boleh di masa depan' using errcode = 'WS002';
  end if;

  select id into v_wh from public.warehouses where is_active;
  if v_wh is null then
    raise exception 'Tidak ada gudang aktif' using errcode = 'WS003';
  end if;

  -- Tahap 1: validasi setiap baris dan kumpulkan SKU
  for r in select e.value as j, e.ord as ord
           from jsonb_array_elements(p_items) with ordinality as e(value, ord)
  loop
    if jsonb_typeof(r.j) <> 'object' then
      raise exception 'Baris %: format item tidak valid', r.ord using errcode = 'WS003';
    end if;
    select id, sku, is_active into v_prod from public.products where sku = r.j ->> 'sku';
    if not found then
      raise exception 'Baris %: SKU % tidak ditemukan', r.ord, coalesce(r.j ->> 'sku', '?') using errcode = 'WS003';
    end if;
    if not v_prod.is_active then
      raise exception 'Baris %: barang % tidak aktif', r.ord, v_prod.sku using errcode = 'WS003';
    end if;

    q := (r.j ->> 'quantity')::numeric;
    if q is null or q <= 0 then
      raise exception 'Baris %: quantity harus lebih dari 0', r.ord using errcode = 'WS003';
    end if;
    if q <> round(q, 4) or q >= 1e16 then
      raise exception 'Baris %: quantity maksimal 4 angka desimal', r.ord using errcode = 'WS003';
    end if;

    if p_type = 'IN' then
      uc := (r.j ->> 'unit_cost')::numeric;
      if uc is null or uc < 0 then
        raise exception 'Baris %: harga beli per unit wajib diisi (>= 0)', r.ord using errcode = 'WS003';
      end if;
      if uc <> round(uc, 6) or uc >= 1e14 then
        raise exception 'Baris %: harga beli maksimal 6 angka desimal', r.ord using errcode = 'WS003';
      end if;
    elsif p_type = 'OPENING' then
      tv := (r.j ->> 'total_value')::numeric;
      if tv is null or tv < 0 then
        raise exception 'Baris %: nilai persediaan awal wajib diisi (>= 0)', r.ord using errcode = 'WS003';
      end if;
      if tv <> round(tv, 2) or tv >= 1e18 then
        raise exception 'Baris %: nilai persediaan maksimal 2 angka desimal', r.ord using errcode = 'WS003';
      end if;
    elsif p_type = 'ADJUSTMENT' then
      v_dir := upper(coalesce(r.j ->> 'direction', ''));
      if v_dir not in ('IN', 'OUT') then
        raise exception 'Baris %: direction adjustment harus IN atau OUT', r.ord using errcode = 'WS003';
      end if;
      uc := nullif(r.j ->> 'unit_cost', '')::numeric;
      if uc is not null and (uc < 0 or uc <> round(uc, 6) or uc >= 1e14) then
        raise exception 'Baris %: harga satuan tidak valid', r.ord using errcode = 'WS003';
      end if;
    end if;

    if not (v_prod.id = any (v_pids)) then
      v_pids := v_pids || v_prod.id;
    end if;
  end loop;

  -- Kunci baris saldo dalam urutan SKU yang konsisten (mencegah deadlock)
  insert into public.stock_balances (warehouse_id, product_id)
  select v_wh, unnest(v_pids)
  on conflict (warehouse_id, product_id) do nothing;

  perform 1
  from public.stock_balances sb
  join public.products p on p.id = sb.product_id
  where sb.warehouse_id = v_wh and sb.product_id = any (v_pids)
  order by p.sku
  for update of sb;

  -- Transaksi bertanggal mundur (dibandingkan per tanggal kalender Asia/Jakarta)
  if p_type <> 'OPENING' then
    select max(movement_date) into v_last from public.inventory_movements where product_id = any (v_pids);
    if v_last is not null
       and (p_date at time zone 'Asia/Jakarta')::date < (v_last at time zone 'Asia/Jakarta')::date then
      if not p_allow_backdate then
        raise exception 'Transaksi bertanggal mundur (% < mutasi terakhir %) tidak dapat langsung diposting; minta ADMIN menyetujuinya',
          (p_date at time zone 'Asia/Jakarta')::date, (v_last at time zone 'Asia/Jakarta')::date
          using errcode = 'WS002';
      end if;
      v_backdated := true;
    end if;
  end if;

  -- Nomor dan urutan resmi dibuat server setelah semua kunci diperoleh
  v_prefix := case p_type when 'OPENING' then 'OPN' when 'IN' then 'IN' when 'OUT' then 'OUT' else 'ADJ' end;
  v_seq := nextval('public.inventory_posting_seq');
  v_number := v_prefix || '-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
              || lpad(nextval('public.transaction_number_seq')::text, 6, '0');

  insert into public.inventory_transactions
    (transaction_number, client_transaction_id, transaction_type, transaction_date, posting_sequence,
     reference_number, supplier_or_recipient, notes, reason, status, created_by, approved_by, posted_at)
  values
    (v_number, p_client_id, p_type, p_date, v_seq,
     nullif(btrim(p_reference), ''), nullif(btrim(p_party), ''), nullif(btrim(p_notes), ''),
     nullif(btrim(p_reason), ''), 'POSTED', p_user,
     case when p_type in ('OPENING', 'ADJUSTMENT') then p_user end, now())
  on conflict (client_transaction_id) do nothing
  returning id into v_tx;

  if v_tx is null then
    -- pemanggil lain memposting client_transaction_id yang sama secara bersamaan
    select id, created_by into v_existing, v_creator
    from public.inventory_transactions where client_transaction_id = p_client_id;
    if v_creator <> p_user then
      raise exception 'client_transaction_id sudah dipakai pengguna lain' using errcode = 'WS003';
    end if;
    return app.tx_result(v_existing, true);
  end if;

  -- Tahap 2: pembukuan, urut SKU lalu urutan baris
  for r in select e.value as j, e.ord as ord
           from jsonb_array_elements(p_items) with ordinality as e(value, ord)
           order by (e.value ->> 'sku'), e.ord
  loop
    select id, sku into v_prod from public.products where sku = r.j ->> 'sku';
    q := (r.j ->> 'quantity')::numeric;
    select quantity, average_cost, inventory_value into bq, ba, bv
    from public.stock_balances where warehouse_id = v_wh and product_id = v_prod.id;

    v_dir := case p_type when 'OUT' then 'OUT' when 'ADJUSTMENT' then upper(r.j ->> 'direction') else 'IN' end;

    if v_dir = 'IN' then
      if p_type = 'OPENING' then
        if exists (select 1 from public.inventory_movements where product_id = v_prod.id) then
          raise exception 'Baris %: SKU % sudah memiliki mutasi; saldo awal hanya boleh satu kali', r.ord, v_prod.sku
            using errcode = 'WS003';
        end if;
        tv := (r.j ->> 'total_value')::numeric;
        uc := round(tv / q, 6);
      else
        uc := nullif(r.j ->> 'unit_cost', '')::numeric;
        if uc is null then
          if bq = 0 then
            raise exception 'Baris %: harga satuan wajib diisi karena stok SKU % nol', r.ord, v_prod.sku
              using errcode = 'WS003';
          end if;
          uc := ba;
        end if;
        tv := round(q * uc, 2);
      end if;
      nq := bq + q;
      nv := bv + tv;
      na := round(nv / nq, 6);
    else
      if q > bq then
        raise exception 'Stok tidak mencukupi untuk SKU %: tersedia %, diminta %', v_prod.sku, bq, q
          using errcode = 'WS001';
      end if;
      hpp := case when q = bq then bv else round(q * ba, 2) end;
      if hpp > bv then hpp := bv; end if;
      uc := ba;
      tv := hpp;
      nq := bq - q;
      nv := bv - hpp;
      na := ba;
    end if;

    insert into public.inventory_transaction_items
      (transaction_id, product_id, quantity, unit_cost, total_value, average_cost_before, average_cost_after)
    values (v_tx, v_prod.id, q, uc, tv, ba, na)
    returning id into v_item;

    insert into public.inventory_movements
      (transaction_item_id, product_id, warehouse_id, movement_sequence, movement_date, movement_type,
       quantity_in, quantity_out, unit_cost, value_in, value_out, balance_quantity, balance_value, average_cost)
    values
      (v_item, v_prod.id, v_wh, nextval('public.inventory_movement_seq'), p_date, p_type,
       case when v_dir = 'IN' then q else 0 end, case when v_dir = 'OUT' then q else 0 end, uc,
       case when v_dir = 'IN' then tv else 0 end, case when v_dir = 'OUT' then tv else 0 end,
       nq, nv, na);

    update public.stock_balances
    set quantity = nq, average_cost = na, inventory_value = nv
    where warehouse_id = v_wh and product_id = v_prod.id;
  end loop;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_value)
  values (p_user, 'POST', 'inventory_transactions', v_tx::text,
          jsonb_build_object('type', p_type, 'number', v_number, 'posting_sequence', v_seq,
                             'items', jsonb_array_length(p_items), 'reference', p_reference));
  if v_backdated then
    insert into public.audit_logs (user_id, action, table_name, record_id, new_value)
    values (p_user, 'BACKDATED_POST', 'inventory_transactions', v_tx::text,
            jsonb_build_object('transaction_date', p_date, 'last_movement_date', v_last, 'number', v_number));
  end if;

  return app.tx_result(v_tx, false);
exception
  when invalid_text_representation or numeric_value_out_of_range or division_by_zero then
    raise exception 'Format angka pada item tidak valid' using errcode = 'WS003';
end;
$$;

-- ---------------------------------------------------------------------------
-- Reversal (internal): replay penuh rangkaian mutasi SKU tanpa transaksi asal.
-- Saldo saat ini dipindahkan ke hasil replay lewat mutasi REVERSAL (ledger tetap append-only).
-- ---------------------------------------------------------------------------
create function app.post_reversal(p_user uuid, p_client_id uuid, p_original uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig record;
  v_wh uuid;
  v_tx uuid;
  v_number text;
  v_seq bigint;
  v_existing uuid;
  v_creator uuid;
  v_pids uuid[];
  r record;
  rs record;
  v_plan jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  bq numeric; ba numeric; bv numeric;
  nq numeric; nv numeric; na numeric;
  dq numeric; dv numeric;
  v_item uuid;
  v_ucost numeric;
begin
  if p_client_id is null then
    raise exception 'client_transaction_id wajib diisi' using errcode = 'WS003';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Alasan reversal wajib diisi' using errcode = 'WS003';
  end if;

  select id, created_by into v_existing, v_creator
  from public.inventory_transactions where client_transaction_id = p_client_id;
  if v_existing is not null then
    if v_creator <> p_user then
      raise exception 'client_transaction_id sudah dipakai pengguna lain' using errcode = 'WS003';
    end if;
    return app.tx_result(v_existing, true);
  end if;

  select * into v_orig from public.inventory_transactions where id = p_original for update;
  if not found then
    raise exception 'Transaksi asal tidak ditemukan' using errcode = 'WS004';
  end if;
  if v_orig.status = 'REVERSED' then
    raise exception 'Transaksi % sudah direversal', v_orig.transaction_number using errcode = 'WS004';
  end if;
  if v_orig.status <> 'POSTED' then
    raise exception 'Hanya transaksi POSTED yang dapat direversal' using errcode = 'WS004';
  end if;
  if v_orig.transaction_type not in ('IN', 'OUT', 'ADJUSTMENT') then
    raise exception 'Transaksi % tidak dapat direversal; gunakan adjustment', v_orig.transaction_type
      using errcode = 'WS004';
  end if;

  select id into v_wh from public.warehouses where is_active;
  select array_agg(distinct product_id) into v_pids
  from public.inventory_transaction_items where transaction_id = p_original;

  perform 1
  from public.stock_balances sb
  join public.products p on p.id = sb.product_id
  where sb.warehouse_id = v_wh and sb.product_id = any (v_pids)
  order by p.sku
  for update of sb;

  -- Rencana: hasil replay tanpa transaksi asal untuk setiap SKU terdampak
  for r in
    select it.product_id, p.sku, sum(it.quantity) as sum_q, sum(it.total_value) as sum_v
    from public.inventory_transaction_items it
    join public.products p on p.id = it.product_id
    where it.transaction_id = p_original
    group by it.product_id, p.sku
    order by p.sku
  loop
    select * into rs from app.replay_product(r.product_id, p_original);
    if not rs.r_ok then
      raise exception 'Reversal ditolak untuk SKU %: %', r.sku, rs.r_msg using errcode = 'WS004';
    end if;
    v_plan := v_plan || jsonb_build_object(
      'product_id', r.product_id, 'sku', r.sku, 'sum_q', r.sum_q, 'sum_v', r.sum_v,
      'qty', rs.r_qty, 'val', rs.r_val, 'avg', rs.r_avg);
  end loop;

  v_seq := nextval('public.inventory_posting_seq');
  v_number := 'REV-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
              || lpad(nextval('public.transaction_number_seq')::text, 6, '0');

  insert into public.inventory_transactions
    (transaction_number, client_transaction_id, transaction_type, transaction_date, posting_sequence,
     reference_number, notes, reason, status, created_by, approved_by, posted_at, reversal_of)
  values
    (v_number, p_client_id, 'REVERSAL', now(), v_seq,
     v_orig.transaction_number, 'Reversal ' || v_orig.transaction_number, btrim(p_reason),
     'POSTED', p_user, p_user, now(), p_original)
  on conflict (client_transaction_id) do nothing
  returning id into v_tx;

  if v_tx is null then
    select id into v_existing from public.inventory_transactions where client_transaction_id = p_client_id;
    return app.tx_result(v_existing, true);
  end if;

  for r in select e.value as j from jsonb_array_elements(v_plan) as e(value) loop
    select quantity, average_cost, inventory_value into bq, ba, bv
    from public.stock_balances
    where warehouse_id = v_wh and product_id = (r.j ->> 'product_id')::uuid;

    nq := (r.j ->> 'qty')::numeric;
    nv := (r.j ->> 'val')::numeric;
    na := (r.j ->> 'avg')::numeric;
    dq := nq - bq;
    dv := nv - bv;
    v_ucost := case when (r.j ->> 'sum_q')::numeric > 0
                    then round((r.j ->> 'sum_v')::numeric / (r.j ->> 'sum_q')::numeric, 6) else 0 end;

    insert into public.inventory_transaction_items
      (transaction_id, product_id, quantity, unit_cost, total_value, average_cost_before, average_cost_after)
    values (v_tx, (r.j ->> 'product_id')::uuid, (r.j ->> 'sum_q')::numeric, v_ucost,
            (r.j ->> 'sum_v')::numeric, ba, na)
    returning id into v_item;

    insert into public.inventory_movements
      (transaction_item_id, product_id, warehouse_id, movement_sequence, movement_date, movement_type,
       quantity_in, quantity_out, unit_cost, value_in, value_out, balance_quantity, balance_value, average_cost)
    values
      (v_item, (r.j ->> 'product_id')::uuid, v_wh, nextval('public.inventory_movement_seq'), now(), 'REVERSAL',
       greatest(dq, 0), greatest(-dq, 0), v_ucost, greatest(dv, 0), greatest(-dv, 0), nq, nv, na);

    update public.stock_balances
    set quantity = nq, average_cost = na, inventory_value = nv
    where warehouse_id = v_wh and product_id = (r.j ->> 'product_id')::uuid;

    v_changes := v_changes || jsonb_build_object(
      'sku', r.j ->> 'sku',
      'before', jsonb_build_object('quantity', bq, 'value', bv, 'average_cost', ba),
      'after', jsonb_build_object('quantity', nq, 'value', nv, 'average_cost', na));
  end loop;

  update public.inventory_transactions set status = 'REVERSED' where id = p_original;

  insert into public.audit_logs (user_id, action, table_name, record_id, old_value, new_value)
  values (p_user, 'REVERSAL', 'inventory_transactions', p_original::text,
          jsonb_build_object('status', 'POSTED', 'number', v_orig.transaction_number),
          jsonb_build_object('status', 'REVERSED', 'reversal_transaction_id', v_tx,
                             'reversal_number', v_number, 'reason', btrim(p_reason), 'changes', v_changes));

  return app.tx_result(v_tx, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- API publik (hak akses divalidasi di database)
-- ---------------------------------------------------------------------------
create function public.post_transaction(
  p_client_transaction_id uuid,
  p_type text,
  p_date timestamptz,
  p_reference text,
  p_party text,
  p_notes text,
  p_items jsonb,
  p_reason text default null,
  p_allow_backdate boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sesi tidak valid' using errcode = '42501';
  end if;
  if p_type in ('IN', 'OUT') then
    if not app.can_transact() then
      raise exception 'Anda tidak berhak mencatat transaksi' using errcode = '42501';
    end if;
  elsif p_type in ('OPENING', 'ADJUSTMENT') then
    if not app.is_admin() then
      raise exception 'Hanya ADMIN yang boleh memposting % ', p_type using errcode = '42501';
    end if;
  else
    raise exception 'Jenis transaksi tidak valid: % (REVERSAL memakai reverse_transaction)', p_type
      using errcode = 'WS003';
  end if;
  if p_allow_backdate and not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh menyetujui transaksi bertanggal mundur' using errcode = '42501';
  end if;
  return app.post_document(auth.uid(), p_client_transaction_id, p_type, coalesce(p_date, now()),
                           p_reference, p_party, p_notes, p_reason, p_items, coalesce(p_allow_backdate, false));
end;
$$;

create function public.reverse_transaction(p_client_transaction_id uuid, p_original uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh melakukan reversal' using errcode = '42501';
  end if;
  return app.post_reversal(auth.uid(), p_client_transaction_id, p_original, p_reason);
end;
$$;

create function public.post_pending_openings() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  if auth.uid() is null or not app.is_admin() then
    raise exception 'Hanya ADMIN yang boleh memposting saldo awal' using errcode = '42501';
  end if;
  for r in
    select s.product_id, s.quantity, s.opening_value, p.sku
    from public.product_opening_stock s
    join public.products p on p.id = s.product_id
    where s.posted_at is null
    order by p.sku
  loop
    perform app.post_document(
      auth.uid(), md5('opening:' || r.product_id::text)::uuid, 'OPENING', now(), 'OPENING', null,
      'Saldo awal', null,
      jsonb_build_array(jsonb_build_object('sku', r.sku, 'quantity', r.quantity::text, 'total_value', r.opening_value::text)),
      false);
    update public.product_opening_stock set posted_at = now() where product_id = r.product_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Rekonsiliasi: saldo vs replay ledger efektif vs jumlah mutasi di ledger
create function public.reconcile_inventory()
returns table (
  sku text,
  balance_qty numeric, balance_value numeric, balance_avg numeric,
  replay_qty numeric, replay_value numeric, replay_avg numeric,
  ledger_qty numeric, ledger_value numeric,
  ok boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  rs record;
  lq numeric;
  lv numeric;
begin
  if not app.can_read() then
    raise exception 'Anda tidak berhak melihat rekonsiliasi' using errcode = '42501';
  end if;
  for r in
    select sb.product_id, p.sku as p_sku, sb.quantity, sb.inventory_value, sb.average_cost
    from public.stock_balances sb
    join public.products p on p.id = sb.product_id
    order by p.sku
  loop
    select * into rs from app.replay_product(r.product_id, null);
    select coalesce(sum(m.quantity_in - m.quantity_out), 0), coalesce(sum(m.value_in - m.value_out), 0)
    into lq, lv
    from public.inventory_movements m where m.product_id = r.product_id;

    sku := r.p_sku;
    balance_qty := r.quantity; balance_value := r.inventory_value; balance_avg := r.average_cost;
    replay_qty := rs.r_qty; replay_value := rs.r_val; replay_avg := rs.r_avg;
    ledger_qty := lq; ledger_value := lv;
    ok := rs.r_ok
      and r.quantity = rs.r_qty and r.inventory_value = rs.r_val and r.average_cost = rs.r_avg
      and r.quantity = lq and r.inventory_value = lv;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hak eksekusi: fungsi internal tertutup; API publik hanya untuk pengguna login
-- ---------------------------------------------------------------------------
revoke all on function
  app.guard_posted_transaction(), app.guard_posted_items(), app.tx_result(uuid, boolean),
  app.replay_product(uuid, uuid),
  app.post_document(uuid, uuid, text, timestamptz, text, text, text, text, jsonb, boolean),
  app.post_reversal(uuid, uuid, uuid, text)
from public, anon, authenticated;

revoke all on function
  public.post_transaction(uuid, text, timestamptz, text, text, text, jsonb, text, boolean),
  public.reverse_transaction(uuid, uuid, text),
  public.post_pending_openings(),
  public.reconcile_inventory()
from public, anon, authenticated;

grant execute on function
  public.post_transaction(uuid, text, timestamptz, text, text, text, jsonb, text, boolean),
  public.reverse_transaction(uuid, uuid, text),
  public.post_pending_openings(),
  public.reconcile_inventory()
to authenticated;

-- ---------------------------------------------------------------------------
-- Import master (FASE 3) kini langsung memposting OPENING satu per SKU,
-- dalam transaksi database yang sama (atomik).
-- ---------------------------------------------------------------------------
create or replace function public.import_products(p_rows jsonb, p_mode text)
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
          -- satu transaksi OPENING per SKU, idempoten lewat client_transaction_id turunan
          perform app.post_document(
            auth.uid(), md5('opening:' || v_id::text)::uuid, 'OPENING', now(), 'IMPORT', null,
            'Saldo awal dari import Excel', null,
            jsonb_build_array(jsonb_build_object('sku', r ->> 'sku', 'quantity', v_qty::text, 'total_value', v_val::text)),
            false);
          update public.product_opening_stock set posted_at = now() where product_id = v_id;
          v_openings := v_openings + 1;
        end if;
      else
        select id into v_id from public.products where sku = r ->> 'sku' for update;
        if v_id is null then
          raise exception 'SKU % tidak ditemukan', r ->> 'sku' using errcode = 'P0002';
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
      when sqlstate 'WS003' then
        raise exception 'Baris %: %', i, sqlerrm using errcode = 'WS003';
      when no_data_found then
        raise exception 'Baris %: SKU % tidak ditemukan', i, coalesce(r ->> 'sku', '?')
          using errcode = 'P0002';
    end;
  end loop;

  insert into public.audit_logs (user_id, action, table_name, new_value)
  values (auth.uid(), 'IMPORT', 'products',
    jsonb_build_object('mode', p_mode, 'rows', i, 'inserted', v_inserted,
                       'updated', v_updated, 'openings_posted', v_openings));

  return jsonb_build_object('mode', p_mode, 'rows', i, 'inserted', v_inserted,
                            'updated', v_updated, 'openings_staged', v_openings,
                            'openings_posted', v_openings);
end;
$$;

revoke all on function public.import_products(jsonb, text) from public, anon, authenticated;
grant execute on function public.import_products(jsonb, text) to authenticated;
