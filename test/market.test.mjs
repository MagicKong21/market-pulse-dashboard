import test from "node:test";
import assert from "node:assert/strict";
import { INSTRUMENTS, inferSymbolMarket, isPeriod, isTradableIntradayTimestamp, mergeLatestQuote, mergeProvisionalIntraday, mergeSyntheticDxy, normalizeEastmoneyA50Daily, normalizeEastmoneyA50Intraday, normalizeEastmoneyAuDaily, normalizeEastmoneyAuIntraday, normalizeEastmoneyBreadth, normalizeEastmoneyGlobal, normalizeEastmoneyTwii, normalizeSinaA50Daily, normalizeSinaA50Minute, normalizeSinaAuHistory, normalizeSinaGlobalFutureLatest, normalizeSinaUsKline, normalizeSymbolInput, normalizeTencentKline, normalizeTencentMinute, normalizeThsIndustryLine, normalizeThsIndustryMinute, normalizeTwseIndexHistory, normalizeYahooChart, normalizeYahooQuotes, resolveInstruments, sanitizeIntradayPoints, sortByMarketCapUsd } from "../market.mjs";

const fixture = { chart: { result: [{ meta: { currency: "USD", chartPreviousClose: 90, exchangeTimezoneName: "America/New_York", currentTradingPeriod: { regular: { start: 100, end: 110 } }, tradingPeriods: [[{ start: 1, end: 10 }]] }, timestamp: [3, 1, 2, 4], indicators: { quote: [{ close: [110, 100, null, 120] }] } }] } };

test("海外默认名单与截图的 18 个标的及顺序一致", () => {
  const expected=["NVDA","AAPL","GOOGL","MSFT","AMZN","TSM","SPCX","AVGO","META","TSLA","005930.KS","MU","000660.KS","AMD","ASML","INTC","SNDK","WDC"];
  assert.deepEqual(INSTRUMENTS.map(item=>item.symbol),expected);
  assert.equal(new Set(INSTRUMENTS.map(item => item.symbol)).size, 18);
  assert.ok(INSTRUMENTS.some(item => item.market === "KRX"));
  assert.equal(INSTRUMENTS.find(item=>item.symbol==="SPCX")?.name,"SpaceX");
  assert.equal(INSTRUMENTS.find(item=>item.symbol==="SNDK")?.name,"闪迪公司");
  assert.equal(INSTRUMENTS.find(item=>item.symbol==="WDC")?.name,"西部数据");
});

test("统一交易时段清洗器剔除周末伪夜盘但保留真实横盘",()=>{
  const at=value=>Date.parse(value),rows=[
    [at("2026-07-03T07:30:00Z"),910,3], // 周五 15:30，日盘
    [at("2026-07-03T12:05:00Z"),910,9], // 周五 20:05，伪夜盘
    [at("2026-07-06T01:05:00Z"),911,2],
    [at("2026-07-06T01:10:00Z"),911,4]  // 真实成交但价格不变
  ];
  const clean=sanitizeIntradayPoints(rows,"SGE","Asia/Shanghai",{requirePositiveVolume:true});
  assert.deepEqual(clean.map(row=>row[0]),[rows[0][0],rows[2][0],rows[3][0]]);
  assert.equal(clean.at(-1)[1],clean.at(-2)[1]);
  assert.equal(isTradableIntradayTimestamp(rows[1][0],"SGE","Asia/Shanghai"),false);
});

test("美国期货仅接受周日至周五的真实周交易窗口",()=>{
  assert.equal(isTradableIntradayTimestamp(Date.parse("2026-07-05T22:00:00Z"),"COMEX","America/New_York"),true);
  assert.equal(isTradableIntradayTimestamp(Date.parse("2026-07-04T16:00:00Z"),"COMEX","America/New_York"),false);
  assert.equal(isTradableIntradayTimestamp(Date.parse("2026-07-03T22:30:00Z"),"COMEX","America/New_York"),false);
});

test("标准化会过滤空点、排序，并用前收计算当日涨跌", () => {
  const result = normalizeYahooChart(fixture, INSTRUMENTS[0], "1d");
  assert.deepEqual(result.points, [[1000, 100], [3000, 110], [4000, 120]]);
  assert.equal(result.price, 120);
  assert.equal(result.previousClose, 90);
  assert.ok(Math.abs(result.changePercent - 100 / 3) < 1e-10);
  assert.deepEqual(result.session, { start: 1000, end: 10000 });
});

test("Yahoo 盘中不会显示未来 K 线时间",()=>{
  const now=Date.parse("2026-07-02T01:59:00Z"),past=Date.parse("2026-07-02T01:50:00Z"),last=Date.parse("2026-07-02T01:55:00Z"),future=Date.parse("2026-07-02T02:00:00Z");
  const payload={chart:{result:[{meta:{currency:"CNY",exchangeTimezoneName:"Asia/Shanghai",chartPreviousClose:100},timestamp:[past/1000,last/1000,future/1000],indicators:{quote:[{close:[100,101,102]}]}}]}};
  const result=normalizeYahooChart(payload,{symbol:"000001.SS",name:"上证指数",market:"SSE"},"1d",now);
  assert.equal(result.points.at(-1)[0],last);assert.ok(result.asOf<=now);
});

test("未开盘时使用包含行情点的上一交易日，而非即将开盘时段", () => {
  const result = normalizeYahooChart(fixture, INSTRUMENTS[0], "1d");
  assert.deepEqual(result.session, { start:1000, end:10000 });
  assert.notDeepEqual(result.session, { start:100000, end:110000 });
});

test("非当日周期用首个有效点作基准", () => {
  const result = normalizeYahooChart(fixture, INSTRUMENTS[0], "1mo");
  assert.equal(result.changePercent, 20);
  assert.equal(result.session, null);
});

test("月年视图使用日 K 收盘价而非开盘价", () => {
  const daily={chart:{result:[{
    meta:{currency:"USD",exchangeTimezoneName:"America/New_York",chartPreviousClose:90},
    timestamp:[1782739800,1782826200],
    indicators:{quote:[{open:[10,20],close:[100,110]}]}
  }]}};
  const result=normalizeYahooChart(daily,INSTRUMENTS[0],"1mo");
  assert.deepEqual(result.points.map(point=>point[1]),[100,110]);
  assert.equal(result.price,110);
});

test("近三年从五年日线中精确截取并保留区间前收",()=>{
  const years=[2021,2022,2023,2024,2025,2026],timestamps=years.map(year=>Date.UTC(year,6,1,13,30)/1000),closes=years.map((_,index)=>100+index);
  const payload={chart:{result:[{meta:{currency:"USD",exchangeTimezoneName:"America/New_York",chartPreviousClose:90},timestamp:timestamps,indicators:{quote:[{close:closes}]}}]}};
  const result=normalizeYahooChart(payload,INSTRUMENTS[0],"3y");
  assert.deepEqual(result.points.map(point=>new Date(point[0]).getUTCFullYear()),[2023,2024,2025,2026]);
  assert.equal(result.previousClose,101);
});

test("正在交易的当日日 K 标为盘中并使用真实报价时间", () => {
  const seconds=value=>Date.parse(value)/1000;
  const quoteTime=seconds("2026-07-02T02:15:00Z");
  const daily={chart:{result:[{
    meta:{currency:"CNY",exchangeTimezoneName:"Asia/Shanghai",chartPreviousClose:100,regularMarketTime:quoteTime,regularMarketPrice:108,currentTradingPeriod:{regular:{start:seconds("2026-07-02T01:30:00Z"),end:seconds("2026-07-02T07:00:00Z")}}},
    timestamp:[seconds("2026-07-01T01:30:00Z"),seconds("2026-07-02T01:30:00Z")],
    indicators:{quote:[{close:[105,108]}]}
  }]}};
  const result=normalizeYahooChart(daily,{symbol:"601138.SS",name:"工业富联",market:"SSE"},"1mo",seconds("2026-07-02T02:16:00Z")*1000);
  assert.equal(result.provisionalLatest,true);
  assert.equal(result.provisionalPoint.kind,"in_progress");
  assert.equal(result.asOf,quoteTime*1000);
  assert.equal(result.price,108);
  assert.equal(result.points.length,2);
});

test("午休期间的日 K 报价心跳回落到最后交易时刻", () => {
  const seconds=value=>Date.parse(value)/1000;
  const quoteTime=seconds("2026-07-02T04:51:17Z");
  const daily={chart:{result:[{
    meta:{currency:"CNY",exchangeTimezoneName:"Asia/Shanghai",chartPreviousClose:100,regularMarketTime:quoteTime,regularMarketPrice:108,currentTradingPeriod:{regular:{start:seconds("2026-07-02T01:30:00Z"),end:seconds("2026-07-02T07:00:00Z")}}},
    timestamp:[seconds("2026-07-01T01:30:00Z"),seconds("2026-07-02T01:30:00Z")],
    indicators:{quote:[{close:[105,108]}]}
  }]}};
  const result=normalizeYahooChart(daily,{symbol:"300308.SZ",name:"中际旭创",market:"SZSE"},"1mo",seconds("2026-07-02T04:52:00Z")*1000);
  assert.equal(new Date(result.asOf).toISOString(),"2026-07-02T03:30:00.000Z");
  assert.equal(result.price,108);
  assert.equal(result.provisionalPoint.kind,"in_progress");
});

test("月年视图的当天临时点由实时分时更新，正式历史点不变", () => {
  const daily={exchangeTimezone:"Asia/Shanghai",points:[[1,100],[2,108]],price:108,change:8,changePercent:8,asOf:2,provisionalLatest:true,provisionalPoint:{kind:"in_progress"}};
  const intraday={exchangeTimezone:"Asia/Shanghai",asOf:Date.parse("2026-07-02T05:10:00Z"),price:111};
  daily.points[1][0]=Date.parse("2026-07-02T01:30:00Z");
  const result=mergeProvisionalIntraday(daily,intraday);
  assert.deepEqual(result.points.map(point=>point[1]),[100,111]);
  assert.equal(result.price,111);
  assert.equal(result.asOf,intraday.asOf);
  assert.equal(result.provisionalPoint.source,"腾讯证券实时分时合成");
  assert.equal(result.changePercent,11);

  const official=mergeProvisionalIntraday({...daily,provisionalLatest:false},intraday);
  assert.equal(official.price,108);
});

test("多日周期的前收取整个可见区间开始前的收盘价", () => {
  const multiDay = { chart:{ result:[{
    meta:{ currency:"USD", chartPreviousClose:50, exchangeTimezoneName:"America/New_York" },
    timestamp:[1782739800,1782761400,1782826200,1782847800,1782912600],
    indicators:{ quote:[{ close:[100,105,110,112,120] }] }
  }] } };
  const result = normalizeYahooChart(multiDay, INSTRUMENTS[0], "5d");
  assert.equal(result.previousClose, 50);
  assert.notEqual(result.previousClose, 112);
});

test("近五日期货严格保留最后五个交易会话并去掉重复的实时心跳横线",()=>{
  const timestamps=[],closes=[];
  const firstStart=Date.parse("2026-06-24T22:00:00Z");
  for(let index=0;index<7;index++){
    const start=firstStart+index*86_400_000;
    timestamps.push(start/1000,(start+22.5*3_600_000)/1000);
    closes.push(100+index*2,101+index*2);
  }
  timestamps.push(Date.parse("2026-07-01T22:00:00Z")/1000,Date.parse("2026-07-02T08:00:00Z")/1000,Date.parse("2026-07-02T08:13:00Z")/1000);
  closes.push(150,151,151);
  const payload={chart:{result:[{meta:{currency:"USD",exchangeTimezoneName:"America/New_York",chartPreviousClose:50},timestamp:timestamps,indicators:{quote:[{close:closes}]}}]}};
  const result=normalizeYahooChart(payload,{symbol:"GC=F",name:"国际黄金",market:"COMEX"},"5d");
  assert.equal(new Date(result.points[0][0]).toISOString(),"2026-06-25T22:00:00.000Z");
  assert.equal(result.previousClose,101);
  assert.equal(result.points.at(-1)[0],Date.parse("2026-07-02T08:00:00Z"));
  assert.equal(result.asOf,Date.parse("2026-07-02T08:13:00Z"));
});

test("Yahoo 近五日用同响应最新报价补上滞后的分钟柱",()=>{
  const seconds=value=>Date.parse(value)/1000,timestamps=["2026-07-02T22:00:00Z","2026-07-03T03:30:00Z"].map(seconds),closes=[4100,4188.5],quoteTime=seconds("2026-07-03T07:51:00Z");
  const payload={chart:{result:[{meta:{currency:"USD",exchangeTimezoneName:"America/New_York",chartPreviousClose:4050,regularMarketTime:quoteTime,regularMarketPrice:4194.6},timestamp:timestamps,indicators:{quote:[{close:closes}]}}]}};
  const result=normalizeYahooChart(payload,{symbol:"GC=F",name:"国际黄金",market:"COMEX"},"5d");
  assert.equal(result.asOf,quoteTime*1000);assert.equal(result.price,4194.6);assert.equal(result.points.at(-1)[1],4194.6);
});

test("东方财富日韩分时解析并拒绝未来时间",()=>{
  const now=Date.parse("2026-07-13T03:00:00Z"),payload={data:{preKPrice:7000,klines:["2026-07-13 11:55,7001,7002,7003,7000,10","2026-07-13 12:00,7002,7004,7005,7001,10","2026-07-13 12:05,7004,7006,7007,7003,10"]}};
  const result=normalizeEastmoneyGlobal(payload,{symbol:"^KS11",name:"KOSPI",market:"KRX"},"1d",now);
  assert.equal(result.source,"东方财富KOSPI分时备用");assert.equal(result.points.at(-1)[0],Date.parse("2026-07-13T03:00:00Z"));assert.ok(result.asOf<=now);
});

test("东方财富指数涨跌家数计算上涨比例",()=>{
  const result=normalizeEastmoneyBreadth({data:{diff:[{f104:436,f105:1849,f106:23}]}});
  assert.deepEqual(result,{breadthUp:436,breadthDown:1849,breadthFlat:23,breadthTotal:2308,breadthUpPercent:436/2308*100,breadthSource:"东方财富"});
  assert.equal(normalizeEastmoneyBreadth({data:{diff:[{f104:0,f105:0,f106:0}]}}),null);
});

test("Yahoo 收盘后报价心跳的时间不得超过交易时段终点",()=>{
  const seconds=value=>Date.parse(value)/1000,end=seconds("2026-07-03T07:00:00Z"),payload={chart:{result:[{meta:{currency:"CNY",exchangeTimezoneName:"Asia/Shanghai",chartPreviousClose:3900,regularMarketTime:seconds("2026-07-03T07:50:00Z"),regularMarketPrice:4019,currentTradingPeriod:{regular:{start:seconds("2026-07-03T01:30:00Z"),end}}},timestamp:[seconds("2026-07-02T07:00:00Z"),end],indicators:{quote:[{close:[3990,4018]}]}}]}};
  const result=normalizeYahooChart(payload,{symbol:"399006.SZ",name:"创业板",market:"SZSE"},"5d");assert.equal(result.asOf,end*1000);assert.equal(result.points.at(-1)[0],end*1000);assert.equal(result.price,4019);
});

test("新浪纽约黄金最新分钟报价解析并补到近五日尾部",()=>{
  const payload='var _DATA=({"minLine_1d":[["2026-07-03","4125.7","x","","06:00","4138.0","0","0","0","2026-07-03 06:00:00"],["15:58","4190.322","0","0","4181.430","2026-07-03 15:58:00"]]});',latest=normalizeSinaGlobalFutureLatest(payload,Date.parse("2026-07-03T08:00:00Z"));
  assert.equal(latest.price,4190.322);assert.equal(new Date(latest.asOf).toISOString(),"2026-07-03T07:58:00.000Z");
  const data={exchangeTimezone:"America/New_York",points:[[Date.parse("2026-07-03T03:30:00Z"),4188.5]],price:4188.5,previousClose:4100,change:88.5,changePercent:2,asOf:Date.parse("2026-07-03T03:30:00Z")};
  const merged=mergeLatestQuote(data,latest,"5d","新浪纽约黄金分钟报价");assert.equal(merged.points.length,2);assert.equal(merged.price,4190.322);assert.equal(merged.asOf,latest.asOf);
});

test("新浪美股日线可在 Yahoo 失效时生成完整备用行情",()=>{
  const payload='var _DATA=([{"d":"2026-07-08","c":"310.00"},{"d":"2026-07-09","c":"312.00"},{"d":"2026-07-10","c":"315.00"}]);';
  const result=normalizeSinaUsKline(payload,{symbol:"AAPL",name:"苹果",market:"NASDAQ"},"5d");
  assert.equal(result.source,"新浪美股日线备用");
  assert.equal(result.price,315);
  assert.equal(result.previousClose,310);
  assert.equal(result.points.length,2);
});

test("新浪 Au99.99 历史下载可作为黄金9999备用",()=>{
  const payload="日期\t合约\t开盘\t最高\t最低\t收盘\n2026-07-10\tAu99.99\t899\t904\t896\t897.20\n2026-07-09\tAu99.99\t892\t899\t883\t899.00\n2026-07-08\tAu99.99\t900\t902\t895\t901.50";
  const result=normalizeSinaAuHistory(payload,{symbol:"AU9999",name:"黄金9999",market:"SGE"},"5d");
  assert.equal(result.source,"新浪 Au99.99 历史行情备用");
  assert.equal(result.price,897.2);
  assert.equal(result.points.length,2);
});

test("新浪 A50 分时和日线均可独立生成备用行情",()=>{
  const minute='var _DATA=({"minLine_1d":[["2026-07-11","14962.000","sgxq","","17:00","14939.460","0","0","0","2026-07-10 17:00:00"],["17:01","14943.900","0","0","0","2026-07-10 17:01:00"],["17:02","14948.240","0","0","0","2026-07-10 17:02:00"]]});';
  const instrument={symbol:"CN00Y",name:"富时中国 A50 期货",market:"SGX"};
  const intraday=normalizeSinaA50Minute(minute,instrument);
  assert.equal(intraday.price,14948.24);
  assert.equal(intraday.previousClose,14939.46);
  const daily='var _DATA=([{"date":"2026-07-08","close":"14800"},{"date":"2026-07-09","close":"14900"},{"date":"2026-07-10","close":"14948.24"}]);';
  const history=normalizeSinaA50Daily(daily,instrument,"5d");
  assert.equal(history.source,"新浪 A50 期货日线备用");
  assert.equal(history.price,14948.24);
});

test("台交所官方月度指数数据可作为台湾加权备用",()=>{
  const payload={stat:"OK",data:[["115/07/08","1","1","1","45,100.00"],["115/07/09","1","1","1","45,200.00"],["115/07/10","1","1","1","45,354.61"]]};
  const result=normalizeTwseIndexHistory(payload,{symbol:"^TWII",name:"台湾加权",market:"TWSE"},"5d");
  assert.equal(result.source,"台湾证券交易所指数日线备用");
  assert.equal(result.price,45354.61);
});

test("东方财富分钟线可作为台湾加权的第一备用",()=>{
  const payload={data:{preKPrice:45200,klines:["2026-07-10 09:00,45210,45210,45210,45210,1","2026-07-10 09:05,45210,45300,45300,45210,1","2026-07-10 09:10,45300,45354.61,45360,45290,1"]}};
  const result=normalizeEastmoneyTwii(payload,{symbol:"^TWII",name:"台湾加权",market:"TWSE"},"1d");
  assert.equal(result.source,"东方财富台湾加权分时备用");
  assert.equal(result.price,45354.61);
  assert.equal(result.previousClose,45200);
});

test("美元指数用六货币合成值补上官方延迟尾点",()=>{
  const official={exchangeTimezone:"America/New_York",points:[[1000,100],[2000,101]],price:101,previousClose:99,change:2,changePercent:2,asOf:2000};
  const result=mergeSyntheticDxy(official,{price:102,asOf:3000},"5d");
  assert.deepEqual(result.points.at(-1),[3000,102]);
  assert.equal(result.price,102);assert.equal(result.syntheticLatest,true);assert.equal(result.syntheticSource,"ICE 六货币公式实时合成");
});

test("日线缺少最新交易日时追加临时报价且正式日线优先", () => {
  const seconds = value => Date.parse(value) / 1000;
  const delayedDaily = { chart:{ result:[{
    meta:{ currency:"KRW", exchangeTimezoneName:"Asia/Seoul", chartPreviousClose:90, regularMarketTime:seconds("2026-07-01T06:30:00Z"), regularMarketPrice:120 },
    timestamp:[seconds("2026-06-29T00:00:00Z"),seconds("2026-06-30T00:00:00Z")],
    indicators:{ quote:[{ close:[100,110] }] }
  }] } };
  const supplemented = normalizeYahooChart(delayedDaily, INSTRUMENTS[0], "1mo");
  assert.equal(supplemented.provisionalLatest, true);
  assert.deepEqual(supplemented.points.at(-1), [seconds("2026-07-01T06:30:00Z")*1000,120]);
  assert.equal(supplemented.price,120);

  delayedDaily.chart.result[0].timestamp.push(seconds("2026-07-01T00:00:00Z"));
  delayedDaily.chart.result[0].indicators.quote[0].close.push(119);
  const official = normalizeYahooChart(delayedDaily, INSTRUMENTS[0], "1mo");
  assert.equal(official.provisionalLatest, false);
  assert.equal(official.points.length,3);
  assert.equal(official.price,119);

  const intraday = normalizeYahooChart(delayedDaily, INSTRUMENTS[0], "5d");
  assert.equal(intraday.provisionalLatest,false);
});

test("A 股分钟线统一剔除午休期间的供应商填充点", () => {
  const seconds = value => Date.parse(value) / 1000;
  const lunchFilled = { chart:{ result:[{
    meta:{ currency:"CNY", exchangeTimezoneName:"Asia/Shanghai", chartPreviousClose:90 },
    timestamp:["2026-07-01T03:25:00Z","2026-07-01T03:30:00Z","2026-07-01T03:35:00Z","2026-07-01T04:00:00Z","2026-07-01T04:55:00Z","2026-07-01T05:00:00Z","2026-07-01T05:05:00Z"].map(seconds),
    indicators:{ quote:[{ close:[99,100,100,100,100,101,102] }] }
  }] } };
  const result = normalizeYahooChart(lunchFilled, { symbol:"300308.SZ",name:"中际旭创",market:"SZSE" }, "1d");
  assert.deepEqual(result.points.map(point=>point[0]),[
    seconds("2026-07-01T03:25:00Z")*1000,
    seconds("2026-07-01T03:30:00Z")*1000,
    seconds("2026-07-01T05:00:00Z")*1000,
    seconds("2026-07-01T05:05:00Z")*1000
  ]);
});

test("腾讯分时后备源解析当天 A 股并过滤午休", () => {
  const quote=Array(83).fill("");quote[1]="工业富联";quote[2]="601138";quote[4]="70.00";quote[82]="CNY";
  const payload={data:{sh601138:{data:{date:"20260702",data:["0930 67.46 1 1","0931 66.82 1 1","1131 66.00 1 1","1301 65.90 1 1"]},qt:{sh601138:quote}}}};
  const result=normalizeTencentMinute(payload,{symbol:"601138.SS",name:"工业富联",market:"SSE"});
  assert.equal(result.source,"腾讯证券公开分时");
  assert.equal(result.previousClose,70);
  assert.equal(result.points.length,3);
  assert.equal(new Date(result.asOf).toISOString(),"2026-07-02T05:01:00.000Z");
  assert.equal(result.changePercent,((65.9-70)/70)*100);
});

test("腾讯港股分时剔除收盘后的报价心跳", () => {
  const quote=Array(83).fill("");quote[2]="0700";quote[4]="420";quote[82]="HKD";
  const payload={data:{hk00700:{data:{date:"20260702",data:["1559 430 1 1","1600 431 1 1","1608 431 1 1"]},qt:{hk00700:quote}}}};
  const result=normalizeTencentMinute(payload,{symbol:"0700.HK",name:"腾讯控股",market:"HKEX"});
  assert.equal(result.points.length,2);
  assert.equal(new Date(result.asOf).toISOString(),"2026-07-02T08:00:00.000Z");
});

test("大盘代码识别到各自市场",()=>{
  assert.equal(inferSymbolMarket("^TWII"),"TWSE");
  assert.equal(inferSymbolMarket("^TNX"),"CBOE");
  assert.equal(inferSymbolMarket("GC=F"),"COMEX");
  assert.equal(inferSymbolMarket("BTC-USD"),"CRYPTO");
  assert.equal(inferSymbolMarket("881121.TI"),"THS");
  assert.equal(inferSymbolMarket("AU9999"),"SGE");
  assert.equal(inferSymbolMarket("CN00Y"),"SGX");
});

test("东方财富 A50 期货按跨夜交易日取值并剔除休市点",()=>{
  const klines=[
    "2026-06-30 17:00,100,100,100,100,8",
    "2026-07-01 16:30,101,101,101,101,9",
    "2026-07-01 17:00,102,102,102,102,10",
    "2026-07-02 05:15,103,103,103,103,11",
    "2026-07-02 08:00,999,999,999,999,99",
    "2026-07-02 09:00,104,104,104,104,12",
    "2026-07-02 16:30,105,105,105,105,13"
  ];
  const result=normalizeEastmoneyA50Intraday({data:{klines,preKPrice:99}},{symbol:"CN00Y",name:"富时中国 A50 期货",market:"SGX"},"1d");
  assert.deepEqual(result.points.map(point=>point[1]),[102,103,104,105]);
  assert.equal(result.previousClose,101);assert.equal(result.price,105);assert.equal(result.market,"SGX");assert.equal(result.currency,"USD");
});

test("A50 未完成 K 线的时间不得超过当前时间",()=>{
  const klines=["2026-07-02 17:00,100,100,100,100,8","2026-07-03 15:30,101,101,101,101,9","2026-07-03 16:00,102,102,102,102,10"],now=Date.parse("2026-07-03T07:58:00Z");
  const result=normalizeEastmoneyA50Intraday({data:{klines,preKPrice:99}},{symbol:"CN00Y",name:"富时中国 A50 期货",market:"SGX"},"1d",now);
  assert.equal(result.asOf,now);assert.equal(new Date(result.asOf).toISOString(),"2026-07-03T07:58:00.000Z");
});

test("东方财富 A50 长周期用日线收盘并以当日分时临时补点",()=>{
  const daily={data:{klines:["2026-06-01,99,100,101,98,1","2026-06-02,100,101,102,99,1","2026-07-01,101,110,111,100,1","2026-07-02,110,111,112,109,1"]}};
  const intraday={data:{klines:["2026-06-30 17:00,100,100,100,100,8","2026-07-01 16:30,110,110,110,110,9","2026-07-01 17:00,111,111,111,111,10","2026-07-02 10:00,120,120,120,120,12"]}};
  const result=normalizeEastmoneyA50Daily(daily,intraday,{symbol:"CN00Y",name:"富时中国 A50 期货",market:"SGX"},"1mo",Date.parse("2026-07-02T02:01:00Z"));
  assert.equal(result.previousClose,100);assert.equal(result.price,120);assert.equal(result.provisionalLatest,true);assert.equal(result.provisionalPoint.kind,"in_progress");
});

test("东方财富 AU9999 分时按交易日截取并剔除零成交休市填充",()=>{
  const klines=[
    "2026-07-01 14:55,870,871,872,869,10,1,0,0,0,0",
    "2026-07-01 15:00,871,872,873,870,12,1,0,0,0,0",
    "2026-07-01 18:00,872,872,872,872,99,1,0,0,0,0",
    "2026-07-01 20:00,873,873,873,873,0,0,0,0,0,0",
    "2026-07-01 20:05,873,874,875,873,8,1,0,0,0,0",
    "2026-07-02 02:30,874,875,875,874,4,1,0,0,0,0",
    "2026-07-02 09:00,875,876,876,875,6,1,0,0,0,0",
    "2026-07-02 12:00,876,999,999,999,88,1,0,0,0,0",
    "2026-07-02 15:30,876,877,878,876,5,1,0,0,0,0"
  ];
  const result=normalizeEastmoneyAuIntraday({data:{klines,preKPrice:870}},{symbol:"AU9999",name:"黄金9999",market:"SGE"},"1d");
  assert.deepEqual(result.points.map(point=>point[1]),[874,875,876,877]);
  assert.equal(result.previousClose,872);assert.equal(result.currency,"CNY");assert.equal(result.market,"SGE");
});

test("东方财富 AU9999 日线使用收盘价并保留区间前收",()=>{
  const daily={data:{klines:["2026-05-29,800,801,802,799,1","2026-06-01,801,810,811,800,1","2026-06-15,810,820,821,809,1","2026-07-01,820,830,831,819,1"]}};
  const intraday={data:{klines:["2026-06-30 20:05,829,830,831,829,2","2026-07-01 09:00,830,831,832,830,3","2026-07-01 15:30,831,830,832,829,4"]}};
  const result=normalizeEastmoneyAuDaily(daily,intraday,{symbol:"AU9999",name:"黄金9999",market:"SGE"},"1mo",Date.parse("2026-07-01T10:00:00Z"));
  assert.deepEqual(result.points.map(point=>point[1]),[810,820,830]);assert.equal(result.previousClose,801);assert.equal(result.price,830);
});

test("同花顺半导体行业日线按五个交易日截取",()=>{
  const rows=Array.from({length:7},(_,index)=>`202606${String(22+index).padStart(2,"0")},1,2,0,${100+index},1,1,,,,0`).join(";");
  const result=normalizeThsIndustryLine(`callback({"data":"${rows}"})`,{symbol:"881121.TI",name:"半导体（同花顺）",market:"THS"},"5d");
  assert.equal(result.points.length,5);assert.equal(result.previousClose,101);assert.equal(result.price,106);
});

test("同花顺半导体行业分时过滤午休",()=>{
  const result=normalizeThsIndustryMinute('cb({"date":"20260702","pre":"100","data":"0930,101;0931,102;1200,999;1301,103"})',{symbol:"881121.TI",name:"半导体（同花顺）",market:"THS"});
  assert.equal(result.points.length,3);assert.equal(result.previousClose,100);assert.equal(result.price,103);
});

test("同花顺半导体行业分时兼容板块键包装",()=>{
  const result=normalizeThsIndustryMinute('cb({"bk_881121":{"date":"20260702","pre":"100","data":"0930,101;0931,102"}})',{symbol:"881121.TI",name:"半导体（同花顺）",market:"THS"});
  assert.equal(result.points.length,2);assert.equal(result.price,102);
});

test("腾讯日线保留区间前收并标记盘中点",()=>{
  const quote=Array(83).fill("");quote[3]="1300";quote[30]="20260702103000";quote[82]="CNY";
  const payload={data:{sh000688:{day:[["2026-06-01","1","90"],["2026-06-02","1","100"],["2026-07-01","1","110"],["2026-07-02","1","120"]],qt:{sh000688:quote}}}};
  const result=normalizeTencentKline(payload,{symbol:"000688.SS",name:"科创 50",market:"SSE"},"1mo",Date.parse("2026-07-02T02:31:00Z"));
  assert.equal(result.previousClose,90);
  assert.equal(new Date(result.points[0][0]).toISOString(),"2026-06-02T07:00:00.000Z");
  assert.equal(result.price,1300);
  assert.equal(result.provisionalLatest,true);
  assert.equal(result.provisionalPoint.kind,"in_progress");
});

test("港股收盘后不再把日线标记为盘中",()=>{
  const seconds=value=>Date.parse(value)/1000,quoteTime=seconds("2026-07-02T07:59:00Z");
  const daily={chart:{result:[{
    meta:{currency:"HKD",exchangeTimezoneName:"Asia/Hong_Kong",chartPreviousClose:420,regularMarketTime:quoteTime,regularMarketPrice:430,currentTradingPeriod:{regular:{start:seconds("2026-07-02T01:30:00Z"),end:seconds("2026-07-02T08:00:00Z")}}},
    timestamp:[seconds("2026-07-01T01:30:00Z"),seconds("2026-07-02T01:30:00Z")],indicators:{quote:[{close:[425,430]}]}
  }]}};
  const result=normalizeYahooChart(daily,{symbol:"0700.HK",name:"腾讯控股",market:"HKEX"},"1mo",Date.parse("2026-07-02T10:00:00Z"));
  assert.equal(result.provisionalLatest,false);
  assert.equal(result.provisionalPoint,null);
});

test("拒绝未知周期和不足的数据", () => {
  assert.equal(isPeriod("1mo"), true);
  assert.equal(isPeriod("6mo"), true);
  assert.equal(isPeriod("3y"), true);
  assert.equal(isPeriod("all"), false);
  assert.throws(() => normalizeYahooChart({ chart: { result: [{ timestamp: [1], indicators: { quote: [{ close: [2] }] } }] } }, INSTRUMENTS[0], "1d"), /不足/);
});

test("自定义股票代码会校验、去重并识别市场", () => {
  const custom = resolveInstruments("amd, 0700.hk, 688256.ss, 300308.sz, 000660.ks, AMD");
  assert.deepEqual(custom.map(item => item.symbol), ["AMD", "0700.HK", "688256.SS", "300308.SZ", "000660.KS"]);
  assert.equal(custom[1].market, "HKEX");
  assert.equal(custom[2].market, "SSE");
  assert.equal(custom[3].market, "SZSE");
  assert.equal(custom[4].name, "SK 海力士");
  assert.throws(() => resolveInstruments("../../etc/passwd"), /格式无效/);
  assert.throws(() => resolveInstruments(Array.from({ length:49 }, (_,index) => `X${index}`).join(",")), /1–48/);
});

test("纯数字 A 股代码自动补全交易所后缀", () => {
  assert.equal(normalizeSymbolInput("301308"),"301308.SZ");
  assert.equal(normalizeSymbolInput("688256"),"688256.SS");
  assert.equal(normalizeSymbolInput("600000"),"600000.SS");
  assert.equal(normalizeSymbolInput("000001"),"000001.SZ");
  assert.equal(normalizeSymbolInput("832000"),"832000.BJ");
  assert.deepEqual(resolveInstruments("301308,688256").map(item=>[item.symbol,item.market]),[["301308.SZ","SZSE"],["688256.SS","SSE"]]);
});

test("市值响应保留数值、币种并区分指数", () => {
  const result = normalizeYahooQuotes({ quoteResponse:{ result:[
    { symbol:"AAPL", quoteType:"EQUITY", marketCap:4249933053952, currency:"USD" },
    { symbol:"^SOX", quoteType:"INDEX", currency:"USD" }
  ], error:null } });
  assert.deepEqual(result.get("AAPL"), { marketCap:4249933053952, marketCapCurrency:"USD", marketCapStatus:"available", regularMarketPrice:null });
  assert.equal(result.get("^SOX").marketCapStatus, "not_applicable");
  assert.throws(() => normalizeYahooQuotes({ quoteResponse:{ error:{ description:"denied" } } }), /denied/);
});

test("按美元市值降序且缺失市值排在末尾", () => {
  const instruments=[{symbol:"A"},{symbol:"B"},{symbol:"C"}];
  const caps=new Map([["A",{marketCapUsd:10}],["B",{marketCapUsd:20}],["C",{marketCapUsd:null}]]);
  assert.deepEqual(sortByMarketCapUsd(instruments,caps).map(entry=>entry.item.symbol),["B","A","C"]);
});
