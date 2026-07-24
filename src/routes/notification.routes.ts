import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// GET /api/notifications
router.get('/', NotificationController.getNotifications);

export default router;
