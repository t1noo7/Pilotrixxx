import bcrypt from 'bcrypt';

const plainPassword = process.argv[2];

if (!plainPassword) {
    console.error('Cach dung: node scripts/hash-password.js "MatKhauCuaMay"');
    process.exit(1);
}

const hash = await bcrypt.hash(plainPassword, 10);
console.log('\nPassword hash (dan vao cot password_hash):\n');
console.log(hash);
console.log('');
