import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTRUMENTS, PERIODS, isPeriod, mergeLatestQuote, mergeProvisionalIntraday, mergeSyntheticDxy, normalizeCoinbaseBitcoinCandles, normalizeEastmoneyA50Daily, normalizeEastmoneyA50Intraday, normalizeEastmoneyAuDaily, normalizeEastmoneyAuIntraday, normalizeEastmoneyBreadthRow, normalizeEastmoneyGlobal, normalizeEastmoneyTwii, normalizeKrakenBitcoinOhlc, normalizeSinaA50Daily, normalizeSinaA50Minute, normalizeSinaAuHistory, normalizeSinaGlobalFutureLatest, normalizeSinaUsKline, normalizeSymbolInput, normalizeTencentKline, normalizeTencentMinute, normalizeThsIndustryLine, normalizeThsIndustryMinute, normalizeTwseIndexHistory, normalizeYahooChart, normalizeYahooQuotes, resolveInstruments, sortByMarketCapUsd } from "./market.mjs";
import { marketClosedToday } from "./market-calendar.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_FILE = process.env.CACHE_FILE || join(ROOT, ".cache", "market.json");
const memoryCache = new Map();
const marketCapCache = new Map();
let yahooSession = null;
let diskCache = {};

try { diskCache = JSON.parse(await readFile(CACHE_FILE, "utf8")); } catch { diskCache = {}; }

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const INSTRUMENT_CONCURRENCY = 6;

export function autoRefreshMaxAge(periodKey,value,enabled=true){
  if(!enabled||!Number.isFinite(Number(value)))return PERIODS[periodKey].ttl;
  const minimum=["1d","5d"].includes(periodKey)?5_000:60_000;
  return Math.min(300_000,Math.max(minimum,Number(value)));
}
export function isShutdownAuthorized(request){return request?.headers?.["x-market-pulse-action"]==="shutdown";}
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg":"image/svg+xml" };

async function fetchJson(url, timeout = 10_000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 StockDashboard/1.0", accept: "application/json", ...extraHeaders }
    });
    if (!response.ok) { const error = new Error(`上游 HTTP ${response.status}`); error.status = response.status; throw error; }
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function fetchText(url,timeout=10_000,extraHeaders={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(url,{signal:controller.signal,headers:{"user-agent":"Mozilla/5.0 StockDashboard/1.0",...extraHeaders}});if(!response.ok)throw new Error(`上游 HTTP ${response.status}`);return await response.text();}
  finally{clearTimeout(timer);}
}

async function getYahooSession(force = false) {
  if (!force && yahooSession && Date.now() - yahooSession.createdAt < 6 * 3_600_000) return yahooSession;
  const cookieResponse = await fetch("https://fc.yahoo.com", {
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
    headers: { "user-agent": "Mozilla/5.0 StockDashboard/1.0" }
  });
  const setCookies = cookieResponse.headers.getSetCookie?.() || [cookieResponse.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map(value => value.split(";",1)[0]).join("; ");
  if (!cookie) throw new Error("无法取得匿名行情会话");
  const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": "Mozilla/5.0 StockDashboard/1.0", cookie }
  });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumbResponse.ok || !crumb || crumb.length > 100 || crumb.includes("<")) throw new Error("无法取得匿名行情令牌");
  yahooSession = { cookie, crumb, createdAt: Date.now() };
  return yahooSession;
}

async function requestMarketCaps(symbols, retry = true) {
  const session = await getYahooSession(!retry);
  const params = new URLSearchParams({ symbols: symbols.join(","), crumb: session.crumb });
  try {
    return normalizeYahooQuotes(await fetchJson(`https://query2.finance.yahoo.com/v7/finance/quote?${params}`, 12_000, { cookie: session.cookie }));
  } catch (error) {
    if (retry && error.status === 401) { yahooSession = null; return requestMarketCaps(symbols, false); }
    throw error;
  }
}

async function lookupInstrument(rawSymbol) {
  const symbol = normalizeSymbolInput(rawSymbol);
  if (!symbol) throw new Error("请输入股票代码");
  const instrument = resolveInstruments(symbol)[0];
  if (symbol === "AU9999") return instrument;
  const known = INSTRUMENTS.find(item => item.symbol === symbol);
  if (known) return known;

  const domesticMatch = symbol.match(/^(\d+)\.(SS|SZ|BJ|HK)$/);
  if (domesticMatch) {
    const [,code,suffix] = domesticMatch;
    const prefix = { SS:"sh",SZ:"sz",BJ:"bj",HK:"hk" }[suffix];
    const providerCode = suffix === "HK" ? code.padStart(5,"0") : code;
    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${prefix}${providerCode}`, {
        signal: AbortSignal.timeout(8_000),
        headers: { "user-agent":"Mozilla/5.0 StockDashboard/1.0", referer:"https://finance.qq.com/" }
      });
      if (response.ok) {
        const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
        const fields = text.match(/="([^"]*)"/)?.[1]?.split("~") || [];
        const name = fields[1]?.trim();
        if (name && fields[2]) return { ...instrument, name };
      }
    } catch {/* 使用 Yahoo 元数据后备 */}
  }

  const path = `${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  for (const host of ["query2.finance.yahoo.com","query1.finance.yahoo.com"]) {
    try {
      const result = (await fetchJson(`https://${host}/v8/finance/chart/${path}`))?.chart?.result?.[0];
      const name = result?.meta?.shortName || result?.meta?.longName;
      if (result && name) return { ...instrument, name };
    } catch {/* 尝试下一个端点 */}
  }
  throw new Error("未找到该股票，请检查代码");
}

async function fetchMarketCaps(instruments, force = false) {
  const now = Date.now();
  const equities = instruments.filter(item => item.market !== "INDEX");
  const missing = equities.filter(item => force || !marketCapCache.has(item.symbol) || now - marketCapCache.get(item.symbol).savedAt > 3_600_000);
  if (missing.length) {
    try {
      const fetched = await requestMarketCaps(missing.map(item => item.symbol));
      const needsCny = instruments.some(item => ["SSE","SZSE","HKEX"].includes(item.market));
      const currencies = [...new Set([
        ...[...fetched.values()].map(item => item.marketCapCurrency).filter(currency => currency && currency !== "USD"),
        ...(needsCny ? ["CNY"] : [])
      ])];
      let rates = new Map();
      if (currencies.length) {
        const fxQuotes = await requestMarketCaps(currencies.map(currency => `USD${currency}=X`));
        rates = new Map([...fxQuotes.values()].filter(item => item.marketCapCurrency && item.regularMarketPrice > 0).map(item => [item.marketCapCurrency,item.regularMarketPrice]));
      }
      for (const item of missing) {
        const data = fetched.get(item.symbol);
        if (data) {
          const rate = data.marketCapCurrency === "USD" ? 1 : rates.get(data.marketCapCurrency);
          const marketCapUsd = data.marketCap && rate > 0 ? data.marketCap / rate : null;
          const usdCnyRate = rates.get("CNY") || null;
          const marketCapCny = data.marketCapCurrency === "CNY"
            ? data.marketCap
            : marketCapUsd && usdCnyRate > 0 ? marketCapUsd * usdCnyRate : null;
          marketCapCache.set(item.symbol, { savedAt: now, data: { ...data, marketCapUsd, marketCapCny, fxRate: rate || null, usdCnyRate } });
        }
      }
    } catch (error) { console.warn("市值更新失败:", error.message); }
  }
  return new Map(instruments.map(item => {
    if (item.market === "INDEX") return [item.symbol, { marketCap: null, marketCapCurrency: null, marketCapUsd: null, marketCapCny: null, marketCapStatus: "not_applicable" }];
    const cached = marketCapCache.get(item.symbol);
    if (cached && now - cached.savedAt < 24 * 3_600_000) return [item.symbol, { ...cached.data, marketCapStale: now - cached.savedAt > 3_600_000 }];
    return [item.symbol, { marketCap: null, marketCapCurrency: null, marketCapUsd: null, marketCapCny: null, marketCapStatus: "unavailable" }];
  }));
}

function tencentMinuteCode(instrument) {
  const special={"HSTECH.HK":"hkHSTECH","000688.SS":"sh000688","399006.SZ":"sz399006"};
  if(special[instrument.symbol])return special[instrument.symbol];
  const match = instrument.symbol.match(/^(\d+)\.(SS|SZ|BJ|HK)$/);
  if (!match || !["SSE","SZSE","BSE","HKEX"].includes(instrument.market)) return null;
  const [,code,suffix] = match;
  return `${{ SS:"sh",SZ:"sz",BJ:"bj",HK:"hk" }[suffix]}${suffix === "HK" ? code.padStart(5,"0") : code}`;
}

async function fetchTencentKline(instrument,periodKey){
  const providerCode=tencentMinuteCode(instrument);
  if(!providerCode)throw new Error("该市场不支持腾讯日线");
  const count={"5d":6,"1mo":28,"6mo":140,"1y":275,"3y":800}[periodKey]||28;
  const param=`${providerCode},day,,,${count},qfq`;
  return normalizeTencentKline(await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${param}`),instrument,periodKey);
}

async function fetchTencentIntraday(instrument) {
  const providerCode = tencentMinuteCode(instrument);
  if (!providerCode) throw new Error("该市场不支持腾讯分时");
  return normalizeTencentMinute(await fetchJson(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${providerCode}`),instrument);
}

async function fetchThsIndustry(instrument,periodKey){
  const headers={referer:"https://q.10jqka.com.cn/"};
  if(periodKey==="1d"){
    try{const minutePayload=await fetchText("https://d.10jqka.com.cn/v6/time/bk_881121/last.js",10_000,headers);return normalizeThsIndustryMinute(minutePayload,instrument);}
    catch(error){console.warn("同花顺行业分时回落:",error.message);}
  }
  const year=new Date().getFullYear(),firstYear=periodKey==="3y"?year-3:year-1,payloads=await Promise.all(Array.from({length:year-firstYear+1},(_,index)=>firstYear+index).map(value=>fetchText(`https://d.10jqka.com.cn/v6/line/bk_881121/01/${value}.js`,10_000,headers)));
  return normalizeThsIndustryLine(payloads,instrument,periodKey);
}

async function fetchSyntheticDxy(){
  const symbols=["EURUSD=X","JPY=X","GBPUSD=X","CAD=X","SEK=X","CHF=X"];
  const quotes=await Promise.all(symbols.map(async symbol=>{
    const instrument={symbol,name:symbol,market:"CUSTOM"},path=`${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=false`;
    const payload=await fetchJson(`https://query2.finance.yahoo.com/v8/finance/chart/${path}`);
    return normalizeYahooChart(payload,instrument,"1d");
  }));
  const values=Object.fromEntries(quotes.map(item=>[item.symbol,item.price]));
  const price=50.14348112*values["EURUSD=X"]**-.576*values["JPY=X"]**.136*values["GBPUSD=X"]**-.119*values["CAD=X"]**.091*values["SEK=X"]**.042*values["CHF=X"]**.036;
  return{price,asOf:Math.min(...quotes.map(item=>item.asOf))};
}

async function fetchSinaGoldLatest(){
  const payload=await fetchText("https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_DATA=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=GC",12_000,{referer:"https://finance.sina.com.cn/"});
  return normalizeSinaGlobalFutureLatest(payload);
}

async function fetchEastmoneyAu9999(instrument,periodKey){
  const base="https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=118.AU9999&fqt=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
  const intraday=await fetchJson(`${base}&klt=5&lmt=2000`,15_000);
  if(periodKey==="1d"||periodKey==="5d")return normalizeEastmoneyAuIntraday(intraday,instrument,periodKey);
  const daily=await fetchJson(`${base}&klt=101&lmt=${periodKey==="3y"?1000:400}`,15_000);
  return normalizeEastmoneyAuDaily(daily,intraday,instrument,periodKey);
}

async function fetchEastmoneyA50(instrument,periodKey){
  const base="https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=104.CN00Y&fqt=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
  const intraday=await fetchJson(`${base}&klt=${periodKey==="5d"?30:5}&lmt=2000`,15_000);
  if(periodKey==="1d"||periodKey==="5d")return normalizeEastmoneyA50Intraday(intraday,instrument,periodKey);
  const daily=await fetchJson(`${base}&klt=101&lmt=${periodKey==="3y"?1000:400}`,15_000);
  return normalizeEastmoneyA50Daily(daily,intraday,instrument,periodKey);
}

function fallbackDateRange(periodKey){
  const end=new Date(),start=new Date(end);
  if(periodKey==="1d"||periodKey==="5d")start.setUTCDate(start.getUTCDate()-14);
  else if(periodKey==="1mo")start.setUTCMonth(start.getUTCMonth()-2);
  else if(periodKey==="6mo")start.setUTCMonth(start.getUTCMonth()-7);
  else if(periodKey==="1y")start.setUTCFullYear(start.getUTCFullYear()-1);
  else start.setUTCFullYear(start.getUTCFullYear()-3);
  const format=value=>value.toISOString().slice(0,10);
  return{start:format(start),end:format(end)};
}

async function fetchSinaAu9999(instrument,periodKey){
  const{start,end}=fallbackDateRange(periodKey);
  const payload=await fetchText(`https://vip.stock.finance.sina.com.cn/q/view/download_gold_history.php?breed=AU9999&start=${start}&end=${end}`,20_000,{referer:"https://vip.stock.finance.sina.com.cn/"});
  return normalizeSinaAuHistory(payload,instrument,periodKey);
}

async function fetchSinaA50(instrument,periodKey){
  const base="https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_DATA=/GlobalFuturesService.";
  if(periodKey==="1d"){
    const payload=await fetchText(`${base}getGlobalFuturesMinLine?symbol=CHA50CFD`,20_000,{referer:"https://finance.sina.com.cn/"});
    return normalizeSinaA50Minute(payload,instrument);
  }
  const payload=await fetchText(`${base}getGlobalFuturesDailyKLine?symbol=CHA50CFD`,20_000,{referer:"https://finance.sina.com.cn/"});
  return normalizeSinaA50Daily(payload,instrument,periodKey);
}

async function fetchCoinbaseBitcoin(instrument,periodKey){
  const granularity=periodKey==="5d"?1800:300,range=periodKey==="5d"?5*86_400_000:86_400_000,end=new Date(),start=new Date(end.getTime()-range-2*granularity*1000);
  const params=new URLSearchParams({granularity:String(granularity),start:start.toISOString(),end:end.toISOString()});
  return normalizeCoinbaseBitcoinCandles(await fetchJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?${params}`,12_000),instrument,periodKey);
}

async function fetchKrakenBitcoin(instrument,periodKey){
  const interval=periodKey==="5d"?30:5;
  return normalizeKrakenBitcoinOhlc(await fetchJson(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`,12_000),instrument,periodKey);
}

async function fetchSinaUs(instrument,periodKey){
  const service=["1d","5d"].includes(periodKey)?`US_MinKService.getMinK?symbol=${encodeURIComponent(instrument.symbol)}&type=5&___qn=3`:`US_MinKService.getDailyK?symbol=${encodeURIComponent(instrument.symbol)}&___qn=3`;
  const payload=await fetchText(`https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_DATA=/${service}`,25_000,{referer:"https://stock.finance.sina.com.cn/"});
  return normalizeSinaUsKline(payload,instrument,periodKey);
}

async function fetchTwseIndex(instrument,periodKey){
  const count={"1d":2,"5d":2,"1mo":2,"6mo":7,"1y":13,"3y":18}[periodKey]||2,now=new Date(),months=[];
  for(let index=0;index<count;index++){
    const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-index,1));
    months.push(`${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,"0")}01`);
  }
  const payloads=[];
  for(let index=0;index<months.length;index+=4){
    const batch=months.slice(index,index+4);
    payloads.push(...await Promise.all(batch.map(async month=>{
      const payload=await fetchJson(`https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=${month}&response=json`,15_000,{referer:"https://www.twse.com.tw/"});
      const expected=`${Number(month.slice(0,4))-1911}/${month.slice(4,6)}`;
      if(!String(payload?.data?.[0]?.[0]||"").startsWith(expected))throw new Error("台交所返回了非请求月份的数据");
      return payload;
    })));
  }
  return normalizeTwseIndexHistory(payloads,instrument,periodKey);
}

async function fetchEastmoneyTwii(instrument,periodKey){
  const intraday=["1d","5d"].includes(periodKey),klt=intraday?(periodKey==="5d"?30:5):101,lmt=periodKey==="3y"?1000:400;
  const url=`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=100.TWII&fqt=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&lmt=${intraday?2000:lmt}`;
  return normalizeEastmoneyTwii(await fetchJson(url,18_000),instrument,periodKey);
}

async function fetchEastmoneyGlobal(instrument,periodKey){
  const secids={"^KS11":"100.KS11","^N225":"100.N225","005930.KS":"177.005930","000660.KS":"177.000660"};
  const secid=secids[instrument.symbol];if(!secid)throw new Error("东方财富未配置该标的");
  const klt=periodKey==="5d"?30:periodKey==="1d"?5:101,lmt=periodKey==="3y"?1000:periodKey==="1y"?500:400;
  const url=`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fqt=0&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&lmt=${lmt}`;
  return normalizeEastmoneyGlobal(await fetchJson(url,18_000),instrument,periodKey);
}

const EASTMONEY_BREADTH_SECIDS=Object.freeze({
  "000001.SS":"1.000001",
  "399001.SZ":"0.399001",
  "000688.SS":"1.000688",
  "399006.SZ":"0.399006"
});
async function fetchMarketBreadth(instruments){
  const selected=instruments.filter(item=>EASTMONEY_BREADTH_SECIDS[item.symbol]);
  if(!selected.length)return new Map();
  const secidToSymbol=new Map(selected.map(item=>[EASTMONEY_BREADTH_SECIDS[item.symbol],item.symbol]));
  const codeToSymbol=new Map([...secidToSymbol].map(([secid,symbol])=>[secid.split(".")[1],symbol]));
  const query=`/api/qt/ulist.np/get?fltt=2&secids=${[...secidToSymbol.keys()].join(",")}&fields=f12,f104,f105,f106`;
  let lastError;
  for(const host of ["push2his.eastmoney.com","push2.eastmoney.com"]){
    try{
      const payload=await fetchJson(`https://${host}${query}`,12_000);
      const output=new Map();
      for(const row of payload?.data?.diff||[]){
        const symbol=codeToSymbol.get(String(row?.f12));
        const breadth=normalizeEastmoneyBreadthRow(row);
        if(symbol&&breadth)output.set(symbol,breadth);
      }
      return output;
    }catch(error){lastError=error;}
  }
  throw lastError||new Error("东方财富涨跌家数不可用");
}

function canUseSinaUs(instrument){
  return["NASDAQ","NYSE","NasdaqGS","NasdaqGM","NasdaqCM"].includes(instrument.market)&&/^[A-Z][A-Z0-9.-]*$/.test(instrument.symbol);
}

function rememberInstrument(key,data){
  const entry={savedAt:Date.now(),data};memoryCache.set(key,entry);diskCache[key]=entry;persistCache();return{...data,cache:"live"};
}

async function fetchInstrument(instrument, periodKey, force = false, maxAge = PERIODS[periodKey].ttl) {
  const key = `${instrument.symbol}:${periodKey}`;
  const period = PERIODS[periodKey];
  const cached = memoryCache.get(key);
  if (!force && cached && Date.now() - cached.savedAt < maxAge) return { ...cached.data, cache: "fresh" };

  const path = `${encodeURIComponent(instrument.symbol)}?interval=${period.interval}&range=${period.range}&includePrePost=false&events=div%2Csplits`;
  const endpoints = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${path}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${path}`
  ];
  let lastError;

  if(instrument.symbol==="AU9999"){
    try{return rememberInstrument(key,await fetchEastmoneyAu9999(instrument,periodKey));}
    catch(error){lastError=error;}
    try{return rememberInstrument(key,await fetchSinaAu9999(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(instrument.symbol==="CN00Y"){
    try{return rememberInstrument(key,await fetchEastmoneyA50(instrument,periodKey));}
    catch(error){lastError=error;}
    try{return rememberInstrument(key,await fetchSinaA50(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(instrument.symbol==="BTC-USD"&&["1d","5d"].includes(periodKey)){
    try{return rememberInstrument(key,await fetchCoinbaseBitcoin(instrument,periodKey));}
    catch(error){lastError=error;}
    try{return rememberInstrument(key,await fetchKrakenBitcoin(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(instrument.symbol==="881121.TI"){
    try{const data=await fetchThsIndustry(instrument,periodKey),entry={savedAt:Date.now(),data};memoryCache.set(key,entry);diskCache[key]=entry;persistCache();return{...data,cache:"live"};}
    catch(error){lastError=error;}
  }

  if(["1mo","6mo","1y","3y"].includes(periodKey)&&["HSTECH.HK","000688.SS","399006.SZ"].includes(instrument.symbol)){
    try{
      const data=await fetchTencentKline(instrument,periodKey),entry={savedAt:Date.now(),data};
      memoryCache.set(key,entry);diskCache[key]=entry;persistCache();return{...data,cache:"live"};
    }catch(error){lastError=error;}
  }

  // A/H 股开盘初段 Yahoo 常只给元数据或延迟约 15 分钟；公开分时源应优先用于“当日”。
  if (periodKey === "1d" && ["SSE","SZSE","BSE","HKEX"].includes(instrument.market)) {
    if (tencentMinuteCode(instrument)) {
      try {
        const data = await fetchTencentIntraday(instrument);
        const entry = { savedAt: Date.now(), data };
        memoryCache.set(key,entry);
        diskCache[key] = entry;
        persistCache();
        return { ...data, cache:"live" };
      } catch (error) { lastError = error; }
    }
  }

  for (const endpoint of endpoints) {
    try {
      let data = normalizeYahooChart(await fetchJson(endpoint), instrument, periodKey);
      if(instrument.symbol==="DX-Y.NYB"){
        try{data=mergeSyntheticDxy(data,await fetchSyntheticDxy(),periodKey);}
        catch(error){console.warn("美元指数实时合成失败，保留 ICE 延迟行情:",error.message);}
      }
      if(instrument.symbol==="GC=F"){
        try{data=mergeLatestQuote(data,await fetchSinaGoldLatest(),periodKey,"新浪纽约黄金分钟报价");}
        catch(error){console.warn("国际黄金实时补点失败，保留 Yahoo 最新报价:",error.message);}
      }
      if (period.interval === "1d" && data.provisionalLatest && tencentMinuteCode(instrument)) {
        try { data = mergeProvisionalIntraday(data,await fetchTencentIntraday(instrument)); }
        catch {/* 保留 Yahoo 盘中日 K；时间仍会遵循休市时段 */}
      }
      const entry = { savedAt: Date.now(), data };
      memoryCache.set(key, entry);
      diskCache[key] = entry;
      persistCache();
      return { ...data, cache: "live" };
    } catch (error) { lastError = error; }
  }

  // 东方财富作为日韩行情备用源；若 Yahoo 可用，优先采用更新时间更稳定的 Yahoo 响应。
  if(["^KS11","^N225","005930.KS","000660.KS"].includes(instrument.symbol)){
    try{return rememberInstrument(key,await fetchEastmoneyGlobal(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(instrument.symbol==="^TWII"){
    try{return rememberInstrument(key,await fetchEastmoneyTwii(instrument,periodKey));}
    catch(error){lastError=error;}
    try{return rememberInstrument(key,await fetchTwseIndex(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(periodKey!=="1d"&&tencentMinuteCode(instrument)){
    try{return rememberInstrument(key,await fetchTencentKline(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  if(canUseSinaUs(instrument)){
    try{return rememberInstrument(key,await fetchSinaUs(instrument,periodKey));}
    catch(error){lastError=error;}
  }

  const stale = diskCache[key];
  if (stale?.data && Date.now() - stale.savedAt < 7 * 86_400_000) {
    return { ...stale.data, cache: "stale", warning: `实时更新失败，显示缓存：${lastError?.message}` };
  }
  throw lastError || new Error("行情源不可用");
}

let persistTimer;
function persistCache() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      await mkdir(dirname(CACHE_FILE), { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(diskCache));
    } catch (error) { console.warn("缓存写入失败:", error.message); }
  }, 200);
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, data: await worker(items[index]) }; }
      catch (error) { results[index] = { ok: false, error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function dashboard(periodKey, force = false, instruments = INSTRUMENTS, page = 0, pageSize = instruments.length, sortByCap = true, maxAge = PERIODS[periodKey].ttl) {
  const startedAt = Date.now();
  // “重点”按关注顺序展示，但个股仍需返回市值，供右上角换算成人民币显示。
  // 首屏的市值、涨跌家数和 K 线互不依赖；并行请求可避免市值接口阻塞全部行情。
  const marketCapsPromise = fetchMarketCaps(instruments,force);
  const marketBreadthPromise = fetchMarketBreadth(instruments).catch(()=>new Map());
  let marketCaps;
  let selected;
  if(sortByCap){
    marketCaps = await marketCapsPromise;
    selected = sortByMarketCapUsd(instruments,marketCaps).slice(page * pageSize, (page + 1) * pageSize);
  }else{
    selected = instruments.slice(page * pageSize, (page + 1) * pageSize).map(item=>({item,cap:undefined}));
  }
  const [resolvedMarketCaps, marketBreadth, results] = await Promise.all([
    marketCaps || marketCapsPromise,
    marketBreadthPromise,
    mapConcurrent(selected, INSTRUMENT_CONCURRENCY, entry => fetchInstrument(entry.item, periodKey, force, maxAge))
  ]);
  if(!sortByCap) selected = selected.map(entry=>({ ...entry, cap:resolvedMarketCaps.get(entry.item.symbol) }));
  const marketClosedFor = (entry) => periodKey === "1d" ? marketClosedToday(entry.item.market) : null;
  const instrumentResults = results.map((result, index) => result.ok
    ? { status: "ok", ...result.data, ...selected[index].cap, ...(marketBreadth.get(selected[index].item.symbol)||{}), marketClosed:marketClosedFor(selected[index]) }
    : { status: "error", ...selected[index].item, ...selected[index].cap, ...(marketBreadth.get(selected[index].item.symbol)||{}), marketClosed:marketClosedFor(selected[index]), error: result.error });
  return {
    period: periodKey,
    periodLabel: PERIODS[periodKey].label,
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    source: "Yahoo Finance chart API（无需登录，可能延迟）",
    total: instruments.length,
    page,
    pageCount: Math.max(1, Math.ceil(instruments.length / pageSize)),
    instruments: instrumentResults
  };
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  try {
    const body = await readFile(join(PUBLIC, relative));
    response.writeHead(200, { "content-type": mime[extname(relative)] || "application/octet-stream", "cache-control": "no-cache" });
    response.end(body);
    return true;
  } catch { return false; }
}

export const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if(request.method==="POST"&&url.pathname==="/api/shutdown"){
      if(!isShutdownAuthorized(request)){
        response.writeHead(403,jsonHeaders);return response.end(JSON.stringify({error:"关闭请求未获授权"}));
      }
      response.writeHead(200,jsonHeaders);response.end(JSON.stringify({ok:true}));
      if(process.env.NODE_ENV!=="test"){
        // This is a single-user local process. A deterministic exit avoids
        // keep-alive browser sockets leaving the server half-closed.
        setTimeout(()=>process.exit(0),250);
      }
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/market") {
      const period = url.searchParams.get("period") || "1mo";
      if (!isPeriod(period)) {
        response.writeHead(400, jsonHeaders);
        return response.end(JSON.stringify({ error: "不支持的周期" }));
      }
      const force = url.searchParams.get("force") === "1";
      const page = Number(url.searchParams.get("page") || 0);
      const pageSize = Number(url.searchParams.get("pageSize") || 48);
      if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) {
        response.writeHead(400, jsonHeaders);
        return response.end(JSON.stringify({ error: "分页参数无效" }));
      }
      let requestedInstruments;
      try { requestedInstruments = resolveInstruments(url.searchParams.get("symbols")); }
      catch (error) {
        response.writeHead(400, jsonHeaders);
        return response.end(JSON.stringify({ error: error.message }));
      }
      const maxAge=autoRefreshMaxAge(period,url.searchParams.get("refreshMs"),url.searchParams.has("refreshMs"));
      response.writeHead(200, jsonHeaders);
      return response.end(JSON.stringify(await dashboard(period, force, requestedInstruments, page, pageSize, url.searchParams.get("sort")!=="none",maxAge)));
    }
    if (request.method === "GET" && url.pathname === "/api/lookup") {
      try {
        const result = await lookupInstrument(url.searchParams.get("symbol"));
        response.writeHead(200, jsonHeaders);
        return response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(404, jsonHeaders);
        return response.end(JSON.stringify({ error:error.message }));
      }
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      response.writeHead(200, jsonHeaders);
      return response.end(JSON.stringify({ ok: true, instruments: INSTRUMENTS.length }));
    }
    if (request.method === "GET" && await serveStatic(url.pathname, response)) return;
    response.writeHead(404, jsonHeaders);
    response.end(JSON.stringify({ error: "未找到" }));
  } catch (error) {
    response.writeHead(500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "服务器错误" }));
  }
});

if (process.env.NODE_ENV !== "test") server.listen(PORT, HOST, () => {
  console.log(`股票看板已启动：http://127.0.0.1:${PORT}`);
});
