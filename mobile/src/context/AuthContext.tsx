import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as driverAuthApi from "../api/driverAuth";
import type { Driver } from "../types";

interface AuthContextValue {
  driver: Driver | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
  ) => Promise<{ email: string; message: string }>;
  // Chỉ xác nhận OTP đúng - KHÔNG tự login. Sau khi verify xong, người
  // dùng phải quay lại màn login và đăng nhập lại như bình thường.
  verifyOtp: (email: string, otp: string) => Promise<void>;
  resendOtp: (email: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync("driverToken");
      if (token) {
        try {
          const me = await driverAuthApi.fetchMe();
          setDriver(me);
        } catch {
          await SecureStore.deleteItemAsync("driverToken");
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { token, driver } = await driverAuthApi.login(email, password);
    await SecureStore.setItemAsync("driverToken", token);
    setDriver(driver);
  };

  // Chỉ tạo tài khoản + gửi OTP. KHÔNG login, KHÔNG lưu token —
  // backend chưa trả token ở bước này.
  const register = async (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
  ) => {
    return driverAuthApi.register(email, password, fullName, phoneNumber);
  };

  // Backend /verify-otp có trả token, nhưng theo yêu cầu UX: verify xong
  // KHÔNG tự vào app, phải quay lại đăng nhập tay cho chắc chắn. Nên ở
  // đây ta cố tình bỏ qua token trả về, chỉ coi verify-otp là bước xác
  // nhận, không phải bước login.
  const verifyOtp = async (email: string, otp: string) => {
    await driverAuthApi.verifyOtp(email, otp);
  };

  const resendOtp = async (email: string) => {
    return driverAuthApi.resendOtp(email);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync("driverToken");
    setDriver(null);
  };

  return (
    <AuthContext.Provider
      value={{
        driver,
        isLoading,
        login,
        register,
        verifyOtp,
        resendOtp,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
