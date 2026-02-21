import { z } from 'zod';

export const UpdateTeamNameSchema = z.object({
  name: z.string().trim().min(3, "Team name must be at least 3 characters").max(50),
});

export const RemoveMemberSchema = z.object({
  userIdToRemove: z.coerce.number().int().positive("Invalid user ID"),
});

export const InviteMemberSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
});