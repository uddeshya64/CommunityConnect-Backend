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

    const fee = Number(event.registration_fee);
    const isFree = fee === 0;

    // Industry Standard: Database Transaction
    return prisma.$transaction(async (tx) => {
      
      // B. Create the Team (If free, instantly active. Otherwise, draft)
      const team = await tx.team.create({
        data: {
          name: teamName,
          event_id: eventId,
          leader_id: userId,
          status: isFree ? 'active' : 'draft' 
        }
      });

      // C. Add Leader as a Team Member
      await tx.teamMember.create({
        data: { team_id: team.id, user_id: userId }
      });

      // D. Create Registration (If free, instantly confirmed)
      const registration = await tx.registration.create({
        data: {
          user_id: userId,
          event_id: eventId,
          team_id: team.id,
          status: isFree ? 'confirmed' : 'pending'
        }
      });

      // ==========================================
      // THE BYPASS: Handle Free Events
      // ==========================================
      if (isFree) {
        // Create a zero-amount payment record for database consistency
        await tx.payment.create({
          data: {
            registration_id: registration.id,
            amount: 0,
            currency: 'INR',
            provider: 'SYSTEM',
            status: 'success',
            transaction_ref: `FREE_${Date.now()}`
          }
        });

        // Return immediately. Tell the frontend no payment is needed.
        return { isFree: true, team, registration };
      }

      // ==========================================
      // RAZORPAY: Handle Paid Events
      // ==========================================
      const amountInPaisa = fee * 100;
      
      const order = await razorpay.orders.create({
        amount: amountInPaisa,
        currency: "INR",
        receipt: `receipt_team_${team.id}`,
      });

      // Tell the frontend to open the Razorpay UI
      return { isFree: false, team, registration, order };
    });
  }
  // ==========================================
  // INDIVIDUAL REGISTRATION FLOW
  // ==========================================

  // 1. INITIALIZE INDIVIDUAL REGISTRATION
  static async initializeIndividualRegistration(userId: number, eventId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    // Optional Validation: Ensure this event actually allows individual participation
    if (event.registration_type !== 'individual' && event.min_team_size > 1) {
      throw new Error("This event requires you to register as a team.");
    }

    // Check to prevent double registration
    const existingRegistration = await prisma.registration.findFirst({
      where: { event_id: eventId, user_id: userId }
    });
    if (existingRegistration) throw new Error("You are already registered for this event.");

    const fee = Number(event.registration_fee);
    const isFree = fee === 0;

    return prisma.$transaction(async (tx) => {
      
      // A. Create Registration (No Team involved!)
      const registration = await tx.registration.create({
        data: {
          user_id: userId,
          event_id: eventId,
          status: isFree ? 'confirmed' : 'pending'
          // Notice: team_id is left completely empty 
        }
      });

      // B. Handle Free Events
      if (isFree) {
        await tx.payment.create({
          data: {
            registration_id: registration.id,
            amount: 0,
            currency: 'INR',
            provider: 'SYSTEM',
            status: 'success',
            transaction_ref: `FREE_IND_${Date.now()}`
          }
        });
        return { isFree: true, registration };
      }

      // C. Handle Paid Events via Razorpay
      const amountInPaisa = fee * 100;
      const order = await razorpay.orders.create({
        amount: amountInPaisa,
        currency: "INR",
        receipt: `receipt_ind_${registration.id}`,
      });

      return { isFree: false, registration, order };
    });
  }


  // 2. VERIFY INDIVIDUAL PAYMENT
  static async verifyIndividualPayment(
    razorpayOrderId: string, 
    razorpayPaymentId: string, 
    razorpaySignature: string,
    registrationId: number
  ) {
    // A. Cryptographic Verification
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
      const registration = await tx.registration.findUnique({ 
        where: { id: registrationId },
        include: { event: true }
      });

      if (!registration) throw new Error("Registration not found");

      // 1. Save Payment Record
      await tx.payment.create({
        data: {
          registration_id: registration.id,
          amount: registration.event.registration_fee,
          currency: 'INR',
          provider: 'Razorpay',
          status: 'success',
          transaction_ref: razorpayPaymentId
        }
      });

      // 2. Mark Registration as Confirmed
      await tx.registration.update({
        where: { id: registration.id },
        data: { status: 'confirmed' }
      });

      return { success: true, registrationId: registration.id };
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