export const DEFAULT_AUTO_REFRESH_MS=10_000;

export const AUTO_REFRESH_OPTIONS=Object.freeze([
  {value:0,label:"关闭"},
  {value:5_000,label:"5 秒"},
  {value:10_000,label:"10 秒"},
  {value:30_000,label:"30 秒"},
  {value:60_000,label:"1 分钟"},
  {value:300_000,label:"5 分钟"}
]);

const ALLOWED=new Set(AUTO_REFRESH_OPTIONS.map(option=>option.value));

export function normalizeAutoRefreshMs(value){
  const number=Number(value);
  return ALLOWED.has(number)?number:DEFAULT_AUTO_REFRESH_MS;
}

export function autoRefreshLabel(value){
  const normalized=normalizeAutoRefreshMs(value);
  return AUTO_REFRESH_OPTIONS.find(option=>option.value===normalized)?.label||"10 秒";
}

export function autoRefreshCountdownLabel(remainingMs){
  return `${autoRefreshCountdownSeconds(remainingMs)} 秒后更新`;
}

export function autoRefreshCountdownSeconds(remainingMs){
  return Math.max(0,Math.ceil((Number(remainingMs)||0)/1000));
}
