import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ProfileService {
  
  // 1. Get Profile (Read)
  static async getProfile(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      // SELECT SPECIFIC FIELDS: Never return password_hash!
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        skills: true,
        linkedin: true,
        github: true,
        profession: true,
        created_at: true,
        // We can also fetch related data, e.g., teams they lead
        teams_led: {
          select: { id: true, name: true }
        }
      }
    });

    if (!user) throw new Error("User not found");
    return user;
  }

  // 2. Update Profile (Write)
  static async updateProfile(userId: number, data: any) {
    // Prisma's 'update' works perfectly with PATCH because it only
    // touches the fields provided in the 'data' object.
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        updated_at: new Date() // Explicitly update timestamp if needed
      },
      select: {
        id: true,
        name: true,
        email: true,
        skills: true,
        updated_at: true
      }
    });

    return updatedUser;
  }
}