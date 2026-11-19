/** État applicatif partagé (UI). */
import type { Audit } from '../core/types.ts';
import { buildModel, emptyOverrides, type Model, type Overrides } from '../core/model.ts';
import type { Report } from '../core/validate.ts';

export const emptyFilters = () => ({ pilier: '', outil: '', criticite: '', statut: '', type: '' });
export const S = {
  RAW: null as unknown as Audit,
  OV: emptyOverrides() as Overrides,
  FB: {} as Record<string, any>,
  M: null as unknown as Model,
  REPORT: null as Report | null,
  artefact: false,
  route: 'S0', fid: null as string | null, ptab: 0, edit: false,
  filters: emptyFilters(), s3view: null as string | null,
  s8: { axe: '', top: false, q: '', sort: 'id_grille', dir: 1 },
};
export const rebuild = () => { S.M = buildModel(S.RAW, S.OV); };
