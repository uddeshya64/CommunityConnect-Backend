import { Router } from "express";
import { LocationController } from "../controllers/location.controller";

const router = Router();

router.get("/search", LocationController.search);
router.get("/reverse", LocationController.reverse);

export default router;