import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

export function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6 số
}

export async function sendOtpEmail(to, otp) {
    await transporter.sendMail({
        from: `"Pilotrix" <${process.env.GMAIL_USER}>`,
        to,
        subject: 'Mã xác thực Pilotrix Driver',
        html: `
            <div style="font-family: sans-serif; padding: 24px;">
                <h2>Xác thực tài khoản Pilotrix Driver</h2>
                <p>Mã xác thực của bạn là:</p>
                <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
                <p>Mã có hiệu lực trong 10 phút. Nếu không phải bạn yêu cầu, vui lòng bỏ qua email này.</p>
            </div>
        `,
    });
}