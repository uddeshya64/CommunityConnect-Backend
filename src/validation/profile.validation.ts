import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone format").optional(),
  
  // Array of strings for skills
  skills: z.array(z.string()).optional(),
  
  // URLs for social links
  linkedin: z.string().url("Invalid LinkedIn URL").optional().or(z.literal('')),
  github: z.string().url("Invalid GitHub URL").optional().or(z.literal('')),
  
  profession: z.string().max(50).optional(),
});