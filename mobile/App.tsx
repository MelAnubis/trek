import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { useAuthStore } from '@/store/authStore';
import { LoginScreen } from '@/screens/LoginScreen';
import { TripsScreen } from '@/screens/TripsScreen';
import { TripDetailScreen } from '@/screens/TripDetailScreen';
import { DayMapScreen } from '@/screens/DayMapScreen';
import { NavigationScreen } from '@/screens/NavigationScreen';
import { RecordScreen } from '@/screens/RecordScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { COLORS } from '@/theme/colors';
import { TabBar } from '@/components/TabBar';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  TripDetail: { tripId: number };
  DayMap: { tripId: number; dayId?: number };
  Navigate: { tripId: number; trackId: number };
};

export type TabParamList = {
  Trips: undefined;
  Grabar: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Trips" component={TripsScreen} />
      <Tab.Screen name="Grabar" component={RecordScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const { token } = useAuthStore();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor={COLORS.bg} />
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            {!token ? (
              <Stack.Screen name="Auth" component={LoginScreen} />
            ) : (
              <>
                <Stack.Screen name="Main" component={TabNavigator} />
                <Stack.Screen name="TripDetail" component={TripDetailScreen} />
                <Stack.Screen name="DayMap" component={DayMapScreen} />
                <Stack.Screen
                  name="Navigate"
                  component={NavigationScreen}
                  options={{ animation: 'fade', gestureEnabled: false }}
                />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
