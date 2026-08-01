const fs = require('node:fs');

const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (pkg.version !== app.expo.version) {
  console.error(`Version mismatch: package.json=${pkg.version}, app.json=${app.expo.version}`);
  process.exit(1);
}

console.log(`version check: ${app.expo.version}`);
