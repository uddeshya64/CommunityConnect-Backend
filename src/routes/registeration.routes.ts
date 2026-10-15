import { Router } from "express";
import { RegistrationController } from "../controllers/registration.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/:registrationId/form",
  authenticate,
  RegistrationController.submitForm
);

export default router;