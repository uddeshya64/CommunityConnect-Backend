import { PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config/env';

const prisma = new PrismaClient();

// Initialize Razorpay (Ensure these are in your .env)
const razorpay = new Razorpay({
  key_id: config.RAZORPAY_KEY_ID!,
  key_secret: config.RAZORPAY_KEY_SECRET!,
});

export class CheckoutService {
  
  // 1. INITIALIZE REGISTRATION & ORDER
  static async initializeTeamRegistration(userId: number, eventId: number, teamName: string) {
    // A. Fetch Event to get the authoritative price
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    // Industry Standard: Database Transaction to ensure no orphaned data
    return prisma.$transaction(async (tx) => {
      // B. Create the Team (Draft Status)
      const team = await tx.team.create({
        data: {
          name: teamName,
          event_id: eventId,
          leader_id: userId,
          status: 'draft' 
        }
      });

      // C. Add Leader as a Team Member
      await tx.teamMember.create({
        data: { team_id: team.id, user_id: userId }
      });

      // D. Create Pending Registration
      const registration = await tx.registration.create({
        data: {
          user_id: userId,
          event_id: eventId,
          team_id: team.id,
          status: 'pending'
        }
      });

      // E. Create Razorpay Order (Amount must be in Paisa)
      const amountInPaisa = Number(event.registration_fee) * 100;
      
      const order = await razorpay.orders.create({
        amount: amountInPaisa,
        currency: "INR",
        receipt: `receipt_team_${team.id}`,
      });

      return { team, registration, order };
    });
  }

  // 2. VERIFY SECURE SIGNATURE & ACTIVATE TEAM
  static async verifyTeamPayment(
    razorpayOrderId: string, 
    razorpayPaymentId: string, 
    razorpaySignature: string,
    teamId: number
  ) {
    // A. Cryptographic Verification (DO NOT SKIP)
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      throw new Error("Invalid payment signature. Payment rejected.");
    }

    // B. If valid, update database
    return prisma.$transaction(async (tx) => {
      // Find the pending registration for this team's leader
      const team = await tx.team.findUnique({ 
        where: { id: teamId },
        include: { registrations: true,
            event: { 
            select: { registration_fee: true } 
          }
         } 
      });

      if (!team || team.registrations.length === 0) throw new Error("Team/Registration not found");

      const leaderRegistration = team.registrations[0];
      const actualAmountPaid = team.event.registration_fee;

      // 1. Save Payment Record
      await tx.payment.create({
        data: {
          registration_id: leaderRegistration.id,
          amount: actualAmountPaid,
          currency: 'INR',
          provider: 'Razorpay',
          status: 'success',
          transaction_ref: razorpayPaymentId
        }
      });

      // 2. Mark Team as Active!
      await tx.team.update({
        where: { id: teamId },
        data: { status: 'active' }
      });

      // 3. Mark Registration as Confirmed
      await tx.registration.update({
        where: { id: leaderRegistration.id },
        data: { status: 'confirmed' }
      });

      return { success: true, teamId: teamId };
    });
  }
}