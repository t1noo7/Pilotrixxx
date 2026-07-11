import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/context/AuthContext";
import { TripProvider, useTrip } from "../../src/context/TripContext";

function AppTabs() {
  const { ongoingTrip } = useTrip();
  const hasOngoing = !!ongoingTrip;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#9ca3af",
      }}
    >
      <Tabs.Screen
        name="vehicles"
        options={{
          title: hasOngoing ? "Đang chạy" : "Chọn xe",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={
                hasOngoing
                  ? focused
                    ? "navigate"
                    : "navigate-outline"
                  : focused
                    ? "car-sport"
                    : "car-sport-outline"
              }
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Lịch sử",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "time" : "time-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Cá nhân",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="trip/[id]" options={{ href: null }} />
      {/* href: null - ẩn khỏi tab bar, chỉ vào bằng router.push từ vehicles.tsx */}
    </Tabs>
  );
}

export default function AppLayout() {
  const { driver, isLoading } = useAuth();
  if (isLoading) return null;
  if (!driver) return <Redirect href="/(auth)/login" />;

  return (
    <TripProvider>
      <AppTabs />
    </TripProvider>
  );
}
