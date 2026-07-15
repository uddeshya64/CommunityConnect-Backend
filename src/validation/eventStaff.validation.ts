import { z } from 'zod';
import { EVENT_PERMISSIONS } from '../utils/constants/permissions'; // Adjust path if needed

// Extract the valid permission strings into an array for Zod to check against
const validPermissions = Object.keys(EVENT_PERMISSIONS) as [string, ...string[]];

export const CreateCustomRoleSchema = z.object({
  name: z.string().trim().min(2, "Role name must be at least 2 characters").max(50),
  permissions: z.array(z.enum(validPermissions)).min(1, "Select at least one permission"),
});

export const InviteStaffSchema = z.object({
  email: z.string().trim().email("Please provide a valid email address"),
  roleId: z.coerce.number().int().positive("A valid Role ID is required"),
});

export const AcceptStaffInviteSchema = z.object({
  token: z.string().min(10, "Invalid token format"),
});