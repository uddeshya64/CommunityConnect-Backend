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

// Add the new schema for accepting invites
export const AcceptTeamInviteSchema = z.object({
  token: z.string().min(10, "Invalid token format"),
});

export const SubmitProjectSchema = z.object({
  title: z.string().trim().min(3, "Project title must be at least 3 characters").max(100),
  repoUrl: z.string().trim().url("Invalid repository URL format").refine(val => {
    return /github\.com|gitlab\.com|bitbucket\.org/i.test(val);
  }, "Only GitHub, GitLab, or Bitbucket repository URLs are allowed"),
});

export const RevokeInviteSchema = z.object({
  inviteId: z.coerce.number().int().positive("Invalid invite ID"),
});