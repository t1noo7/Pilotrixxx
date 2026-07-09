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