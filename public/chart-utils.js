export const BEIJING_TIME_ZONE="Asia/Shanghai";

export function tradingDateKey(value,timeZone){
  return new Intl.DateTimeFormat("en-CA",{timeZone:timeZone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
}

export function rangeTimeLabel(value){
  return new Intl.DateTimeFormat("zh-CN",{timeZone:BEIJING_TIME_ZONE,month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
}

const TRADING_BREAKS={SSE:[690,780],SZSE:[690,780],BSE:[690,780],HKEX:[720,780],TSE:[690,750],THS:[690,780]};
const MARKET_HOURS={
  SSE:["09:30","15:00"],SZSE:["09:30","15:00"],BSE:["09:30","15:00"],THS:["09:30","15:00"],HKEX:["09:30","16:00"],
  NASDAQ:["09:30","16:00"],NasdaqGS:["09:30","16:00"],NasdaqGM:["09:30","16:00"],NasdaqCM:["09:30","16:00"],NYSE:["09:30","16:00"],
  KRX:["09:00","15:30"],TSE:["09:00","15:30"],TWSE:["09:00","13:30"],CBOE:["09:30","16:00"],
  NYB:["18:00","17:00",18*60],COMEX:["18:00","17:00",18*60],NYMEX:["18:00","17:00",18*60],
  SGE:["20:00","15:30",20*60],SGX:["17:00","16:35",17*60],CRYPTO:["00:00","24:00"]
};

function localParts(value,timeZone){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timeZone||"UTC",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const part=type=>Number(parts.find(item=>item.type===type)?.value);
  return{year:part("year"),month:part("month"),day:part("day"),hour:part("hour"),minute:part("minute"),second:part("second")};
}

function localMinute(value,timeZone){const parts=localParts(value,timeZone);return parts.hour*60+parts.minute;}
function addDateDays(date,days){const [year,month,day]=date.split("-").map(Number);return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);}

function zonedTimestamp(date,clock,timeZone){
  const [year,month,day]=date.split("-").map(Number),[hour,minute]=clock.split(":").map(Number),target=Date.UTC(year,month-1,day,hour,minute);
  let guess=target;
  for(let index=0;index<3;index++){
    const rendered=localParts(guess,timeZone),renderedUtc=Date.UTC(rendered.year,rendered.month-1,rendered.day,rendered.hour,rendered.minute,rendered.second);
    guess+=target-renderedUtc;
  }
  return guess;
}

export function marketSessionForTime(value,timeZone,market,providedSession=null){
  if(Number.isFinite(providedSession?.start)&&Number.isFinite(providedSession?.end)&&providedSession.end>providedSession.start)return providedSession;
  const hours=MARKET_HOURS[market];if(!hours||!Number.isFinite(value))return null;
  const [open,close,rollover]=hours,date=tradingDateKey(value,timeZone),minute=localMinute(value,timeZone);
  if(Number.isFinite(rollover)){
    const closeDate=minute>=rollover?addDateDays(date,1):date,startDate=addDateDays(closeDate,-1);
    return{start:zonedTimestamp(startDate,open,timeZone),end:zonedTimestamp(closeDate,close,timeZone)};
  }
  return{start:zonedTimestamp(date,open,timeZone),end:zonedTimestamp(date,close,timeZone)};
}

function elapsedTradingMinutes(minute,start,market){
  const raw=Math.max(0,minute-start),tradingBreak=TRADING_BREAKS[market];
  if(!tradingBreak)return raw;
  const [breakStart,breakEnd]=tradingBreak;
  return raw-Math.max(0,Math.min(minute,breakEnd)-Math.max(start,breakStart));
}

function subtractBreak(elapsedStart,elapsedEnd,breakStart,breakEnd){return Math.max(0,Math.min(elapsedEnd,breakEnd)-Math.max(elapsedStart,breakStart));}

function sessionProgress(value,session,market,timeZone){
  if(!session||session.end<=session.start)return null;
  if(market==="SGX"||market==="SGE"){
    const elapsed=Math.max(0,Math.min(value,session.end)-session.start),duration=session.end-session.start;
    const breaks=market==="SGX"?[[12.25,16]]:[[6.5,13],[15.5,17.5]];
    const removed=breaks.reduce((sum,[start,end])=>sum+subtractBreak(0,elapsed,start*3_600_000,end*3_600_000),0);
    const totalRemoved=breaks.reduce((sum,[start,end])=>sum+(end-start)*3_600_000,0);
    return Math.max(0,Math.min(1,(elapsed-removed)/(duration-totalRemoved)));
  }
  if(["NYB","COMEX","NYMEX","CRYPTO"].includes(market))return Math.max(0,Math.min(1,(value-session.start)/(session.end-session.start)));
  const start=localMinute(session.start,timeZone),end=localMinute(session.end,timeZone),total=elapsedTradingMinutes(end,start,market);
  if(total<=0)return null;
  return Math.max(0,Math.min(1,elapsedTradingMinutes(localMinute(value,timeZone),start,market)/total));
}

function sessionKey(value,timeZone,market){
  const date=tradingDateKey(value,timeZone),hours=MARKET_HOURS[market],rollover=hours?.[2];
  if(!Number.isFinite(rollover)||localMinute(value,timeZone)<rollover)return date;
  return addDateDays(date,1);
}

export function chartProgressValues(points,periodKey,timeZone,session,market,provisionalLatest=false){
  if(periodKey==="1d"&&session){
    const progress=points.map(([time])=>sessionProgress(time,session,market,timeZone));
    if(progress.every(Number.isFinite))return progress;
  }
  if(periodKey==="5d"){
    const groups=[],groupByDate=new Map(),positions=[];
    points.forEach(([time])=>{
      const key=sessionKey(time,timeZone,market);
      if(!groupByDate.has(key)){groupByDate.set(key,groups.length);groups.push([]);}
      const groupIndex=groupByDate.get(key),pointIndex=groups[groupIndex].length;
      groups[groupIndex].push(time);positions.push([groupIndex,pointIndex,time]);
    });
    const expectedPoints=Math.max(2,...groups.map(group=>group.length));
    const positioned=positions.map(([groupIndex,pointIndex,time])=>{
      const pointSession=groupIndex===groups.length-1&&session?session:marketSessionForTime(time,timeZone,market);
      const exact=pointSession?sessionProgress(time,pointSession,market,timeZone):null,withinDay=Number.isFinite(exact)?exact:pointIndex/(expectedPoints-1);
      return{progress:(groupIndex+withinDay)/groups.length,withinDay};
    });
    const first=positioned[0]?.progress??0,last=positioned.at(-1)?.progress??first;
    // 数据源可能只给每日收盘价，或者第一天从盘中才开始有数据。
    // 横轴仍应从“第一个有效点”开始，不应把第一个交易日的无数据时段留在图左侧。
    if(first>1e-9&&last>first){
      const finalWithinDay=positioned.at(-1).withinDay,rightGap=provisionalLatest?Math.max(0,(1-finalWithinDay)/groups.length):0,targetLast=1-rightGap;
      return positioned.map(item=>(item.progress-first)/(last-first)*targetLast);
    }
    return positioned.map(item=>item.progress);
  }
  if(provisionalLatest&&session&&points.length>1){
    const latestProgress=sessionProgress(points.at(-1)[0],session,market,timeZone);
    if(Number.isFinite(latestProgress)){
      // 日线周期很长时，“当天剩余几小时”按真实时间比例几乎不可见。
      // 保留至少 6% 的当日槽位，既体现盘中进度，又不改变历史点顺序。
      const lastIndex=points.length-1,slot=Math.max(1/points.length,.06),historyWidth=1-slot;
      return points.map((_,index)=>index===lastIndex?historyWidth+latestProgress*slot:index/Math.max(1,lastIndex-1)*historyWidth);
    }
  }
  return points.map((_,index)=>index/Math.max(1,points.length-1));
}

export function chartSegmentIndexes(points){
  const indexes=points.map((_,index)=>index);
  return indexes.length?[indexes]:[];
}
