/**
 * WardComplianceScreen.js
 * Page 4: Ward Accessibility Compliance & Budget Analytics Dashboard
 * 
 * Assigned Member: Savindu
 * Ticket: SPT-209
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
  Modal,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { fetchWardCompliance, exportAuditReport, downloadAuditReportPdf } from '../../services/wardComplianceService';
import adminAuthService from '../../services/adminAuthService';
import { MUNICIPAL_WARDS, getWardById } from '../../utils/wardJurisdictions';

export const WardComplianceScreen = ({ onBack, initialWardId }) => {
  const currentUser = adminAuthService.getCurrentUser();
  const [selectedWardId, setSelectedWardId] = useState(
    initialWardId || currentUser?.assignedWardId || 'CMC-W01'
  );
  const [complianceData, setComplianceData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [auditModalData, setAuditModalData] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const activeWard = getWardById(selectedWardId);

  const loadCompliance = useCallback(async (wardId, isCancelled) => {
    setLoadError(null);
    try {
      const data = await fetchWardCompliance(wardId);
      if (isCancelled?.()) return;
      if (data) {
        setComplianceData(data);
      }
    } catch (err) {
      if (isCancelled?.()) return;
      // Surface the real reason instead of rendering stale or zeroed figures.
      setComplianceData(null);
      setLoadError(
        err?.status === 403
          ? 'Your municipal clearance does not permit viewing ward compliance data.'
          : err?.message || 'Could not load ward compliance data from the server.'
      );
    } finally {
      if (!isCancelled?.()) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    loadCompliance(selectedWardId, () => cancelled).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedWardId, loadCompliance]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadCompliance(selectedWardId);
  };

  const handleWardSelect = (wardId) => {
    setSelectedWardId(wardId);
  };

  const handleExportAudit = async () => {
    setIsExporting(true);
    try {
      const report = await exportAuditReport(selectedWardId);
      setAuditModalData(report);
    } catch (err) {
      Alert.alert('Export Error', err?.message || 'Failed to generate audit report.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadAuditPdf = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const result = await downloadAuditReportPdf(selectedWardId);
      setAuditModalData(null);
      Alert.alert(
        'Download Started',
        `${result.fileName} is being saved for council presentation.`
      );
    } catch (err) {
      Alert.alert(
        'Download Failed',
        err?.message || 'The audit PDF could not be downloaded. Please try again.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 85) return { text: '#16A34A', bg: '#DCFCE7', border: '#86EFAC', label: 'EXCELLENT' };
    if (score >= 75) return { text: '#047857', bg: '#ECFDF5', border: '#A7F3D0', label: 'GOOD' };
    if (score >= 65) return { text: '#D97706', bg: '#FEF3C7', border: '#FCD34D', label: 'NEEDS ATTENTION' };
    return { text: '#DC2626', bg: '#FEE2E2', border: '#FCA5A5', label: 'CRITICAL DEFICIT' };
  };

  const scoreTheme = getScoreColor(complianceData?.complianceScorePercent ?? 100);

  const getWorkOrderStatusBadge = (status) => {
    switch (status) {
      case 'IN_PROGRESS':
        return { label: 'IN PROGRESS', bg: '#ECFDF5', text: '#047857', border: '#A7F3D0' };
      case 'PENDING_INSPECTION':
        return { label: 'INSPECTION DUE', bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' };
      default:
        return { label: 'SCHEDULED', bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' };
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B3D2E" />

      {/* Top Header */}
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
          <TouchableOpacity
            style={styles.exportTopBtn}
            onPress={handleExportAudit}
            disabled={isExporting}
            activeOpacity={0.7}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Feather name="file-text" size={13} color="#FFFFFF" />
                <Text style={styles.exportTopBtnText}>Audit Report</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.topBarTitleRow}>
          <Text style={styles.topBarTitle}>Ward Compliance & Budget</Text>
          <Text style={styles.topBarSub} numberOfLines={1} ellipsizeMode="tail">
            {activeWard.name} • Ward {activeWard.wardNumber}
          </Text>
        </View>
      </View>

      {/* Ward Switcher Chips */}
      <View style={styles.wardPickerBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wardChipsScroll}>
          {MUNICIPAL_WARDS.map((w) => {
            const isSelected = w.id === selectedWardId;
            return (
              <TouchableOpacity
                key={w.id}
                style={[styles.wardChip, isSelected && styles.wardChipSelected]}
                onPress={() => handleWardSelect(w.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.wardChipText, isSelected && styles.wardChipTextSelected]}>
                  Ward {w.wardNumber}: {w.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#0B3D2E" />}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#0B3D2E" />
            <Text style={styles.loadingText}>Compiling Ward Accessibility Metrics...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.loadingBox}>
            <Feather name="alert-triangle" size={30} color="#DC2626" />
            <Text style={styles.errorTitle}>Compliance Data Unavailable</Text>
            <Text style={styles.errorDetail}>{loadError}</Text>
            <TouchableOpacity
              style={styles.errorRetryBtn}
              onPress={onRefresh}
              accessibilityRole="button"
              accessibilityLabel="Retry loading compliance data"
            >
              <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 7 }} />
              <Text style={styles.errorRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !complianceData ? (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>No compliance data available for this ward.</Text>
          </View>
        ) : (
          <>
            {/* Primary Accessibility Compliance Scorecard */}
            <View style={styles.scoreHeroCard}>
              <View style={styles.scoreHeroRow}>
                <View style={styles.scoreGaugeCircle}>
                  <Text style={[styles.scoreHeroNumber, { color: scoreTheme.text }]}>
                    {complianceData.complianceScorePercent}%
                  </Text>
                  <Text style={styles.scoreHeroCaption}>COMPLIANCE</Text>
                </View>

                <View style={styles.scoreHeroMeta}>
                  <View
                    style={[
                      styles.scoreStatusPill,
                      { backgroundColor: scoreTheme.bg, borderColor: scoreTheme.border },
                    ]}
                  >
                    <Text style={[styles.scoreStatusText, { color: scoreTheme.text }]}>
                      {scoreTheme.label}
                    </Text>
                  </View>
                  <Text style={styles.scoreHeroWardName} numberOfLines={2}>
                    {complianceData.name}
                  </Text>
                  <Text style={styles.scoreInspector} numberOfLines={1} ellipsizeMode="tail">
                    Assigned: {complianceData.assignedInspector}
                  </Text>
                  <View style={styles.slaRow}>
                    <Feather name="target" size={11} color="#047857" style={{ marginRight: 4 }} />
                    <Text style={styles.scoreTargetSla} numberOfLines={2}>
                      Target SLA: 85% minimum council benchmark
                    </Text>
                  </View>
                </View>
              </View>

              {/* Resolution Stats Row */}
              <View style={styles.statPillsRow}>
                <View style={styles.statPill}>
                  <Text style={[styles.statPillVal, { color: '#DC2626' }]}>
                    {complianceData.activeBarrierCount}
                  </Text>
                  <Text style={styles.statPillLbl}>Active Deficits</Text>
                </View>
                <View style={styles.statPillDivider} />
                <View style={styles.statPill}>
                  <Text style={[styles.statPillVal, { color: '#16A34A' }]}>
                    {complianceData.resolvedBarrierCount}
                  </Text>
                  <Text style={styles.statPillLbl}>Resolved</Text>
                </View>
                <View style={styles.statPillDivider} />
                <View style={styles.statPill}>
                  <Text style={styles.statPillVal}>
                    {complianceData.meanTimeToRepairDays != null
                      ? `${complianceData.meanTimeToRepairDays}d`
                      : '—'}
                  </Text>
                  <Text style={styles.statPillLbl}>Avg Repair Time</Text>
                </View>
              </View>
            </View>

            {/* Repair Budget Utilization Card */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Feather name="dollar-sign" size={13} color="#047857" style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>REPAIR BUDGET UTILIZATION</Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Municipal allocation vs. committed work order expenditures
              </Text>

              <View style={styles.budgetMetricsRow}>
                <View style={styles.budgetItem}>
                  <Text style={styles.budgetNum}>
                    {(complianceData.allocatedBudgetLKR / 1000000).toFixed(2)}M
                  </Text>
                  <Text style={styles.budgetLbl}>Allocated (LKR)</Text>
                </View>
                <View style={styles.budgetItem}>
                  <Text style={[styles.budgetNum, { color: '#0B3D2E' }]}>
                    {(complianceData.spentBudgetLKR / 1000000).toFixed(2)}M
                  </Text>
                  <Text style={styles.budgetLbl}>Committed (LKR)</Text>
                </View>
                <View style={styles.budgetItem}>
                  <Text style={[styles.budgetNum, { color: '#16A34A' }]}>
                    {(complianceData.availableBudgetLKR / 1000000).toFixed(2)}M
                  </Text>
                  <Text style={styles.budgetLbl}>Available (LKR)</Text>
                </View>
              </View>

              {/* Visual Budget Progress Bar */}
              <View style={styles.budgetProgressBarBg}>
                <View
                  style={[
                    styles.budgetProgressBarFill,
                    {
                      width: `${Math.min(
                        100,
                        Math.round(
                          (complianceData.spentBudgetLKR / complianceData.allocatedBudgetLKR) * 100
                        )
                      )}%`,
                    },
                  ]}
                />
              </View>
              <View style={styles.budgetBarFooter}>
                <Text style={styles.budgetPercentText}>
                  {Math.round(
                    (complianceData.spentBudgetLKR / complianceData.allocatedBudgetLKR) * 100
                  )}
                  % of allocated ward capital utilized
                </Text>
              </View>
            </View>

            {/* Category-Wise Accessibility Compliance Breakdown */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Feather name="bar-chart-2" size={13} color="#047857" style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>CATEGORY COMPLIANCE BREAKDOWN</Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Evaluation of barrier types against Colombo Municipal standards
              </Text>

              <View style={styles.categoriesList}>
                {complianceData.categoryBreakdown.map((cat, idx) => (
                  <View key={cat.category || idx} style={styles.categoryRow}>
                    <View style={styles.catHeaderRow}>
                      <Text style={styles.catName}>{cat.category}</Text>
                      <Text style={styles.catPercent}>{cat.compliancePercent}%</Text>
                    </View>
                    <View style={styles.catBarBg}>
                      <View
                        style={[
                          styles.catBarFill,
                          {
                            width: `${cat.compliancePercent}%`,
                            backgroundColor:
                              cat.compliancePercent >= 80
                                ? '#10B981'
                                : cat.compliancePercent >= 70
                                ? '#059669'
                                : '#F59E0B',
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.catFooterRow}>
                      <Text style={styles.catCount}>
                        {cat.activeCount} active defects • {cat.resolvedCount} remediated
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* Active Work Order Repair Queue */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleRow}>
                  <Feather name="tool" size={13} color="#047857" style={{ marginRight: 6 }} />
                  <Text style={styles.sectionTitle}>ACTIVE WORK ORDERS QUEUE</Text>
                </View>
                <Text style={styles.workOrderCountBadge}>
                  {complianceData.activeWorkOrders?.length || 0} active
                </Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Approved barrier repair tasks dispatched to municipal engineering teams
              </Text>

              {complianceData.activeWorkOrders && complianceData.activeWorkOrders.length > 0 ? (
                complianceData.activeWorkOrders.map((wo, idx) => {
                  const statusStyle = getWorkOrderStatusBadge(wo.status);
                  return (
                    <View key={wo.orderId || idx} style={styles.workOrderCard}>
                      <View style={styles.workOrderHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.workOrderId}>{wo.orderId}</Text>
                          <Text style={styles.workOrderTitle}>{wo.title}</Text>
                        </View>
                        <View
                          style={[
                            styles.workOrderStatusPill,
                            { backgroundColor: statusStyle.bg, borderColor: statusStyle.border },
                          ]}
                        >
                          <Text style={[styles.workOrderStatusText, { color: statusStyle.text }]}>
                            {statusStyle.label}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.workOrderDetails}>
                        <View style={styles.contractorRow}>
                          <Feather name="user" size={12} color="#475569" style={{ marginRight: 5 }} />
                          <Text style={styles.contractorText} numberOfLines={1} ellipsizeMode="tail">
                            {wo.contractor}
                          </Text>
                        </View>
                        <View style={styles.workOrderFooterRow}>
                          <Text style={styles.workOrderBudget}>
                            Cost: {Number(wo.allocatedLKR).toLocaleString()} LKR
                          </Text>
                          <Text style={styles.workOrderTarget}>Target: {wo.targetDate}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.noWorkOrdersBox}>
                  <View style={styles.noWorkOrdersIconBox}>
                    <Feather name="check-circle" size={28} color="#10B981" />
                  </View>
                  <Text style={styles.noWorkOrdersTitle}>No Pending Work Orders</Text>
                  <Text style={styles.noWorkOrdersSub}>
                    All reported barriers in this ward are either resolved or undergoing initial triage inspection.
                  </Text>
                </View>
              )}
            </View>

            {/* Monthly Resolution Trend */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Feather name="trending-up" size={13} color="#047857" style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>MONTHLY RESOLUTION PROGRESS</Text>
              </View>
              <Text style={styles.sectionSubtitle}>
                Barriers resolved by municipal crews over the last 5 months
              </Text>

              <View style={styles.trendRow}>
                {complianceData.monthlyTrends.map((t, idx) => (
                  <View key={t.month || idx} style={styles.trendCol}>
                    <Text style={styles.trendResolvedVal}>{t.resolved}</Text>
                    <View style={styles.trendBarTrack}>
                      <View
                        style={[
                          styles.trendBarFill,
                          { height: `${Math.min(100, Math.round((t.resolved / 40) * 100))}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.trendMonthLbl}>{t.month}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Export Audit Report Button */}
            <TouchableOpacity
              style={styles.exportFullBtn}
              onPress={handleExportAudit}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Generate compliance audit report"
            >
              <Feather name="file-text" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.exportFullBtnText}>
                Generate Council Compliance Audit Report
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Audit Report Modal */}
      <Modal visible={!!auditModalData} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalDialog}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="shield" size={16} color="#0B3D2E" />
                <Text style={styles.modalTitle}>Municipal Compliance Audit</Text>
              </View>
              <TouchableOpacity onPress={() => setAuditModalData(null)}
                style={styles.modalCloseBtn}
                accessibilityRole="button" accessibilityLabel="Close audit modal">
                <Feather name="x" size={18} color="#64748B" />
              </TouchableOpacity>
            </View>

            {auditModalData && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.auditReferenceBox}>
                  <Text style={styles.auditRefKey}>Official Audit Reference</Text>
                  <Text style={styles.auditRefVal} numberOfLines={1} ellipsizeMode="middle">
                    {auditModalData.reportReference}
                  </Text>
                  <Text style={styles.auditAuth} numberOfLines={2}>
                    {auditModalData.issuingAuthority}
                  </Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Ward Authority</Text>
                  <Text style={styles.auditDetailVal} numberOfLines={2}>
                    {auditModalData.wardName}
                  </Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Compliance Score</Text>
                  <Text style={[styles.auditDetailVal, { color: '#16A34A', fontWeight: '800' }]}>
                    {auditModalData.complianceScorePercent}%
                  </Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Allocated Capital</Text>
                  <Text style={styles.auditDetailVal}>
                    {Number(auditModalData.allocatedBudgetLKR).toLocaleString()} LKR
                  </Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Committed Repairs</Text>
                  <Text style={styles.auditDetailVal}>
                    {Number(auditModalData.spentBudgetLKR).toLocaleString()} LKR
                  </Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Active Barrier Queue</Text>
                  <Text style={styles.auditDetailVal}>{auditModalData.activeBarriers} defects</Text>
                </View>

                <View style={styles.auditDetailRow}>
                  <Text style={styles.auditDetailKey}>Audit Classification</Text>
                  <Text style={[styles.auditDetailVal, { color: '#0B3D2E', fontWeight: '800' }]}>
                    {auditModalData.auditStatus}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.downloadReportBtn, isDownloading && styles.downloadReportBtnDisabled]}
                  onPress={handleDownloadAuditPdf}
                  disabled={isDownloading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Download official PDF audit"
                  accessibilityState={{ disabled: isDownloading, busy: isDownloading }}
                >
                  {isDownloading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                  ) : (
                    <Feather name="download" size={15} color="#FFFFFF" style={{ marginRight: 8 }} />
                  )}
                  <Text style={styles.downloadReportText}>
                    {isDownloading ? 'Preparing PDF…' : 'Download Official PDF Audit'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
    paddingBottom: 40,
  },
  topBar: {
    backgroundColor: '#0B3D2E',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  topBarNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  topBarTitleRow: {
    alignItems: 'flex-start',
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
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  topBarSub: {
    fontSize: 12,
    color: '#A7F3D0',
    marginTop: 2,
    fontWeight: '500',
  },
  exportTopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    minHeight: 36,
  },
  exportTopBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  wardPickerBar: {
    backgroundColor: '#0B3D2E',
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  wardChipsScroll: {
    flexDirection: 'row',
  },
  wardChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  wardChipSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  wardChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  wardChipTextSelected: {
    color: '#0B3D2E',
    fontWeight: '800',
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  errorTitle: {
    marginTop: 14,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorDetail: {
    marginTop: 8,
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 19,
  },
  errorRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: '#0B3D2E',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    minHeight: 44,
  },
  errorRetryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  scoreHeroCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  scoreHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scoreGaugeCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F8FAFC',
    borderWidth: 5,
    borderColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreHeroNumber: {
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
  },
  scoreHeroCaption: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  scoreHeroMeta: {
    flex: 1,
  },
  scoreStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  scoreStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  scoreHeroWardName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  scoreInspector: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  scoreTargetSla: {
    fontSize: 10,
    color: '#047857',
    fontWeight: '600',
    marginTop: 4,
  },
  statPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
  },
  statPillVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  statPillLbl: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 2,
  },
  statPillDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#E2E8F0',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.7,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    marginBottom: 12,
    paddingLeft: 19,
  },
  workOrderCountBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  budgetMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  budgetItem: {
    flex: 1,
  },
  budgetNum: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  budgetLbl: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  budgetProgressBarBg: {
    height: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 5,
    overflow: 'hidden',
  },
  budgetProgressBarFill: {
    height: '100%',
    backgroundColor: '#0B3D2E',
    borderRadius: 5,
  },
  budgetBarFooter: {
    marginTop: 6,
  },
  budgetPercentText: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
  },
  categoriesList: {
    gap: 10,
  },
  categoryRow: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  catHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  catName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  catPercent: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  catBarBg: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  catBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  catFooterRow: {
    marginTop: 4,
  },
  catCount: {
    fontSize: 10,
    color: '#64748B',
  },
  workOrderCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  workOrderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  workOrderId: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    color: '#0B3D2E',
  },
  workOrderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  workOrderStatusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    marginLeft: 8,
  },
  workOrderStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  workOrderDetails: {
    marginTop: 4,
  },
  contractorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contractorText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  workOrderFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  workOrderBudget: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  workOrderTarget: {
    fontSize: 10,
    color: '#94A3B8',
  },
  noWorkOrdersBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  noWorkOrdersIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  noWorkOrdersTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 4,
  },
  noWorkOrdersSub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
  },
  trendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  trendCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  trendResolvedVal: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0B3D2E',
    marginBottom: 4,
  },
  trendBarTrack: {
    width: 22,
    height: 75,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  trendBarFill: {
    width: '100%',
    backgroundColor: '#10B981',
    borderRadius: 6,
  },
  trendMonthLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 6,
  },
  exportFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B3D2E',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    paddingVertical: 15,
    borderRadius: 14,
    minHeight: 52,
    shadowColor: '#0B3D2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  exportFullBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  modalDialog: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  auditReferenceBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  auditRefKey: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  auditRefVal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0B3D2E',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  auditAuth: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  auditDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  auditDetailKey: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  auditDetailVal: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
  },
  downloadReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B3D2E',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 18,
    marginBottom: 20,
    minHeight: 52,
  },
  downloadReportBtnDisabled: {
    backgroundColor: '#5B7A6E',
    opacity: 0.85,
  },
  downloadReportText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  slaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
});

export default WardComplianceScreen;
