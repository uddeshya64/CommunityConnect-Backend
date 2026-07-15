import { PrismaClient, Prisma } from '@prisma/client';
import { EVENT_PERMISSIONS } from '../utils/constants/permissions';

const prisma = new PrismaClient();

export class EventService {
  
  // 1. POST EVENT
  static async createEvent(userId: number, data: any) {
    return prisma.$transaction(async (tx) => {
      const {
        title, description, type, mode, banner_url, logo_url,
        start_date, end_date, registration_type, registration_fee,
        max_team_size, min_team_size, location, rewards,
      } = data;
      
      const newEvent = await tx.event.create({
        data: {
          title, description, type, mode,
          banner_url: banner_url ?? undefined,
          logo_url: logo_url ?? undefined,
          start_date: start_date instanceof Date ? start_date : new Date(start_date),
          end_date: end_date instanceof Date ? end_date : new Date(end_date),
          registration_type,
          registration_fee: registration_fee ?? 0,
          max_team_size, min_team_size,
          location: location ?? undefined,
          rewards: rewards ?? undefined,
          created_by: userId,
        }
      });

      await tx.eventRoleDefinition.createMany({
        data: [
          {
            event_id: newEvent.id,
            name: "Co-Organizer",
            permissions: [
              EVENT_PERMISSIONS.MANAGE_EVENT, 
              EVENT_PERMISSIONS.MANAGE_STAFF, 
              EVENT_PERMISSIONS.VIEW_DASHBOARD, 
              EVENT_PERMISSIONS.MANAGE_ATTENDEES, 
              EVENT_PERMISSIONS.MANAGE_COMMUNICATIONS
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Judge",
            permissions: [EVENT_PERMISSIONS.VIEW_DASHBOARD, EVENT_PERMISSIONS.SCORE_SUBMISSIONS],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Mentor",
            permissions: [EVENT_PERMISSIONS.VIEW_DASHBOARD],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Volunteer",
            permissions: [EVENT_PERMISSIONS.VIEW_DASHBOARD, EVENT_PERMISSIONS.MANAGE_ATTENDEES],
            is_system: true
          }
        ]
      });

      return newEvent;
    });
  }

  // 2. GET ALL EVENTS
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
      orderBy: { start_date: 'asc' },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } }
      }
    });

    const total = await prisma.event.count({ where: whereClause });
    return { events, total, totalPages: Math.ceil(total / limit) };
  }

  // 3. GET ONE EVENT WITH CONTEXT (UPDATED FOR UNIFIED CONTEXT)
  static async getEventWithContext(eventId: number, userId?: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        user_roles: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar_url: true } },
            role: { select: { name: true, permissions: true } }
          }
        },
        role_definitions: { select: { id: true, name: true, permissions: true } },
        _count: { select: { registrations: true } } 
      }
    });

    if (!event) throw new Error("Event not found");

    // Unified User Context Object
    let userContext = {
      is_organizer: false,
      role: null as string | null,
      permissions: [] as string[],
      is_registered: false,
      registration_status: null as string | null,
      team_id: null as number | null,
      team_name: null as string | null
    };

    if (userId) {
      if (event.created_by === userId) {
        userContext.is_organizer = true;
      }

      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });

      if (staffRole) {
        userContext.role = staffRole.role.name; 
        const basePermissions = (staffRole.role.permissions as string[]) || [];
        const overrides = (staffRole.permissions_override as string[]) || [];
        userContext.permissions = Array.from(new Set([...basePermissions, ...overrides]));
      }

      // 👇 NEW: Fetch registration details including team info
      const reg = await prisma.registration.findFirst({
        where: { event_id: eventId, user_id: userId },
        include: { team: { select: { name: true } } }
      });

      if (reg) {
        userContext.is_registered = reg.status === 'confirmed';
        userContext.registration_status = reg.status; // e.g., 'pending', 'confirmed'
        userContext.team_id = reg.team_id;
        userContext.team_name = reg.team?.name || null;
      }
    }

    return { ...event, user_context: userContext };
  }
  
  // 4. UPDATE EVENT
  static async updateEvent(eventId: number, userId: number, data: any) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const isCreator = event.created_by === userId;

    if (!isCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true } 
      });

      if (!staffRole) throw new Error("Unauthorized: You are not staff for this event");

      const rolePermissions = (staffRole.role.permissions as string[]) || [];
      const overrides = (staffRole.permissions_override as string[]) || [];

      const hasManagePermission = 
        rolePermissions.includes(EVENT_PERMISSIONS.MANAGE_EVENT) || 
        overrides.includes(EVENT_PERMISSIONS.MANAGE_EVENT);

      if (!hasManagePermission) throw new Error("Unauthorized: You lack the MANAGE_EVENT permission");
    }

    return prisma.event.update({ where: { id: eventId }, data });
  }

  // 5. DELETE EVENT
  static async deleteEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");
    if (event.created_by !== userId) throw new Error("Only the creator can delete an event");

    return prisma.event.delete({ where: { id: eventId } });
  }
}