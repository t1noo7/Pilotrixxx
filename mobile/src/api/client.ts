import axios from "axios";
import * as SecureStore from "expo-secure-store";

const BASE_URL = "https://pilotrixxx.onrender.com"; // đổi thành URL Render thật

export const apiClient = axios.create({ baseURL: BASE_URL });

apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync("driverToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Tự logout khi token hết hạn/không hợp lệ (backend trả 401/403)
apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync("driverToken");
      // AuthContext sẽ tự phát hiện mất token ở lần check tiếp theo -
      // không điều hướng thẳng ở đây để tránh phụ thuộc vòng giữa
      // client.ts và router.
    }
    return Promise.reject(error);
  },
);
