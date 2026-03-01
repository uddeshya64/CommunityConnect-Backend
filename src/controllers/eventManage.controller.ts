import { Request, Response } from 'express';
import { EventManageService } from '../services/eventManage.service';

export const EventManageController = {
  
  // GET /api/events/:eventId/manage/overview
  async getOverview(req: Request, res: Response) {
    try {
      // No Zod body validation needed for a simple GET request
      const eventId = Number(req.params.eventId);
      
      if (isNaN(eventId)) {
        return res.status(400).json({ error: "Invalid Event ID" });
      }

      // In a real app, you would also check if req.user.id has the right permissions here
      // const userId = req.user!.id; 

      const overviewData = await EventManageService.getEventOverview(eventId);
      
      res.json({ success: true, data: overviewData });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  // GET /api/events/:eventId/manage/participants
  async getParticipants(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      
      if (isNaN(eventId)) {
        return res.status(400).json({ error: "Invalid Event ID" });
      }

      // NOTE: In a production app, ensure req.user has the 'MANAGE_ATTENDEES' permission here
      const participants = await EventManageService.getParticipants(eventId);
      
      res.json({ success: true, data: participants });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
};