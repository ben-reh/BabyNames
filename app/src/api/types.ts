export interface Name {
  name: string;
  sex: 'M' | 'F';
  rank: number | null;
  rank_2025: number | null;
  origin: string | null;
  year_peak: number | null;
  total_count: number | null;
  female_pct: number | null;
  similar_names: string[];
  spelling_variants: string[];
}

export interface PopularityRow {
  year: number;
  gender: string;
  count: number;
}

export interface ListPartner {
  names: string[];
}

export interface ListSession {
  listId: string;
  code: string;
  partnerA: ListPartner;
  partnerB: ListPartner | null;
  matches: string[];
  partnerCount: 1 | 2;
  filters: Record<string, unknown>;
}

export interface RankingRow {
  name: string;
  count: number;
  rank: number;
}

export interface NamesFilters {
  sex?: 'M' | 'F' | 'U';
  origins?: string[];
  listId?: string;
  deviceId?: string;
  min_rank?: number;
  max_rank?: number;
  limit?: number;
  cursor?: string;
}
