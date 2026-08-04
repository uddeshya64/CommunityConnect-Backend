import { PrismaClient } from "@prisma/client";


const prisma = new PrismaClient();

export class ProfileService {

  // ==========================================
  // GET USER PROFILE BY ID
  // ==========================================
  static async getProfile(userId: number) {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        // ==========================================
        // BASIC USER INFORMATION
        // ==========================================
        id: true,
        name: true,
        email: true,
        phone: true,
        profession: true,
        skills: true,
        github: true,
        linkedin: true,
        avatar_url: true,
        bio: true,
        location: true,
        user_settings: true,
        created_at: true,
        updated_at: true,

        // ==========================================
        // EVENTS CREATED BY USER
        // ==========================================
        events_created: {
          select: {
            id: true,
            title: true,
            description: true,
            start_date: true,
            end_date: true,
            location: true,
            banner_url: true,
          },

          orderBy: {
            start_date: "asc",
          },
        },

        // ==========================================
        // USER ACTIVITY COUNTS
        // ==========================================
        _count: {
          select: {
            // Total events created
            events_created: true,

            // Total teams led
            teams_led: true,

            // Total mentor assignments
            mentor_assignments: true,

            // Total submissions
            submissions: true,
          },
        },
      },
    });

    // ==========================================
    // USER NOT FOUND
    // ==========================================
    if (!user) {
      throw new Error("User not found");
    }

    // ==========================================
    // RETURN PROFILE
    // ==========================================
    return user;
  }


  // ==========================================
  // UPDATE USER PROFILE
  // ==========================================
  static async updateProfile(
    userId: number,
    data: Record<string, unknown>
  ) {
    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        ...data,
        updated_at: new Date(),
      },

      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profession: true,
        skills: true,
        github: true,
        linkedin: true,
        avatar_url: true,
        bio: true,
        location: true,
        user_settings: true,
        created_at: true,
        updated_at: true,
      },
    });

    return updatedUser;
  }

  // ==========================================
  // GET USER SETTINGS
  // ==========================================
  static async getSettings(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { user_settings: true },
    });
    if (!user) {
      throw new Error("User not found");
    }
    return user.user_settings || {};
  }

  // ==========================================
  // UPDATE USER SETTINGS
  // ==========================================
  static async updateSettings(userId: number, settingsData: any) {
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { user_settings: true },
    });
    if (!current) {
      throw new Error("User not found");
    }
    const existingSettings = (current.user_settings as Record<string, any>) || {};
    const mergedSettings = { ...existingSettings, ...settingsData };

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        user_settings: mergedSettings,
        updated_at: new Date(),
      },
      select: { user_settings: true },
    });
    return updated.user_settings;
  }

  // ==========================================
  // DELETE USER ACCOUNT
  // ==========================================
  static async deleteAccount(userId: number) {
    await prisma.user.delete({
      where: { id: userId },
    });
    return { success: true, message: "Account deleted successfully" };
  }
}