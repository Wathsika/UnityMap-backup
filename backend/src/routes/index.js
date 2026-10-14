const express = require('express');
const router = express.Router();

const nodeRoutes = require('./nodeRoutes');
const pathwayRoutes = require('./pathwayRoutes');
const elevatorRoutes = require('./elevatorRoutes');
const obstacleRoutes = require('./obstacleRoutes');
const adminAuthRoutes = require('./adminAuthRoutes');
const triageRoutes = require('./triageRoutes');
const wardComplianceRoutes = require('./wardComplianceRoutes');
const speechRoutes = require('./speechRoutes');
const audioRoutes = require('./audioRoutes');
const reportRoutes = require('./reportRoutes');
const placeSearchRoutes = require('./placeSearchRoutes');

router.use('/nodes', nodeRoutes);
router.use('/pathways', pathwayRoutes);
router.use('/elevators', elevatorRoutes);
router.use('/obstacles', obstacleRoutes);
router.use('/reports', reportRoutes);
router.use('/places', placeSearchRoutes);
router.use('/speech', speechRoutes);
router.use('/audio', audioRoutes);
router.use('/admin/auth', adminAuthRoutes);
router.use('/admin/triage', triageRoutes);
router.use('/admin/compliance', wardComplianceRoutes);

module.exports = router;
