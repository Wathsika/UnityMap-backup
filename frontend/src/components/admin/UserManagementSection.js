/**
 * UserManagementSection.js
 * Comprehensive Mobile User Role Management Console for UnityMap
 * 
 * Aligned with UnityMap's emerald theme:
 * - Clear Admin Capabilities Guide
 * - Search & Role Filter Tabs (All, Admins, Citizens)
 * - User Metrics Summary
 * - Immediate Promote & Demote Actions
 * - Permanent Super Admin Protection Guard
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import authService, { USER_ROLES } from '../../services/authService';

export const UserManagementSection = ({ onBack, isStandalone = false }) => {
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL'); // 'ALL' | 'ADMIN' | 'REGULAR_USER'
  const [loadError, setLoadError] = useState(null);

  const loadUsers = useCallback(async (isCancelled) => {
    // Only treat the argument as a cancellation checker when it actually is one
    // (call sites like onPress={loadUsers} pass a press event object).
    const cancelled = typeof isCancelled === 'function' ? isCancelled : null;
    setLoadError(null);
    try {
      const list = await authService.getUsers();
      if (cancelled?.()) return;
      if (Array.isArray(list)) {
        setUsers(list);
      } else {
        setLoadError('The server returned an unexpected user directory.');
      }
    } catch (err) {
      if (cancelled?.()) return;
      // Distinguish "denied / offline" from "genuinely no users" so the UI
      // never claims an empty directory when the request actually failed.
      setLoadError(
        err?.status === 403
          ? 'Your municipal clearance does not permit viewing the user directory.'
          : err?.message || 'Could not reach the server to load the user directory.'
      );
    } finally {
      if (!cancelled?.()) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadUsers(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadUsers]);

  // Statistics
  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter(
      (u) => u.role === USER_ROLES.ADMIN || u.role === 'CHIEF_ENGINEER' || u.isSuperAdmin
    ).length;
    const regular = total - admins;
    return { total, admins, regular };
  }, [users]);

  // Filtered & Searched Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const isSuper = !!u.isSuperAdmin || u.email === 'admin@unitymap.com';
      const isAdmin = u.role === USER_ROLES.ADMIN || u.role === 'CHIEF_ENGINEER' || isSuper;

      if (roleFilter === 'ADMIN' && !isAdmin) return false;
      if (roleFilter === 'REGULAR_USER' && isAdmin) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = (u.name || '').toLowerCase().includes(q);
        const matchesEmail = (u.email || '').toLowerCase().includes(q);
        const matchesPhone = (u.phone || '').toLowerCase().includes(q);
        return matchesName || matchesEmail || matchesPhone;
      }
      return true;
    });
  }, [users, roleFilter, searchQuery]);

  const handlePromote = async (user) => {
    setActionLoadingId(user.id);
    setStatusMessage('');
    try {
      await authService.promoteUser(user.id);
      setStatusMessage(`Granted Administrator privileges to ${user.name}.`);
      await loadUsers();
    } catch (err) {
      const msg = err.message || 'Failed to promote user.';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Action Failed', msg);
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDemote = async (user) => {
    if (user.isSuperAdmin || user.email === 'admin@unitymap.com') {
      const msg = 'Security Policy: The root Super Admin cannot be demoted.';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Protected Account', msg);
      }
      return;
    }

    const executeDemote = async () => {
      setActionLoadingId(user.id);
      setStatusMessage('');
      try {
        await authService.demoteUser(user.id);
        setStatusMessage(`Revoked Administrator privileges for ${user.name}.`);
        await loadUsers();
      } catch (err) {
        const msg = err.message || 'Failed to demote user.';
        if (Platform.OS === 'web') {
          window.alert(msg);
        } else {
          Alert.alert('Action Failed', msg);
        }
      } finally {
        setActionLoadingId(null);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to demote ${user.name} to a Regular User?`)) {
        executeDemote();
      }
    } else {
      Alert.alert(
        'Confirm Demotion',
        `Are you sure you want to revoke Admin rights from ${user.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Demote', style: 'destructive', onPress: executeDemote },
        ]
      );
    }
  };

  // Standalone view is hosted directly by the admin scaffold (no parent ScrollView),
  // so it must scroll itself or the user list is unreachable on short screens.
  // Inline/hub usage is already inside the scaffold ScrollView — never nest there.
  const Root = isStandalone ? ScrollView : View;
  const rootProps = isStandalone
    ? {
        style: styles.standaloneScroll,
        contentContainerStyle: styles.standaloneContainer,
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: 'handled',
      }
    : { style: styles.container };

  return (
    <Root {...rootProps}>
      {/* Optional Standalone Header with Back Button */}
      {isStandalone && (
        <View style={styles.standaloneHeader}>
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to Admin Hub"
          >
            <Feather name="arrow-left" size={20} color="#FFFFFF" />
            <Text style={styles.backButtonText}>Dashboard</Text>
          </TouchableOpacity>
          <Text style={styles.standaloneTitle}>User Management</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      {/* Main Container Card */}
      <View style={styles.card}>
        {/* Header Title Row */}
        <View style={styles.headerRow}>
          <View style={styles.headerIconCircle}>
            <Feather name="users" size={20} color="#0B3D2E" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>User Role Management</Text>
            <Text style={styles.cardSubtitle}>
              Elevate community members or manage administrative permissions
            </Text>
          </View>
          <TouchableOpacity
            onPress={loadUsers}
            style={styles.refreshButton}
            accessibilityRole="button"
            accessibilityLabel="Refresh directory"
          >
            <Feather name="refresh-cw" size={16} color="#0B3D2E" />
          </TouchableOpacity>
        </View>

        {/* Admin Capabilities Explainer Banner */}
        <View style={styles.capabilityBanner}>
          <Feather name="shield" size={16} color="#0B3D2E" style={{ marginRight: 8, marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.capabilityTitle}>Admin Capabilities & Policies:</Text>
            <Text style={styles.capabilityDesc}>
              • Elevate any community reporter to Administrator status.{'\n'}
              • Demote administrative accounts back to Regular User.{'\n'}
              • Root Super Admin (admin@unitymap.com) is permanently protected.
            </Text>
          </View>
        </View>

        {/* Metrics Grid */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{stats.total}</Text>
            <Text style={styles.metricLabel}>Total Users</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
            <Text style={[styles.metricValue, { color: '#047857' }]}>{stats.admins}</Text>
            <Text style={[styles.metricLabel, { color: '#065F46' }]}>Admins</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
            <Text style={[styles.metricValue, { color: '#0B3D2E' }]}>{stats.regular}</Text>
            <Text style={[styles.metricLabel, { color: '#166534' }]}>Citizens</Text>
          </View>
        </View>

        {/* Status Message Feedback */}
        {statusMessage ? (
          <View style={styles.statusBanner}>
            <Feather name="check-circle" size={16} color="#047857" style={{ marginRight: 8 }} />
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        ) : null}

        {/* Search Input Bar */}
        <View style={styles.searchWrapper}>
          <Feather name="search" size={16} color="#64748B" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users by name, email, or phone..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          {[
            { id: 'ALL', label: `All (${stats.total})` },
            { id: 'ADMIN', label: `Admins (${stats.admins})` },
            { id: 'REGULAR_USER', label: `Citizens (${stats.regular})` },
          ].map((tab) => {
            const isActive = roleFilter === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setRoleFilter(tab.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* User List */}
        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#0B3D2E" size="small" />
            <Text style={styles.loadingText}>Loading registered users...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.emptyBox}>
            <Feather name="alert-triangle" size={24} color="#DC2626" />
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity onPress={loadUsers} style={styles.retryButton} accessibilityRole="button">
              <Feather name="refresh-cw" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : filteredUsers.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="user-x" size={24} color="#94A3B8" />
            <Text style={styles.emptyText}>
              {searchQuery ? `No users match "${searchQuery}"` : 'No users found in this category.'}
            </Text>
          </View>
        ) : (
          <View style={styles.userList}>
            {filteredUsers.map((item) => {
              const isSuper = !!item.isSuperAdmin || item.email === 'admin@unitymap.com';
              const isAdmin = item.role === USER_ROLES.ADMIN || item.role === 'CHIEF_ENGINEER' || isSuper;
              const isProcessing = actionLoadingId === item.id;

              return (
                <View key={item.id || item.email} style={styles.userCard}>
                  {/* Top Details Row */}
                  <View style={styles.userHeaderRow}>
                    <View
                      style={[
                        styles.avatarCircle,
                        {
                          backgroundColor: isSuper ? '#FEF3C7' : isAdmin ? '#ECFDF5' : '#F1F5F9',
                        },
                      ]}
                    >
                      <Feather
                        name={isSuper ? 'shield' : isAdmin ? 'award' : 'user'}
                        size={18}
                        color={isSuper ? '#D97706' : isAdmin ? '#047857' : '#64748B'}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <View style={styles.nameRow}>
                        <Text style={styles.userName} numberOfLines={2}>
                          {item.name}
                        </Text>
                        {isSuper ? (
                          <View style={styles.superBadge}>
                            <Text style={styles.superBadgeText}>SUPER ADMIN</Text>
                          </View>
                        ) : isAdmin ? (
                          <View style={styles.adminBadge}>
                            <Text style={styles.adminBadgeText}>ADMIN</Text>
                          </View>
                        ) : (
                          <View style={styles.citizenBadge}>
                            <Text style={styles.citizenBadgeText}>REGULAR USER</Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="middle">
                        {item.email}
                      </Text>
                      {item.phone ? (
                        <View style={styles.phoneRow}>
                          <Feather name="phone" size={11} color="#64748B" style={{ marginRight: 4 }} />
                          <Text style={styles.userPhone}>{item.phone}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* Actions Row */}
                  <View style={styles.cardActionRow}>
                    {isSuper ? (
                      <View style={styles.protectedBox}>
                        <Feather name="lock" size={13} color="#B45309" style={{ marginRight: 6 }} />
                        <Text style={styles.protectedText}>
                          Permanent Super Admin (Account cannot be demoted)
                        </Text>
                      </View>
                    ) : isAdmin ? (
                      <TouchableOpacity
                        style={[styles.btn, styles.demoteBtn, isProcessing && styles.btnDisabled]}
                        onPress={() => handleDemote(item)}
                        disabled={isProcessing}
                        activeOpacity={0.8}
                      >
                        {isProcessing ? (
                          <ActivityIndicator color="#DC2626" size="small" />
                        ) : (
                          <>
                            <Feather name="arrow-down-circle" size={14} color="#DC2626" style={{ marginRight: 6 }} />
                            <Text style={styles.demoteBtnText}>Demote to Regular User</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.btn, styles.promoteBtn, isProcessing && styles.btnDisabled]}
                        onPress={() => handlePromote(item)}
                        disabled={isProcessing}
                        activeOpacity={0.8}
                      >
                        {isProcessing ? (
                          <ActivityIndicator color="#047857" size="small" />
                        ) : (
                          <>
                            <Feather name="arrow-up-circle" size={14} color="#047857" style={{ marginRight: 6 }} />
                            <Text style={styles.promoteBtnText}>Promote to Admin</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </Root>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  standaloneScroll: {
    flex: 1,
  },
  standaloneContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  standaloneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 8,
    backgroundColor: '#0B3D2E',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 4,
  },
  standaloneTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  refreshButton: {
    padding: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
  },
  capabilityBanner: {
    flexDirection: 'row',
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  capabilityTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B3D2E',
    marginBottom: 3,
  },
  capabilityDesc: {
    fontSize: 11,
    color: '#166534',
    lineHeight: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: '#0B3D2E',
    borderColor: '#0B3D2E',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  loadingBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 8,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 8,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 14,
    backgroundColor: '#0B3D2E',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    minHeight: 44,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  userList: {
    gap: 10,
  },
  userCard: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  userHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 2,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  superBadge: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  superBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.3,
  },
  adminBadge: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  adminBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#047857',
    letterSpacing: 0.3,
  },
  citizenBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  citizenBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.3,
  },
  userEmail: {
    fontSize: 12,
    color: '#64748B',
  },
  userPhone: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },

  cardActionRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
  },
  protectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderColor: '#FEF3C7',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  protectedText: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '600',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    minHeight: 38,
  },
  promoteBtn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
    borderWidth: 1,
  },
  promoteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#047857',
  },
  demoteBtn: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
  },
  demoteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});

export default UserManagementSection;
