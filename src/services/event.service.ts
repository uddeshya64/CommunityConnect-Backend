import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export class EventService {
  
  // 1. CREATE EVENT
  static async createEvent(userId: number, data: any) {
    return prisma.event.create({
      data: {
        ...data,
        created_by: userId, // Link ownership
      }
    });
  }

  // 2. GET ALL EVENTS (The Feed)
  // Supports Pagination + Search
  static async getAllEvents(page = 1, limit = 10, search?: string) {
    const skip = (page - 1) * limit;
    
    const whereClause: Prisma.EventWhereInput = search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    } : {};

    const events = await prisma.event.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { start_date: 'asc' }, // Show upcoming events first
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } }
      }
    });

    const total = await prisma.event.count({ where: whereClause });

    return { events, total, totalPages: Math.ceil(total / limit) };
  }

  // 3. GET ONE EVENT (With User Context)
  // This is the "Industry Standard" magic. It tells the frontend:
  // "Is the viewer the Organizer? A Judge? A Participant?"
  static async getEventWithContext(eventId: number, userId?: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        _count: { select: { registrations: true } } // Show attendee count
      }
    });

    if (!event) throw new Error("Event not found");

    // Dynamic Context: Determine the viewer's relationship to this event
    let userContext = {
      is_organizer: false,
      role: null as string | null, // 'JUDGE', 'MENTOR', etc.
      is_registered: false
    };

    if (userId) {
      // Check ownership
      if (event.created_by === userId) {
        userContext.is_organizer = true;
      }

      // Check Staff Role
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } }
      });
      if (staffRole) userContext.role = staffRole.role;

      // Check Registration
      const reg = await prisma.registration.findFirst({
        where: { event_id: eventId, user_id: userId }
      });
      if (reg) userContext.is_registered = true;
    }

    return { ...event, user_context: userContext };
  }

  // 4. UPDATE EVENT
  static async updateEvent(eventId: number, userId: number, data: any) {
    // Check permissions
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    // Allow Creator OR Co-Hosts to edit
    const isCreator = event.created_by === userId;
    const isCoHost = await prisma.eventUserRole.findUnique({
      where: { event_id_user_id: { event_id: eventId, user_id: userId } }
    });

    if (!isCreator && isCoHost?.role !== 'CO_HOST') {
      throw new Error("Unauthorized to edit this event");
    }

    return prisma.event.update({
      where: { id: eventId },
      data
    });
  }

  // 5. DELETE EVENT
  static async deleteEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    
    if (!event) throw new Error("Event not found");
    if (event.created_by !== userId) throw new Error("Only the creator can delete an event");

    // Transaction to clean up related data (Optional if you rely on Cascade Delete in DB)
    return prisma.event.delete({ where: { id: eventId } });
  }
}