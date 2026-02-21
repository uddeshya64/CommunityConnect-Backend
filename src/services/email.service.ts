import nodemailer from "nodemailer";
import { config } from '../config/env';

// --- EMAIL TRANSPORTER SETUP ---
const transporter = nodemailer.createTransport({
  service: "gmail", // In production, switch to 'SES', 'SendGrid', or 'Resend'
  auth: {
    user: config.EMAIL_USER,
    pass: config.EMAIL_PASS,
  },
});

export class EmailService {
  
  // 1. Send OTP Email (Used by AuthService)
  static async sendOtpEmail(email: string, otp: string) {
    try {
      await transporter.sendMail({
        from: '"Hackathon Platform" <no-reply@hackathon.com>',
        to: email,
        subject: "Your Verification Code",
        text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Verification Code</h2>
            <p>Your verification code is: <b>${otp}</b></p>
            <p>It expires in 10 minutes. Do not share this code with anyone.</p>
          </div>
        `,
      });
      console.log(`[EMAIL_SENT] OTP to: ${email}`);
    } catch (error) {
      console.error("Email sending failed:", error);
      throw new Error("Failed to send verification email. Please try again.");
    }
  }

  // 2. Send Team Invite (Used by TeamDashboardService)
  static async sendTeamInvite(email: string, teamName: string, magicLink: string) {
    try {
      await transporter.sendMail({
        from: '"Hackathon Platform" <no-reply@hackathon.com>',
        to: email,
        subject: `You have been invited to join ${teamName}!`,
        text: `Click this link to join the team: ${magicLink}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Team Invitation</h2>
            <p>You have been invited to join the team <b>${teamName}</b>.</p>
            <a href="${magicLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Accept Invitation</a>
            <p><small>If the button doesn't work, copy and paste this link: ${magicLink}</small></p>
          </div>
        `,
      });
      console.log(`[EMAIL_SENT] Invite to: ${email}`);
    } catch (error) {
      console.error("Email sending failed:", error);
      // We don't always throw an error here, because we don't want a failing email 
      // to crash the entire "Invite" API response.
    }
  }
}