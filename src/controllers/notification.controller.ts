import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const NotificationController = {
  async getNotifications(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      
      // 1. Fetch user to get their email address
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const email = user.email;

      // 2. Fetch pending team invites
      const teamInvites = await prisma.teamInvite.findMany({
        where: {
          email: email,
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          team: {
            include: {
              event: {
                select: {
                  title: true,
                  banner_url: true
                }
              }
            }
          }
        }
      });

      // 3. Fetch pending staff invites
      const staffInvites = await prisma.eventStaffInvite.findMany({
        where: {
          email: email,
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          event: {
            select: {
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

      // 4. Format them consistently
      const teamInvitesFormatted = teamInvites.map(ti => ({
        id: `team_${ti.id}`,
        type: 'TEAM_INVITE',
        token: ti.token,
        teamName: ti.team.name,
        eventName: ti.team.event.title,
        eventBanner: ti.team.event.banner_url || null,
        created_at: ti.created_at,
        expires_at: ti.expires_at
      }));

      const staffInvitesFormatted = staffInvites.map(si => ({
        id: `staff_${si.id}`,
        type: 'STAFF_INVITE',
        token: si.token,
        roleName: si.role.name,
        eventName: si.event.title,
        eventBanner: si.event.banner_url || null,
        created_at: si.created_at,
        expires_at: si.expires_at
      }));

      // 5. Combine and sort by date descending
      const allNotifications = [...teamInvitesFormatted, ...staffInvitesFormatted].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      res.json({ success: true, data: allNotifications });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
};
