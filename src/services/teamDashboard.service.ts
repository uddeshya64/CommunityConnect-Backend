import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { EmailService } from './email.service'; 
import { config } from '../config/env';

const prisma = new PrismaClient();

export class TeamDashboardService {

  // 1. GET TEAM DETAILS (For the Dashboard UI)
  static async getTeamDetails(teamId: number, requestingUserId: number) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatar_url: true } } }
        },
        invites: {
          where: { status: 'pending' },
          select: { id: true, email: true, expires_at: true }
        }
      }
    });

    if (!team) throw new Error("Team not found");

    // Authorization: Only team members can view the dashboard
    const isMember = team.members.some(m => m.user_id === requestingUserId);
    if (!isMember) throw new Error("Unauthorized: You are not a member of this team");

    return {
      ...team,
      is_leader: team.leader_id === requestingUserId // Tell frontend if this user is the boss
    };
  }

  // 2. UPDATE TEAM NAME
  static async updateTeamName(teamId: number, leaderId: number, newName: string) {
    // Check if the user is the actual leader
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can change the name");
    }

    return prisma.team.update({
      where: { id: teamId },
      data: { name: newName }
    });
  }

  // 3. INVITE A MEMBER (Moved from Checkout Service)
  static async inviteMember(teamId: number, leaderId: number, inviteeEmail: string) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can invite members");
    }

    // Check if already invited or already in team to prevent spam
    const existingInvite = await prisma.teamInvite.findFirst({
      where: { team_id: teamId, email: inviteeEmail, status: 'pending' }
    });
    if (existingInvite) throw new Error("An invitation is already pending for this email");

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await prisma.teamInvite.create({
      data: {
        team_id: teamId,
        email: inviteeEmail.toLowerCase(),
        token: token,
        expires_at: expiresAt
      }
    });

    // Fire & Forget email (Don't await it so the API responds instantly)
    const magicLink = `${config.FRONTEND_URL}/join-team?token=${token}`;
    EmailService.sendTeamInvite(inviteeEmail, team.name, magicLink).catch(console.error);

    return invite;
  }

  // 4. REMOVE A MEMBER
  static async removeMember(teamId: number, leaderId: number, userIdToRemove: number) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can remove members");
    }

    if (leaderId === userIdToRemove) {
      throw new Error("The team leader cannot be removed. Transfer ownership or delete the team instead.");
    }

    // Use a transaction to ensure clean removal
    return prisma.$transaction(async (tx) => {
      // A. Remove from TeamMember junction table
      await tx.teamMember.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: userIdToRemove } }
      });

      // B. Update their Registration status to cancelled (Optional, but good practice)
      await tx.registration.updateMany({
        where: { team_id: teamId, user_id: userIdToRemove },
        data: { status: 'cancelled' }
      });

      return { success: true, message: "Member removed successfully" };
    });
  }

  // ==========================================
  // 5. VERIFY TEAM INVITATION (PUBLIC)
  // ==========================================
  static async verifyInviteToken(token: string) {
    const invite = await prisma.teamInvite.findUnique({
      where: { token },
      include: {
        team: { 
          include: { 
            event: { select: { title: true, banner_url: true } } // Fetch event details for the UI
          } 
        }
      }
    });

    if (!invite) throw new Error("Invalid invitation link.");
    if (invite.status !== 'pending') throw new Error("This invitation has already been used or revoked.");
    if (invite.expires_at < new Date()) throw new Error("This invitation has expired.");

    // Return safe data for the frontend to display the "You're Invited!" screen
    return {
      emailInvited: invite.email,
      teamName: invite.team.name,
      eventName: invite.team.event.title,
      eventBanner: invite.team.event.banner_url
    };
  }

  // ==========================================
  // 6. ACCEPT TEAM INVITATION (SECURE)
  // ==========================================
  static async acceptInvite(userId: number, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const invite = await prisma.teamInvite.findUnique({ 
      where: { token },
      include: { team: true }
    });

    // Validations
    if (!invite) throw new Error("Invalid invitation token");
    if (invite.status !== 'pending') throw new Error("Invitation already used or revoked");
    if (invite.expires_at < new Date()) throw new Error("Invitation has expired");
    
    // Strict email check to prevent token forwarding
    if (invite.email !== user.email) {
      throw new Error("This invite was sent to a different email address. Please log in with the correct account.");
    }

    // Use a transaction to ensure all database steps succeed together
    return prisma.$transaction(async (tx) => {
      
      // A. Mark Invite as Accepted [cite: 17]
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted' }
      });

      // B. Add User to the Team [cite: 19]
      await tx.teamMember.create({
        data: {
          team_id: invite.team_id,
          user_id: userId
        }
      });

      // C. Handle Event Registration [cite: 14, 15]
      // Check if the user is already registered for this event (e.g., they registered solo first)
      const existingRegistration = await tx.registration.findFirst({
        where: { event_id: invite.team.event_id, user_id: userId }
      });

      if (existingRegistration) {
        // Update existing registration to link to this team 
        await tx.registration.update({
          where: { id: existingRegistration.id },
          data: { team_id: invite.team_id, status: 'confirmed' }
        });
      } else {
        // Create a brand new registration for the event 
        await tx.registration.create({
          data: {
            event_id: invite.team.event_id,
            user_id: userId,
            team_id: invite.team_id,
            status: 'confirmed'
          }
        });
      }

      return { 
        success: true, 
        teamId: invite.team_id, 
        teamName: invite.team.name 
      };
    });
  }
}