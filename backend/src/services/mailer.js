export function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6 số
}

export async function sendOtpEmail(to, otp) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'accept': 'application/json',
        },
        body: JSON.stringify({
            sender: { name: 'Pilotrix', email: process.env.BREVO_SENDER_EMAIL },
            to: [{ email: to }],
            subject: 'Mã xác thực Pilotrix Driver',
            htmlContent: `
                <div style="font-family: sans-serif; padding: 24px;">
                    <h2>Xác thực tài khoản Pilotrix Driver</h2>
                    <p>Mã xác thực của bạn là:</p>
                    <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
                    <p>Mã có hiệu lực trong 10 phút. Nếu không phải bạn yêu cầu, vui lòng bỏ qua email này.</p>
                </div>
            `,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brevo API error ${res.status}: ${body}`);
    }
}

/**
 * Gui khi co ai do goi /register hoac /resend-otp bang 1 email DA CO
 * tai khoan va DA verify roi. Khong gui OTP (khong co gi de xac thuc
 * them) - thay vao do bao that cho chinh chu email biet, vi day la kenh
 * chi chu tai khoan doc duoc (API response ben ngoai van tra ve message
 * chung chung, khong phan biet duoc case nay - xem driverAuth.js).
 */
export async function sendAlreadyRegisteredEmail(to) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json',
            'accept': 'application/json',
        },
        body: JSON.stringify({
            sender: { name: 'Pilotrix', email: process.env.BREVO_SENDER_EMAIL },
            to: [{ email: to }],
            subject: 'Email này đã có tài khoản Pilotrix',
            htmlContent: `
                <div style="font-family: sans-serif; padding: 24px;">
                    <h2>Email này đã có tài khoản</h2>
                    <p>Có người vừa thử đăng ký (hoặc yêu cầu gửi lại mã xác thực) bằng email này trên ứng dụng Pilotrix Driver, nhưng email này đã có tài khoản và đã được xác thực từ trước.</p>
                    <p>Nếu đó là bạn, hãy quay lại ứng dụng và đăng nhập bình thường.</p>
                    <p>Nếu không phải bạn thực hiện yêu cầu này, vui lòng bỏ qua email.</p>
                </div>
            `,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brevo API error ${res.status}: ${body}`);
    }
}
