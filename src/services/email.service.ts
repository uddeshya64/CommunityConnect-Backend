import nodemailer from "nodemailer";
import { config } from '../config/env';
import { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';
import crypto from 'crypto';

const prisma = new PrismaClient();

// --- EMAIL TRANSPORTER SETUP ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,           // Use 587 instead of the default 465
  secure: false,       // false for 587, it will upgrade to TLS automatically
  auth: {
    user: config.EMAIL_USER,
    pass: config.EMAIL_PASS,
  },
  // 👇 THE RENDER FIX: Give the server more time to complete the handshake
  connectionTimeout: 20000, // 20 seconds
  greetingTimeout: 20000,
  socketTimeout: 20000,
  // 👇 Optional but helps bypass strict cloud firewalls
  tls: {
    rejectUnauthorized: false 
  }
});

export class EmailService {
  
  // 1. Send OTP Email (Used by AuthService)
  static async sendOtpEmail(email: string, otp: string) {
    try {
      await transporter.sendMail({
        from: '"CommunityConnect" <no-reply@communityconnect.com>',
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
        from: '"CommunityConnect" <no-reply@communityconnect.com>',
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

  // 3. Send Registration Confirmation Email with ticket QR code
  static async sendRegistrationConfirmationEmail(registrationId: number) {
    try {
      const reg = await prisma.registration.findUnique({
        where: { id: registrationId },
        include: {
          user: true,
          event: true,
          team: true
        }
      });

      if (!reg) {
        console.error(`[EMAIL_ERROR] Registration not found for ID: ${registrationId}`);
        return;
      }

      // Ensure ticket_code is present
      let ticketCode = reg.ticket_code;
      if (!ticketCode) {
        ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
        await prisma.registration.update({
          where: { id: reg.id },
          data: { ticket_code: ticketCode }
        });
      }

      // Generate QR Code PNG Buffer
      const qrBuffer = await QRCode.toBuffer(ticketCode, {
        margin: 1,
        color: {
          dark: '#18181b', // Zinc-900
          light: '#ffffff'
        }
      });

      // Format Date
      const formattedDate = new Date(reg.event.start_date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });

      const eventUrl = `${config.FRONTEND_URL}/events/${reg.event.id}`;

      await transporter.sendMail({
        from: '"CommunityConnect" <no-reply@communityconnect.com>',
        to: reg.user.email,
        subject: `Your Registration for ${reg.event.title} is Confirmed!`,
        text: `Hi ${reg.user.name}, you are registered for ${reg.event.title}. Your ticket code is ${ticketCode}. Go to ${eventUrl} for more details.`,
        html: `
          <div style="background-color: #f4f4f5; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <div style="max-width: 550px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);">
              <!-- Top Gradient Accent Bar -->
              <div style="height: 8px; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #f43f5e 100%);"></div>
              
              <div style="padding: 32px 24px;">
                <!-- Brand Header -->
                <div style="margin-bottom: 24px;">
                  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="vertical-align: middle; padding-right: 8px;">
                        <div style="width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, #4f46e5, #7c3aed);"></div>
                      </td>
                      <td style="vertical-align: middle;">
                        <span style="font-size: 18px; font-weight: 800; color: #18181b; letter-spacing: -0.5px;">CommunityConnect</span>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- Main Message -->
                <h2 style="font-size: 24px; font-weight: 800; color: #18181b; margin: 0 0 8px 0; line-height: 1.2;">Your Ticket is Confirmed! 🎉</h2>
                <p style="font-size: 15px; color: #71717a; margin: 0 0 28px 0; line-height: 1.5;">Hi ${reg.user.name}, your registration is complete. We've generated your entry ticket for the event. See the ticket details below.</p>

                <!-- Ticket Card -->
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 28px;">
                  <!-- Event Title -->
                  <h3 style="font-size: 20px; font-weight: 800; color: #18181b; margin: 0 0 12px 0; line-height: 1.3;">${reg.event.title}</h3>
                  
                  <!-- Badges -->
                  <div style="margin-bottom: 20px;">
                    <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #e0e7ff; color: #4338ca; text-transform: capitalize;">
                      ${reg.event.mode}
                    </span>
                    ${reg.team ? `
                    <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #f1f5f9; color: #334155; margin-left: 6px;">
                      Team: ${reg.team.name}
                    </span>
                    ` : ''}
                  </div>

                  <!-- Details -->
                  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
                    <tr>
                      <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Attendee</td>
                      <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${reg.user.name}</td>
                    </tr>
                    <tr>
                      <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Date & Time</td>
                      <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${formattedDate}</td>
                    </tr>
                    ${reg.event.location ? `
                    <tr>
                      <td style="width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Location</td>
                      <td style="font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${reg.event.location}</td>
                    </tr>
                    ` : ''}
                  </table>

                  <!-- Dashed Separator -->
                  <div style="border-top: 2px dashed #e2e8f0; height: 1px; margin: 24px 0;"></div>

                  <!-- QR Code Placement -->
                  <div style="text-align: center; padding-top: 8px;">
                    <div style="display: inline-block; padding: 12px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                      <img src="cid:ticketqr" alt="Ticket QR Code" style="width: 160px; height: 160px; display: block;" />
                    </div>
                    <div style="margin-top: 14px;">
                      <span style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Ticket Code</span>
                    </div>
                    <div style="margin-top: 4px;">
                      <span style="font-family: Consolas, Monaco, monospace; font-size: 13px; font-weight: 700; color: #1e293b; background-color: #f1f5f9; padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block;">
                        ${ticketCode}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Call to Action -->
                <div style="text-align: center; margin-bottom: 32px;">
                  <a href="${eventUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; border-radius: 9999px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1);">
                    View Event Dashboard
                  </a>
                </div>

                <!-- Guidelines -->
                <div style="background-color: #fef08a; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 6px; margin-bottom: 28px;">
                  <p style="margin: 0; font-size: 13px; color: #854d0e; font-weight: 500; line-height: 1.4;">
                    <strong>Important:</strong> Please keep this email handy and present the QR code above on your mobile phone for check-in at the entrance.
                  </p>
                </div>

                <!-- Footer -->
                <div style="text-align: center; border-top: 1px solid #e4e4e7; padding-top: 24px; font-family: sans-serif;">
                  <p style="font-size: 13px; color: #a1a1aa; margin: 0 0 6px 0;">Need assistance? Contact the organizer team via the platform.</p>
                  <p style="font-size: 12px; color: #d4d4d8; margin: 0;">&copy; ${new Date().getFullYear()} CommunityConnect. All rights reserved.</p>
                </div>
              </div>
            </div>
          </div>
        `,
        attachments: [{
          filename: 'ticket-qr.png',
          content: qrBuffer,
          cid: 'ticketqr'
        }]
      });
      console.log(`[EMAIL_SENT] Registration confirmation (ticket code: ${ticketCode}) sent to: ${reg.user.email}`);
    } catch (error) {
      console.error("[EMAIL_ERROR] Failed to send registration confirmation email:", error);
    }
  }
}