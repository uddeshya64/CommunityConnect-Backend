import { Router } from 'express';
import { OrganizerConfigController } from '../controllers/organizerConfig.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireTenantOwner } from '../middlewares/requireTenantOwner.middleware';

const router = Router();

// Retrieve configuration (Protected, restricted to the organizer/tenant owner)
router.get('/:organizerId/config', 
  authenticate, 
  requireTenantOwner, 
  OrganizerConfigController.getConfig
);

// Update configuration (Protected, restricted to the organizer/tenant owner)
router.patch('/:organizerId/config', 
  authenticate, 
  requireTenantOwner, 
  OrganizerConfigController.updateConfig
);

export default router;
