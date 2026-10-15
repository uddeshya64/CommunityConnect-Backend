import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class OrganizerConfigService {
  /**
   * Retrieves an organizer's global tenant configuration.
   */
  static async getConfig(organizerId: number) {
    const user = await prisma.user.findUnique({
      where: { id: organizerId },
      select: {
        id: true,
        name: true,
        email: true,
        subscription_status: true,
        branding_config: true,
        tenant_policy: true,
        security_config: true,
        billing_info: true,
      }
    });

    if (!user) {
      throw new Error("Organizer not found.");
    }

    return user;
  }

  /**
   * Updates an organizer's global tenant configuration.
   */
  static async updateConfig(organizerId: number, updateData: {
    branding_config?: any;
    tenant_policy?: any;
    security_config?: any;
    billing_info?: any;
    subscription_status?: string;
  }) {
    // Verify the organizer exists first
    const exists = await prisma.user.findUnique({ where: { id: organizerId } });
    if (!exists) {
      throw new Error("Organizer not found.");
    }

    // Update configs
    const updatedUser = await prisma.user.update({
      where: { id: organizerId },
      data: {
        branding_config: updateData.branding_config !== undefined ? updateData.branding_config : undefined,
        tenant_policy: updateData.tenant_policy !== undefined ? updateData.tenant_policy : undefined,
        security_config: updateData.security_config !== undefined ? updateData.security_config : undefined,
        billing_info: updateData.billing_info !== undefined ? updateData.billing_info : undefined,
        subscription_status: updateData.subscription_status !== undefined ? updateData.subscription_status : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        subscription_status: true,
        branding_config: true,
        tenant_policy: true,
        security_config: true,
        billing_info: true,
      }
    });

    return updatedUser;
  }
}
