import { Router } from 'express';
import { TeamDashboardController } from '../controllers/teamDashboard.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

/**
 * All routes here require authentication because team 
 * management is a private/internal action.
 */
router.use(authenticate);

// GET /api/teamDashboard/:id - Fetch dashboard details
router.get('/:id', TeamDashboardController.getDashboard);

// PATCH /api/teamDashboard/:id/name - Update the team name
router.patch('/:id/name', TeamDashboardController.updateName);

// POST /api/teamDashboard/:id/invite - Invite a new member
router.post('/:id/invite', TeamDashboardController.inviteMember);

// DELETE /api/teamDashboard/:id/members - Remove a member
// We use DELETE since it's a destructive action for the sub-resource (members)
router.delete('/:id/members', TeamDashboardController.removeMember);

export default router;