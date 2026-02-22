import { PrismaClient, Prisma } from '@prisma/client';
import { EVENT_PERMISSIONS } from '../utils/constants/permissions';

const prisma = new PrismaClient();

export class EventService {
  
  // 1. POST EVENT – only pass fields that exist on Prisma Event model
  static async createEvent(userId: number, data: any) {
    
    // We use a transaction so if role creation fails, the event isn't created either
    return prisma.$transaction(async (tx) => {
      
      const {
        title, description, type, mode, banner_url, logo_url,
        start_date, end_date, registration_type, registration_fee,
        max_team_size, min_team_size, location, rewards,
      } = data;
      
      // 1. Create the Event using the transaction client (tx)
      const newEvent = await tx.event.create({
        data: {
          title,
          description,
          type,
          mode,
          banner_url: banner_url ?? undefined,
          logo_url: logo_url ?? undefined,
          start_date: start_date instanceof Date ? start_date : new Date(start_date),
          end_date: end_date instanceof Date ? end_date : new Date(end_date),
          registration_type,
          registration_fee: registration_fee ?? 0,
          max_team_size,
          min_team_size,
          location: location ?? undefined,
          rewards: rewards ?? undefined,
          created_by: userId,
        }
      });

      // 2. Auto-generate the default System Roles for this specific event
      await tx.eventRoleDefinition.createMany({
        data: [
          {
            event_id: newEvent.id, // Grab the ID from the event we just created
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
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD, 
              EVENT_PERMISSIONS.SCORE_SUBMISSIONS
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Mentor",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ], // Mentors usually just view teams and chat
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Volunteer",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD, 
              EVENT_PERMISSIONS.MANAGE_ATTENDEES
            ], // Volunteers scan tickets/check people in
            is_system: true
          }
        ]
      });

      return newEvent;
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

static async getEventWithContext(eventId: number, userId?: number) {
    
    // 1. Fetch Event with ALL details (Organizer, Staff Members, and Role Definitions)
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        // Fetch the absolute owner/organizer
        creator: { 
          select: { id: true, name: true, avatar_url: true } 
        },
        // 👇 NEW: Fetch ALL staff members and their assigned roles for this event
        user_roles: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar_url: true } },
            role: { select: { name: true, permissions: true } } // Include the custom role names
          }
        },
        // (Optional) Expose the available roles so the frontend knows what can be assigned
        role_definitions: {
          select: { id: true, name: true, permissions: true }
        },
        _count: { select: { registrations: true } } 
      }
    });

    if (!event) throw new Error("Event not found");

    // 2. Dynamic Context: Determine the viewer's exact relationship to this event
    let userContext = {
      is_organizer: false, // Is this the absolute creator?
      role: null as string | null, // E.g., 'Judge', 'Volunteer'
      permissions: [] as string[], // 👇 NEW: Let the frontend know exactly what buttons to show
      is_registered: false
    };

    if (userId) {
      // Check absolute ownership
      if (event.created_by === userId) {
        userContext.is_organizer = true;
      }

      // Check Staff Role (Using the new PBAC relationship)
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true } // 👇 CRITICAL: We must include the related Role Definition table
      });

      if (staffRole) {
        userContext.role = staffRole.role.name; // Extract the string name 
        
        // Safely extract and combine base permissions + user-specific overrides
        const basePermissions = (staffRole.role.permissions as string[]) || [];
        const overrides = (staffRole.permissions_override as string[]) || [];
        
        // Merge them and remove duplicates using a Set
        userContext.permissions = Array.from(new Set([...basePermissions, ...overrides]));
      }

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
    // 1. Fetch Event to check absolute ownership
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const isCreator = event.created_by === userId;

    // 2. If not creator, check if they have the specific MANAGE_EVENT permission
    if (!isCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true } // 👇 CRITICAL: Include the Role Definition to read permissions
      });

      if (!staffRole) {
        throw new Error("Unauthorized: You are not staff for this event");
      }

      // Safely extract permissions from the base role and any user overrides
      const rolePermissions = (staffRole.role.permissions as string[]) || [];
      const overrides = (staffRole.permissions_override as string[]) || [];

      const hasManagePermission = 
        rolePermissions.includes(EVENT_PERMISSIONS.MANAGE_EVENT) || 
        overrides.includes(EVENT_PERMISSIONS.MANAGE_EVENT);

      if (!hasManagePermission) {
        throw new Error("Unauthorized: You lack the MANAGE_EVENT permission");
      }
    }

    // 3. Update the event safely
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