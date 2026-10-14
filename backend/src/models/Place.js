const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: [true, 'Coordinates [longitude, latitude] are required'],
      validate: {
        validator: function (coords) {
          return (
            Array.isArray(coords) &&
            coords.length === 2 &&
            coords[0] >= -180 &&
            coords[0] <= 180 &&
            coords[1] >= -90 &&
            coords[1] <= 90
          );
        },
        message: 'Coordinates must be valid [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

/**
 * Place — local searchable places table (~5k rows).
 * Search bar hits this table FIRST (fast, offline-friendly), click → lat/lon from DB → map.
 */
const placeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Place name is required'],
      trim: true,
      maxlength: [200, 'Place name cannot exceed 200 characters'],
      index: true,
    },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '', index: true },
    district: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: 'place', index: true },
    categoryLabel: { type: String, trim: true, default: 'Place' },
    // Flat lat/lon — frontend reads these on click to move the map.
    lat: { type: Number, required: [true, 'lat is required'], min: -90, max: 90, index: true },
    lon: { type: Number, required: [true, 'lon is required'], min: -180, max: 180, index: true },
    location: { type: pointSchema, required: [true, 'Location is required'] },
    postcode: { type: String, default: null },
    phone: { type: String, default: null },
    wheelchair: { type: String, enum: ['yes', 'limited', 'no', null], default: null },
    source: { type: String, default: 'local' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Keep GeoJSON in sync when lat/lon are set via create/save.
placeSchema.pre('validate', function (next) {
  if (Number.isFinite(this.lat) && Number.isFinite(this.lon)) {
    this.location = { type: 'Point', coordinates: [Number(this.lon), Number(this.lat)] };
  }
  next();
});

// Fast search indexes for 5k+ rows.
placeSchema.index({ location: '2dsphere' });
placeSchema.index({ name: 'text', address: 'text', city: 'text', category: 'text', categoryLabel: 'text' });

const Place = mongoose.models.Place || mongoose.model('Place', placeSchema);

module.exports = Place;
