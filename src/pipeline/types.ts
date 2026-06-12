export type PlanType = "savings" | "ci" | "iul";

export interface ExtractionInput {
  pdfName: string;
  pdfPath?: string;
  planType: PlanType;
  data: any;
}

export interface TenantBrandConfig {
  tenantId: string;
  companyName: string;
  logoUrl?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    bgStart: string;
    bgEnd: string;
  };
  fontFamily: string;
  imageWhitelist: Record<string, string | string[]>;
  companyIntro?: string;
  companyRating?: string[];
}

export interface PipelineRequest {
  tenantId: string;
  userId: string;
  sessionId: string;
  customerName: string;
  outputStem?: string;
  quality?: "standard" | "high";
  format?: "pptx" | "pdf" | "both";
  stylePreset?: "broker" | "business" | "minimal" | "chinese" | "ink";
  companyContext?: {
    companyId: string;
    companyName: string;
    evidenceFiles: string[];
  };
  savingsMetrics?: {
    insuredName: string;
    insuredAge: number;
    insuredGender: string;
    productName: string;
    currency: string;
    annualPremium: number;
    payYears: number;
    totalPremium: number;
    breakevenYear: number | null;
    multiple20: number | null;
    multiple30: number | null;
    withdrawStartYear: number | null;
    withdrawStartAge: number | null;
  };
  extractions: ExtractionInput[];
  normalizedSavings?: import("../savings/savings-normalizer.ts").NormalizedSavingsPlan;
  normalizedCi?: import("../ci/ci-normalizer.ts").NormalizedCiPlan;
  normalizedIul?: import("../iul/iul-normalizer.ts").NormalizedIulPlan;
}

export interface OutlineSlide {
  id: string;
  pageType: "cover" | "company" | "timeline" | "compare" | "chart" | "table" | "conclusion" | "narrative";
  title: string;
  bullets: string[];
  chartIntent?: "growth" | "cashflow" | "stacked" | "radar";
  visualIntent?: "family" | "education" | "retire" | "company" | "finance" | "shield";
}

export interface OutlineArtifact {
  markdownPath: string;
  slides: OutlineSlide[];
}

export interface ImageAsset {
  slideId: string;
  pathOrUrl: string;
  source: "whitelist" | "generated";
}

export interface ImageArtifact {
  assetsDir: string;
  images: ImageAsset[];
}

export interface ChartAsset {
  kind: string;
  path: string;
  productName?: string;
}

export interface ChartArtifact {
  assetsDir: string;
  assets: ChartAsset[];
}

export interface DeckArtifact {
  marpPath: string;
  pptxPath?: string;
  pdfPath?: string;
  pptxRenderMode?: "marp" | "artifact-tool-exact-clone-edit";
}
