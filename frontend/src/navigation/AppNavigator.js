import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { getTextStyle, textProps } from '../theme/typography';

// Import Feature Screens
import WheelchairRoutingScreen from '../screens/wheelchair/WheelchairRoutingScreen';
import LiveTurnByTurnNavigationScreen from '../screens/wheelchair/LiveTurnByTurnNavigationScreen';
import OSMCanvasScreen from '../screens/wheelchair/OSMCanvasScreen';
import VoiceNavigationScreen from '../screens/audio/VoiceNavigationScreen';
import TTSInterfaceScreen from '../screens/audio/TTSInterfaceScreen';
import ThreeTapReportScreen from '../screens/volunteer/ThreeTapReportScreen';
import EXIFCaptureScreen from '../screens/volunteer/EXIFCaptureScreen';
import AdminPortalScaffoldScreen from '../screens/admin/AdminPortalScaffoldScreen';

const STREAMS = [
  { id: 'admin_portal', title: 'Admin Portal', component: AdminPortalScaffoldScreen },
  { id: 'wheelchair_route', title: 'Barrier Routing', component: WheelchairRoutingScreen },
  { id: 'wheelchair_turn_by_turn', title: 'Turn-by-Turn Nav', component: LiveTurnByTurnNavigationScreen },
  { id: 'osm_canvas', title: 'OSM Map Canvas', component: OSMCanvasScreen },
  { id: 'voice_nav', title: 'Voice Navigation', component: VoiceNavigationScreen },
  { id: 'tts_interface', title: 'TTS Interfaces', component: TTSInterfaceScreen },
  { id: 'volunteer_report', title: '3-Tap Report', component: ThreeTapReportScreen },
  { id: 'exif_capture', title: 'Take a Photo', component: EXIFCaptureScreen },
];

const TAB_ICONS = {
  admin_portal: '🏛️',
  wheelchair_route: '♿',
  wheelchair_turn_by_turn: '🧭',
  osm_canvas: '⌖',
  voice_nav: '🎙',
  tts_interface: '🔊',
  volunteer_report: '✚',
  exif_capture: '◉',
};

export const AppNavigator = () => {
  const [activeStream, setActiveStream] = useState('osm_canvas');
  const { palette, borderWidth, isHighContrast } = useTheme();

  const ActiveComponent = STREAMS.find(s => s.id === activeStream)?.component || WheelchairRoutingScreen;
  const activeProps =
    activeStream === 'volunteer_report'
      ? {
          onNavigateToMap: () => setActiveStream('osm_canvas'),
          onSuccess: () => setTimeout(() => setActiveStream('osm_canvas'), 800),
        }
      : {};

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { backgroundColor: palette.surface, borderBottomColor: palette.cardBorder, borderBottomWidth: borderWidth }]}>
        <Text {...textProps} style={[styles.headerTitle, getTextStyle('lg', { isHighContrast }), { color: palette.textPrimary }]}>
          UnityMap
        </Text>
      </View>

      <View style={[styles.screenContainer, { backgroundColor: palette.background }]}>
        <ActiveComponent {...activeProps} />
      </View>

      <View
        style={[
          styles.bottomTabBar,
          { backgroundColor: palette.surface, borderTopColor: palette.cardBorder, borderTopWidth: borderWidth },
          isHighContrast && { shadowOpacity: 0, elevation: 0 },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {STREAMS.map(stream => {
            const isActive = activeStream === stream.id;
            return (
              <TouchableOpacity
                key={stream.id}
                style={[styles.tabButton, isActive && [styles.activeTabButton, { backgroundColor: isHighContrast ? '#FFFFFF' : '#ECFDF5', borderColor: palette.border, borderWidth: isActive && isHighContrast ? borderWidth : 0 }]]}
                onPress={() => setActiveStream(stream.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={stream.title}
                accessibilityState={{ selected: isActive }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.tabIcon, { color: isActive ? palette.primary : palette.textMuted }]}>
                  {TAB_ICONS[stream.id]}
                </Text>
                <Text
                  {...textProps}
                  style={[styles.tabText, getTextStyle('xs', { isHighContrast }), { color: isActive ? palette.primary : palette.textMuted }]}
                  numberOfLines={1}
                >
                  {stream.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    alignItems: 'center',
  },
  headerTitle: {
    letterSpacing: 0.3,
  },
  bottomTabBar: {
    paddingTop: 6,
    paddingBottom: 8,
    minHeight: 62,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 4,
  },
  tabScroll: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 4,
    minWidth: 64,
    minHeight: 48,
    borderRadius: 10,
  },
  activeTabButton: {},
  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
    lineHeight: 20,
  },
  tabText: {
    textAlign: 'center',
  },
  screenContainer: {
    flex: 1,
  },
});

export default AppNavigator;
