// scripts/hash-password.js
// Cong cu tam thoi de tao password_hash cho tai khoan admin dau tien.
// Chay: node scripts/hash-password.js "MatKhauCuaMay123"
// Copy chuoi hash in ra, dan vao cau INSERT trong sql/001_create_admins.sql

import bcrypt from 'bcryptjs';

const plainPassword = process.argv[2];

if (!plainPassword) {
    console.error('Cach dung: node scripts/hash-password.js "MatKhauCuaMay"');
    process.exit(1);
}

const hash = await bcrypt.hash(plainPassword, 10);
console.log('\nPassword hash (dan vao cot password_hash):\n');
console.log(hash);
console.log('');
