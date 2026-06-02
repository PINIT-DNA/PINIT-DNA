/**
 * PINIT-DNA API Service
 * Connects to the backend at localhost:4000 via Vite proxy.
 */

import axios from 'axios';
import type { GenerateDnaResponse } from '../types';

const client = axios.create({ baseURL: '/api/v1' });

/**
 * Upload an image and generate its 6-layer DNA fingerprint.
 * Calls: POST /api/v1/dna/generate
 */
export async function generateDna(file: File): Promise<GenerateDnaResponse> {
  const form = new FormData();
  form.append('image', file);

  const { data } = await client.post<GenerateDnaResponse>('/dna/generate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return data;
}

/**
 * Get a stored DNA record.
 * Calls: GET /api/v1/dna/:id
 */
export async function getDnaRecord(id: string) {
  const { data } = await client.get(`/dna/${id}`);
  return data;
}

/**
 * Encrypt image and store in vault.
 * Calls: POST /api/v1/vault/store
 */
export async function storeInVault(file: File, dnaRecordId: string) {
  const form = new FormData();
  form.append('image', file);
  form.append('dnaRecordId', dnaRecordId);

  const { data } = await client.post('/vault/store', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/**
 * Get vault record metadata.
 * Calls: GET /api/v1/vault/:id
 */
export async function getVaultRecord(vaultId: string) {
  const { data } = await client.get(`/vault/${vaultId}`);
  return data;
}
