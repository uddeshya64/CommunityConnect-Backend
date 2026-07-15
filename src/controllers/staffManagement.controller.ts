import { Request, Response } from 'express';
import { EventStaffService } from '../services/staffManagement.service';
import { CreateCustomRoleSchema, InviteStaffSchema, AcceptStaffInviteSchema } from '../validation/eventStaff.validation';
import { ZodError } from 'zod';

export const EventStaffController = {

  // GET ALL ROLES FOR AN EVENT
  async getRoles(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      
      // Assuming your EventStaffService has a method to get roles. 
      // If it doesn't, you can query Prisma directly here.
      const roles = await EventStaffService.getRoles(eventId); 

      res.json({ success: true, data: roles });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 1. CREATE CUSTOM ROLE
  async createCustomRole(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const validatedData = CreateCustomRoleSchema.parse(req.body);

      const newRole = await EventStaffService.createCustomRole(
        eventId, 
        validatedData.name, 
        validatedData.permissions as any
      );

      res.status(201).json({ success: true, message: "Custom role created", data: newRole });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // 2. INVITE STAFF MEMBER
  async inviteStaff(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const { email, roleId } = InviteStaffSchema.parse(req.body);

      const result = await EventStaffService.inviteStaff(eventId, email, roleId);

      res.json({ success: true, message: result.message });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // GET /api/staff/verify-invite/:token
  async verifyInvite(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const details = await EventStaffService.verifyInviteToken(token);
      
      res.json({ success: true, data: details });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 3. ACCEPT INVITATION
  async acceptInvite(req: Request, res: Response) {
    try {
      const userId = req.user!.id; // Authenticated user clicking the link
      const { token } = AcceptStaffInviteSchema.parse(req.body);

      const result = await EventStaffService.acceptInvite(userId, token);

      res.json({ 
        success: true, 
        message: `Successfully joined event as ${result.roleName}!`,
        eventId: result.eventId 
      });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  }
  
};

