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
        created_at: true,
        updated_at: true,
      },
    });

    return updatedUser;
  }
}