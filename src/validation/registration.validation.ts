import { z } from "zod";

export const SubmitRegistrationFormSchema = z.object({
  formResponses: z.record(z.string(), z.any())
});