/**
 * triageService.js
 * Frontend Service & API Client for Automated Severity Triage Engine
 * 
 * Interacts with live backend severity triage API.
 * All dummy and hardcoded mock reports have been removed.
 */

import { apiRequest } from './api';

// Live runtime cache for offline or newly added reports (starts empty - NO dummy data)
const RUNTIME_REPORTS = [];

/**
 * Fetch severity-sorted triage queue from live backend
 */
export const fetchTriageQueue = async ({
  wardId = 'CMC-W01',
  category = 'all',
  status = 'pending',
  minUrgency = 0,
  sortBy = 'urgency',
  page = 1,
  limit = 20,
} = {}) => {
  try {
    const params = new URLSearchParams({
      wardId,
      status,
      sortBy,
      page: String(page),
      limit: String(limit),
    });
    if (category && category !== 'all') params.append('category', category);
    if (minUrgency > 0) params.append('minUrgency', String(minUrgency));

    const response = await apiRequest(`/admin/triage/queue?${params.toString()}`);
    if (response?.success && response.data) {
      return response.data;
    }
  } catch (error) {
    if (__DEV__) console.warn('[triageService] Error fetching live triage queue:', error.message);
  }

  // If unreachable or empty, return empty real structure (NO fake dummy reports)
  return {
    totalReports: RUNTIME_REPORTS.length,
    page,
    limit,
    totalPages: Math.ceil(RUNTIME_REPORTS.length / limit) || 1,
    wardId,
    reports: [...RUNTIME_REPORTS],
  };
};

/**
 * Fetch ward-level triage statistics from live backend
 */
export const fetchTriageMetrics = async (wardId = 'CMC-W01') => {
  try {
    const response = await apiRequest(`/admin/triage/metrics?wardId=${encodeURIComponent(wardId)}`);
    if (response?.success && response.data) {
      return response.data;
    }
  } catch (error) {
    if (__DEV__) console.warn('[triageService] Error fetching triage metrics:', error.message);
  }

  return {
    wardId,
    totalPendingReports: 0,
    criticalPriorityCount: 0,
    highPriorityCount: 0,
    mediumPriorityCount: 0,
    lowPriorityCount: 0,
    averageUrgencyIndex: 0,
  };
};

/**
 * Fetch detailed report inspection data with cross-referenced asset from live backend
 */
export const fetchReportDetails = async (reportId, wardId = 'CMC-W01') => {
  if (!reportId) return null;

  try {
    const response = await apiRequest(`/admin/triage/report/${encodeURIComponent(reportId)}?wardId=${encodeURIComponent(wardId)}`);
    if (response?.success && response.data) {
      return response.data;
    }
  } catch (error) {
    if (__DEV__) console.warn('[triageService] Error fetching report details:', error.message);
  }

  const runtimeFound = RUNTIME_REPORTS.find((r) => r._id === reportId);
  return runtimeFound || null;
};

/**
 * Dispatch administrative municipal decision (SPT-208)
 * Dispositions: APPROVED, REJECTED, INFO_REQUESTED
 */
export const dispatchDecision = async ({
  reportId,
  decision,
  allocatedBudgetLKR = 0,
  rejectionReason = null,
  notes = '',
  wardId = 'CMC-W01',
  repairTargetDays = 7,
} = {}) => {
  // `staffId` is intentionally not sent: the backend records the authenticated
  // officer from the session token, so a client cannot forge the actor.
  const response = await apiRequest('/admin/triage/dispatch', {
    method: 'POST',
    body: JSON.stringify({
      reportId,
      decision,
      allocatedBudgetLKR,
      rejectionReason,
      notes,
      wardId,
      repairTargetDays,
    }),
  });

  if (!response?.success || !response?.data) {
    throw new Error(response?.message || 'The administrative decision was not accepted.');
  }

  return response.data;
};

/**
 * SPT-111/112 — Persist a fresh urgency computation for the pending queue.
 * Unlike a plain refetch this writes recalculated scores to the server.
 */
export const recalculateTriageQueue = async (wardId = 'CMC-W01') => {
  const response = await apiRequest('/admin/triage/recalculate', {
    method: 'POST',
    body: JSON.stringify({ wardId }),
  });

  if (!response?.success) {
    throw new Error(response?.message || 'Urgency recalculation failed.');
  }

  return response.data;
};

/**
 * Runtime helper for newly submitted reports when offline
 */
export const addMockTriageReport = (reportData = {}) => {
  const id = reportData._id || `RPT-${Date.now().toString(36).toUpperCase()}`;
  const newReport = {
    ...reportData,
    _id: id,
    triageStatus: 'pending',
    createdAt: reportData.createdAt || new Date().toISOString(),
    triage: {
      urgencyIndex: 50,
      priorityBadge: 'MEDIUM',
      formulaFactors: {
        barrierSeverityWeight: Number(reportData.rating) || 3,
        corroborationCount: Number(reportData.corroborationCount) || 0,
        reportAgeDays: 0,
        vitalCorridorMultiplier: 1.0,
      },
      crossReferencedAsset: null,
      distanceToAssetMeters: null,
    },
  };
  RUNTIME_REPORTS.unshift(newReport);
  return newReport;
};

export const getMockReports = () => [...RUNTIME_REPORTS];

export const corroborateMockReport = (reportId, userId = 'user') => {
  const report = RUNTIME_REPORTS.find((r) => r._id === reportId);
  if (!report) return null;
  if (!Array.isArray(report.upvotedBy)) report.upvotedBy = [];
  const idx = report.upvotedBy.indexOf(userId);
  if (idx !== -1) {
    report.upvotedBy.splice(idx, 1);
  } else {
    report.upvotedBy.push(userId);
  }
  report.corroborationCount = report.upvotedBy.length;
  return report;
};

export default {
  fetchTriageQueue,
  fetchTriageMetrics,
  fetchReportDetails,
  dispatchDecision,
  recalculateTriageQueue,
  addMockTriageReport,
  getMockReports,
  corroborateMockReport,
};
