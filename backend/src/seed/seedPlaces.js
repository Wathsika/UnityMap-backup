/**
 * seedPlaces.js — fills the local `places` table with ~5000 searchable rows.
 *
 * Usage:
 *   cd backend && npm run seed:places            (wipes + inserts 5000)
 *   cd backend && npm run seed:places -- --keep  (inserts only if empty)
 *   COUNT=2000 node src/seed/seedPlaces.js       (custom count)
 *
 * Each row has name/address/city/lat/lon → search bar finds it,
 * click → lat/lon from DB → map pin + route.
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Place = require('../models/Place');

const TOTAL = Math.min(Math.max(parseInt(process.env.COUNT, 10) || 5000, 100), 20000);
const KEEP = process.argv.includes('--keep');

// ~25 district anchors so pins spread across the whole island.
const DISTRICTS = [
  { city: 'Colombo', district: 'Colombo', lat: 6.9271, lon: 79.8612 },
  { city: 'Dehiwala', district: 'Colombo', lat: 6.85, lon: 79.8667 },
  { city: 'Moratuwa', district: 'Colombo', lat: 6.7731, lon: 79.8812 },
  { city: 'Kandy', district: 'Kandy', lat: 7.2906, lon: 80.6337 },
  { city: 'Galle', district: 'Galle', lat: 6.0329, lon: 80.2168 },
  { city: 'Jaffna', district: 'Jaffna', lat: 9.6615, lon: 80.0255 },
  { city: 'Negombo', district: 'Gampaha', lat: 7.2083, lon: 79.8358 },
  { city: 'Gampaha', district: 'Gampaha', lat: 7.0873, lon: 80.0144 },
  { city: 'Kurunegala', district: 'Kurunegala', lat: 7.4863, lon: 80.3628 },
  { city: 'Anuradhapura', district: 'Anuradhapura', lat: 8.3114, lon: 80.4037 },
  { city: 'Polonnaruwa', district: 'Polonnaruwa', lat: 7.9403, lon: 81.0038 },
  { city: 'Trincomalee', district: 'Trincomalee', lat: 8.5874, lon: 81.2152 },
  { city: 'Batticaloa', district: 'Batticaloa', lat: 7.7102, lon: 81.6924 },
  { city: 'Matara', district: 'Matara', lat: 5.9549, lon: 80.555 },
  { city: 'Hambantota', district: 'Hambantota', lat: 6.1241, lon: 81.1185 },
  { city: 'Badulla', district: 'Badulla', lat: 6.9934, lon: 81.055 },
  { city: 'Ratnapura', district: 'Ratnapura', lat: 6.7056, lon: 80.3847 },
  { city: 'Kegalle', district: 'Kegalle', lat: 7.2514, lon: 80.3464 },
  { city: 'Kalutara', district: 'Kalutara', lat: 6.5854, lon: 79.9607 },
  { city: 'Puttalam', district: 'Puttalam', lat: 8.0408, lon: 79.8395 },
  { city: 'Vavuniya', district: 'Vavuniya', lat: 8.7514, lon: 80.497 },
  { city: 'Kilinochchi', district: 'Kilinochchi', lat: 9.3803, lon: 80.377 },
  { city: 'Mannar', district: 'Mannar', lat: 8.9763, lon: 79.9044 },
  { city: 'Nuwara Eliya', district: 'Nuwara Eliya', lat: 6.9497, lon: 80.7891 },
  { city: 'Ampara', district: 'Ampara', lat: 7.3018, lon: 81.6747 },
  { city: 'Monaragala', district: 'Monaragala', lat: 6.8714, lon: 81.3504 },
];

const CATEGORIES = [
  { key: 'hospital', label: 'Hospital' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'school', label: 'School' },
  { key: 'university', label: 'University' },
  { key: 'library', label: 'Library' },
  { key: 'bank', label: 'Bank' },
  { key: 'atm', label: 'ATM' },
  { key: 'supermarket', label: 'Supermarket' },
  { key: 'market', label: 'Market' },
  { key: 'temple', label: 'Temple' },
  { key: 'church', label: 'Church' },
  { key: 'mosque', label: 'Mosque' },
  { key: 'bus_stop', label: 'Bus Stop' },
  { key: 'railway_station', label: 'Railway Station' },
  { key: 'police', label: 'Police Station' },
  { key: 'post_office', label: 'Post Office' },
  { key: 'park', label: 'Park' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'fuel', label: 'Fuel Station' },
  { key: 'government', label: 'Government Office' },
];

// Deterministic PRNG (mulberry32) — same 5k rows on every run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) throw new Error('MONGO_URI missing in backend/.env');
  await mongoose.connect(mongoURI, { dbName: process.env.DB_NAME || 'UnityMap' });
  console.log(`✅ Connected → ${mongoose.connection.name}`);

  const existing = await Place.estimatedDocumentCount();
  if (KEEP && existing > 0) {
    console.log(`ℹ️  places already has ${existing} rows (--keep), skipping.`);
    await mongoose.connection.close();
    return;
  }

  console.log(`🧹 Clearing places (${existing} rows)…`);
  await Place.deleteMany({});

  const rand = rng(20261014);
  const docs = [];
  for (let i = 0; i < TOTAL; i++) {
    const d = DISTRICTS[Math.floor(rand() * DISTRICTS.length)];
    const c = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    // Spread ~±6km around district centre so map pins look natural.
    const lat = +(d.lat + (rand() - 0.5) * 0.11).toFixed(6);
    const lon = +(d.lon + (rand() - 0.5) * 0.11).toFixed(6);
    const n = Math.floor(rand() * 900) + 100;
    docs.push({
      name: `${d.city} ${c.label} ${i + 1}`,
      address: `${n} Main Street, ${d.city}`,
      city: d.city,
      district: d.district,
      category: c.key,
      categoryLabel: c.label,
      lat,
      lon,
      location: { type: 'Point', coordinates: [lon, lat] },
      postcode: String(10000 + Math.floor(rand() * 89999)),
      wheelchair: ['yes', 'limited', 'no', null][Math.floor(rand() * 4)],
      source: 'local',
    });
  }

  // insertMany in batches (memory-safe).
  const BATCH = 500;
  for (let i = 0; i < docs.length; i += BATCH) {
    await Place.insertMany(docs.slice(i, i + BATCH), { ordered: false });
    console.log(`   … ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }

  await Place.syncIndexes();
  const count = await Place.estimatedDocumentCount();
  console.log(`🎉 Seeded places table: ${count} rows.`);
  console.log(`   Try: GET /api/places/local/search?q=colombo&limit=5`);
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error('💥 seedPlaces failed:', err.message);
  process.exit(1);
});
