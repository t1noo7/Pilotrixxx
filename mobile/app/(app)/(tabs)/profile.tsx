import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../../../src/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  DriverProfile,
} from "../../../src/api/driverTrips";

export default function ProfileScreen() {
  const { driver, logout } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [fullNameInput, setFullNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [licenseInput, setLicenseInput] = useState("");

  const load = () => {
    getProfile()
      .then(setProfile)
      .catch((err) =>
        console.log("getProfile error:", err.response?.data || err.message),
      );
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = () => {
    setFullNameInput(profile?.full_name ?? driver?.fullName ?? "");
    setPhoneInput(profile?.phone_number ?? "");
    setLicenseInput(profile?.license_number ?? "");
    setEditVisible(true);
  };

  const handleSave = async () => {
    if (!fullNameInput.trim()) {
      Alert.alert("Thiếu thông tin", "Họ tên không được để trống");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile({
        fullName: fullNameInput.trim(),
        phoneNumber: phoneInput.trim() || null,
        licenseNumber: licenseInput.trim() || null,
      });
      setProfile(updated);
      setEditVisible(false);
    } catch (err: any) {
      Alert.alert(
        "Không lưu được",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    // Xin quyền truy cập thư viện ảnh - chỉ hỏi khi thực sự cần (lazy),
    // không xin ngay lúc mở màn hình.
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Cần quyền truy cập",
        "Cho phép truy cập thư viện ảnh để đổi ảnh đại diện",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1], // Crop vuông - khớp avatar tròn
      quality: 0.6, // Nén sẵn phía client - giảm dung lượng trước khi upload
    });

    if (result.canceled || !result.assets?.[0]) return;

    const imageUri = result.assets[0].uri;
    setUploadingAvatar(true);
    try {
      const updated = await uploadAvatar(imageUri);
      setProfile((prev) =>
        prev ? { ...prev, avatar_url: updated.avatar_url } : prev,
      );
    } catch (err: any) {
      Alert.alert(
        "Không đổi được ảnh",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Đăng xuất", "Bạn có chắc muốn đăng xuất?", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Đăng xuất",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.avatarWrapper}
        onPress={handlePickAvatar}
        disabled={uploadingAvatar}
        activeOpacity={0.8}
      >
        <View style={styles.avatarCircle}>
          {profile?.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatarImage}
            />
          ) : (
            <Ionicons name="person" size={48} color="#2563eb" />
          )}
          {uploadingAvatar && (
            <View style={styles.avatarLoadingOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.avatarCameraBadge}>
          <Ionicons name="camera" size={16} color="#fff" />
        </View>
      </TouchableOpacity>

      <View style={styles.nameRow}>
        <Text style={styles.name}>
          {profile?.full_name ?? driver?.fullName}
        </Text>
        <TouchableOpacity onPress={openEdit} hitSlop={8}>
          <Ionicons name="pencil" size={18} color="#2563eb" />
        </TouchableOpacity>
      </View>
      <View style={styles.emailRow}>
        <Text style={styles.email}>{profile?.email ?? driver?.email}</Text>
        <Ionicons
          name={
            profile?.email_verified
              ? "checkmark-circle"
              : "checkmark-circle-outline"
          }
          size={16}
          color={profile?.email_verified ? "#2563eb" : "#d1d5db"}
        />
      </View>

      <View style={styles.infoBlock}>
        <View style={styles.infoRow}>
          <Ionicons name="call-outline" size={18} color="#6b7280" />
          <Text style={styles.infoText}>
            {profile?.phone_number || "Chưa cập nhật"}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="card-outline" size={18} color="#6b7280" />
          <Text style={styles.infoText}>
            {profile?.license_number || "Chưa cập nhật"}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#fff" />
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </TouchableOpacity>

      <Modal visible={editVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Chỉnh sửa thông tin</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Họ và tên"
              value={fullNameInput}
              onChangeText={setFullNameInput}
              autoFocus
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Số điện thoại"
              value={phoneInput}
              onChangeText={setPhoneInput}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Số bằng lái"
              value={licenseInput}
              onChangeText={setLicenseInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditVisible(false)}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.modalConfirmText}>
                  {saving ? "Đang lưu..." : "Lưu"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 48,
    backgroundColor: "#fff",
  },
  avatarWrapper: {
    width: 88,
    height: 88,
    marginBottom: 16,
  },
  avatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 88,
    height: 88,
  },
  avatarLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#00000066",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCameraBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  name: { fontSize: 20, fontWeight: "600" },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  },
  email: { fontSize: 14, color: "#6b7280" },
  infoBlock: {
    width: "100%",
    paddingHorizontal: 32,
    gap: 14,
    marginBottom: 32,
  },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontSize: 14, color: "#374151" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ef4444",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  logoutText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000099",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "85%",
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  modalCancelBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  modalCancelText: { color: "#6b7280", fontWeight: "600" },
  modalConfirmBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalConfirmText: { color: "#fff", fontWeight: "700" },
});
