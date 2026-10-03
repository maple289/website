export type StatisticsColumn = { key: string; name: string; format?: 'date' | 'bytes' | 'number'; sortable?: boolean };
export const statisticsColumn = (key: string, name: string, format?: StatisticsColumn['format'], sortable = true): StatisticsColumn => ({ key, name, format, sortable });
export const statisticsDate = (value: unknown) => value ? new Date(String(value)).toLocaleString() : '—';
export const statisticsNumber = (value: unknown) => Number(value ?? 0).toLocaleString();
