import { PrismaClient, Prisma } from '@prisma/client';
import { EVENT_PERMISSIONS, getDefaultPermissionsForRole } from '../utils/constants/permissions';
import { EmailService } from './email.service';
import { PushService } from './push.service';

import supabase from "../config/supabase";

const prisma = new PrismaClient();

export class EventService {

  // Post event Banner

  static async uploadBanner(
  eventId: number,
  userId: number,
  file: Express.Multer.File
) {
    // Check if event exists
    const event = await prisma.event.findUnique({
      where: {
        id: eventId,
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    // Check event ownership
    if (event.created_by !== Number(userId)) {
      throw new Error(
        "You are not authorized to update this event"
      );
    }

    // Create unique file name
    const fileName =
      `event-banners/${eventId}-${Date.now()}-${file.originalname}`;

    // Upload image to Supabase
    const { error: uploadError } =
      await supabase.storage
        .from("image-bucket")
        .upload(
          fileName,
          file.buffer,
          {
            contentType: file.mimetype,
            upsert: false,
          }
        );

    if (uploadError) {
      throw new Error(
        `Failed to upload banner image: ${uploadError.message}`
      );
    }

    // Get public URL
    const { data: publicUrlData } =
      supabase.storage
        .from("image-bucket")
        .getPublicUrl(fileName);

    const bannerURL =
      publicUrlData.publicUrl;

    // Save URL in Event.banner_url
    const updatedEvent =
      await prisma.event.update({
        where: {
          id: eventId,
        },
        data: {
          banner_url: bannerURL,
        },
        select: {
          id: true,
          title: true,
          banner_url: true,
        },
      });

    return updatedEvent;
  }

  // 1. POST EVENT
  static async createEvent(userId: number, data: any) {
    return prisma.$transaction(async (tx) => {
      const {
        title, description, type, mode, banner_url, logo_url,
        start_date, end_date, is_registration_open, registration_type, registration_fee,
        max_team_size, min_team_size, capacity, location, rewards,
        custom_fields, custom_form_schema, registration_form_schema,
      } = data;

      // Ensure registration_form_schema is embedded into custom_fields if provided
      const mergedCustomFields = {
        ...(custom_fields || {}),
        ...(registration_form_schema
          ? { registration_form_schema }
          : custom_fields?.registration_form_schema
          ? { registration_form_schema: custom_fields.registration_form_schema }
          : {}),
      };

      // Find or create the event type (case-insensitive)
      let eventType = await tx.eventType.findFirst({
        where: {
          name: {
            equals: type,
            mode: 'insensitive'
          }
        }
      });

      if (!eventType) {
        eventType = await tx.eventType.create({
          data: {
            name: type,
            is_system: false,
            created_by: userId
          }
        });
      }

      const newEvent = await tx.event.create({
        data: {
          title, description,
          type_id: eventType.id,
          mode,
          banner_url: banner_url ?? undefined,
          logo_url: logo_url ?? undefined,
          start_date: start_date ? (start_date instanceof Date ? start_date : new Date(start_date)) : null,
          end_date: end_date ? (end_date instanceof Date ? end_date : new Date(end_date)) : null,
          is_registration_open: typeof is_registration_open === "boolean" ? is_registration_open : true,
          registration_type,
          registration_fee: registration_fee ?? 0,
          max_team_size, min_team_size,
          capacity: capacity ?? 0,
          location: location ?? undefined,
          rewards: rewards ?? undefined,
          custom_fields: Object.keys(mergedCustomFields).length > 0 ? mergedCustomFields : undefined,
          custom_form_schema: custom_form_schema ?? undefined,
          created_by: userId,
        }
      });

      await tx.eventRoleDefinition.createMany({
        data: [
          {
            event_id: newEvent.id,
            name: "Admin",
            permissions: Object.values(EVENT_PERMISSIONS),
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Registration Manager",
            permissions: [
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_INVITATIONS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_REFUNDS,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Program Manager",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Volunteer",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Guest",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          }
        ]
      });

      // Automatically assign the event creator the Admin role
      const adminRoleDef = await tx.eventRoleDefinition.findFirst({
        where: { event_id: newEvent.id, name: "Admin" }
      });

      if (adminRoleDef) {
        await tx.eventUserRole.create({
          data: {
            event_id: newEvent.id,
            user_id: userId,
            role_id: adminRoleDef.id,
            permissions_override: []
          }
        });
      }

      return {
        ...newEvent,
        type
      };
    });
  }

  // 2. GET ALL EVENTS
  static async getAllEvents(page = 1, limit = 10, search?: string, userId?: number) {
    const skip = (page - 1) * limit;

    const whereClause: Prisma.EventWhereInput = search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { timelines: { some: { tags: { has: search } } } },
      ]
    } : {};

    const events = await prisma.event.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { start_date: 'asc' },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        type: { select: { name: true } },
        timelines: { select: { tags: true } },
        _count: { select: { registrations: true } }
      }
    });

    const total = await prisma.event.count({ where: whereClause });

    let savedEventIds = new Set<number>();
    if (userId) {
      const saved = await prisma.savedEvent.findMany({
        where: { user_id: userId },
        select: { event_id: true }
      });
      savedEventIds = new Set(saved.map(s => s.event_id));
    }

    // Map response to keep type as string and aggregate tags
    const formattedEvents = events.map(evt => {
      const { type, timelines, ...rest } = evt;
      const aggregatedTags = Array.from(
        new Set((timelines || []).flatMap(t => t.tags || []))
      );

      return {
        ...rest,
        type: type.name,
        tags: aggregatedTags,
        is_saved: savedEventIds.has(evt.id),
        registered_count: (evt as any)._count?.registrations ?? 0,
        _count: (evt as any)._count
      };
    });

    return { events: formattedEvents, total, totalPages: Math.ceil(total / limit) };
  }

  // 3. GET ONE EVENT WITH CONTEXT (UPDATED FOR UNIFIED CONTEXT)
  static async getEventWithContext(eventId: number, userId?: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        type: { select: { name: true } },
        user_roles: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar_url: true } },
            role: { select: { name: true, permissions: true } }
          }
        },
        role_definitions: { select: { id: true, name: true, permissions: true } },
        _count: { select: { registrations: true } },
        timelines: { orderBy: { start_time: 'asc' } }
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
      team_name: null as string | null,
      registration_id: null as number | null,
      is_saved: false,
      has_reminder: false
    };

    if (userId) {
      if (event.created_by === userId) {
        userContext.is_organizer = true;
        userContext.role = "Admin";
        userContext.permissions = Object.values(EVENT_PERMISSIONS);
      }

      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });

      if (staffRole) {
        userContext.role = staffRole.role.name;
        const userOverrides = staffRole.permissions_override as string[] | null;
        let effectivePermissions = (Array.isArray(userOverrides) && userOverrides.length > 0)
          ? userOverrides
          : ((staffRole.role.permissions as string[]) || []);

        if (!effectivePermissions || effectivePermissions.length === 0) {
          effectivePermissions = getDefaultPermissionsForRole(staffRole.role.name);
        } else {
          if (!effectivePermissions.includes(EVENT_PERMISSIONS.VIEW_DASHBOARD)) {
            effectivePermissions = [...effectivePermissions, EVENT_PERMISSIONS.VIEW_DASHBOARD];
          }
          if (staffRole.role.name.toLowerCase().includes('registration')) {
            const regPerms = [
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_INVITATIONS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_REFUNDS,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ];
            effectivePermissions = Array.from(new Set([...effectivePermissions, ...regPerms]));
          }
          if (staffRole.role.name.toLowerCase().includes('admin')) {
            effectivePermissions = Object.values(EVENT_PERMISSIONS);
          }
        }
        userContext.permissions = effectivePermissions;
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
        userContext.registration_id = reg.id;
      }

      const saved = await prisma.savedEvent.findUnique({
        where: { user_id_event_id: { user_id: userId, event_id: eventId } }
      });
      if (saved) {
        userContext.is_saved = true;
      }

      const reminder = await prisma.eventReminder.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } }
      });
      if (reminder && !reminder.notified_at) {
        userContext.has_reminder = true;
      }
    }

    const reminderCount = await prisma.eventReminder.count({
      where: { event_id: eventId, notified_at: null }
    });

    const { type, ...rest } = event;
    const aggregatedTags = Array.from(
      new Set((event.timelines || []).flatMap((t) => t.tags || []))
    );
    return { ...rest, type: type.name, tags: aggregatedTags, reminder_count: reminderCount, user_context: userContext };
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

    const { type, ...updateData } = data;
    const finalUpdateData: any = { ...updateData };

    const effectiveStartDate =
      finalUpdateData.start_date !== undefined ? finalUpdateData.start_date : event.start_date;
    const effectiveEndDate =
      finalUpdateData.end_date !== undefined ? finalUpdateData.end_date : event.end_date;

    if ((effectiveStartDate && !effectiveEndDate) || (!effectiveStartDate && effectiveEndDate)) {
      throw new Error("Please provide both start date and end date, or leave both blank for Coming Soon.");
    }
    if (effectiveStartDate && effectiveEndDate && new Date(effectiveEndDate) <= new Date(effectiveStartDate)) {
      throw new Error("End date must be after start date");
    }

    if (type) {
      // Find or create the event type (case-insensitive)
      let eventType = await prisma.eventType.findFirst({
        where: {
          name: {
            equals: type,
            mode: 'insensitive'
          }
        }
      });

      if (!eventType) {
        eventType = await prisma.eventType.create({
          data: {
            name: type,
            is_system: false,
            created_by: userId
          }
        });
      }
      finalUpdateData.type_id = eventType.id;
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: finalUpdateData,
      include: {
        type: { select: { name: true } }
      }
    });

    // Dispatch Email + Notification reminders when dates are announced/updated and registrations are open
    const hadDatesBefore = Boolean(event.start_date && event.end_date);
    const hasDatesNow = Boolean(updatedEvent.start_date && updatedEvent.end_date);
    const datesChanged =
      hasDatesNow &&
      (!hadDatesBefore ||
        event.start_date?.getTime() !== updatedEvent.start_date?.getTime() ||
        event.end_date?.getTime() !== updatedEvent.end_date?.getTime());
    const regJustOpened = !event.is_registration_open && Boolean(updatedEvent.is_registration_open);

    if (hasDatesNow && updatedEvent.is_registration_open && (datesChanged || regJustOpened)) {
      EventService.dispatchEventReminders(updatedEvent).catch((err) => {
        console.error(`[REMINDER_DISPATCH_ERROR] Event ${eventId}:`, err);
      });
    }

    const { type: updatedType, ...rest } = updatedEvent;
    return { ...rest, type: updatedType.name };
  }

  private static async dispatchEventReminders(event: {
    id: number;
    title: string;
    start_date: Date | null;
    end_date: Date | null;
    location: string | null;
    mode: string;
    registration_fee: any;
  }) {
    const waitingSubscribers = await prisma.eventReminder.findMany({
      where: { event_id: event.id, notified_at: null },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    if (waitingSubscribers.length === 0) return;

    const now = new Date();
    await prisma.eventReminder.updateMany({
      where: { id: { in: waitingSubscribers.map((s) => s.id) } },
      data: { notified_at: now },
    });

    const datePreview = event.start_date
      ? new Date(event.start_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Updated Schedule";

    await Promise.allSettled(
      waitingSubscribers.map(async (sub) => {
        if (!sub.user) return;
        await EmailService.sendEventReminderEmail(sub.user.email, sub.user.name, event);
        await PushService.sendPushToUser(sub.user.id, {
          title: `🔔 Registration Open: ${event.title}`,
          body: `Dates are live (${datePreview}) and registrations are now open! Tap to participate.`,
          url: `/events/${event.id}`,
          tag: `event-reminder-${event.id}`,
          actions: [{ action: "open", title: "Participate Now" }],
        });
      })
    );
  }

  static async subscribeReminder(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    if (event.created_by === userId) {
      throw new Error("Organizers do not need a reminder for their own event.");
    }

    await prisma.eventReminder.upsert({
      where: { event_id_user_id: { event_id: eventId, user_id: userId } },
      create: { event_id: eventId, user_id: userId, notified_at: null },
      update: { notified_at: null },
    });

    return { has_reminder: true };
  }

  static async unsubscribeReminder(eventId: number, userId: number) {
    try {
      await prisma.eventReminder.delete({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
      });
    } catch {
      // Ignore if not found
    }
    return { has_reminder: false };
  }

  // 5. DELETE EVENT
  static async deleteEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const isCreator = event.created_by === Number(userId);
    if (!isCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: Number(userId) } },
        include: { role: true }
      });

      let hasPermission = false;
      if (staffRole) {
        const rolePermissions = (staffRole.role.permissions as string[]) || [];
        const overrides = (staffRole.permissions_override as string[]) || [];
        hasPermission =
          rolePermissions.includes(EVENT_PERMISSIONS.MANAGE_EVENT) ||
          overrides.includes(EVENT_PERMISSIONS.MANAGE_EVENT) ||
          staffRole.role.name.toLowerCase().includes("admin");
      }

      if (!hasPermission) {
        throw new Error("Only the creator or authorized event admin can delete an event");
      }
    }

    return prisma.event.delete({ where: { id: eventId } });
  }

  // 6. GET ALL EVENT TYPES
  static async getEventTypes(userId?: number) {
    return prisma.eventType.findMany({
      where: {
        OR: [
          { is_system: true },
          ...(userId ? [{ created_by: userId }] : [])
        ]
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        is_system: true
      }
    });
  }

  // 7. SAVE EVENT
  static async saveEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    return prisma.savedEvent.upsert({
      where: { user_id_event_id: { user_id: userId, event_id: eventId } },
      create: { user_id: userId, event_id: eventId },
      update: {}
    });
  }

  // 8. UNSAVE EVENT
  static async unsaveEvent(eventId: number, userId: number) {
    try {
      await prisma.savedEvent.delete({
        where: { user_id_event_id: { user_id: userId, event_id: eventId } }
      });
    } catch (error) {
      // Ignore if not found
    }
    return { success: true };
  }

  // 9. GET SAVED EVENTS
  static async getSavedEvents(userId: number, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const savedEvents = await prisma.savedEvent.findMany({
      where: { user_id: userId },
      skip,
      take: limit,
      orderBy: { saved_at: 'desc' },
      include: {
        event: {
          include: {
            creator: { select: { id: true, name: true, avatar_url: true } },
            type: { select: { name: true } },
            _count: { select: { registrations: true } }
          }
        }
      }
    });

    const total = await prisma.savedEvent.count({ where: { user_id: userId } });

    const formattedEvents = savedEvents.map(se => {
      const { type, ...rest } = se.event;
      return {
        ...rest,
        type: type.name,
        is_saved: true,
        saved_at: se.saved_at,
        registered_count: (se.event as any)._count?.registrations ?? 0,
        _count: (se.event as any)._count
      };
    });

    return { events: formattedEvents, total, totalPages: Math.ceil(total / limit) };
  }

  // 12. GET EVENTS WHERE USER IS A CONTRIBUTOR / STAFF MEMBER
  static async getContributedEvents(userId: number) {
    try {
      if (!userId || isNaN(userId)) return [];

      const staffRoles = await prisma.eventUserRole.findMany({
        where: { user_id: userId },
        include: {
          event: {
            include: {
              creator: { select: { id: true, name: true, avatar_url: true } },
              type: { select: { name: true } },
              timelines: { select: { tags: true } },
              _count: { select: { registrations: true } }
            }
          },
          role: { select: { id: true, name: true } }
        }
      });

      const formattedEvents = staffRoles
        .filter(sr => sr && sr.event)
        .map(sr => {
          const { type, timelines, ...rest } = sr.event;
          const aggregatedTags = Array.from(
            new Set((timelines || []).flatMap((t: any) => t.tags || []))
          );

          return {
            ...rest,
            type: type ? type.name : 'Event',
            tags: aggregatedTags,
            staffRoleName: sr.role ? sr.role.name : 'Staff Member',
            staffRoleId: sr.role_id,
            assignedAt: sr.assigned_at,
            registered_count: (sr.event as any)._count?.registrations ?? 0,
            _count: (sr.event as any)._count
          };
        });

      return formattedEvents;
    } catch (error: any) {
      console.error("Error in getContributedEvents:", error);
      return [];
    }
  }
}