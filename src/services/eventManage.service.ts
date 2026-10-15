import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class EventManageService {
  
  static async getEventOverview(eventId: number) {
    // 1. Check if event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true, registration_fee: true }
    });
    
    if (!event) throw new Error("Event not found");

    // 2. Run aggregations in parallel for better performance
    const [totalRegistrations, totalTeams, revenueData] = await Promise.all([
      // Count confirmed registrations
      prisma.registration.count({
        where: { 
          event_id: eventId, 
          status: 'confirmed' 
        }
      }),

      // Count created teams (excluding drafts if you want)
      prisma.team.count({
        where: { 
          event_id: eventId,
          status: { not: 'draft' } // Optional: only count active/locked teams
        }
      }),

      // Sum the amounts from successful payments linked to this event
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'success',
          registration: { event_id: eventId }
        }
      })
    ]);

    // Prisma returns Decimal, so we convert it to a standard Number
    const totalRevenue = revenueData._sum.amount ? Number(revenueData._sum.amount) : 0;

    return {
      totalRegistrations,
      totalTeams,
      totalRevenue,
      total_registrations: totalRegistrations,
      teams_count: totalTeams,
      revenue: totalRevenue,
      eventTitle: event.title
    };
  }

  // GET FULL PARTICIPANT LIST (UPDATED)
  static async getParticipants(eventId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const registrations = await prisma.registration.findMany({
      where: { event_id: eventId },
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, location: true, profession: true, github: true, linkedin: true }
        },
        team: {
          select: {
            id: true,
            name: true,
            leader_id: true, // 👇 FETCH LEADER ID
            registrations: { // 👇 FETCH TEAM REGISTRATIONS TO FIND THE LEADER'S PAYMENT
              include: {
                payments: { orderBy: { created_at: 'desc' }, take: 1 }
              }
            }
          }
        },
        payments: {
          orderBy: { created_at: 'desc' }, take: 1, select: { status: true, amount: true }
        }
      }
    });

    return registrations.map(reg => {
      // 1. Default to their own payment status
      let finalPaymentStatus = reg.payments.length > 0 ? reg.payments[0].status : 'free';

      // 2. Safely extract team to help TypeScript's type checker
      const team = reg.team;

      // 3. Inherit the team leader's payment status safely using optional chaining
      if (team && reg.payments.length === 0) {
        const leaderReg = team.registrations?.find(r => r.user_id === team.leader_id);
        
        if (leaderReg && leaderReg.payments && leaderReg.payments.length > 0) {
          finalPaymentStatus = leaderReg.payments[0].status;
        }
      }

      // 4. Visually override registration status if the team paid
      let finalRegStatus = reg.status;
      if (team && finalPaymentStatus === 'success') {
        finalRegStatus = 'confirmed'; // This ensures the UI doesn't show "pending" for paid members
      }

      return {
        registrationId: reg.id,
        registrationStatus: finalRegStatus,
        registeredAt: reg.created_at,
        
        // User Details
        userId: reg.user.id,
        name: reg.user.name,
        email: reg.user.email,
        phone: reg.user.phone,
        location: reg.user.location,
        profession: reg.user.profession,
        github: reg.user.github,
        linkedin: reg.user.linkedin,
        
        // Safely access team properties
        teamId: team?.id || null,
        teamName: team?.name || 'Individual',
        
        paymentStatus: finalPaymentStatus,

        // Check-In Details
        ticketCode: reg.ticket_code,
        checkedIn: reg.checked_in,
        checkedInAt: reg.checked_in_at
      };
    });
  }
}
