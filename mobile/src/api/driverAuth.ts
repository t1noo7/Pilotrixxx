import { apiClient } from "./client";
import type { Driver } from "../types";

export async function login(email: string, password: string) {
  const { data } = await apiClient.post<{ token: string; driver: Driver }>(
    "/api/driver-auth/login",
    { email, password },
  );
  return data;
}

// Backend giờ KHÔNG trả token ở bước register nữa — chỉ tạo tài khoản
// + gửi OTP. Phải verify-otp mới có token thật.
export async function register(
  email: string,
  password: string,
  fullName: string,
  phoneNumber?: string,
) {
  const { data } = await apiClient.post<{ email: string; message: string }>(
    "/api/driver-auth/register",
    { email, password, fullName, phoneNumber },
  );
  return data;
}

export async function verifyOtp(email: string, otp: string) {
  const { data } = await apiClient.post<{ token: string; driver: Driver }>(
    "/api/driver-auth/verify-otp",
    { email, otp },
  );
  return data;
}

export async function resendOtp(email: string) {
  const { data } = await apiClient.post<{ message: string }>(
    "/api/driver-auth/resend-otp",
    { email },
  );
  return data;
}

export async function fetchMe() {
  const { data } = await apiClient.get<{ driver: Driver }>(
    "/api/driver-auth/me",
  );
  return data.driver;
}
