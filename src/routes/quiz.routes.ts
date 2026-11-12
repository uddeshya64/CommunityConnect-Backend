import express from "express";
import {
  createQuiz, getQuizzes, addQuestion, startQuiz, resetQuiz,
  deleteQuiz, deleteQuestion, getActiveQuiz, updateQuiz, updateQuestion
} from "../controllers/quiz.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = express.Router({ mergeParams: true });

// Protect all quiz routes
router.use(authenticate);

// /api/events/:eventId/quizzes
router.post("/", createQuiz);
router.get("/", getQuizzes);
router.get("/active", getActiveQuiz);

// /api/events/:eventId/quizzes/:quizId
router.put("/:quizId", updateQuiz);
router.patch("/:quizId", updateQuiz);
router.delete("/:quizId", deleteQuiz);

// /api/events/:eventId/quizzes/:quizId/questions
router.post("/:quizId/questions", addQuestion);

// /api/events/:eventId/quizzes/:quizId/questions/:questionId
router.put("/:quizId/questions/:questionId", updateQuestion);
router.patch("/:quizId/questions/:questionId", updateQuestion);
router.delete("/:quizId/questions/:questionId", deleteQuestion);

// /api/events/:eventId/quizzes/:quizId/start
router.post("/:quizId/start", startQuiz);

// /api/events/:eventId/quizzes/:quizId/reset
router.post("/:quizId/reset", resetQuiz);

export default router;
