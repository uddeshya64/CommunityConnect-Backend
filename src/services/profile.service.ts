import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class ProfileService {

  // Get logged in user's profile
  static async getProfile(userId: number) {

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
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

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  // Update profile
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