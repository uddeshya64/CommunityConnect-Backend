import { Router } from 'express';
import { TeamDashboardController } from '../controllers/teamDashboard.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// ==========================================
// PUBLIC ROUTES (Must be ABOVE authenticate)
// ==========================================

// GET /api/teamDashboard/verify-invite/:token
// Used by the frontend to fetch team details before the user logs in/signs up.
router.get('/verify-invite/:token', TeamDashboardController.verifyInvite);


// ==========================================
// PROTECTED ROUTES
// ==========================================
router.use(authenticate);

// POST /api/teamDashboard/accept-invite
// User has logged in and is submitting the token to join the team
router.post('/accept-invite', TeamDashboardController.acceptInvite);

// POST /api/teamDashboard/decline-invite
// User has logged in and is declining the team invitation
router.post('/decline-invite', TeamDashboardController.declineInvite);

// GET /api/teamDashboard/:id - Fetch dashboard details
router.get('/:id', TeamDashboardController.getDashboard);

// PATCH /api/teamDashboard/:id/name - Update the team name
router.patch('/:id/name', TeamDashboardController.updateName);

// POST /api/teamDashboard/:id/invite - Invite a new member
router.post('/:id/invite', TeamDashboardController.inviteMember);

// DELETE /api/teamDashboard/:id/members - Remove a member
router.delete('/:id/members', TeamDashboardController.removeMember);

// POST /api/teamDashboard/:id/submit - Submit or update project
router.post('/:id/submit', TeamDashboardController.submitProject);

// DELETE /api/teamDashboard/:id/invites - Revoke an invitation
router.delete('/:id/invites', TeamDashboardController.revokeInvite);

// POST /api/teamDashboard/:id/leave - Leave the team
router.post('/:id/leave', TeamDashboardController.leaveTeam);

export default router;