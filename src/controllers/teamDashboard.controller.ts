import { Request, Response } from 'express';
import { TeamDashboardService } from '../services/teamDashboard.service';
import { UpdateTeamNameSchema, RemoveMemberSchema, InviteMemberSchema } from '../validation/teamDashboard';
import { ZodError } from 'zod';

export const TeamDashboardController = {

  async getDashboard(req: Request, res: Response) {
    try {
      const teamId = Number(req.params.id);
      const userId = req.user!.id;
      
      const details = await TeamDashboardService.getTeamDetails(teamId, userId);
      res.json({ success: true, data: details });
    } catch (error: any) {
      res.status(403).json({ error: error.message });
    }
  },

  async updateName(req: Request, res: Response) {
    try {
      const teamId = Number(req.params.id);
      const userId = req.user!.id;
      const { name } = UpdateTeamNameSchema.parse(req.body);

      const updatedTeam = await TeamDashboardService.updateTeamName(teamId, userId, name);
      res.json({ success: true, message: "Team name updated", data: updatedTeam });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: error.issues });
      res.status(403).json({ error: error.message });
    }
  },

  async inviteMember(req: Request, res: Response) {
    try {
      const teamId = Number(req.params.id);
      const userId = req.user!.id;
      const { email } = InviteMemberSchema.parse(req.body);

      await TeamDashboardService.inviteMember(teamId, userId, email);
      res.json({ success: true, message: "Invitation sent!" });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  async removeMember(req: Request, res: Response) {
    try {
      const teamId = Number(req.params.id);
      const leaderId = req.user!.id;
      const { userIdToRemove } = RemoveMemberSchema.parse(req.body);

      await TeamDashboardService.removeMember(teamId, leaderId, userIdToRemove);
      res.json({ success: true, message: "Member removed" });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: error.issues });
      res.status(400).json({ error: error.message });
    }
  }
};