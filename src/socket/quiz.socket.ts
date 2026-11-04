import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// In-memory room socket tracking: roomName -> Map<socketId, { userId: number; name: string; isHost: boolean }>
const roomParticipants = new Map<string, Map<string, { userId: number; name: string; isHost: boolean }>>();

export function setupQuizSockets(io: Server) {
  const quizNamespace = io.of("/quiz");

  quizNamespace.on("connection", (socket: Socket) => {
    console.log(`[Quiz Socket] Client connected: ${socket.id}`);

    // Join a quiz session
    socket.on("join_quiz", async ({ quizId, userId, userName }) => {
      try {
        const idNum = Number(quizId);
        const userNum = Number(userId);
        console.log(`[Quiz Socket] User ${userNum} joining quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;
        socket.join(roomName);

        // Track socket room and user metadata
        (socket as any).quizRoomName = roomName;
        (socket as any).quizUserId = userNum;

        // Determine player display name
        let displayName = userName;
        if (!displayName && userNum > 0) {
          try {
            const user = await prisma.user.findUnique({
              where: { id: userNum },
              select: { name: true }
            });
            displayName = user?.name || `Player ${userNum}`;
          } catch {
            displayName = `Player ${userNum}`;
          }
        } else if (userNum === 0) {
          displayName = "Organizer (Host)";
        }

        if (!roomParticipants.has(roomName)) {
          roomParticipants.set(roomName, new Map());
        }

        roomParticipants.get(roomName)!.set(socket.id, {
          userId: userNum,
          name: displayName || "Attendee",
          isHost: userNum === 0
        });

        // Compute player list & count excluding host
        const allParticipants = Array.from(roomParticipants.get(roomName)!.values());
        const currentPlayers = allParticipants.filter(p => !p.isHost);

        // Broadcast to everyone in the room
        quizNamespace.to(roomName).emit("room_players", {
          count: currentPlayers.length,
          players: currentPlayers
        });

        quizNamespace.to(roomName).emit("user_joined", {
          userId: userNum,
          name: displayName,
          count: currentPlayers.length
        });

        // Fetch current session status
        const session = await prisma.quizSession.findFirst({
          where: { quiz_id: idNum },
          orderBy: { id: 'desc' }
        });

        if (session?.status === "COMPLETED") {
          const finalLeaderboard = await prisma.quizLeaderboard.findMany({
            where: { quiz_id: idNum },
            orderBy: { score: 'desc' },
            take: 10,
            include: { user: { select: { id: true, name: true } } }
          });
          socket.emit("quiz_ended", {
            quizId: idNum,
            message: "The live activity session has concluded.",
            leaderboard: finalLeaderboard
          });
          return;
        }

        if (session && session.status === "IN_PROGRESS" && session.current_question) {
          const question = await prisma.question.findUnique({
            where: { id: session.current_question },
            include: {
              options: {
                select: { id: true, text: true }
              }
            }
          });
          socket.emit("quiz_state", { status: "IN_PROGRESS", question });
        } else {
          socket.emit("quiz_state", {
            status: "WAITING",
            count: currentPlayers.length,
            players: currentPlayers
          });
        }
      } catch (err) {
        console.error("[Quiz Socket] join_quiz error:", err);
      }
    });

    // Start quiz (Organizer only)
    socket.on("start_quiz", async ({ quizId }) => {
      try {
        const idNum = Number(quizId);
        console.log(`[Quiz Socket] Starting quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;

        const quiz = await prisma.quiz.findUnique({
          where: { id: idNum },
          include: {
            questions: {
              orderBy: { id: 'asc' },
              include: {
                options: {
                  select: { id: true, text: true }
                }
              }
            }
          }
        });

        let session = await prisma.quizSession.findFirst({
          where: { quiz_id: idNum, status: "IN_PROGRESS" },
          orderBy: { id: 'desc' }
        });

        const firstQId = quiz?.questions?.[0]?.id || null;

        if (!session) {
          session = await prisma.quizSession.create({
            data: {
              quiz_id: idNum,
              status: "IN_PROGRESS",
              started_at: new Date(),
              current_question: firstQId
            }
          });
        } else if (firstQId && !session.current_question) {
          session = await prisma.quizSession.update({
            where: { id: session.id },
            data: { current_question: firstQId }
          });
        }

        await prisma.quiz.update({
          where: { id: idNum },
          data: { status: "LIVE" }
        });

        // Broadcast to room
        quizNamespace.to(roomName).emit("quiz_started", {
          sessionId: session.id,
          quizId: idNum,
          eventId: quiz?.event_id
        });

        // Global notification so in-app toast/banner pops up
        quizNamespace.emit("quiz_started", {
          sessionId: session.id,
          quizId: idNum,
          eventId: quiz?.event_id
        });

        if (quiz?.questions?.[0]) {
          quizNamespace.to(roomName).emit("new_question", { question: quiz.questions[0] });
        }
      } catch (err) {
        console.error("[Quiz Socket] start_quiz error:", err);
      }
    });

    // Next question (Organizer only)
    socket.on("next_question", async ({ quizId, questionId }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const roomName = `quiz_${idNum}`;
        console.log(`[Quiz Socket] Next question ${qNum} for quiz ${idNum}`);

        const question = await prisma.question.findUnique({
          where: { id: qNum },
          include: {
            options: {
              select: { id: true, text: true }
            }
          }
        });

        await prisma.quizSession.updateMany({
          where: { quiz_id: idNum, status: "IN_PROGRESS" },
          data: { current_question: qNum }
        });

        quizNamespace.to(roomName).emit("new_question", { question });
      } catch (err) {
        console.error("[Quiz Socket] next_question error:", err);
      }
    });

    // End question and show leaderboard (Organizer only)
    socket.on("end_question", async ({ quizId, questionId }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const roomName = `quiz_${idNum}`;

        const question = await prisma.question.findUnique({
          where: { id: qNum },
          include: { options: true }
        });

        const correctOption = question?.options.find(o => o.is_correct);

        const leaderboard = await prisma.quizLeaderboard.findMany({
          where: { quiz_id: idNum },
          orderBy: { score: 'desc' },
          take: 10,
          include: { user: { select: { id: true, name: true } } }
        });

        quizNamespace.to(roomName).emit("question_ended", {
          questionId: qNum,
          leaderboard,
          correctOptionId: correctOption?.id
        });
      } catch (err) {
        console.error("[Quiz Socket] end_question error:", err);
      }
    });

    // End Entire Quiz Session (Organizer only)
    socket.on("end_quiz", async ({ quizId }) => {
      try {
        const idNum = Number(quizId);
        console.log(`[Quiz Socket] Ending quiz session for quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;

        await prisma.quizSession.updateMany({
          where: { quiz_id: idNum, status: "IN_PROGRESS" },
          data: { status: "COMPLETED", ended_at: new Date() }
        });

        await prisma.quiz.update({
          where: { id: idNum },
          data: { status: "COMPLETED" }
        });

        const finalLeaderboard = await prisma.quizLeaderboard.findMany({
          where: { quiz_id: idNum },
          orderBy: { score: 'desc' },
          take: 10,
          include: { user: { select: { id: true, name: true } } }
        });

        quizNamespace.to(roomName).emit("quiz_ended", {
          quizId: idNum,
          message: "The host has ended this live activity session.",
          leaderboard: finalLeaderboard
        });
      } catch (err) {
        console.error("[Quiz Socket] end_quiz error:", err);
      }
    });

    // Submit answer (Participant)
    socket.on("submit_answer", async ({ quizId, questionId, optionId, userId, timeTaken }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const optNum = Number(optionId);
        const userNum = Number(userId);

        const question = await prisma.question.findUnique({
          where: { id: qNum },
          include: { options: true }
        });

        if (!question) return;

        const option = question.options.find(o => o.id === optNum);
        const correctOption = question.options.find(o => o.is_correct);
        let pointsAwarded = 0;

        if (option && option.is_correct) {
          const maxTime = question.time_limit || 30;
          const timeRatio = Math.max(0, (maxTime - (Number(timeTaken) || 0)) / maxTime);
          pointsAwarded = Math.round((question.points / 2) + (question.points / 2) * timeRatio);
        }

        if (userNum && !isNaN(userNum)) {
          await prisma.quizResponse.upsert({
            where: { user_id_question_id: { user_id: userNum, question_id: qNum } },
            create: {
              user_id: userNum,
              question_id: qNum,
              option_id: optNum,
              points_awarded: pointsAwarded,
              time_taken: Number(timeTaken) || 0
            },
            update: {
              option_id: optNum,
              points_awarded: pointsAwarded,
              time_taken: Number(timeTaken) || 0
            }
          });

          const board = await prisma.quizLeaderboard.findUnique({
            where: { quiz_id_user_id: { quiz_id: idNum, user_id: userNum } }
          });

          if (board) {
            await prisma.quizLeaderboard.update({
              where: { id: board.id },
              data: { score: board.score + pointsAwarded }
            });
          } else {
            await prisma.quizLeaderboard.create({
              data: { quiz_id: idNum, user_id: userNum, score: pointsAwarded }
            });
          }
        }

        socket.emit("answer_result", {
          correct: option?.is_correct || false,
          points: pointsAwarded,
          correctOptionId: correctOption?.id
        });
      } catch (error) {
        console.error("[Quiz Socket] Error saving response:", error);
      }
    });

    socket.on("disconnect", () => {
      const roomName = (socket as any).quizRoomName;
      if (roomName && roomParticipants.has(roomName)) {
        roomParticipants.get(roomName)!.delete(socket.id);
        const remaining = Array.from(roomParticipants.get(roomName)!.values()).filter(p => !p.isHost);
        quizNamespace.to(roomName).emit("room_players", {
          count: remaining.length,
          players: remaining
        });
      }
      console.log(`[Quiz Socket] Client disconnected: ${socket.id}`);
    });
  });
}
