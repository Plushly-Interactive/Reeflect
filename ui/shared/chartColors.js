import { host } from './host.js';
﻿import { PREF_CHART_COLORS } from './prefKeys.js';

export const CHART_COLOR_TYPES = [
  { type: 'time', cssVar: '--color-chart-time' },
  { type: 'audio', cssVar: '--color-chart-audio' },
  { type: 'visits', cssVar: '--color-chart-visits' },
  { type: 'hourly', cssVar: '--color-chart-hourly' },
  { type: 'idle', cssVar: '--color-chart-idle' },
];

export async function getChartColorOverrides() {
  const stored = await host.prefs.get(PREF_CHART_COLORS);
  return stored[PREF_CHART_COLORS] ?? {};
}

export async function applyChartColorOverrides() {
  const overrides = await getChartColorOverrides();
  for (const { type, cssVar } of CHART_COLOR_TYPES) {
    if (overrides[type]) document.documentElement.style.setProperty(cssVar, overrides[type]);
  }
}

export async function setChartColorOverride(type, color) {
  const overrides = await getChartColorOverrides();
  const { cssVar } = CHART_COLOR_TYPES.find(c => c.type === type);
  if (color) {
    overrides[type] = color;
    document.documentElement.style.setProperty(cssVar, color);
  } else {
    delete overrides[type];
    document.documentElement.style.removeProperty(cssVar);
  }
  await host.prefs.set({ [PREF_CHART_COLORS]: overrides });
}
