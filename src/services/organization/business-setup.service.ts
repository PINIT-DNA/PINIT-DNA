import { prisma } from '../../lib/prisma';
import {
  isOrganizationIndustry,
  isOrganizationSize,
  type OrganizationIndustry,
  type OrganizationSize,
} from './constants/organization-profile';

export interface BusinessSetupInput {
  organizationName: string;
  industry: OrganizationIndustry;
  organizationSize: OrganizationSize;
  workspaceName: string;
}

export interface BusinessSetupResult {
  organization: string;
  industry: OrganizationIndustry;
  organizationSize: OrganizationSize;
  workspaceName: string;
  businessSetupCompletedAt: Date;
}

export const businessSetupService = {
  async completeSetup(userId: string, input: BusinessSetupInput): Promise<BusinessSetupResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true, businessSetupCompletedAt: true },
    });
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }
    if (user.accountType !== 'BUSINESS') {
      throw Object.assign(new Error('Business setup is only available for Business accounts'), { status: 403 });
    }
    if (user.businessSetupCompletedAt) {
      throw Object.assign(new Error('Business workspace is already configured'), { status: 409 });
    }

    const organizationName = input.organizationName.trim();
    const workspaceName = input.workspaceName.trim();
    if (organizationName.length < 2) {
      throw Object.assign(new Error('Organization name must be at least 2 characters'), { status: 400 });
    }
    if (workspaceName.length < 2) {
      throw Object.assign(new Error('Workspace name must be at least 2 characters'), { status: 400 });
    }
    if (!isOrganizationIndustry(input.industry)) {
      throw Object.assign(new Error('Invalid industry'), { status: 400 });
    }
    if (!isOrganizationSize(input.organizationSize)) {
      throw Object.assign(new Error('Invalid organization size'), { status: 400 });
    }

    const completedAt = new Date();
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        organization: organizationName,
        organizationIndustry: input.industry,
        organizationSize: input.organizationSize,
        workspaceName,
        businessSetupCompletedAt: completedAt,
      },
      select: {
        organization: true,
        organizationIndustry: true,
        organizationSize: true,
        workspaceName: true,
        businessSetupCompletedAt: true,
      },
    });

    return {
      organization: updated.organization!,
      industry: updated.organizationIndustry!,
      organizationSize: updated.organizationSize!,
      workspaceName: updated.workspaceName!,
      businessSetupCompletedAt: updated.businessSetupCompletedAt!,
    };
  },

  async getSetupStatus(userId: string): Promise<{ complete: boolean; accountType: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true, businessSetupCompletedAt: true },
    });
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }
    return {
      accountType: user.accountType,
      complete: user.accountType !== 'BUSINESS' || Boolean(user.businessSetupCompletedAt),
    };
  },
};
