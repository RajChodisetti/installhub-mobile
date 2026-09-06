export type PricingMode = 'quoted' | 'charge_up';
export type CostCategory = 'labour' | 'material' | 'other';
export type CostLineSource = 'manual' | 'auto_labour';

export type FinanceHeader = {
  installationId: string;
  pricingMode: PricingMode;
  pricedAmount: number | null;
  currency: string;
  notes: string | null;
  updatedAt: string;
};

export type CostLine = {
  id: string;
  installationId: string;
  category: CostCategory;
  description: string;
  costAmount: number;
  sellAmount: number | null;
  hours: number | null;
  billable: boolean;
  invoiced: boolean;
  source: CostLineSource;
  incurredAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutoLabourMeta = {
  enabled: boolean;
  hoursPerDay: number;
  hourlyRate: number;
  calendarDays: number;
  hours: number;
  costAmount: number;
  startAt: string;
  endAt: string;
};

export type FinancialSummary = {
  installationId: string;
  installation: {
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  header: FinanceHeader;
  lines: CostLine[];
  autoLabour: AutoLabourMeta;
  billablePricedAmount: number;
  invoicedCosts: number;
  uninvoicedCosts: number;
  uninvoicableCosts: number;
  totalCurrentCosts: number;
  potentialProfit: number;
  creditApplied: number;
  billablePricedMarginPct: number | null;
  currentMarginToDatePct: number | null;
  marginBreathingRoomPct: number | null;
  invoicedBillable: number;
  uninvoicedBillable: number;
  labour: {
    cost: number;
    sell: number;
    hours: number;
    unchargedCost: number;
  };
  material: {
    cost: number;
    sell: number;
  };
  other: {
    cost: number;
    sell: number;
  };
  scheduledHours: number;
  currency: string;
};

export type UpsertFinanceHeaderInput = {
  pricingMode: PricingMode;
  pricedAmount: number | null;
  currency?: string;
  notes?: string | null;
};

export type CostLineInput = {
  category: CostCategory;
  description: string;
  costAmount: number;
  sellAmount?: number | null;
  billable?: boolean;
  incurredAt?: string | null;
};

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  costLineId: string | null;
  category: CostCategory | null;
};

export type InvoiceListItem = {
  id: string;
  installationId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  gstRate: number;
  createdAt: string;
  updatedAt: string;
};

export type Invoice = InvoiceListItem & {
  notes: string | null;
  sellerName: string | null;
  sellerAbn: string | null;
  sellerAddress: string | null;
  sellerEmail: string | null;
  createdByUserId: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  installation: {
    auditDate: string;
    siteName: string;
    clientName: string;
    siteAddress: string;
    status: string;
  };
  lines: InvoiceLine[];
};

export type QuickInvoiceInput = {
  costLineIds?: string[];
  notes?: string | null;
};

export type UpdateDraftInvoiceInput = {
  notes?: string | null;
  dueDate?: string | null;
};
