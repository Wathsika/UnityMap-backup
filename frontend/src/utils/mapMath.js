/**
 * Geographic and wheelchair routing mathematical utilities
 * UnityMap — SPT-103
 */

/**
 * Haversine formula to compute great-circle distance between two GPS coordinates in meters.
 */
export const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000; // Distance in meters
};

/**
 * Calculates estimated travel time (ETA) in minutes for a wheelchair user.
 * Baseline flat pace: 1.1 m/s (~4.0 km/h).
 * Incline penalty applies for slopes > 2° (ADA guideline: slopes >= 5° reduce speed by 25-45%).
 *
 * @param {number} distanceMeters - Total route distance in meters
 * @param {number} maxSlopeDeg - Maximum or average incline degrees along route
 * @param {number} surfaceFactor - Surface multiplier (1.0 = paved, 1.2 = uneven/gravel)
 * @returns {number} ETA in rounded minutes (minimum 1 min)
 */
export const calculateWheelchairETA = (distanceMeters, maxSlopeDeg = 0, surfaceFactor = 1.0) => {
  if (!distanceMeters || distanceMeters <= 0) return 0;

  // Base wheelchair speed: ~1.1 meters/sec (approx 4 km/h)
  let speedMps = 1.1;

  // Slope adjustment
  if (maxSlopeDeg > 2) {
    // Speed decreases gradually with slope up to ~45% reduction at 8°
    const slopePenalty = Math.min(0.5, (maxSlopeDeg - 2) * 0.075);
    speedMps *= 1 - slopePenalty;
  }

  // Surface texture factor
  speedMps /= Math.max(0.8, surfaceFactor);

  const durationSeconds = distanceMeters / speedMps;
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  return minutes;
};

/**
 * Categorizes route slope into accessibility safety tiers.
 * - Safe: <= 5° (ADA recommended ramp standard is ~4.76° / 1:12 slope)
 * - Caution: 5.1° - 8.0° (Demanding, manual assist or powered wheelchair advised)
 * - Hazard: > 8.0° (Non-compliant for unassisted wheelchair access)
 *
 * @param {number} slopeDeg - Incline angle in degrees
 */
export const getGradientSafetyCategory = (slopeDeg = 0) => {
  const slope = Number(slopeDeg) || 0;
  if (slope <= 5) {
    return {
      status: 'Safe',
      level: 'safe',
      slope: slope,
      label: `Max Slope: ${slope}° - Safe`,
      color: '#16A34A',
      bg: '#DCFCE7',
      border: '#86EFAC',
      darkBg: '#143823',
      darkBorder: '#2E8B57',
      textColor: '#4ADE80',
    };
  }

  if (slope <= 8) {
    return {
      status: 'Caution',
      level: 'caution',
      slope: slope,
      label: `Max Slope: ${slope}° - Caution`,
      color: '#D97706',
      bg: '#FEF3C7',
      border: '#FCD34D',
      darkBg: '#36240E',
      darkBorder: '#F59E0B',
      textColor: '#FBBF24',
    };
  }

  return {
    status: 'Hazard',
    level: 'hazard',
    slope: slope,
    label: `Max Slope: ${slope}° - High Incline`,
    color: '#DC2626',
    bg: '#FEE2E2',
    border: '#FCA5A5',
    darkBg: '#3B1212',
    darkBorder: '#EF4444',
    textColor: '#F87171',
  };
};

/**
 * Formats a distance in meters to a human-readable string (e.g., "450 m" or "1.2 km").
 */
export const formatDistance = (distanceMeters) => {
  if (distanceMeters == null || isNaN(distanceMeters)) return '0 m';
  const meters = Math.round(distanceMeters);
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
};

/**
 * Formats duration in minutes to readable ETA string (e.g. "18 mins" or "1 hr 12 mins").
 */
export const formatDuration = (minutes) => {
  if (minutes == null || isNaN(minutes) || minutes <= 0) return '1 min';
  const mins = Math.round(minutes);
  if (mins < 60) {
    return `${mins} min${mins === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours} hr ${remainingMins} min${remainingMins === 1 ? '' : 's'}` : `${hours} hr`;
};

/**
 * Filters a list of obstacle objects to those whose GPS position falls within
 * `radiusMeters` of any polyline segment in `routeCoords`.
 *
 * Used as a local fallback when the `/obstacles/nearby` API call fails: the
 * already-fetched `dbObstacles` list is filtered against the route in-memory.
 *
 * @param {Array<{ lat: number, lng: number }>} obstacles  - Array of obstacle objects
 * @param {Array<[number, number]>} routeCoords            - Route as [[lat,lng], …] pairs
 * @param {number} radiusMeters                            - Search radius in metres (default 300)
 * @returns {Array} Subset of `obstacles` near the route
 */
export const filterObstaclesNearRoute = (obstacles, routeCoords, radiusMeters = 300) => {
  if (!Array.isArray(obstacles) || obstacles.length === 0) return [];
  if (!Array.isArray(routeCoords) || routeCoords.length === 0) return [];

  return obstacles.filter((obs) => {
    const obsLat = obs.lat ?? obs.location?.coordinates?.[1];
    const obsLng = obs.lng ?? obs.location?.coordinates?.[0];
    if (obsLat == null || obsLng == null) return false;

    // Check distance from obstacle to every node in the route polyline
    return routeCoords.some(([rLat, rLng]) => {
      const d = calculateHaversineDistance(obsLat, obsLng, rLat, rLng);
      return d <= radiusMeters;
    });
  });
};

/**
 * Computes an overall accessibility safety status for a tap-to-route result.
 *
 * Combines:
 *  - Maximum slope across route pathways (ADA tiers: safe ≤5°, caution ≤8°, hazard >8°)
 *  - Count and type of nearby obstacles (construction, stairs_only, broken elevators)
 *  - Count of accessible features found nearby (operational elevators, accessible nodes)
 *
 * Returns a status object consumed by the route overlay card and bottom sheet.
 *
 * @param {Array}  routePathways   - DB pathway objects along the computed route
 * @param {Array}  nearbyObstacles - Hazard objects near destination
 * @param {Array}  nearbyFeatures  - Accessible feature objects near destination
 * @returns {{ level: string, label: string, badgeText: string, color: string, bg: string, border: string, iconName: string }}
 */
export const computeRouteSafetyStatus = (
  routePathways = [],
  nearbyObstacles = [],
  nearbyFeatures = [],
) => {
  // ── 1. Slope analysis ──────────────────────────────────────────────────────
  const maxSlope = routePathways.reduce(
    (max, pw) => Math.max(max, Math.abs(Number(pw.inclineDegrees) || 0)),
    0
  );

  // ── 2. Obstacle classification ─────────────────────────────────────────────
  const stairsCount       = nearbyObstacles.filter((o) => o.obstacleType === 'stairs_only' || o.type === 'stairs_only' || o.iconType === 'stairs').length;
  const constructionCount = nearbyObstacles.filter((o) => o.obstacleType === 'construction' || o.type === 'construction' || o.iconType === 'construction').length;
  const brokenElevCount   = nearbyObstacles.filter((o) => o.obstacleType === 'broken_elevator' || o.type === 'broken_elevator' || o.iconType === 'broken_elevator').length;
  const steepPathCount    = nearbyObstacles.filter((o) => o.obstacleType === 'steep_ramp' || o.type === 'steep_ramp' || o.iconType === 'slope').length;
  const totalHazards      = nearbyObstacles.length;

  // ── 3. Accessible feature counts ──────────────────────────────────────────
  const opElevCount  = nearbyFeatures.filter((f) => f.type === 'elevator' || f.featureType === 'elevator').length;
  const accessCount  = nearbyFeatures.filter((f) => f.type === 'entrance' || f.type === 'node' || f.featureType === 'node').length;
  const pavedCount   = nearbyFeatures.filter((f) => f.type === 'smooth_path').length;

  // ── 4. Determine overall safety level ─────────────────────────────────────
  let level = 'safe';
  if (stairsCount > 0 || brokenElevCount > 0 || maxSlope > 8 || steepPathCount > 0) {
    level = 'hazard';
  } else if (constructionCount > 0 || maxSlope > 5 || totalHazards > 0) {
    level = 'caution';
  }

  // ── 5. Build human-readable badge text ────────────────────────────────────
  const parts = [];
  if (stairsCount > 0)       parts.push(`${stairsCount} Stair${stairsCount > 1 ? 's' : ''}`);
  if (brokenElevCount > 0)   parts.push(`${brokenElevCount} Broken Elevator${brokenElevCount > 1 ? 's' : ''}`);
  if (constructionCount > 0) parts.push(`${constructionCount} Construction`);
  if (steepPathCount > 0)    parts.push('Steep Slope Nearby');
  if (maxSlope > 5 && maxSlope <= 8 && steepPathCount === 0) parts.push('1 Ramp Ahead');
  if (maxSlope > 8 && stairsCount === 0 && steepPathCount === 0) parts.push('Steep Slope Nearby');

  let label, badgeText, color, bg, border, iconName;
  if (level === 'safe') {
    label     = 'Safe Route';
    badgeText = parts.length > 0 ? `Safe Route - ${parts[0]}` : (opElevCount > 0 ? 'Safe Route - Elevator Accessible' : 'Safe Route - Step-Free');
    color     = '#16A34A';
    bg        = '#DCFCE7';
    border    = '#86EFAC';
    iconName  = 'check-circle';
  } else if (level === 'caution') {
    label     = 'Caution';
    badgeText = parts.length > 0 ? `Caution - ${parts[0]}` : 'Caution - Steep Slope Nearby';
    color     = '#D97706';
    bg        = '#FEF3C7';
    border    = '#FCD34D';
    iconName  = 'alert-triangle';
  } else {
    label     = 'Hazard Detected';
    badgeText = parts.length > 0 ? `Hazard - ${parts[0]}` : 'Hazard - Steep Slope Nearby';
    color     = '#DC2626';
    bg        = '#FEE2E2';
    border    = '#FCA5A5';
    iconName  = 'alert-circle';
  }

  return { level, label, badgeText, color, bg, border, iconName, maxSlope, totalHazards, opElevCount, accessCount, pavedCount };
};

/**
 * Categorizes points around a location or along a route into:
 *  1. Issues / Hazards (ramp inclines > 8°, stairs without ramps, broken elevators, construction obstacles)
 *  2. Accessible / Helpful Features (operational elevators, accessible rest areas/nodes, smooth paved pathways, accessible entrances/exits)
 *
 * @param {Object} options
 * @param {Array}  options.nearbyObstacles - Array of obstacle objects
 * @param {Array}  options.nearbyNodes     - Array of node objects
 * @param {Array}  options.elevators       - Array of elevator objects
 * @param {Array}  options.pathways        - Array of pathway objects
 * @param {Array}  options.centerCoords    - [latitude, longitude] of tapped point
 * @param {Array}  options.routeCoords     - [[lat, lng], ...] of active route polyline
 * @param {number} options.radiusMeters    - Search radius (default: 400m)
 * @returns {{ hazards: Array, accessible: Array }}
 */
export const categorizeProximityFeatures = ({
  nearbyObstacles = [],
  nearbyNodes = [],
  elevators = [],
  pathways = [],
  centerCoords = null,
  routeCoords = [],
  radiusMeters = 400,
}) => {
  const pointsOfInterest = Array.isArray(routeCoords) && routeCoords.length > 0
    ? routeCoords
    : (centerCoords && Number.isFinite(centerCoords[0]) && Number.isFinite(centerCoords[1]) ? [centerCoords] : []);

  const isNear = (lat, lng) => {
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
    if (pointsOfInterest.length === 0) return true;
    return pointsOfInterest.some(([rLat, rLng]) => calculateHaversineDistance(lat, lng, rLat, rLng) <= radiusMeters);
  };

  const hazards = [];
  const accessible = [];
  const seenHazardKeys = new Set();
  const seenAccessKeys = new Set();

  // 1. Process Obstacles (Hazards)
  nearbyObstacles.forEach((obs) => {
    const lat = obs.lat ?? obs.location?.coordinates?.[1];
    const lng = obs.lng ?? obs.location?.coordinates?.[0];
    if (isNear(lat, lng)) {
      const id = obs.id || obs._id || `obs_${lat}_${lng}`;
      if (!seenHazardKeys.has(id)) {
        seenHazardKeys.add(id);
        const type = obs.obstacleType || 'hazard';
        let title = obs.title || 'Obstacle';
        let desc = obs.desc || 'Reported pathway barrier';
        let severity = 'High';
        let iconType = 'hazard';

        if (type === 'construction') {
          title = obs.title || 'Construction Obstacle';
          desc = obs.desc || 'Temporary construction barrier blocking pathway';
          severity = 'Medium';
          iconType = 'construction';
        } else if (type === 'stairs_only') {
          title = obs.title || 'Stairs Without Ramp';
          desc = obs.desc || 'Stairs preventing wheelchair access';
          severity = 'High';
          iconType = 'stairs';
        } else if (type === 'broken_elevator' || type === 'elevator_out_of_service') {
          title = obs.title || 'Broken Elevator';
          desc = obs.desc || 'Elevator is currently out of service';
          severity = 'High';
          iconType = 'broken_elevator';
        } else if (type === 'steep_ramp') {
          title = obs.title || 'Steep Ramp Incline';
          desc = obs.desc || 'Ramp slope exceeds 8° wheelchair safety limit';
          severity = 'Caution';
          iconType = 'slope';
        }

        hazards.push({
          id,
          title,
          desc,
          type,
          iconType,
          priority: severity,
          lat,
          lng,
        });
      }
    }
  });

  // 2. Process Elevators (Broken -> Hazard, Operational -> Accessible)
  elevators.forEach((elv) => {
    const lat = elv.lat ?? elv.associatedNode?.location?.coordinates?.[1] ?? elv.nodeDetails?.location?.coordinates?.[1];
    const lng = elv.lng ?? elv.associatedNode?.location?.coordinates?.[0] ?? elv.nodeDetails?.location?.coordinates?.[0];
    if (lat != null && lng != null && isNear(lat, lng)) {
      const isOp = elv.isOperational !== false && elv.status !== 'out_of_service' && elv.status !== 'maintenance';
      const id = elv.id || elv.elevatorId || `elv_${lat}_${lng}`;
      if (!isOp) {
        if (!seenHazardKeys.has(id)) {
          seenHazardKeys.add(id);
          hazards.push({
            id,
            title: `Broken Elevator (${elv.title || elv.elevatorId || 'Elevator'})`,
            desc: 'Elevator out of service • Use ground alternative',
            type: 'broken_elevator',
            iconType: 'broken_elevator',
            priority: 'High',
            lat,
            lng,
          });
        }
      } else {
        if (!seenAccessKeys.has(id)) {
          seenAccessKeys.add(id);
          accessible.push({
            id,
            title: `Operational Elevator (${elv.title || elv.elevatorId || 'Elevator'})`,
            desc: 'Fully operational vertical wheelchair access',
            type: 'elevator',
            iconType: 'elevator',
            badge: 'Operational',
            lat,
            lng,
          });
        }
      }
    }
  });

  // 3. Process Pathways (Steep >8° or stairs -> Hazard; Smooth & ADA <=5° -> Accessible)
  pathways.forEach((pw) => {
    let coords = null;
    if (pw.geometry && Array.isArray(pw.geometry.coordinates) && pw.geometry.coordinates.length >= 2) {
      coords = pw.geometry.coordinates.map((c) => [c[1], c[0]]);
    } else if (
      pw.startNode?.location?.coordinates?.length >= 2 &&
      pw.endNode?.location?.coordinates?.length >= 2
    ) {
      coords = [
        [pw.startNode.location.coordinates[1], pw.startNode.location.coordinates[0]],
        [pw.endNode.location.coordinates[1], pw.endNode.location.coordinates[0]],
      ];
    }
    const midLat = coords ? coords[0][0] : null;
    const midLng = coords ? coords[0][1] : null;
    if (midLat != null && midLng != null && isNear(midLat, midLng)) {
      const slope = Math.abs(Number(pw.inclineDegrees) || 0);
      const isStairs = pw.pathType === 'stairs' || pw.isWheelchairAccessible === false;
      const pwId = pw._id || pw.id || `pw_${midLat}_${midLng}`;

      if (slope > 8) {
        if (!seenHazardKeys.has(pwId)) {
          seenHazardKeys.add(pwId);
          hazards.push({
            id: pwId,
            title: `Ramp Incline > 8° (${slope.toFixed(1)}°)`,
            desc: `Exceeds ADA safe wheelchair ramp threshold (8.0°)`,
            type: 'steep_ramp',
            iconType: 'slope',
            priority: 'High',
            lat: midLat,
            lng: midLng,
          });
        }
      } else if (isStairs) {
        if (!seenHazardKeys.has(pwId)) {
          seenHazardKeys.add(pwId);
          hazards.push({
            id: pwId,
            title: 'Stairs Without Ramp',
            desc: 'Multi-step stairs lacking wheelchair bypass',
            type: 'stairs_only',
            iconType: 'stairs',
            priority: 'High',
            lat: midLat,
            lng: midLng,
          });
        }
      } else if (pw.isWheelchairAccessible !== false && slope <= 5) {
        if (!seenAccessKeys.has(pwId)) {
          seenAccessKeys.add(pwId);
          accessible.push({
            id: pwId,
            title: 'Smooth Paved Pathway',
            desc: `${pw.distanceMeters ? `${pw.distanceMeters}m • ` : ''}Level step-free surface (${slope.toFixed(1)}° grade)`,
            type: 'smooth_path',
            iconType: 'walkway',
            badge: 'Paved',
            lat: midLat,
            lng: midLng,
          });
        }
      }
    }
  });

  // 4. Process Nearby Nodes (Accessible entrances/exits, rest areas)
  nearbyNodes.forEach((node) => {
    const lat = node.lat ?? node.location?.coordinates?.[1];
    const lng = node.lng ?? node.location?.coordinates?.[0];
    if (lat != null && lng != null && isNear(lat, lng)) {
      const id = node.id || node._id || `node_${lat}_${lng}`;
      if (!seenAccessKeys.has(id)) {
        seenAccessKeys.add(id);
        const nameLower = (node.name || node.title || '').toLowerCase();
        const isRestArea = nameLower.includes('rest') || nameLower.includes('lounge') || nameLower.includes('park') || nameLower.includes('bench');
        accessible.push({
          id,
          title: node.name || node.title || 'Accessible Entrance / Exit',
          desc: isRestArea
            ? 'Accessible rest area & level seating zone'
            : `Accessible entrance/exit • Floor ${node.floorLevel ?? 1}`,
          type: isRestArea ? 'rest_area' : 'entrance',
          iconType: isRestArea ? 'rest_area' : 'entrance',
          badge: isRestArea ? 'Rest Area' : 'Step-Free',
          lat,
          lng,
        });
      }
    }
  });

  return { hazards, accessible };
};

export default {
  calculateHaversineDistance,
  calculateWheelchairETA,
  getGradientSafetyCategory,
  formatDistance,
  formatDuration,
  filterObstaclesNearRoute,
  computeRouteSafetyStatus,
  categorizeProximityFeatures,
};

