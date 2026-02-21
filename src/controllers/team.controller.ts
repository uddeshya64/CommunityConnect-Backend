import { Request, Response } from 'express';
import { CheckoutService } from '../services/checkout.service';
import{StartRegistrationSchema, VerifyPaymentSchema} from '../validation/team.validation';

export const TeamController = {

  // POST /api/teams/register
  async startRegistration(req: Request, res: Response) {
    try {
      const { eventId, teamName } = StartRegistrationSchema.parse(req.body);
      const userId = req.user!.id; // From your auth middleware

      // Basic validation
      if (!eventId || !teamName) return res.status(400).json({ error: "Missing required fields" });

      const result = await CheckoutService.initializeTeamRegistration(userId, Number(eventId), teamName);

      // Return JSON to frontend so it can open Razorpay
      res.json({
        success: true,
        data: {
          team_id: result.team.id,
          razorpay_order_id: result.order.id,
          amount: result.order.amount,
          currency: result.order.currency
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/payments/verify
  async verifyPayment(req: Request, res: Response) {
    try {
      const { 
        razorpay_order_id, 
        razorpay_payment_id, 
        razorpay_signature, 
        team_id 
      } = VerifyPaymentSchema.parse(req.body);

      const result = await CheckoutService.verifyTeamPayment(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        Number(team_id)
      );

      res.json({ success: true, message: "Payment successful. Team activated!" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};