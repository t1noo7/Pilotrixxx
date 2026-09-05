import { StorageClient } from '@supabase/storage-js';

// Dung @supabase/storage-js (khong phai @supabase/supabase-js) - package
// nhe hon, CHI chua phan Storage, khong tu dong khoi tao Realtime client.
// Ly do: @supabase/supabase-js ban moi khoi tao Realtime client (can
// WebSocket native, chi co tu Node 22+) ngay trong constructor cua
// createClient(), du minh khong dung Realtime ti nao - Render dang chay
// Node 20 nen se crash ngay luc start server. Storage-js tranh hoan toan
// van de nay vi khong dong goi Realtime.
//
// Dung Service Role Key - bypass RLS vi backend da tu xac thuc driver bang
// JWT rieng (verifyDriverToken), khong can Supabase Auth/RLS o day.
// KHONG BAO GIO dua key nay ra frontend/mobile.
const STORAGE_URL = `${process.env.SUPABASE_URL}/storage/v1`;
const supabaseStorage = new StorageClient(STORAGE_URL, {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
});

const AVATAR_BUCKET = 'avatars';

/**
 * Upload avatar buffer len Supabase Storage, tra ve public URL.
 * Ten file gan driverId + timestamp de:
 *  - Khong trung ten giua cac driver
 *  - Moi lan upload la 1 file MOI - tranh CDN/client cache tra ve anh cu
 *    khi driver doi avatar (public URL cu van con hop le nhung khong ai
 *    tro toi no nua sau khi UPDATE avatar_url).
 */
export async function uploadAvatar(driverId, buffer, mimetype) {
    const ext = mimetype === 'image/png' ? 'png' : 'jpg';
    const fileName = `driver-${driverId}-${Date.now()}.${ext}`;

    const { error } = await supabaseStorage
        .from(AVATAR_BUCKET)
        .upload(fileName, buffer, { contentType: mimetype, upsert: false });

    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

    const { data } = supabaseStorage.from(AVATAR_BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
}

/**
 * Xoa avatar cu khoi Storage dua vao public URL cua no. Goi SAU KHI da
 * UPDATE DB voi avatar moi thanh cong - day la buoc don dep phu, KHONG
 * duoc lam fail request chinh neu loi (vd file da bi xoa tu truoc, hoac
 * network glitch). Loi chi log, khong throw.
 */
export async function deleteAvatar(oldAvatarUrl) {
    if (!oldAvatarUrl) return;
    try {
        // URL dang: https://xxx.supabase.co/storage/v1/object/public/avatars/<fileName>
        const fileName = oldAvatarUrl.split('/').pop();
        if (!fileName) return;

        const { error } = await supabaseStorage.from(AVATAR_BUCKET).remove([fileName]);
        if (error) {
            console.error('[deleteAvatar] Khong xoa duoc anh cu:', error.message);
        }
    } catch (err) {
        console.error('[deleteAvatar] Error:', err.message);
    }
}
