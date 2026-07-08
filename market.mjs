export const INSTRUMENTS = Object.freeze([
  { symbol: "AAPL", name: "苹果", market: "NASDAQ" },
  { symbol: "MSFT", name: "微软", market: "NASDAQ" },
  { symbol: "NVDA", name: "英伟达", market: "NASDAQ" },
  { symbol: "GOOGL", name: "谷歌 A", market: "NASDAQ" },
  { symbol: "AMZN", name: "亚马逊", market: "NASDAQ" },
  { symbol: "META", name: "Meta", market: "NASDAQ" },
  { symbol: "TSLA", name: "特斯拉", market: "NASDAQ" },
  { symbol: "TSM", name: "台积电 ADR", market: "NYSE" },
  { symbol: "MU", name: "美光", market: "NASDAQ" },
  { symbol: "AVGO", name: "博通", market: "NASDAQ" },
  { symbol: "AMD", name: "AMD", market: "NASDAQ" },
  { symbol: "000660.KS", name: "SK 海力士", market: "KRX" },
  { symbol: "005930.KS", name: "三星电子", market: "KRX" },
  { symbol: "INTC", name: "英特尔", market: "NASDAQ" },
  { symbol: "ASML", name: "阿斯麦 ADR", market: "NASDAQ" }
]);

export const PERIODS = Object.freeze({
  "1d": { range: "1d", interval: "5m", label: "当日", ttl: 60_000 },
  "5d": { range: "1mo", interval: "30m", label: "近五日", ttl: 180_000 },
  "1mo": { range: "1mo", interval: "1d", label: "近一月", ttl: 600_000 },
  "6mo": { range: "6mo", interval: "1d", label: "近半年", ttl: 1_200_000 },
  "1y": { range: "1y", interval: "1d", label: "近一年", ttl: 1_800_000 },
  "3y": { range: "5y", interval: "1d", label: "近三年", ttl: 3_600_000 }
});

const INTRADAY_BREAKS = Object.freeze({
  SSE: [11 * 60 + 30, 13 * 60],
  SZSE: [11 * 60 + 30, 13 * 60],
  BSE: [11 * 60 + 30, 13 * 60],
  HKEX: [12 * 60, 13 * 60],
  TSE: [11 * 60 + 30, 12 * 60 + 30]
});

function isDuringTradingBreak(timestamp, market, timeZone) {
  const schedule = INTRADAY_BREAKS[market];
  if (!schedule) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date(timestamp));
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    const minute = Number(parts.find(part => part.type === "minute")?.value);
    const minutes = hour * 60 + minute;
    return Number.isFinite(minutes) && minutes > schedule[0] && minutes < schedule[1];
  } catch { return false; }
}

function clampToLastTradingTime(timestamp, market, timeZone) {
  const schedule = INTRADAY_BREAKS[market];
  if (!schedule || !Number.isFinite(timestamp)) return timestamp;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date(timestamp));
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    const minute = Number(parts.find(part => part.type === "minute")?.value);
    const minutes = hour * 60 + minute;
    if (!Number.isFinite(minutes) || minutes <= schedule[0] || minutes >= schedule[1]) return timestamp;
    const date = new Date(timestamp);
    return timestamp - (minutes - schedule[0]) * 60_000 - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds();
  } catch { return timestamp; }
}

function tradingSessionKey(timestamp,market,timeZone){
  const date=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(timestamp));
  if(!["NYB","COMEX","NYMEX"].includes(market))return date;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const hour=Number(parts.find(part=>part.type==="hour")?.value);
  if(hour<18)return date;
  const [year,month,day]=date.split("-").map(Number);
  return new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
}

function localTradingClock(timestamp,timeZone){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const value=type=>parts.find(part=>part.type===type)?.value;
  return{weekday:{Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[value("weekday")],minute:Number(value("hour"))*60+Number(value("minute"))};
}

export function isTradableIntradayTimestamp(timestamp,market,timeZone){
  if(!Number.isFinite(timestamp))return false;
  const{weekday,minute}=localTradingClock(timestamp,timeZone);
  if(!Number.isFinite(weekday)||!Number.isFinite(minute))return false;
  if(["NYB","COMEX","NYMEX"].includes(market)){
    if(weekday===0)return minute>=18*60;
    if(weekday>=1&&weekday<=4)return minute<=17*60||minute>=18*60;
    if(weekday===5)return minute<=17*60;
    return false;
  }
  if(market==="SGE"){
    const day=minute>=9*60&&minute<=11*60+30||minute>=13*60+30&&minute<=15*60+30;
    const night=minute>=20*60,afterMidnight=minute<=2*60+30;
    return day&&weekday>=1&&weekday<=5||night&&weekday>=1&&weekday<=4||afterMidnight&&weekday>=2&&weekday<=5;
  }
  if(market==="SGX"){
    const day=minute>=9*60&&minute<=16*60+35,night=minute>=17*60,afterMidnight=minute<=5*60+15;
    return day&&weekday>=1&&weekday<=5||night&&weekday>=1&&weekday<=4||afterMidnight&&weekday>=2&&weekday<=5;
  }
  return true;
}

export function sanitizeIntradayPoints(rows,market,timeZone,{requirePositiveVolume=false}={}){
  const unique=new Map();
  for(const row of rows){
    const time=Number(row?.[0]),value=Number(row?.[1]),volume=row?.[2]==null?null:Number(row[2]);
    if(!Number.isFinite(time)||!Number.isFinite(value)||value<=0||requirePositiveVolume&&!(volume>0))continue;
    if(!isTradableIntradayTimestamp(time,market,timeZone)||isDuringTradingBreak(time,market,timeZone))continue;
    unique.set(time,[time,value,Number.isFinite(volume)?volume:null]);
  }
  const clean=[...unique.values()].sort((a,b)=>a[0]-b[0]),groups=[];
  for(const row of clean){
    const key=tradingSessionKey(row[0],market,timeZone),last=groups.at(-1);
    if(!last||last.key!==key)groups.push({key,rows:[row]});else last.rows.push(row);
  }
  // 部分供应商会在节假日仅生成 1—2 根“沿用前收”的无成交心跳柱。
  // 只删除整场会话均无成交且与上一场收盘完全相同的短会话，不碰真实盘中横盘。
  const accepted=[];
  for(const group of groups){
    const previous=accepted.at(-1)?.rows.at(-1),allFlat=group.rows.every(row=>Math.abs(row[1]-group.rows[0][1])<1e-9);
    const noVolume=group.rows.every(row=>!(row[2]>0));
    const phantom=Boolean(previous)&&group.rows.length<=2&&allFlat&&noVolume&&Math.abs(group.rows[0][1]-previous[1])<1e-9;
    if(!phantom)accepted.push(group);
  }
  return accepted.flatMap(group=>group.rows);
}

export function normalizeYahooChart(payload, instrument, periodKey, now=Date.now()) {
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;
  if (!result || error) throw new Error(error?.description || "行情响应中没有数据");

  const meta = result.meta || {};
  const exchangeTimezone = meta.exchangeTimezoneName || "UTC";
  const isIntradayPeriod = PERIODS[periodKey]?.interval !== "1d";
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const volumes=result.indicators?.quote?.[0]?.volume||[];
  let rawPoints=[];
  for (let index = 0; index < Math.min(timestamps.length, closes.length); index += 1) {
    const time = Number(timestamps[index]) * 1000;
    const value = Number(closes[index]);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue;
    rawPoints.push([time,value,volumes[index]]);
  }
  if(isIntradayPeriod)rawPoints=sanitizeIntradayPoints(rawPoints,instrument.market,exchangeTimezone);
  let points=rawPoints.map(([time,value])=>[time,value]).sort((a,b)=>a[0]-b[0]);
  if (points.length < 2) throw new Error("有效价格点不足");

  const quoteTime=Number(meta.regularMarketTime)*1000,quotePrice=Number(meta.regularMarketPrice),regularSession=meta.currentTradingPeriod?.regular,regularStart=Number(regularSession?.start)*1000,regularEnd=Number(regularSession?.end)*1000;
  let visiblePreviousClose=null,intradayObservationTime=null;
  if(periodKey==="3y"){
    const cutoff=new Date(points.at(-1)[0]);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-3);
    const firstIndex=points.findIndex(([time])=>time>=cutoff.getTime());
    if(firstIndex>0){visiblePreviousClose=points[firstIndex-1][1];points=points.slice(firstIndex);}
  }
  if(periodKey==="5d"){
    const sessionKeys=points.map(([time])=>tradingSessionKey(time,instrument.market,exchangeTimezone));
    const lastFive=[...new Set(sessionKeys)].slice(-5),firstIndex=sessionKeys.findIndex(key=>key===lastFive[0]);
    if(firstIndex>0)visiblePreviousClose=points[firstIndex-1][1];
    points=points.slice(Math.max(0,firstIndex));
    const finalPoint=points.at(-1),localParts=new Intl.DateTimeFormat("en-GB",{timeZone:exchangeTimezone,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(finalPoint[0]));
    const minute=Number(localParts.find(part=>part.type==="minute")?.value),second=Number(localParts.find(part=>part.type==="second")?.value);
    if((minute%30!==0||second!==0)&&points.length>2){
      intradayObservationTime=finalPoint[0];
      if(Math.abs(finalPoint[1]-points.at(-2)[1])<1e-9)points.pop();
    }
    // Yahoo 的多日分钟柱有时会停在数小时前，但同一响应的 meta 已有更新的实时报价。
    // 用同源最新报价补尾，避免把“柱周期延迟”误显示成整体行情延迟。
    if(Number.isFinite(quoteTime)&&Number.isFinite(quotePrice)&&quoteTime>points.at(-1)[0]&&quotePrice>0){
      let observationTime=clampToLastTradingTime(quoteTime,instrument.market,exchangeTimezone);
      if(Number.isFinite(regularEnd)&&quoteTime>=regularEnd)observationTime=Math.min(observationTime,regularEnd);
      if(observationTime>points.at(-1)[0])points.push([observationTime,quotePrice]);
      else if(observationTime===points.at(-1)[0])points[points.length-1][1]=quotePrice;
      intradayObservationTime=Math.max(points.at(-1)[0],observationTime);
    }
  }

  const isDailyPeriod = PERIODS[periodKey]?.interval === "1d";
  const tradingDate = timestamp => {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone:exchangeTimezone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(timestamp)); }
    catch { return new Date(timestamp).toISOString().slice(0,10); }
  };
  const officialLastPoint = points.at(-1);
  const shouldAppendQuote = isDailyPeriod
    && Number.isFinite(quoteTime) && Number.isFinite(quotePrice) && quoteTime > officialLastPoint[0] && quotePrice > 0
    && tradingDate(quoteTime) !== tradingDate(officialLastPoint[0]);
  const isInProgressDaily = isDailyPeriod && !shouldAppendQuote
    && Number.isFinite(quoteTime) && Number.isFinite(regularStart) && Number.isFinite(regularEnd)
    && quoteTime >= regularStart && quoteTime < regularEnd
    && now >= regularStart && now < regularEnd
    && tradingDate(quoteTime) === tradingDate(officialLastPoint[0]);
  const observationTime = isInProgressDaily || shouldAppendQuote ? clampToLastTradingTime(quoteTime,instrument.market,exchangeTimezone) : quoteTime;
  const provisionalPoint = shouldAppendQuote
    ? { time:observationTime, value:quotePrice, source:"Yahoo 最新报价", kind:"supplemented" }
    : isInProgressDaily ? { time:observationTime, value:officialLastPoint[1], source:"Yahoo 盘中日 K", kind:"in_progress" } : null;
  if (shouldAppendQuote) points.push([provisionalPoint.time, provisionalPoint.value]);

  const firstPointSeconds = points[0][0] / 1000;
  const lastPointSeconds = points.at(-1)[0] / 1000;
  const reportedSessions = Array.isArray(meta.tradingPeriods) ? meta.tradingPeriods.flat(2).filter(Boolean) : [];
  const containsPoints = candidate => {
    const start = Number(candidate?.start), end = Number(candidate?.end);
    return Number.isFinite(start) && Number.isFinite(end) && firstPointSeconds >= start - 600 && lastPointSeconds <= end + 600;
  };
  const actualSession = reportedSessions.find(containsPoints) || (containsPoints(meta.currentTradingPeriod?.regular) ? meta.currentTradingPeriod.regular : null);
  const session = periodKey === "1d" && actualSession
    ? { start: Number(actualSession.start) * 1000, end: Number(actualSession.end) * 1000 }
    : null;
  const last = points.at(-1)[1];
  const rawPreviousClose = Number(visiblePreviousClose || meta.chartPreviousClose || meta.previousClose || meta.regularMarketPreviousClose);
  const previousClose = Number.isFinite(rawPreviousClose) && rawPreviousClose > 0 ? rawPreviousClose : null;
  const first = periodKey === "1d"
    ? Number(previousClose || points[0][1])
    : points[0][1];
  const baseline = Number.isFinite(first) && first > 0 ? first : points[0][1];
  const change = last - baseline;
  return {
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market === "CUSTOM" ? (meta.fullExchangeName || meta.exchangeName || "CUSTOM") : instrument.market,
    currency: meta.currency || "",
    exchangeTimezone,
    price: last,
    previousClose,
    change,
    changePercent: (change / baseline) * 100,
    asOf: isInProgressDaily ? observationTime : intradayObservationTime||points.at(-1)[0],
    provisionalLatest: Boolean(provisionalPoint),
    provisionalPoint,
    session,
    points
  };
}

function asiaShanghaiTimestamp(date, time) {
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return NaN;
  const year = Number(date.slice(0,4)), month = Number(date.slice(4,6)), day = Number(date.slice(6,8));
  const hour = Number(time.slice(0,2)), minute = Number(time.slice(2,4));
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

function shanghaiDateKey(timestamp) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(timestamp));
}

function sgeTradingDayKey(timestamp) {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const value=type=>Number(parts.find(part=>part.type===type)?.value),year=value("year"),month=value("month"),day=value("day"),hour=value("hour");
  return new Date(Date.UTC(year,month-1,day+(hour>=20?1:0))).toISOString().slice(0,10);
}

function eastmoneyRows(payload) {
  const rows=payload?.data?.klines;
  if(!Array.isArray(rows))throw new Error("东方财富 AU9999 行情响应中没有数据");
  return rows;
}

export function normalizeEastmoneyAuIntraday(payload,instrument,periodKey) {
  const parsed=sanitizeIntradayPoints(eastmoneyRows(payload).map(raw=>{
    const fields=String(raw).split(","),stamp=fields[0],value=Number(fields[2]),volume=Number(fields[5]);
    const [date,time]=stamp.split(" "),timestamp=asiaShanghaiTimestamp(date?.replaceAll("-",""),time?.replace(":",""));
    return[timestamp,value,volume];
  }),"SGE","Asia/Shanghai",{requirePositiveVolume:true});
  if(parsed.length<3)throw new Error("东方财富 AU9999 有效分时点不足");
  const keys=parsed.map(([time])=>sgeTradingDayKey(time)),unique=[...new Set(keys)],visibleKeys=periodKey==="1d"?unique.slice(-1):unique.slice(-5),firstIndex=keys.findIndex(key=>key===visibleKeys[0]);
  const points=parsed.slice(firstIndex).filter(([time])=>visibleKeys.includes(sgeTradingDayKey(time))).map(([time,value])=>[time,value]);
  const previousClose=firstIndex>0?parsed[firstIndex-1][1]:Number(payload?.data?.preKPrice)||points[0][1],last=points.at(-1),baseline=periodKey==="1d"?previousClose:points[0][1];
  const tradingDay=visibleKeys.at(-1),sessionStart=asiaShanghaiTimestamp(tradingDay.replaceAll("-",""),"0000")-4*60*60*1000,sessionEnd=asiaShanghaiTimestamp(tradingDay.replaceAll("-",""),"1530");
  return{symbol:instrument.symbol,name:instrument.name,market:"SGE",currency:"CNY",exchangeTimezone:"Asia/Shanghai",price:last[1],previousClose,change:last[1]-baseline,changePercent:(last[1]-baseline)/baseline*100,asOf:last[0],provisionalLatest:false,provisionalPoint:null,source:"东方财富 AU9999",session:periodKey==="1d"?{start:sessionStart,end:sessionEnd}:null,points};
}

export function normalizeEastmoneyAuDaily(payload,intradayPayload,instrument,periodKey,now=Date.now()) {
  const parsed=eastmoneyRows(payload).map(raw=>{const fields=String(raw).split(","),date=fields[0],value=Number(fields[2]);return[asiaShanghaiTimestamp(date.replaceAll("-",""),"1530"),value];}).filter(([time,value])=>Number.isFinite(time)&&Number.isFinite(value)&&value>0).sort((a,b)=>a[0]-b[0]);
  if(parsed.length<3)throw new Error("东方财富 AU9999 有效日线点不足");
  const anchor=parsed.at(-1)[0],cutoff=new Date(anchor);
  if(periodKey==="1mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-1);else if(periodKey==="6mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-6);else cutoff.setUTCFullYear(cutoff.getUTCFullYear()-(periodKey==="3y"?3:1));
  let firstIndex=parsed.findIndex(([time])=>time>=cutoff.getTime());if(firstIndex<1)firstIndex=1;
  const points=parsed.slice(firstIndex),previousClose=parsed[firstIndex-1][1];
  let provisionalLatest=false,provisionalPoint=null;
  try{
    const live=normalizeEastmoneyAuIntraday(intradayPayload,instrument,"1d"),lastDate=shanghaiDateKey(points.at(-1)[0]),liveDate=sgeTradingDayKey(live.asOf),nowKey=sgeTradingDayKey(now);
    const stillOpen=isTradableIntradayTimestamp(now,"SGE","Asia/Shanghai");
    if(liveDate===lastDate&&liveDate===nowKey&&stillOpen){points[points.length-1]=[live.asOf,live.price];provisionalLatest=true;provisionalPoint={time:live.asOf,value:live.price,source:"东方财富 AU9999 分时合成",kind:"in_progress"};}
  }catch{/* 日线仍可独立显示 */}
  const last=points.at(-1),baseline=points[0][1];
  return{symbol:instrument.symbol,name:instrument.name,market:"SGE",currency:"CNY",exchangeTimezone:"Asia/Shanghai",price:last[1],previousClose,change:last[1]-baseline,changePercent:(last[1]-baseline)/baseline*100,asOf:last[0],provisionalLatest,provisionalPoint,source:"东方财富 AU9999",session:null,points};
}

function a50TradingDayKey(timestamp){
  const date=shanghaiDateKey(timestamp),parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const hour=Number(parts.find(part=>part.type==="hour")?.value),minute=Number(parts.find(part=>part.type==="minute")?.value);
  if(hour*60+minute<17*60)return date;
  const [year,month,day]=date.split("-").map(Number);return new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);
}

export function normalizeEastmoneyA50Intraday(payload,instrument,periodKey,now=Date.now()){
  const parsed=sanitizeIntradayPoints(eastmoneyRows(payload).map(raw=>{const fields=String(raw).split(","),stamp=fields[0],value=Number(fields[2]),volume=Number(fields[5]);const [date,time]=stamp.split(" ");return[asiaShanghaiTimestamp(date?.replaceAll("-",""),time?.replace(":","")),value,volume];}),"SGX","Asia/Singapore",{requirePositiveVolume:true});
  if(parsed.length<3)throw new Error("东方财富 A50 期货有效分时点不足");
  const keys=parsed.map(([time])=>a50TradingDayKey(time)),unique=[...new Set(keys)],visibleKeys=periodKey==="1d"?unique.slice(-1):unique.slice(-5),firstIndex=keys.findIndex(key=>key===visibleKeys[0]);
  const points=parsed.slice(firstIndex).filter(([time])=>visibleKeys.includes(a50TradingDayKey(time))).map(([time,value])=>[time,value]);
  if(points.at(-1)[0]>now&&points.at(-1)[0]-now<=60*60*1000)points[points.length-1][0]=now;
  const previousClose=firstIndex>0?parsed[firstIndex-1][1]:Number(payload?.data?.preKPrice)||points[0][1],last=points.at(-1),baseline=periodKey==="1d"?previousClose:points[0][1],tradingDay=visibleKeys.at(-1);
  const sessionEnd=asiaShanghaiTimestamp(tradingDay.replaceAll("-",""),"1635"),sessionStart=sessionEnd-23*60*60*1000-35*60*1000;
  return{symbol:instrument.symbol,name:instrument.name,market:"SGX",currency:"USD",exchangeTimezone:"Asia/Singapore",price:last[1],previousClose,change:last[1]-baseline,changePercent:(last[1]-baseline)/baseline*100,asOf:last[0],provisionalLatest:false,provisionalPoint:null,source:"东方财富 A50 期货",session:periodKey==="1d"?{start:sessionStart,end:sessionEnd}:null,points};
}

export function normalizeEastmoneyA50Daily(payload,intradayPayload,instrument,periodKey,now=Date.now()){
  const parsed=eastmoneyRows(payload).map(raw=>{const fields=String(raw).split(","),date=fields[0],value=Number(fields[2]);return[asiaShanghaiTimestamp(date.replaceAll("-",""),"1635"),value];}).filter(([time,value])=>Number.isFinite(time)&&Number.isFinite(value)&&value>0).sort((a,b)=>a[0]-b[0]);
  if(parsed.length<3)throw new Error("东方财富 A50 期货有效日线点不足");
  const anchor=parsed.at(-1)[0],cutoff=new Date(anchor);if(periodKey==="1mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-1);else if(periodKey==="6mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-6);else cutoff.setUTCFullYear(cutoff.getUTCFullYear()-(periodKey==="3y"?3:1));
  let firstIndex=parsed.findIndex(([time])=>time>=cutoff.getTime());if(firstIndex<1)firstIndex=1;
  const points=parsed.slice(firstIndex),previousClose=parsed[firstIndex-1][1];let provisionalLatest=false,provisionalPoint=null;
  try{
    const live=normalizeEastmoneyA50Intraday(intradayPayload,instrument,"1d"),lastDate=shanghaiDateKey(points.at(-1)[0]),liveDate=a50TradingDayKey(live.asOf),nowDate=a50TradingDayKey(now);
    if(liveDate>=lastDate&&liveDate===nowDate&&isTradableIntradayTimestamp(now,"SGX","Asia/Singapore")){
      if(liveDate===lastDate)points[points.length-1]=[live.asOf,live.price];else points.push([live.asOf,live.price]);
      provisionalLatest=true;provisionalPoint={time:live.asOf,value:live.price,source:"东方财富 A50 分时合成",kind:"in_progress"};
    }
  }catch{/* 日线仍可独立显示 */}
  const last=points.at(-1),baseline=points[0][1];return{symbol:instrument.symbol,name:instrument.name,market:"SGX",currency:"USD",exchangeTimezone:"Asia/Singapore",price:last[1],previousClose,change:last[1]-baseline,changePercent:(last[1]-baseline)/baseline*100,asOf:last[0],provisionalLatest,provisionalPoint,source:"东方财富 A50 期货",session:null,points};
}

function parseJsonp(text) {
  const source=String(text||""),start=source.indexOf("{"),end=source.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("行情响应格式无效");
  return JSON.parse(source.slice(start,end+1));
}

export function normalizeThsIndustryLine(payloads,instrument,periodKey) {
  const rows=[];
  for(const payload of Array.isArray(payloads)?payloads:[payloads]){
    const data=parseJsonp(payload)?.data;
    if(typeof data!=="string")continue;
    for(const raw of data.split(";")){
      const fields=raw.split(","),date=fields[0],close=Number(fields[4]);
      const time=asiaShanghaiTimestamp(date,"1500");
      if(Number.isFinite(time)&&Number.isFinite(close)&&close>0)rows.push([time,close]);
    }
  }
  const parsed=[...new Map(rows.sort((a,b)=>a[0]-b[0]).map(point=>[point[0],point])).values()];
  if(parsed.length<3)throw new Error("同花顺行业日线有效价格点不足");
  const anchor=parsed.at(-1)[0],cutoff=new Date(anchor);let firstVisibleIndex=1;
  if(periodKey==="1d")firstVisibleIndex=parsed.length-1;
  else if(periodKey==="5d")firstVisibleIndex=Math.max(1,parsed.length-5);
  else{
    if(periodKey==="1mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-1);
    else if(periodKey==="6mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-6);
    else if(periodKey==="1y")cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);
    else if(periodKey==="3y")cutoff.setUTCFullYear(cutoff.getUTCFullYear()-3);
    const candidate=parsed.findIndex(([time])=>time>=cutoff.getTime());if(candidate>0)firstVisibleIndex=candidate;
  }
  let points=parsed.slice(firstVisibleIndex),previousClose=parsed[firstVisibleIndex-1][1];
  if(periodKey==="1d")points=[parsed[firstVisibleIndex-1],parsed[firstVisibleIndex]];
  const last=points.at(-1)[1],baseline=periodKey==="1d"?previousClose:points[0][1];
  return{symbol:instrument.symbol,name:instrument.name,market:"THS",currency:"CNY",exchangeTimezone:"Asia/Shanghai",price:last,previousClose,change:last-baseline,changePercent:(last-baseline)/baseline*100,asOf:points.at(-1)[0],resolution:"1d",provisionalLatest:false,provisionalPoint:null,session:null,points};
}

export function normalizeThsIndustryMinute(payload,instrument) {
  const root=parseJsonp(payload),data=typeof root.data==="string"?root:Object.values(root)[0]||root,date=String(data.date||data.lastDate||new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).replaceAll("-",""));
  const rows=String(data.data||"").split(";"),points=[];
  for(const raw of rows){const fields=raw.split(","),clock=String(fields[0]||"").replace(":",""),price=Number(fields[1]),time=asiaShanghaiTimestamp(date,clock);if(Number.isFinite(time)&&Number.isFinite(price)&&price>0&&!isDuringTradingBreak(time,"SSE","Asia/Shanghai"))points.push([time,price]);}
  if(points.length<2)throw new Error("同花顺行业分时有效价格点不足");
  const reportedPrevious=Number(data.pre||data.preClose||data.yestclose),previousClose=reportedPrevious>0?reportedPrevious:points[0][1],last=points.at(-1)[1];
  return{symbol:instrument.symbol,name:instrument.name,market:"THS",currency:"CNY",exchangeTimezone:"Asia/Shanghai",price:last,previousClose,change:last-previousClose,changePercent:(last-previousClose)/previousClose*100,asOf:points.at(-1)[0],provisionalLatest:false,provisionalPoint:null,session:{start:asiaShanghaiTimestamp(date,"0930"),end:asiaShanghaiTimestamp(date,"1500")},points};
}

export function normalizeSinaGlobalFutureLatest(payload,now=Date.now()){
  const rows=parseJsonp(payload)?.minLine_1d;
  if(!Array.isArray(rows)||rows.length===0)throw new Error("新浪全球期货分时响应中没有数据");
  const row=rows.at(-1),stamp=String(row.at(-1)||""),match=stamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/),firstRowShape=/^\d{4}-\d{2}-\d{2}$/.test(String(row[0])),price=Number(firstRowShape?row[5]:row[1]);
  if(!match||!Number.isFinite(price)||price<=0)throw new Error("新浪全球期货最新报价无效");
  let asOf=asiaShanghaiTimestamp(`${match[1]}${match[2]}${match[3]}`,`${match[4]}${match[5]}`);
  if(asOf>now&&asOf-now<=2*60_000)asOf=now;
  return{price,asOf};
}

export function normalizeTencentMinute(payload, instrument) {
  const entry = Object.values(payload?.data || {})[0];
  const date = entry?.data?.date;
  const rows = entry?.data?.data;
  const rawCode = instrument.symbol.split(".")[0];
  const sameCode=(left,right)=>/^\d+$/.test(String(left))&&/^\d+$/.test(String(right))?Number(left)===Number(right):String(left).toUpperCase()===String(right).toUpperCase();
  const quote = Object.entries(entry?.qt || {}).find(([,value]) => Array.isArray(value) && value.length > 30 && sameCode(value[2],rawCode))?.[1];
  if (!entry || !Array.isArray(rows) || !quote) throw new Error("腾讯分时响应中没有数据");

  const points = [];
  const sessionEnd = instrument.market === "HKEX" ? 16*60 : 15*60;
  for (const row of rows) {
    const [clock, rawPrice] = String(row).trim().split(/\s+/);
    const time = asiaShanghaiTimestamp(date, clock), value = Number(rawPrice),minute=Number(clock.slice(0,2))*60+Number(clock.slice(2,4));
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0 || minute<9*60+30 || minute>sessionEnd || isDuringTradingBreak(time,instrument.market,"Asia/Shanghai")) continue;
    points.push([time,value]);
  }
  if (points.length < 2) throw new Error("腾讯分时有效价格点不足");

  const previousClose = Number(quote[4]);
  const baseline = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : points[0][1];
  const last = points.at(-1)[1];
  const sessionEndClock = instrument.market === "HKEX" ? "1600" : "1500";
  return {
    symbol: instrument.symbol,
    name: instrument.name,
    market: instrument.market,
    currency: quote[82] || (instrument.market === "HKEX" ? "HKD" : "CNY"),
    exchangeTimezone: instrument.market === "HKEX" ? "Asia/Hong_Kong" : "Asia/Shanghai",
    price: last,
    previousClose: baseline,
    change: last - baseline,
    changePercent: ((last - baseline) / baseline) * 100,
    asOf: points.at(-1)[0],
    provisionalLatest: false,
    provisionalPoint: null,
    source: "腾讯证券公开分时",
    session: { start: asiaShanghaiTimestamp(date,"0930"), end: asiaShanghaiTimestamp(date,sessionEndClock) },
    points
  };
}

export function normalizeTencentKline(payload, instrument, periodKey, now=Date.now()) {
  const entry=Object.values(payload?.data||{})[0];
  const rows=entry?.day||entry?.qfqday;
  if(!entry||!Array.isArray(rows)||rows.length<3)throw new Error("腾讯日线响应中没有足够数据");
  const closeClock=instrument.market==="HKEX"?"1600":"1500";
  const parsed=rows.map(row=>[asiaShanghaiTimestamp(String(row[0]).replaceAll("-",""),closeClock),Number(row[2])]).filter(([time,value])=>Number.isFinite(time)&&Number.isFinite(value)&&value>0);
  if(parsed.length<3)throw new Error("腾讯日线有效价格点不足");
  const quote=Object.values(entry.qt||{}).find(value=>Array.isArray(value)&&value.length>30&&Number(value[3])>0&&String(value[30]||"").replace(/\D/g,"").length>=12);
  const stamp=String(quote?.[30]||"").replace(/\D/g,"");
  const quoteTime=stamp.length>=12?asiaShanghaiTimestamp(stamp.slice(0,8),stamp.slice(8,12)):NaN;
  const quotePrice=Number(quote?.[3]);
  const anchor=Number.isFinite(quoteTime)?quoteTime:parsed.at(-1)[0];
  let firstVisibleIndex=1;
  if(periodKey==="5d")firstVisibleIndex=Math.max(1,parsed.length-5);
  else{
    const cutoff=new Date(anchor);
    if(periodKey==="1mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-1);
    else if(periodKey==="6mo")cutoff.setUTCMonth(cutoff.getUTCMonth()-6);
    else if(periodKey==="1y")cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);
    else if(periodKey==="3y")cutoff.setUTCFullYear(cutoff.getUTCFullYear()-3);
    const candidate=parsed.findIndex(([time])=>time>=cutoff.getTime());
    if(candidate>0)firstVisibleIndex=candidate;
  }
  const previousClose=parsed[firstVisibleIndex-1][1],points=parsed.slice(firstVisibleIndex);
  if(points.length<2)throw new Error("腾讯日线可见区间价格点不足");
  const lastDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date(points.at(-1)[0]));
  const quoteDate=Number.isFinite(quoteTime)?new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date(quoteTime)):"";
  const sessionStart=quoteDate?asiaShanghaiTimestamp(quoteDate.replaceAll("-",""),"0930"):NaN;
  const sessionEnd=quoteDate?asiaShanghaiTimestamp(quoteDate.replaceAll("-",""),closeClock):NaN;
  const isInProgress=quoteDate===lastDate&&Number.isFinite(quotePrice)&&quotePrice>0
    &&quoteTime>=sessionStart&&quoteTime<sessionEnd&&now>=sessionStart&&now<sessionEnd;
  const observationTime=isInProgress?clampToLastTradingTime(quoteTime,instrument.market,"Asia/Shanghai"):points.at(-1)[0];
  if(isInProgress)points[points.length-1]=[observationTime,quotePrice];
  const last=points.at(-1)[1],baseline=periodKey==="1d"?previousClose:points[0][1];
  return{symbol:instrument.symbol,name:instrument.name,market:instrument.market,currency:quote?.[82]||(instrument.market==="HKEX"?"HKD":"CNY"),exchangeTimezone:instrument.market==="HKEX"?"Asia/Hong_Kong":"Asia/Shanghai",price:last,previousClose,change:last-baseline,changePercent:(last-baseline)/baseline*100,asOf:points.at(-1)[0],provisionalLatest:isInProgress,provisionalPoint:isInProgress?{time:observationTime,value:last,source:"腾讯证券盘中日 K",kind:"in_progress"}:null,session:null,points};
}

export function mergeProvisionalIntraday(daily, intraday) {
  if (!daily?.provisionalLatest || !Array.isArray(daily.points) || daily.points.length < 2 || !Number.isFinite(intraday?.asOf) || !Number.isFinite(intraday?.price)) return daily;
  const timeZone = daily.exchangeTimezone || intraday.exchangeTimezone || "UTC";
  const dateKey = value => new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value));
  const points = daily.points.map(point => [...point]);
  if (dateKey(points.at(-1)[0]) === dateKey(intraday.asOf)) points[points.length-1][1] = intraday.price;
  else points.push([intraday.asOf,intraday.price]);
  const baseline = points[0][1];
  return {
    ...daily,
    points,
    price:intraday.price,
    change:intraday.price-baseline,
    changePercent:((intraday.price-baseline)/baseline)*100,
    asOf:intraday.asOf,
    provisionalLatest:true,
    provisionalPoint:{ time:intraday.asOf, value:intraday.price, source:"腾讯证券实时分时合成", kind:"in_progress" }
  };
}

export function mergeSyntheticDxy(data,synthetic,periodKey){
  if(!data||!Number.isFinite(synthetic?.price)||synthetic.price<=0||!Number.isFinite(synthetic?.asOf)||synthetic.asOf<=data.asOf)return data;
  const points=data.points.map(point=>[...point]),timeZone=data.exchangeTimezone||"America/New_York";
  const dateKey=value=>new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  if(PERIODS[periodKey]?.interval==="1d"&&dateKey(points.at(-1)[0])===dateKey(synthetic.asOf))points[points.length-1]=[synthetic.asOf,synthetic.price];
  else points.push([synthetic.asOf,synthetic.price]);
  const baseline=periodKey==="1d"?Number(data.previousClose||points[0][1]):points[0][1];
  return{...data,points,price:synthetic.price,change:synthetic.price-baseline,changePercent:(synthetic.price-baseline)/baseline*100,asOf:synthetic.asOf,syntheticLatest:true,syntheticSource:"ICE 六货币公式实时合成"};
}

export function mergeLatestQuote(data,latest,periodKey,source){
  if(!data||!Number.isFinite(latest?.price)||latest.price<=0||!Number.isFinite(latest?.asOf)||latest.asOf<=data.asOf)return data;
  const points=data.points.map(point=>[...point]),timeZone=data.exchangeTimezone||"UTC",dateKey=value=>new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  const daily=PERIODS[periodKey]?.interval==="1d";
  if(daily&&dateKey(points.at(-1)[0])===dateKey(latest.asOf))points[points.length-1]=[latest.asOf,latest.price];else points.push([latest.asOf,latest.price]);
  const baseline=periodKey==="1d"?Number(data.previousClose||points[0][1]):points[0][1];
  return{...data,points,price:latest.price,change:latest.price-baseline,changePercent:(latest.price-baseline)/baseline*100,asOf:latest.asOf,provisionalLatest:daily?true:data.provisionalLatest,provisionalPoint:daily?{time:latest.asOf,value:latest.price,source,kind:"in_progress"}:data.provisionalPoint,latestSupplementSource:source};
}

export function isPeriod(value) {
  return Object.hasOwn(PERIODS, value);
}

const SYMBOL_PATTERN = /^[A-Z0-9^.=\-]{1,20}$/;

export function normalizeSymbolInput(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^\d{6}$/.test(symbol)) return symbol;
  if (/^(688|689|600|601|603|605|900)/.test(symbol)) return `${symbol}.SS`;
  if (/^[0123]/.test(symbol)) return `${symbol}.SZ`;
  if (/^[489]/.test(symbol)) return `${symbol}.BJ`;
  return symbol;
}

export function inferSymbolMarket(symbol) {
  const special={"^SOX":"NASDAQ","^NDX":"NASDAQ","^GSPC":"NYSE","^TWII":"TWSE","^N225":"TSE","^KS11":"KRX","^TNX":"CBOE","DX-Y.NYB":"NYB","GC=F":"COMEX","CL=F":"NYMEX","BTC-USD":"CRYPTO","881121.TI":"THS","AU9999":"SGE","CN00Y":"SGX"};
  return special[symbol] || (symbol.startsWith("^") ? "INDEX"
    : symbol.endsWith(".KS") ? "KRX"
    : symbol.endsWith(".T") ? "TSE"
    : symbol.endsWith(".HK") ? "HKEX"
    : symbol.endsWith(".SS") ? "SSE"
    : symbol.endsWith(".SZ") ? "SZSE"
    : symbol.endsWith(".BJ") ? "BSE"
    : "CUSTOM");
}

export function resolveInstruments(rawSymbols) {
  if (!rawSymbols) return [...INSTRUMENTS];
  const symbols = [...new Set(rawSymbols.split(",").map(normalizeSymbolInput).filter(Boolean))];
  if (symbols.length === 0 || symbols.length > 48) throw new Error("股票代码数量必须为 1–48 个");
  if (symbols.some(symbol => !SYMBOL_PATTERN.test(symbol))) throw new Error("股票代码格式无效");
  const known = new Map([...INSTRUMENTS,{symbol:"AU9999",name:"黄金9999",market:"SGE"},{symbol:"CN00Y",name:"富时中国 A50 期货",market:"SGX"}].map(item => [item.symbol, item]));
  return symbols.map(symbol => known.get(symbol) || {
    symbol,
    name: symbol,
    market: inferSymbolMarket(symbol)
  });
}

export function normalizeYahooQuotes(payload) {
  const error = payload?.quoteResponse?.error;
  if (error) throw new Error(error.description || "市值响应错误");
  const quotes = Array.isArray(payload?.quoteResponse?.result) ? payload.quoteResponse.result : [];
  return new Map(quotes.map(quote => {
    const value = Number(quote.marketCap);
    return [quote.symbol, {
      marketCap: Number.isFinite(value) && value > 0 ? value : null,
      marketCapCurrency: quote.currency || null,
      marketCapStatus: quote.quoteType === "INDEX" ? "not_applicable" : Number.isFinite(value) && value > 0 ? "available" : "unavailable",
      regularMarketPrice: Number.isFinite(Number(quote.regularMarketPrice)) ? Number(quote.regularMarketPrice) : null
    }];
  }));
}

export function sortByMarketCapUsd(instruments, marketCaps) {
  return instruments.map((item,index) => ({ item,index,cap:marketCaps.get(item.symbol) }))
    .sort((a,b) => (b.cap?.marketCapUsd ?? -1) - (a.cap?.marketCapUsd ?? -1) || a.index - b.index);
}
