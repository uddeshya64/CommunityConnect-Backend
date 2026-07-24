import { Request, Response } from "express";
import { ZodError } from "zod";

import { RegistrationService } from "../services/registration.service";
import { SubmitRegistrationFormSchema } from "../validation/registration.validation";

export const RegistrationController = {

  async submitForm(req: Request, res: Response) {

    try {

      const registrationId = Number(req.params.registrationId);

      const userId = req.user!.id;

      const { formResponses } =
        SubmitRegistrationFormSchema.parse(req.body);

      const registration =
        await RegistrationService.submitRegistrationForm(
          registrationId,
          userId,
          formResponses
        );

      return res.json({
        success: true,
        message: "Registration form submitted successfully.",
        data: registration
      });

    } catch (error: any) {

      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Validation Error",
          details: error.issues
        });
      }

      return res.status(400).json({
        error: error.message
      });
    }

  }

};