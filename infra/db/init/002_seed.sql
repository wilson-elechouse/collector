-- Collector V3 - minimal seed (dev)
-- NOTE: dev only. For production, seed should be explicit and audited.

BEGIN;

-- Deterministic admin seed (password_hash is placeholder for Slice-1; session auth is env-based).
INSERT INTO app_user (username, password_hash, role)
VALUES ('admin', 'DEV_ONLY_NOT_USED_YET', 'admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO vendor (name)
VALUES ('Demo Vendor')
ON CONFLICT DO NOTHING;

INSERT INTO bill (vendor_id, bill_no, amount_cents, currency, status, due_date, notes)
SELECT v.id, 'BILL-DEMO-001', 12345, 'USD', 'draft', CURRENT_DATE + INTERVAL '14 days', 'seed bill'
FROM vendor v
WHERE v.name = 'Demo Vendor'
LIMIT 1;

COMMIT;
