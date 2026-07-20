const HOLIDAYS_2026={
  CN:new Set(["2026-01-01","2026-01-02","2026-01-05","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-23","2026-04-06","2026-05-01","2026-05-04","2026-05-05","2026-06-19","2026-10-01","2026-10-02","2026-10-05","2026-10-06","2026-10-07"]),
  JP:new Set(["2026-01-01","2026-01-02","2026-01-12","2026-02-11","2026-02-23","2026-03-20","2026-04-29","2026-05-04","2026-05-05","2026-05-06","2026-07-20","2026-08-11","2026-09-21","2026-09-22","2026-09-23","2026-10-12","2026-11-03","2026-11-23","2026-12-31"]),
  KR:new Set(["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-02","2026-05-01","2026-05-05","2026-05-25","2026-06-03","2026-08-17","2026-09-24","2026-09-25","2026-09-26","2026-10-05","2026-10-09","2026-12-25","2026-12-31"])
};

const countryForMarket={SSE:"CN",SZSE:"CN",BSE:"CN",THS:"CN",TSE:"JP",KRX:"KR"};
const dateInZone=(time,timeZone)=>new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"}).formatToParts(new Date(time));

export function marketClosedToday(market,now=Date.now()){
  const country=countryForMarket[market];
  if(!country)return null;
  const timeZone=country==="JP"?"Asia/Tokyo":country==="KR"?"Asia/Seoul":"Asia/Shanghai",parts=dateInZone(now,timeZone),value=type=>parts.find(part=>part.type===type)?.value;
  const date=`${value("year")}-${value("month")}-${value("day")}`,weekday=value("weekday");
  if(["Sat","Sun"].includes(weekday)||HOLIDAYS_2026[country]?.has(date))return "本日休市";
  return null;
}
