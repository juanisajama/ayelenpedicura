CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,category TEXT NOT NULL CHECK(category IN('Pedicura','Manicura')),name TEXT NOT NULL,description TEXT,price INTEGER NOT NULL CHECK(price>=0),minutes INTEGER NOT NULL CHECK(minutes>0),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,notes TEXT,date TEXT NOT NULL,start_min INTEGER NOT NULL,duration INTEGER NOT NULL,services TEXT NOT NULL,total INTEGER NOT NULL,deposit_pct INTEGER NOT NULL,deposit INTEGER NOT NULL,balance INTEGER NOT NULL,pay_method TEXT NOT NULL,pay_status TEXT NOT NULL DEFAULT 'pending',status TEXT NOT NULL,mp_payment_id TEXT,expires_at INTEGER,created_at INTEGER NOT NULL);
-- La clave primaria impide a nivel de base que dos turnos ocupen el mismo bloque
CREATE TABLE IF NOT EXISTS slots(date TEXT NOT NULL,start_min INTEGER NOT NULL,booking_id TEXT NOT NULL REFERENCES bookings(id),PRIMARY KEY(date,start_min));
CREATE TABLE IF NOT EXISTS blocks(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,start_min INTEGER NOT NULL,end_min INTEGER NOT NULL,reason TEXT);
CREATE TABLE IF NOT EXISTS payments(provider_id TEXT PRIMARY KEY,booking_id TEXT NOT NULL,provider TEXT NOT NULL,status TEXT,amount REAL,created_at INTEGER NOT NULL);
INSERT OR IGNORE INTO settings VALUES('whatsapp','5491136009440'),('deposit_pct','15'),('open','9'),('close','19'),('step','30'),('closed_days','0'),('pending_minutes','30'),('transfer_minutes','1440'),('antimicotico_extra_price','2500'),('bank_alias','COMPLETAR.ALIAS'),('bank_cbu','COMPLETAR'),('bank_titular','COMPLETAR'),('bank_banco','COMPLETAR'),('policy','Podés reprogramar con 24 h de anticipación. La seña no es reembolsable salvo cancelación del local.');
INSERT OR IGNORE INTO services VALUES
('p1','Pedicura','Pedicura tradicional','Higiene, corte, limado y cuidado de cutículas.',18000,60,1),
('p2','Pedicura','Pedicura con semipermanente','Pedicura completa con esmaltado semipermanente.',24000,90,1),
('p3','Pedicura','Pedicura spa','Exfoliación, hidratación profunda y masaje.',26000,90,1),
('p4','Pedicura','Tratamiento de durezas','Eliminación de callosidades y suavizado de talones.',15000,60,1),
('p5','Pedicura','Tratamiento Antimicótico','Cuidado de uñas con posibles signos compatibles con hongos. Consultá con un profesional de la salud para confirmar el diagnóstico y definir el tratamiento adecuado.',25000,60,1),
('m1','Manicura','Manicura tradicional','Limado, cutículas e hidratación con esmaltado.',14000,60,1),
('m2','Manicura','Manicura semipermanente','Manicura completa con semipermanente.',20000,90,1),
('m3','Manicura','Soft gel / Kapping gel','Refuerzo y extensión natural de uñas.',28000,120,1),
('m4','Manicura','Retiro de semipermanente','Retiro seguro sin dañar la uña.',6000,30,1);
