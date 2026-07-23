import { Router } from 'express';
import { EventController } from '../controllers/event.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';
import { EventManageController } from '../controllers/eventManage.controller'
import { requirePermission } from '../middlewares/requirePermission.middleware';

import upload from "../middlewares/upload";


const router = Router();

// Public Routes (Feed & Details)
// Note: apply 'authenticate' optionally to 'getOne' if your middleware supports optional auth, 
// OR just handle the "no token" case in middleware to not crash but leave req.user undefined.
router.get('/types', optionalAuthenticate, EventController.getTypes);
router.get('/', EventController.getFeed);
router.post( "/:eventId/banner",authenticate, upload.single("banner"),EventController.uploadBanner); // banner image in event
router.get('/:id', optionalAuthenticate, EventController.getOne);
// ^ If you want guest users to view events, ensure your 'authenticate' middleware 
// doesn't block requests without tokens, or create a specific 'optionalAuth' middleware.

router.get('/:eventId/manage/overview', authenticate, EventManageController.getOverview);
router.get('/:eventId/manage/participants', authenticate, requirePermission(['MANAGE_ATTENDEES', 'MANAGE_CHECK_IN']), EventManageController.getParticipants);

// Protected Routes (Create, Update, Delete)
router.post('/', authenticate, EventController.create);
router.patch('/:id', authenticate, EventController.update);
router.delete('/:id', authenticate, EventController.delete);

export default router;