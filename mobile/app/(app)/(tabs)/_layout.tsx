import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTrip } from "../../../src/context/TripContext";

export default function TabsLayout() {
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
      {/* Không còn Tabs.Screen cho trip/[id] nữa - đã chuyển ra Stack
          ở layout cha (app)/_layout.tsx */}
    </Tabs>
  );
}
