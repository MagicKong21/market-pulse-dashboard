const shanghaiParts=time=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(time)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));

function tradingDayKey(time){
  const parts=shanghaiParts(time),date=`${parts.year}-${parts.month}-${parts.day}`;
  if(Number(parts.hour)*60+Number(parts.minute)<17*60)return date;
  return new Date(Date.parse(`${date}T00:00:00Z`)+86_400_000).toISOString().slice(0,10);
}

// 浏览器直连东方财富时，使用与本地服务相同的交易日切分规则。
export function normalizeA50BrowserPayload(payload,periodKey){
  const parsed=(payload?.data?.klines||[]).map(row=>String(row).split(",")).map(fields=>[Date.parse(`${fields[0].replace(" ","T")}+08:00`),Number(fields[2]),Number(fields[5])]).filter(([time,value,volume])=>Number.isFinite(time)&&value>0&&volume>0);
  const keys=parsed.map(([time])=>tradingDayKey(time)),visible=[...new Set(keys)].slice(periodKey==="1d"?-1:-5),first=keys.findIndex(key=>key===visible[0]);
  const points=parsed.slice(first).filter(([time])=>visible.includes(tradingDayKey(time))).map(([time,value])=>[time,value]);
  if(points.length<3)throw new Error("东方财富 A50 期货有效分时点不足");
  const previousClose=first>0?parsed[first-1][1]:Number(payload?.data?.preKPrice)||points[0][1],last=points.at(-1),baseline=periodKey==="1d"?previousClose:points[0][1],lastDay=visible.at(-1),sessionEnd=Date.parse(`${lastDay}T16:35:00+08:00`);
  return{price:last[1],previousClose,change:last[1]-baseline,changePercent:(last[1]-baseline)/baseline*100,asOf:last[0],points,session:periodKey==="1d"?{start:sessionEnd-84_900_000,end:sessionEnd}:null,provisionalLatest:false,provisionalPoint:null};
}
