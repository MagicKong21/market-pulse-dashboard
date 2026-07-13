const shanghaiParts=time=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(time)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));

function isSgeTradingTime(time){
  const parts=shanghaiParts(time),minute=Number(parts.hour)*60+Number(parts.minute),weekday=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`).getDay();
  return weekday>=1&&weekday<=5&&(minute>=9*60&&minute<=11*60+30||minute>=13*60+30&&minute<=15*60+30||minute>=20*60)||weekday>=2&&weekday<=6&&minute<=2*60+30;
}
function tradingDayKey(time){
  const parts=shanghaiParts(time),date=`${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour)>=20?new Date(Date.parse(`${date}T00:00:00Z`)+86_400_000).toISOString().slice(0,10):date;
}

export function normalizeAu9999BrowserPayload(payload){
  const parsed=(payload?.data?.klines||[]).map(row=>String(row).split(",")).map(fields=>[Date.parse(`${fields[0].replace(" ","T")}+08:00`),Number(fields[2]),Number(fields[5])]).filter(([time,value,volume])=>Number.isFinite(time)&&value>0&&volume>0&&isSgeTradingTime(time));
  const keys=parsed.map(([time])=>tradingDayKey(time)),day=keys.at(-1),first=keys.findIndex(key=>key===day),points=parsed.slice(first).filter(([time])=>tradingDayKey(time)===day).map(([time,value])=>[time,value]);
  if(points.length<3)throw new Error("东方财富 AU9999 有效分时点不足");
  const previousClose=first>0?parsed[first-1][1]:Number(payload?.data?.preKPrice)||points[0][1],last=points.at(-1),sessionEnd=Date.parse(`${day}T15:30:00+08:00`);
  return{price:last[1],previousClose,change:last[1]-previousClose,changePercent:(last[1]-previousClose)/previousClose*100,asOf:last[0],points,session:{start:sessionEnd-70_200_000,end:sessionEnd},provisionalLatest:false,provisionalPoint:null};
}
