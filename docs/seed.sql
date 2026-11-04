-- docs/seed.sql: fake demo data only. Run on an EMPTY database, never on production.
INSERT INTO vehicles (license_plate, model, device_ident, vehicle_type, last_latitude, last_longitude)
VALUES
  ('29A-00001', 'Demo Sedan 1', 'demo-001', 'sedan', 21.0285, 105.8542),
  ('29A-00002', 'Demo Sedan 2', 'demo-002', 'sedan', 21.0307, 105.8512),
  ('29A-00003', 'Demo Sedan 3', 'demo-003', 'sedan', 21.0262, 105.8570);
