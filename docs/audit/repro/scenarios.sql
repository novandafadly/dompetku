-- Skenario reproduksi temuan audit v1. Jalankan di atas v1_schema_replica.sql (DB lokal, BUKAN produksi).
-- Setiap blok meniru urutan panggilan PostgREST yang persis dilakukan kode v1 (path:baris disebut di judul).
\set ON_ERROR_STOP off
\pset footer off
-- seed: 2 user, wallet, aset
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','a@test'),('00000000-0000-0000-0000-00000000000b','b@test');
insert into wallets(id,user_id,name,type,balance) values
 ('10000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','A-Bank','bank',1000000),
 ('10000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000000a','A-Cash','cash',500000),
 ('10000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b','B-Bank','bank',1000000);
insert into assets(id,user_id,name,type,value) values
 ('20000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000a','RDPU','investment',0);

create or replace function pg_temp.ledger(w uuid) returns numeric language sql as $$
 select coalesce((select sum(case when type='income' then amount else -amount end) from transactions where wallet_id=w),0)
      + coalesce((select sum(amount) from transfers where to_wallet_id=w),0)
      - coalesce((select sum(amount+coalesce(fee,0)) from transfers where from_wallet_id=w),0) $$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);

\echo '== S1 UPDATE transactions.amount tidak menyentuh saldo (savings-goals/page.tsx:513, trigger hanya INSERT/DELETE)'
insert into transactions(id,user_id,wallet_id,type,amount,date) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','expense',100000,'2026-10-01');
update transactions set amount = 300000 where id='30000000-0000-0000-0000-000000000001';
select name, balance, 1000000 - 300000 as expected_balance from wallets where id='10000000-0000-0000-0000-00000000000a';

\echo '== S2 Edit saldo dompet diam-diam diabaikan (wallets/page.tsx:61-62 vs trigger prevent_direct_balance_update)'
update wallets set balance = 42 where id='10000000-0000-0000-0000-0000000000a2' returning name, balance as balance_after_update_request_42;

\echo '== S3 Edit transaksi = DELETE lalu INSERT; INSERT gagal => transaksi hilang (transactions/page.tsx:172,180-196)'
insert into transactions(id,user_id,wallet_id,type,amount,description,date) values
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','expense',50000,'makan','2026-10-02');
-- user mengetik "-50000"; validasi client hanya !amount (172) sehingga lolos
delete from transactions where id='30000000-0000-0000-0000-000000000002';
insert into transactions(user_id,wallet_id,type,amount,description,date) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','expense',-50000,'makan','2026-10-02');
select count(*) as tx_makan_remaining from transactions where description='makan';

\echo '== S4 Edit utang menghapus semua cicilan tapi paid_amount tetap (debts/page.tsx:76-81,236,263-289)'
insert into debts(id,user_id,type,person_name,total_amount,paid_amount,wallet_id) values
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','debt','Budi',1000000,0,'10000000-0000-0000-0000-0000000000a2');
insert into transactions(user_id,wallet_id,debt_id,type,amount,description,date) values  -- pinjaman masuk (305-316)
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','40000000-0000-0000-0000-000000000001','income',1000000,'[Hutang] Budi','2026-09-01');
-- dua cicilan (submitPay 362 lalu 380)
update debts set paid_amount=200000 where id='40000000-0000-0000-0000-000000000001';
insert into transactions(user_id,wallet_id,debt_id,type,amount,description,date) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','40000000-0000-0000-0000-000000000001','expense',200000,'[Bayar Hutang] Budi','2026-09-10');
update debts set paid_amount=400000 where id='40000000-0000-0000-0000-000000000001';
insert into transactions(user_id,wallet_id,debt_id,type,amount,description,date) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','40000000-0000-0000-0000-000000000001','expense',200000,'[Bayar Hutang] Budi','2026-09-20');
select balance as cash_before_edit from wallets where id='10000000-0000-0000-0000-0000000000a2';
-- user hanya mengubah keterangan utang -> saveDebt edit mode
delete from transactions where debt_id='40000000-0000-0000-0000-000000000001';
delete from transfers where debt_id='40000000-0000-0000-0000-000000000001';
update debts set description='ganti keterangan', paid_amount=400000 where id='40000000-0000-0000-0000-000000000001';
insert into transactions(user_id,wallet_id,debt_id,type,amount,description,date) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-0000000000a2','40000000-0000-0000-0000-000000000001','income',1000000,'[Hutang] Budi','2026-10-29');
select (select balance from wallets where id='10000000-0000-0000-0000-0000000000a2') as cash_after_edit,
       (select paid_amount from debts where id='40000000-0000-0000-0000-000000000001') as paid_amount,
       (select count(*) from transactions where debt_id='40000000-0000-0000-0000-000000000001' and description like '[Bayar%') as payment_rows_left,
       (select min(date) from transactions where debt_id='40000000-0000-0000-0000-000000000001') as principal_date_now;

\echo '== S5 Edit riwayat top-up goal berbasis aset membuang to_asset_id (savings-goals/page.tsx:525-543)'
insert into savings_goals(id,user_id,name,target_amount,asset_id) values
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Dana Darurat',5000000,'20000000-0000-0000-0000-00000000000a');
insert into transfers(id,user_id,from_wallet_id,to_wallet_id,to_asset_id,amount,fee,date,savings_goal_id,savings_type) values
 ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a',null,'20000000-0000-0000-0000-00000000000a',500000,0,'2026-10-03','50000000-0000-0000-0000-000000000001','topup');
select (select value from assets where id='20000000-0000-0000-0000-00000000000a') rdpu_before, (select balance from wallets where id='10000000-0000-0000-0000-00000000000a') bank_before;
delete from transfers where id='60000000-0000-0000-0000-000000000001';
insert into transfers(user_id,from_wallet_id,to_wallet_id,amount,fee,date,savings_goal_id,savings_type) values
 ('00000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a',null,600000,0,'2026-10-03','50000000-0000-0000-0000-000000000001','topup');
select (select value from assets where id='20000000-0000-0000-0000-00000000000a') rdpu_after_edit_to_600k, (select balance from wallets where id='10000000-0000-0000-0000-00000000000a') bank_after;

\echo '== S6 Lintas-tenant: B mengubah saldo dompet A via UPDATE lalu DELETE transfer (policy UPDATE transfers hanya cek user_id)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
insert into transfers(id,user_id,from_wallet_id,to_wallet_id,amount,date) values  -- B: transfer ke dirinya? butuh 2 wallet; pakai to_wallet null
 ('60000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000b',null,1,'2026-10-04');
update transfers set to_wallet_id='10000000-0000-0000-0000-00000000000a', amount=1, from_wallet_id=null where id='60000000-0000-0000-0000-0000000000b1';
reset role;
select balance as a_bank_before_b_delete from wallets where id='10000000-0000-0000-0000-00000000000a';
set role authenticated;
delete from transfers where id='60000000-0000-0000-0000-0000000000b1';
reset role;
select balance as a_bank_after_b_delete from wallets where id='10000000-0000-0000-0000-00000000000a';

\echo '== S7 Saldo vs ledger setelah skenario (invarian saldo = saldo awal + ledger)'
select name, balance, pg_temp.ledger(id) as ledger, balance - pg_temp.ledger(id) as implied_opening from wallets order by name;
