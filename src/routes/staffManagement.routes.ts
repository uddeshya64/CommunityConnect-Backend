  import { Router } from 'express';
  import { EventStaffController } from '../controllers/staffManagement.controller';
  import { authenticate } from '../middlewares/auth.middleware';
  import { requirePermission } from '../middlewares/requirePermission.middleware';

  // We merge params so we can access :eventId from the parent router
  const router = Router({ mergeParams: true }); 

  // ==========================================
  // PROTECTED ORGANIZER ROUTES
  // ==========================================

  router.get('/roles', 
    authenticate, 
    requirePermission('MANAGE_STAFF'), 
    EventStaffController.getRoles
  );

  // POST /api/events/:eventId/staff/roles
  // Who can do this? Only God Mode (Creator) or someone with MANAGE_STAFF permission
  router.post('/roles', 
    authenticate, 
    requirePermission('MANAGE_STAFF'), 
    EventStaffController.createCustomRole
  );

  // POST /api/events/:eventId/staff/invite
  // Who can do this? Only God Mode (Creator) or someone with MANAGE_STAFF permission
  router.post('/invite', 
    authenticate, 
    requirePermission('MANAGE_STAFF'), 
    EventStaffController.inviteStaff
  );

  // POST /api/events/:eventId/manage/check-in
  // Who can do this? Volunteers or staff with MANAGE_ATTENDEES permission
  router.post('/check-in',
    authenticate,
    requirePermission('MANAGE_ATTENDEES'),
    EventStaffController.checkInParticipant
  );

  // ==========================================
  // GENERAL AUTHENTICATED ROUTES
  // ==========================================

  // POST /api/events/staff/accept-invite (Notice there is no :eventId here)
  // Who can do this? ANY logged in user who has a valid magic link token
  router.post('/accept-invite', 
    authenticate, 
    EventStaffController.acceptInvite
  );

  // ==========================================
  // PUBLIC ROUTES
  // ==========================================

  // GET /api/staff/verify-invite/:token
  // Who can do this? Anyone with the link. Used by frontend to show the "You're invited!" screen.
  router.get('/verify-invite/:token', EventStaffController.verifyInvite);

  export default router;