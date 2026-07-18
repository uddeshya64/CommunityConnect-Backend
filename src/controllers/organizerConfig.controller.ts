import { Request, Response } from 'express';
import { OrganizerConfigService } from '../services/organizerConfig.service';

export const OrganizerConfigController = {
  /**
   * GET /api/organizers/:organizerId/config
   * Retrieves tenant configuration settings for the organizer.
   */
  async getConfig(req: Request, res: Response) {
    try {
      const organizerId = Number(req.params.organizerId);
      if (isNaN(organizerId)) {
        return res.status(400).json({ error: "Invalid Organizer ID." });
      }

      const config = await OrganizerConfigService.getConfig(organizerId);
      res.json({ success: true, data: config });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  /**
   * PATCH /api/organizers/:organizerId/config
   * Updates tenant configuration settings for the organizer.
   */
  async updateConfig(req: Request, res: Response) {
    try {
      const organizerId = Number(req.params.organizerId);
      if (isNaN(organizerId)) {
        return res.status(400).json({ error: "Invalid Organizer ID." });
      }

      const { branding_config, tenant_policy, security_config, billing_info, subscription_status } = req.body;

      const updatedConfig = await OrganizerConfigService.updateConfig(organizerId, {
        branding_config,
        tenant_policy,
        security_config,
        billing_info,
        subscription_status
      });

      res.json({
        success: true,
        message: "Organizer configuration updated successfully.",
        data: updatedConfig
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
