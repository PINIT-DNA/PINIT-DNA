/** Business Account — Client / Campaign API. Uses the JWT-authenticated `api` instance. */
import { api } from './dashboard.api';
import { API_BASE_URL } from '../config/api.config';

export interface BusinessClient {
  id: string;
  name: string;
  companyName: string | null;
  website: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  campaignCount: number;
}

export interface Campaign {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  startDate: string | null;
  endDate: string | null;
  budgetCents: number | null;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  memberCount: number;
  client?: { id: string; name: string };
}

export interface CampaignMember {
  id: string;
  userId: string | null;
  name: string | null;
  shortId: string | null;
  platform: string | null;
  profileUrl: string | null;
  roleLabel: string | null;
  isExternal: boolean;
  addedAt: string;
}

export interface CampaignAsset {
  id: string;
  originalFilename: string;
  assetType: string;
  status: string;
  mimeType: string;
  sizeBytes: number;
  vaultId: string | null;
  createdAt: string;
}

export interface CampaignActivityItem {
  id: string;
  createdAt: string;
  action: string;
  title: string;
}

export interface BusinessOverview {
  clientCount: number;
  campaignCount: number;
  assetCount: number;
  creatorCount: number;
  recentClients: BusinessClient[];
  recentCampaigns: Array<{
    id: string;
    name: string;
    clientName: string;
    assetCount: number;
    memberCount: number;
    status: string;
  }>;
}

const BASE = `${API_BASE_URL}/business`;

export async function getBusinessOverview(): Promise<BusinessOverview> {
  const { data } = await api.get<{ success: boolean; overview: BusinessOverview }>(`${BASE}/overview`);
  return data.overview;
}

export async function listClients(): Promise<BusinessClient[]> {
  const { data } = await api.get<{ success: boolean; clients: BusinessClient[] }>(`${BASE}/clients`);
  return data.clients;
}

export async function getClient(clientId: string): Promise<BusinessClient> {
  const { data } = await api.get<{ success: boolean; client: BusinessClient }>(`${BASE}/clients/${clientId}`);
  return data.client;
}

export interface ClientInput {
  name: string;
  companyName?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
}

export async function createClient(input: ClientInput): Promise<BusinessClient> {
  const { data } = await api.post<{ success: boolean; client: BusinessClient }>(`${BASE}/clients`, input);
  return data.client;
}

export async function updateClient(clientId: string, input: Partial<ClientInput>): Promise<BusinessClient> {
  const { data } = await api.patch<{ success: boolean; client: BusinessClient }>(`${BASE}/clients/${clientId}`, input);
  return data.client;
}

export async function deleteClient(clientId: string): Promise<void> {
  await api.delete(`${BASE}/clients/${clientId}`);
}

export async function listCampaigns(clientId: string): Promise<Campaign[]> {
  const { data } = await api.get<{ success: boolean; campaigns: Campaign[] }>(`${BASE}/clients/${clientId}/campaigns`);
  return data.campaigns;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const { data } = await api.get<{ success: boolean; campaign: Campaign }>(`${BASE}/campaigns/${campaignId}`);
  return data.campaign;
}

export interface CampaignInput {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetCents?: number;
}

export async function createCampaign(clientId: string, input: CampaignInput): Promise<Campaign> {
  const { data } = await api.post<{ success: boolean; campaign: Campaign }>(`${BASE}/clients/${clientId}/campaigns`, input);
  return data.campaign;
}

export async function updateCampaign(campaignId: string, input: Partial<CampaignInput & { status: string }>): Promise<Campaign> {
  const { data } = await api.patch<{ success: boolean; campaign: Campaign }>(`${BASE}/campaigns/${campaignId}`, input);
  return data.campaign;
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  await api.delete(`${BASE}/campaigns/${campaignId}`);
}

export async function listCampaignMembers(campaignId: string): Promise<CampaignMember[]> {
  const { data } = await api.get<{ success: boolean; members: CampaignMember[] }>(`${BASE}/campaigns/${campaignId}/members`);
  return data.members;
}

export interface CampaignMemberInput {
  /** Internal staff to connect. Named `memberUserId`, not `userId`, because the
   *  API strips `userId`-style keys from request bodies as an anti-spoofing guard. */
  memberUserId?: string;
  name?: string;
  platform?: string;
  profileUrl?: string;
  roleLabel?: string;
}

export async function addCampaignMember(campaignId: string, input: CampaignMemberInput): Promise<CampaignMember> {
  const { data } = await api.post<{ success: boolean; member: CampaignMember }>(`${BASE}/campaigns/${campaignId}/members`, input);
  return data.member;
}

export async function removeCampaignMember(campaignId: string, memberId: string): Promise<void> {
  await api.delete(`${BASE}/campaigns/${campaignId}/members/${memberId}`);
}

export async function listCampaignAssets(campaignId: string): Promise<CampaignAsset[]> {
  const { data } = await api.get<{ success: boolean; assets: CampaignAsset[] }>(`${BASE}/campaigns/${campaignId}/assets`);
  return data.assets;
}

export async function listCampaignActivity(campaignId: string): Promise<CampaignActivityItem[]> {
  const { data } = await api.get<{ success: boolean; activity: CampaignActivityItem[] }>(`${BASE}/campaigns/${campaignId}/activity`);
  return data.activity;
}
