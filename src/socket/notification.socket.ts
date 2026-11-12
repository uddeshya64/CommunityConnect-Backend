import { Server, Socket } from "socket.io";

let activeNotificationNamespace: any = null;

export function getNotificationNamespace() {
  return activeNotificationNamespace;
}

/**
 * Instantly delivers a real-time notification to a specific user's open tabs/devices over WebSocket (< 50ms)
 */
export function sendRealtimeNotification(userId: number, payload: any) {
  try {
    if (activeNotificationNamespace) {
      activeNotificationNamespace.to(`user_${userId}`).emit("notification", {
        ...payload,
        created_at: payload.created_at || new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(`[Notification Socket] Error sending realtime notification to user ${userId}:`, err);
  }
}

/**
 * Instantly broadcasts a real-time notification to all connected clients over WebSocket (< 50ms)
 */
export function broadcastRealtimeNotification(payload: any) {
  try {
    if (activeNotificationNamespace) {
      activeNotificationNamespace.emit("notification", {
        ...payload,
        created_at: payload.created_at || new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(`[Notification Socket] Error broadcasting notification:`, err);
  }
}

/**
 * Configures the real-time notification WebSocket namespace
 */
export function setupNotificationSockets(io: Server) {
  const notifNamespace = io.of("/notifications");
  activeNotificationNamespace = notifNamespace;

  notifNamespace.on("connection", (socket: Socket) => {
    // When a user tab connects, join their private user room
    socket.on("join_user", ({ userId }: { userId: number | string }) => {
      const uId = Number(userId);
      if (uId && !isNaN(uId)) {
        socket.join(`user_${uId}`);
        (socket as any).userId = uId;
      }
    });

    socket.on("leave_user", ({ userId }: { userId: number | string }) => {
      const uId = Number(userId);
      if (uId) {
        socket.leave(`user_${uId}`);
      }
    });

    socket.on("disconnect", () => {
      // Automatic cleanup
    });
  });
}

