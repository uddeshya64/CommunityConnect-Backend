import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PushService } from '../services/push.service';
import { config } from '../config/env';

const prisma = new PrismaClient();

export const NotificationController = {
  async getNotifications(req: Request, res: Response) {
    try {
      const userId = req.user!.id;

      // 1. Fetch user to get their email address
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true }
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const email = user.email.toLowerCase().trim();

      // 2. Fetch pending team invites for this user (case-insensitive email)
      const teamInvites = await prisma.teamInvite.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          team: {
            include: {
              event: {
                select: {
                  id: true,
                  title: true,
                  banner_url: true
                }
              }
            }
          }
        }
      });

      // 3. Fetch pending staff invites for this user (case-insensitive email)
      const staffInvites = await prisma.eventStaffInvite.findMany({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              banner_url: true
            }
          },
          role: {
            select: {
              name: true
            }
          }
        }
      });

      // 4. Fetch active staff assignments / role updates
      const staffRoles = await prisma.eventUserRole.findMany({
        where: { user_id: userId },
        include: {
          event: { select: { id: true, title: true, banner_url: true } },
          role: { select: { name: true } }
        },
        orderBy: { assigned_at: 'desc' }
      });

      // 5. Find all events associated with this user:
      // - Events where user is registered
      const userRegistrations = await prisma.registration.findMany({
        where: { user_id: userId },
        select: { event_id: true }
      });
      const registeredEventIds = userRegistrations.map(r => r.event_id);
      const staffEventIds = staffRoles.map(sr => sr.event.id);

      // - Events organized / created by this user
      const organizedEvents = await prisma.event.findMany({
        where: { created_by: userId },
        select: { id: true }
      });
      const organizedEventIds = organizedEvents.map(e => e.id);

      const allUserEventIds = Array.from(new Set([
        ...registeredEventIds,
        ...staffEventIds,
        ...organizedEventIds
      ]));

      // 6. Fetch live quizzes for events user is involved in
      const liveQuizzes = allUserEventIds.length > 0 ? await prisma.quiz.findMany({
        where: {
          event_id: { in: allUserEventIds },
          OR: [
            { status: 'LIVE' },
            { sessions: { some: { status: 'IN_PROGRESS' } } }
          ]
        },
        include: {
          event: { select: { id: true, title: true, banner_url: true } },
          sessions: {
            where: { status: 'IN_PROGRESS' },
            orderBy: { started_at: 'desc' },
            take: 1
          }
        },
        orderBy: { updated_at: 'desc' },
        take: 15
      }) : [];

      // 7. Fetch event announcements for events user is involved in
      const announcements = allUserEventIds.length > 0 ? await prisma.eventAnnouncement.findMany({
        where: {
          event_id: { in: allUserEventIds }
        },
        include: {
          event: { select: { id: true, title: true, banner_url: true } },
          author: { select: { id: true, name: true, avatar_url: true } }
        },
        orderBy: { created_at: 'desc' },
        take: 30
      }) : [];

      // 8. Fetch recent confirmed registrations (tickets)
      const recentRegistrations = await prisma.registration.findMany({
        where: { user_id: userId, status: 'confirmed' },
        include: {
          event: { select: { id: true, title: true, banner_url: true } }
        },
        orderBy: { created_at: 'desc' },
        take: 10
      });

      // 8b. Fetch triggered event reminder alerts (dates announced & registrations open)
      const triggeredReminders = await prisma.eventReminder.findMany({
        where: { user_id: userId, notified_at: { not: null } },
        include: {
          event: { select: { id: true, title: true, banner_url: true, start_date: true } }
        },
        orderBy: { notified_at: 'desc' },
        take: 20
      });

      // 9. Format all notifications consistently with rich titles, messages, and action URLs
      const liveQuizzesFormatted = liveQuizzes.map(lq => ({
        id: `quiz_${lq.id}`,
        type: 'LIVE_QUIZ',
        quizId: lq.id,
        eventId: lq.event_id,
        title: `🎯 Live Quiz: ${lq.title}`,
        message: `Live trivia quiz for "${lq.event.title}" is active right now! Click to enter the quiz arena and compete live.`,
        quizTitle: lq.title,
        eventName: lq.event.title,
        eventBanner: lq.event.banner_url || null,
        created_at: lq.sessions[0]?.started_at || lq.updated_at || new Date(),
        url: `/events/${lq.event_id}/quiz/${lq.id}`
      }));

      const announcementsFormatted = announcements.map(a => ({
        id: `announcement_${a.id}`,
        type: 'ANNOUNCEMENT',
        eventId: a.event_id,
        title: a.title ? `📢 ${a.title}` : `📢 Announcement from ${a.event.title}`,
        message: a.message,
        eventName: a.event.title,
        eventBanner: a.event.banner_url || null,
        authorName: a.author?.name || 'Event Organizer',
        created_at: a.created_at,
        url: `/events/${a.event_id}`
      }));

      const teamInvitesFormatted = teamInvites.map(ti => ({
        id: `team_${ti.id}`,
        type: 'TEAM_INVITE',
        token: ti.token,
        title: `🤝 Team Invitation: ${ti.team.name}`,
        message: `You've been invited to join team "${ti.team.name}" for "${ti.team.event.title}". Accept to collaborate with your team.`,
        teamName: ti.team.name,
        eventId: ti.team.event_id,
        eventName: ti.team.event.title,
        eventBanner: ti.team.event.banner_url || null,
        created_at: ti.created_at,
        expires_at: ti.expires_at,
        url: `/join-team?token=${ti.token}`
      }));

      const staffInvitesFormatted = staffInvites.map(si => ({
        id: `staff_${si.id}`,
        type: 'STAFF_INVITE',
        token: si.token,
        title: `🛡️ Staff Invitation: ${si.role.name}`,
        message: `You've been invited to join the staff team for "${si.event.title}" as ${si.role.name}.`,
        roleName: si.role.name,
        eventId: si.event_id,
        eventName: si.event.title,
        eventBanner: si.event.banner_url || null,
        created_at: si.created_at,
        expires_at: si.expires_at,
        url: `/join-staff?token=${si.token}`
      }));

      const roleUpdatesFormatted = staffRoles.map(sr => ({
        id: `role_${sr.id}`,
        type: 'ROLE_UPDATE',
        eventId: sr.event.id,
        title: `⭐ Staff Assignment: ${sr.role.name}`,
        message: `You are an assigned ${sr.role.name} for "${sr.event.title}". Check your staff duties and scanner portal.`,
        roleName: sr.role.name,
        eventName: sr.event.title,
        eventBanner: sr.event.banner_url || null,
        created_at: sr.assigned_at,
        url: `/events/${sr.event.id}`
      }));

      const registrationsFormatted = recentRegistrations.map(r => ({
        id: `reg_${r.id}`,
        type: 'REGISTRATION',
        eventId: r.event_id,
        title: `🎟️ Ticket Confirmed: ${r.event.title}`,
        message: `Your registration for "${r.event.title}" is confirmed. View your QR pass and event details.`,
        eventName: r.event.title,
        eventBanner: r.event.banner_url || null,
        created_at: r.created_at,
        url: `/events/${r.event_id}`
      }));

      const remindersFormatted = triggeredReminders.map(rem => ({
        id: `reminder_${rem.id}`,
        type: 'EVENT_REMINDER',
        eventId: rem.event_id,
        title: `🔔 Registration Open: ${rem.event.title}`,
        message: rem.event.start_date
          ? `Dates are announced (${new Date(rem.event.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}) and registrations are open!`
          : `Registrations for "${rem.event.title}" are now open!`,
        eventName: rem.event.title,
        eventBanner: rem.event.banner_url || null,
        created_at: rem.notified_at || rem.created_at,
        url: `/events/${rem.event_id}`
      }));

      // 10. Combine and sort by date descending
      const allNotifications = [
        ...liveQuizzesFormatted,
        ...announcementsFormatted,
        ...teamInvitesFormatted,
        ...staffInvitesFormatted,
        ...roleUpdatesFormatted,
        ...registrationsFormatted,
        ...remindersFormatted
      ].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      res.json({ success: true, data: allNotifications });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async getUnreadCount(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });
      if (!user) return res.json({ success: true, count: 0 });

      const email = user.email.toLowerCase().trim();
      const [teamInvitesCount, staffInvitesCount] = await Promise.all([
        prisma.teamInvite.count({
          where: {
            email: { equals: email, mode: 'insensitive' },
            status: 'pending',
            expires_at: { gt: new Date() }
          }
        }),
        prisma.eventStaffInvite.count({
          where: {
            email: { equals: email, mode: 'insensitive' },
            status: 'pending',
            expires_at: { gt: new Date() }
          }
        })
      ]);

      const [userRegistrations, staffRoles, organizedEvents] = await Promise.all([
        prisma.registration.findMany({ where: { user_id: userId }, select: { event_id: true } }),
        prisma.eventUserRole.findMany({ where: { user_id: userId }, select: { event_id: true } }),
        prisma.event.findMany({ where: { created_by: userId }, select: { id: true } })
      ]);

      const allUserEventIds = Array.from(new Set([
        ...userRegistrations.map(r => r.event_id),
        ...staffRoles.map(sr => sr.event_id),
        ...organizedEvents.map(e => e.id)
      ]));

      const liveQuizzesCount = allUserEventIds.length > 0 ? await prisma.quiz.count({
        where: {
          event_id: { in: allUserEventIds },
          OR: [
            { status: 'LIVE' },
            { sessions: { some: { status: 'IN_PROGRESS' } } }
          ]
        }
      }) : 0;

      res.json({ success: true, count: teamInvitesCount + staffInvitesCount + liveQuizzesCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async markAllRead(req: Request, res: Response) {
    try {
      res.json({ success: true, message: "Marked all as read." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async getPushStatus(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const count = await prisma.pushSubscription.count({
        where: { user_id: userId },
      });
      res.json({ success: true, isSubscribed: count > 0, count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async getVapidPublicKey(req: Request, res: Response) {
    try {
      const publicKey = PushService.getVapidPublicKey();
      res.json({ success: true, publicKey });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async subscribePush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { subscription, device, userAgent } = req.body;

      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid push subscription object." });
      }

      const saved = await PushService.saveSubscription(userId, {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        device: device || 'browser',
        userAgent: userAgent || req.headers['user-agent'],
      });

      res.json({ success: true, message: "Push subscription saved successfully.", data: saved });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async unsubscribePush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { endpoint } = req.body;

      if (endpoint) {
        await PushService.removeSubscription(endpoint);
      }
      await PushService.removeUserSubscriptions(userId);

      res.json({ success: true, message: "Unsubscribed successfully." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async sendTestPush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });

      const frontendUrl = (config.FRONTEND_URL || process.env.FRONTEND_URL || "http://localhost:3001").replace(/\/$/, "");
      const targetUrl = `${frontendUrl}/notifications`;

      const result = await PushService.sendPushToUser(userId, {
        title: "Eventrix",
        body: `Hello ${user?.name || 'there'}! Native system notifications are working on this device.`,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        url: targetUrl,
        tag: "test-notification",
        actions: [
          { action: "open", title: "Open App" }
        ],
      });

      res.json({
        success: true,
        message: result.successful > 0
          ? `Push notification sent successfully to ${result.successful} device(s).`
          : "No active push subscriptions found. Please enable system push notifications first.",
        result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
};
