const express = require('express');

const router = express.Router();
const { searchPlacesProxy } = require('../controllers/placeSearchController');
const { searchLocalPlaces, getLocalPlaceById, countLocalPlaces } = require('../controllers/placeLocalController');

router.route('/search').get(searchPlacesProxy);

// Local DB table (~5k places): search bar hits these FIRST.
// Order matters: /local/search + /local/count must be registered BEFORE /local/:id.
router.route('/local/search').get(searchLocalPlaces);
router.route('/local/count').get(countLocalPlaces);
router.route('/local/:id').get(getLocalPlaceById);

module.exports = router;
