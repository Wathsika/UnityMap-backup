/**
 * TriageQueueScreen.js
 * Page 2: Severity-Sorted Triage Queue Dashboard
 *
 * Assigned Member: Savindu
 * Ticket: SPT-112
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  Image,
  AccessibilityInfo,
  Alert,
  Platform,
} from 'react-native';
import { fetchTriageQueue, fetchTriageMetrics, recalculateTriageQueue } from '../../services/triageService';
import adminAuthService from '../../services/adminAuthService';
import { getWardById, MUNICIPAL_WARDS } from '../../utils/wardJurisdictions';
import { Feather } from '@expo/vector-icons';
import AdminAddReportModal from '../../components/admin/AdminAddReportModal';
import { corroborateReport } from '../../services/api';

const isValidPhotoUri = (uri) => {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed) return false;
  // React Native on iOS/Android cannot load web blob: URIs
  if (Platform.OS !== 'web' && trimmed.startsWith('blob:')) return false;
  return true;
};

const CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'Lift', label: 'Lift' },
  { id: 'Ramp', label: 'Ramp' },
  { id: 'Tactile Paving', label: 'Tactile Paving' },
  { id: 'Restroom', label: 'Restroom' },
];

const SORT_OPTIONS = [
  { id: 'urgency', label: 'Urgency', icon: 'zap' },
  { id: 'corroboration', label: 'Corroborated', icon: 'users' },
  { id: 'date', label: 'Newest', icon: 'clock' },
];

export const TriageQueueScreen = ({ onBack, onSelectReport, selectedWardId: propWardId, onWardChange }) => {
  const currentUser = adminAuthService.getCurrentUser();
  const fallbackWard = currentUser?.assignedWardId || 'CMC-W01';
  // Role gate: allow WARD_INSPECTOR, CHIEF_ENGINEER, BUDGET_OFFICER, SUPER_ADMIN (SPT-206)
  const canAddReport = !!currentUser && (
    adminAuthService.hasPermission('VIEW_TRIAGE') ||
    ['WARD_INSPECTOR', 'CHIEF_ENGINEER', 'BUDGET_OFFICER', 'ADMIN', 'SUPER_ADMIN'].includes(currentUser.role) ||
    !!currentUser.isSuperAdmin ||
    currentUser.email === 'admin@unitymap.com'
  );
  const [selectedWardId, setSelectedWardId] = useState(propWardId || fallbackWard);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSort, setSelectedSort] = useState('urgency');
  const [minUrgency, setMinUrgency] = useState(0);

  const [reports, setReports] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isAddReportOpen, setIsAddReportOpen] = useState(false);

  const activeWard = getWardById(selectedWardId);

  const loadTriageData = useCallback(async (isCancelled) => {
    try {
      if (__DEV__) {
        console.log(`Fetching Triage Queue: ward=${selectedWardId} category=${selectedCategory} status=pending sortBy=${selectedSort}`);
      }
      const [queueData, metricsData] = await Promise.all([
        fetchTriageQueue({
          wardId: selectedWardId,
          category: selectedCategory,
          status: 'pending',
          minUrgency,
          sortBy: selectedSort,
        }),
        fetchTriageMetrics(selectedWardId),
      ]);

      if (isCancelled?.()) return;
      if (__DEV__) {
        console.log(`Queue loaded: ${queueData?.reports?.length || 0} reports`);
      }
      if (queueData?.reports) {
        setReports(queueData.reports);
      }
      if (metricsData) {
        setMetrics(metricsData);
      }
    } catch (error) {
      if (isCancelled?.()) return;
      if (__DEV__) console.warn('[TriageQueueScreen] Error loading queue:', error.message);
    } finally {
      if (!isCancelled?.()) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsRecalculating(false);
      }
    }
  }, [selectedWardId, selectedCategory, selectedSort, minUrgency]);

  // Sync controlled prop from scaffold
  useEffect(() => {
    if (propWardId && propWardId !== selectedWardId) {
      setSelectedWardId(propWardId);
    }
  }, [propWardId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    loadTriageData(() => cancelled).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadTriageData]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadTriageData();
  };

  const handleRecalculate = async () => {
    if (isRecalculating) return;
    setIsRecalculating(true);
    try {
      const result = await recalculateTriageQueue(selectedWardId);
      // Server-side scores are now persisted — pull the refreshed queue back down.
      await loadTriageData();
      Alert.alert(
        'Urgency Recalculated',
        `${result?.recalculated ?? 0} pending report(s) rescored and saved for ${result?.wardId || selectedWardId}.`
      );
    } catch (err) {
      Alert.alert('Recalculation Failed', err?.message || 'Could not recalculate the triage queue.');
    } finally {
      setIsRecalculating(false);
    }
  };

  const handleReportCreated = useCallback(
    (newReport) => {
      setIsAddReportOpen(false);
      setSelectedCategory('all');
      setTimeout(() => loadTriageData(), 50);
      const ref = newReport?._id || newReport?.id || '';
      try {
        AccessibilityInfo.announceForAccessibility('Barrier report successfully added to queue');
      } catch {}
      try {
        Alert.alert('Report Added', `Barrier report ${ref ? ref + ' ' : ''}added to Triage Queue.`);
      } catch {}
    },
    [loadTriageData]
  );

  // SPT-301: confirmation count pill dynamically reflects updated corroborationCount
  const handleCorroborationSuccess = useCallback(
    (updatedReport) => {
      if (!updatedReport?._id) return;
      setReports((prev) =>
        prev.map((r) =>
          r._id === updatedReport._id
            ? {
                ...r,
                corroborationCount: updatedReport.corroborationCount ?? r.corroborationCount,
                upvotedBy: updatedReport.upvotedBy ?? r.upvotedBy,
                triage: updatedReport.triage
                  ? { ...r.triage, ...updatedReport.triage, formulaFactors: { ...(r.triage?.formulaFactors || {}), corroborationCount: updatedReport.corroborationCount ?? r.corroborationCount } }
                  : r.triage,
              }
            : r
        )
      );
      fetchTriageMetrics(selectedWardId).then(setMetrics).catch(() => {});
      try {
        AccessibilityInfo.announceForAccessibility(`Confirmations updated to ${updatedReport.corroborationCount}`);
      } catch {}
    },
    [selectedWardId]
  );

  const handleCorroboratePress = async (reportItem) => {
    if (!reportItem?._id) return;
    try {
      const response = await corroborateReport(reportItem._id);
      const updated = response?.data || response;
      handleCorroborationSuccess({
        _id: reportItem._id,
        corroborationCount: updated?.corroborationCount ?? (reportItem.corroborationCount || 0) + 1,
        upvotedBy: updated?.upvotedBy,
        triage: updated?.triage,
      });
    } catch (err) {
      if (__DEV__) console.warn('[TriageQueueScreen] Corroborate error:', err.message);
    }
  };

  const getPriorityBadgeStyle = (badge) => {
    switch (badge) {
      case 'CRITICAL':
        return { bg: '#FEE2E2', border: '#DC2626', text: '#991B1B' };
      case 'HIGH':
        return { bg: '#FEF3C7', border: '#D97706', text: '#92400E' };
      case 'MEDIUM':
        return { bg: '#ECFDF5', border: '#10B981', text: '#047857' };
      default:
        return { bg: '#F1F5F9', border: '#94A3B8', text: '#475569' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B3D2E" />

      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarNavRow}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}
              accessibilityRole="button" accessibilityLabel="Back to Dashboard">
              <Feather name="arrow-left" size={16} color="#FFFFFF" style={{ marginRight: 5 }} />
              <Text style={styles.backBtnText}>Dashboard</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <View style={styles.topBarActions}>
            {canAddReport && (
              <TouchableOpacity
                style={styles.addReportBtn}
                onPress={() => setIsAddReportOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Add barrier report"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="plus" size={13} color="#FFFFFF" />
                <Text style={styles.addReportBtnText}>Add Report</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.recalculateBtn}
              onPress={handleRecalculate}
              disabled={isRecalculating}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Recalculate triage queue"
            >
              {isRecalculating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="refresh-cw" size={14} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.topBarTitleContainer}>
          <Text style={styles.topBarTitle}>Severity Triage Queue</Text>
          <Text style={styles.topBarSubtitle}>
            {activeWard.name} — Ward {activeWard.wardNumber}
          </Text>
        </View>

        {/* Ward Jurisdiction Selection Strip */}
        <View style={styles.wardStripWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wardScrollContent}>
            {MUNICIPAL_WARDS.map((ward) => {
              const isSelected = selectedWardId === ward.id;
              return (
                <TouchableOpacity
                  key={ward.id}
                  style={[styles.wardChip, isSelected && styles.wardChipSelected]}
                  onPress={() => {
                    setSelectedWardId(ward.id);
                    if (onWardChange) onWardChange(ward.id);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to Ward ${ward.wardNumber}: ${ward.name}`}
                >
                  <Feather
                    name="map-pin"
                    size={10}
                    color={isSelected ? '#FFFFFF' : '#A7F3D0'}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.wardChipText, isSelected && styles.wardChipTextSelected]}>
                    W{ward.wardNumber}: {ward.name.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#0B3D2E" />}
        showsVerticalScrollIndicator={false}
      >
        {/* Urgency Metrics KPI Row */}
        {metrics && (
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderTopColor: '#DC2626' }]}>
              <Text style={[styles.kpiCount, { color: '#DC2626' }]}>
                {metrics.criticalPriorityCount}
              </Text>
              <Text style={styles.kpiLabel}>CRITICAL</Text>
              <Text style={styles.kpiSub}>Score 80+</Text>
            </View>

            <View style={[styles.kpiCard, { borderTopColor: '#D97706' }]}>
              <Text style={[styles.kpiCount, { color: '#D97706' }]}>
                {metrics.highPriorityCount}
              </Text>
              <Text style={styles.kpiLabel}>HIGH</Text>
              <Text style={styles.kpiSub}>Score 60–79</Text>
            </View>

            <View style={[styles.kpiCard, { borderTopColor: '#10B981' }]}>
              <Text style={[styles.kpiCount, { color: '#047857' }]}>
                {metrics.mediumPriorityCount}
              </Text>
              <Text style={styles.kpiLabel}>MEDIUM</Text>
              <Text style={styles.kpiSub}>Score 40–59</Text>
            </View>

            <View style={[styles.kpiCard, { borderTopColor: '#0B3D2E' }]}>
              <Text style={[styles.kpiCount, { color: '#0B3D2E' }]}>
                {metrics.averageUrgencyIndex}
              </Text>
              <Text style={styles.kpiLabel}>AVG INDEX</Text>
              <Text style={styles.kpiSub}>0–100 Scale</Text>
            </View>
          </View>
        )}

        {/* Category Filters Bar */}
        <View style={styles.filterSection}>
          <Text style={styles.filterSectionHeader}>FILTER BY CATEGORY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.filterChip, isSelected && styles.filterChipSelected]}
                  onPress={() => setSelectedCategory(cat.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Sort & Urgency Threshold Controls */}
        <View style={styles.sortSection}>
          <View style={styles.sortHeaderRow}>
            <Text style={styles.filterSectionHeader}>SORT CRITERIA</Text>
            <View style={styles.resultCountBadge}>
              <Text style={styles.resultCountText}>{reports.length} pending</Text>
            </View>
          </View>
          <View style={styles.sortTabsRow}>
            {SORT_OPTIONS.map((opt) => {
              const isSelected = selectedSort === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.sortTab, isSelected && styles.sortTabSelected]}
                  onPress={() => setSelectedSort(opt.id)}
                  activeOpacity={0.7}
                >
                  <Feather
                    name={opt.icon}
                    size={12}
                    color={isSelected ? '#0B3D2E' : '#94A3B8'}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[styles.sortTabText, isSelected && styles.sortTabTextSelected]}
                    numberOfLines={1}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Report Queue List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0B3D2E" />
            <Text style={styles.loadingText}>Running Severity Triage Engine...</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBox}>
              <Feather name="check-circle" size={36} color="#10B981" />
            </View>
            <Text style={styles.emptyTitle}>Queue Clear</Text>
            <Text style={styles.emptyText}>
              No pending accessibility barriers match the selected category or urgency filter.
            </Text>
            {canAddReport && (
              <TouchableOpacity
                style={styles.emptyCtaBtn}
                onPress={() => setIsAddReportOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Add barrier report"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="plus" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.emptyCtaText}>Add Barrier Report</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.reportsList}>
            {reports.map((report, idx) => {
              const triage = report.triage || {};
              const badgeStyle = getPriorityBadgeStyle(triage.priorityBadge);
              const factors = triage.formulaFactors || {};

              return (
                <View key={report._id || idx} style={styles.reportCard}>
                  {/* Card Header */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.cardCategoryBadge}>
                      <Text style={styles.cardCategoryText}>{report.category}</Text>
                    </View>

                    <View
                      style={[
                        styles.urgencyBadge,
                        { backgroundColor: badgeStyle.bg, borderColor: badgeStyle.border },
                      ]}
                    >
                      <Text style={[styles.urgencyBadgeText, { color: badgeStyle.text }]}>
                        {triage.priorityBadge} — {triage.urgencyIndex}/100
                      </Text>
                    </View>
                  </View>

                  {/* Barrier Notes & Photo Preview */}
                  <View style={styles.cardBody}>
                    {isValidPhotoUri(report.photoUrl) ? (
                      <Image
                        source={{ uri: report.photoUrl }}
                        style={styles.cardThumbnail}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.cardThumbnailPlaceholder}>
                        <Feather name="camera" size={22} color="#94A3B8" />
                      </View>
                    )}

                    <View style={styles.cardMainInfo}>
                      {report.name ? (
                        <Text style={styles.cardReportName} numberOfLines={1}>
                          {report.name}
                        </Text>
                      ) : null}
                      {report.locationName ? (
                        <View style={styles.locationRow}>
                          <Feather name="map-pin" size={11} color="#059669" style={{ marginRight: 3 }} />
                          <Text style={styles.cardLocationName} numberOfLines={1}>
                            {report.locationName}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={styles.cardNotes} numberOfLines={report.name ? 2 : 3}>
                        {report.notes || 'No description provided.'}
                      </Text>

                      <View style={styles.cardMetaRow}>
                        <Text style={styles.cardRating}>
                          {'★'.repeat(report.rating || 3)}
                          {'☆'.repeat(5 - (report.rating || 3))}
                        </Text>
                        <TouchableOpacity
                          style={styles.corroborationPill}
                          onPress={() => handleCorroboratePress(report)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm barrier. Current count ${report.corroborationCount || 0}`}
                        >
                          <Feather name="users" size={10} color="#047857" style={{ marginRight: 4 }} />
                          <Text style={styles.corroborationText}>
                            {report.corroborationCount || 0}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {/* Vital Corridor Alert Banner */}
                  {factors.corridorName && (
                    <View style={styles.corridorTag}>
                      <Feather name="alert-triangle" size={12} color="#92400E" style={{ marginRight: 6 }} />
                      <Text style={styles.corridorText}>
                        Vital Corridor ({factors.vitalCorridorMultiplier}x) — {factors.corridorName}
                      </Text>
                    </View>
                  )}

                  {/* Municipal Asset Match Indicator */}
                  {triage.crossReferencedAsset && (
                    <View style={styles.assetMatchBox}>
                      <Feather name="tag" size={11} color="#64748B" style={{ marginRight: 6 }} />
                      <Text style={styles.assetMatchText} numberOfLines={1}>
                        Matched Asset: {triage.crossReferencedAsset.name} ({triage.distanceToAssetMeters}m)
                      </Text>
                    </View>
                  )}

                  {/* Card Action Footer */}
                  <View style={styles.cardFooter}>
                    <Text style={styles.cardDate}>
                      {factors.reportAgeDays != null ? `${factors.reportAgeDays}d ago` : '—'}
                    </Text>
                    <TouchableOpacity
                      style={styles.inspectButton}
                      onPress={() => onSelectReport && onSelectReport(report)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.inspectButtonText}>Inspect Evidence</Text>
                      <Feather name="arrow-right" size={12} color="#FFFFFF" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      {canAddReport && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setIsAddReportOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Add barrier report"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="plus" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      )}

      {/* Admin Add Report Modal */}
      <AdminAddReportModal
        visible={isAddReportOpen}
        onClose={() => setIsAddReportOpen(false)}
        wardId={selectedWardId}
        onReportCreated={handleReportCreated}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B3D2E',
  },
  container: {
    flex: 1,
    backgroundColor: '#F0F4F0',
  },
  content: {
    paddingBottom: 100,
  },
  topBar: {
    backgroundColor: '#0B3D2E',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  topBarNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    minHeight: 36,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  topBarTitleContainer: {
    alignItems: 'flex-start',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  topBarSubtitle: {
    fontSize: 12,
    color: '#A7F3D0',
    marginTop: 2,
    fontWeight: '500',
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#047857',
    gap: 5,
    justifyContent: 'center',
    minHeight: 36,
  },
  addReportBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  recalculateBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  kpiCount: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  kpiLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#475569',
    marginTop: 3,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  kpiSub: {
    fontSize: 8,
    color: '#94A3B8',
    marginTop: 1,
    textAlign: 'center',
  },
  filterSection: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  filterSectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  chipScroll: {
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginRight: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: '#0B3D2E',
    borderColor: '#0B3D2E',
  },
  filterChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  filterChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sortSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  sortHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  resultCountBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  resultCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  sortTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  sortTab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    minHeight: 36,
  },
  sortTabSelected: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sortTabText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    textAlign: 'center',
  },
  sortTabTextSelected: {
    color: '#0B3D2E',
    fontWeight: '800',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  emptyIconBox: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptyCtaBtn: {
    flexDirection: 'row',
    backgroundColor: '#0B3D2E',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 48,
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  fab: {
    position: 'absolute',
    bottom: 28,
    right: 16,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0B3D2E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0B3D2E',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  reportsList: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardCategoryBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardCategoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  urgencyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  urgencyBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  cardBody: {
    flexDirection: 'row',
    marginBottom: 10,
    gap: 12,
  },
  cardThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 12,
    flexShrink: 0,
  },
  cardThumbnailPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardMainInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardReportName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardLocationName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    flexShrink: 1,
  },
  cardNotes: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  cardRating: {
    fontSize: 12,
    color: '#F59E0B',
    letterSpacing: 1,
  },
  corroborationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  corroborationText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
  },
  corridorTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 8,
  },
  corridorText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
    flex: 1,
  },
  assetMatchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  assetMatchText: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  cardDate: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  inspectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B3D2E',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 36,
  },
  inspectButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  wardStripWrap: {
    marginTop: 10,
  },
  wardScrollContent: {
    gap: 8,
  },
  wardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  wardChipSelected: {
    backgroundColor: '#059669',
    borderColor: '#34D399',
  },
  wardChipText: {
    fontSize: 11,
    color: '#D1FAE5',
    fontWeight: '600',
  },
  wardChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
});

export default TriageQueueScreen;
