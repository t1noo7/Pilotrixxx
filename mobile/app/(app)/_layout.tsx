import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { TripProvider } from "../../src/context/TripContext";

export default function AppLayout() {
  const { driver, isLoading } = useAuth();
  if (isLoading) return null;
  if (!driver) return <Redirect href="/(auth)/login" />;

  return (
    <TripProvider>
      <Stack screenOptions={{ headerShown: false }}>
        {/* (tabs) là route group - không xuất hiện trong URL, chỉ để tổ
            chức 3 tab chính (vehicles/history/profile) thành 1 navigator
            riêng, tách khỏi trip/[id] bên dưới. */}
        <Stack.Screen name="(tabs)" />

        {/* trip/[id] KHÔNG còn là 1 tab (trước đây bị đăng ký nhầm thành
            tab ẩn qua href:null, gây ra bug: không tab nào thực sự active
            khi đang xem màn này, và lỡ tay bấm tab khác vẫn vào được do
            tab bar vẫn hiển thị bên dưới).
            Giờ đây là 1 màn hình Stack riêng, trình bày dạng full screen
            modal - đè lên TRÊN toàn bộ khu vực có tab bar, nên khi đang
            chạy chuyến, tab bar bị che hẳn -> không còn bấm nhầm tab được
            nữa. gestureEnabled=false để tránh vuốt xuống thoát màn hình
            giữa chừng chuyến đi. */}
        <Stack.Screen
          name="trip/[id]"
          options={{
            presentation: "fullScreenModal",
            gestureEnabled: false,
          }}
        />
      </Stack>
    </TripProvider>
  );
}
