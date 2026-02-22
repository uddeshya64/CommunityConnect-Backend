export const EVENT_PERMISSIONS = {
  MANAGE_EVENT: 'MANAGE_EVENT',                   // Edit details, dates, etc.
  MANAGE_STAFF: 'MANAGE_STAFF',                   // Invite/remove other staff
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',               // Access the backend organizer UI
  MANAGE_ATTENDEES: 'MANAGE_ATTENDEES',           // Accept/reject registrations
  SCORE_SUBMISSIONS: 'SCORE_SUBMISSIONS',         // Grade projects
  MANAGE_COMMUNICATIONS: 'MANAGE_COMMUNICATIONS', // Send emails/announcements
} as const;

export type EventPermission = keyof typeof EVENT_PERMISSIONS;