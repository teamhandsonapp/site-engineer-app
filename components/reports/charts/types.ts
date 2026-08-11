// Shared shapes for the Reports chart primitives (BarChart, PieChart).

export interface BarChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarChartCategory {
  key: string;
  label: string;
  values: Record<string, number>; // seriesKey -> value
  // Optional per-category-per-series color override — the one mechanism that
  // covers every "this specific bar/segment needs its own color" use site
  // (department tint, red/green sign-based bars, per-metric quantity colors)
  // without the primitive needing a special case per use site.
  colors?: Record<string, string>;
}

export interface PieChartDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}
