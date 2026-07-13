import { chartProgressValues, chartSegmentIndexes, marketSessionForTime, rangeTimeLabel } from "./chart-utils.js";
import { APP_VERSION, LATEST_RELEASE_API, RELEASES_URL, isNewerVersion } from "./version.js";
import { AUTO_REFRESH_OPTIONS, autoRefreshCountdownSeconds, normalizeAutoRefreshMs } from "./auto-refresh.js";
import { normalizeProfile, SYMBOL_PATTERN } from "./profile-utils.js";

const IS_HOSTED_SITE=!(["localhost","127.0.0.1","::1"].includes(location.hostname));
const DEFAULT_GLOBAL_STOCKS = [
  ["NVDA","英伟达","NASDAQ"],["AAPL","苹果","NASDAQ"],["GOOGL","谷歌 A","NASDAQ"],["MSFT","微软","NASDAQ"],["AMZN","亚马逊","NASDAQ"],["TSM","台积电 ADR","NYSE"],
  ["SPCX","SpaceX","NasdaqGS"],["AVGO","博通","NASDAQ"],["META","Meta","NASDAQ"],["TSLA","特斯拉","NASDAQ"],["005930.KS","三星电子","KRX"],["MU","美光","NASDAQ"],
  ["000660.KS","SK 海力士","KRX"],["AMD","AMD","NASDAQ"],["ASML","阿斯麦 ADR","NASDAQ"],["INTC","英特尔","NASDAQ"],["SNDK","闪迪公司","NasdaqGS"],["WDC","西部数据","NasdaqGS"]
].map(([symbol,name,market])=>({symbol,name,market}));
const DEFAULT_CHINA_STOCKS = [
  ["0700.HK","腾讯控股","HKEX"],["9988.HK","阿里巴巴","HKEX"],["688981.SS","中芯国际","SSE"],["601138.SS","工业富联","SSE"],["300308.SZ","中际旭创","SZSE"],["688256.SS","寒武纪","SSE"],
  ["688041.SS","海光信息","SSE"],["688347.SS","华虹宏力","SSE"],["2513.HK","智谱","HKEX"],["002371.SZ","北方华创","SZSE"],["1810.HK","小米集团","HKEX"],["603986.SS","兆易创新","SSE"],
  ["688012.SS","中微公司","SSE"],["688802.SS","沐曦股份","SSE"],["688795.SS","摩尔线程","SSE"],["688008.SS","澜起科技","SSE"],["301308.SZ","江波龙","SZSE"],["000977.SZ","浪潮信息","SZSE"]
].map(([symbol,name,market])=>({symbol,name,market}));
const DEFAULT_MARKET_STOCKS = [
  ["^SOX","费城半导体","NASDAQ","指数"],["^NDX","纳指 100","NASDAQ","指数"],["^GSPC","标普 500","NYSE","指数"],["^TNX","美债 10 年期","CBOE","利率"],["DX-Y.NYB","美元指数","NYB","指数"],["CL=F","原油","NYMEX","商品"],
  ["^KS11","KOSPI","KRX","指数"],["^N225","日经 225","TSE","指数"],["HSTECH.HK","恒生科技","HKEX","指数"],["^TWII","台湾加权","TWSE","指数"],["GC=F","国际黄金","COMEX","期货"],["AU9999","黄金9999","SGE","现货黄金"],
  ["CN00Y","富时中国 A50 期货","SGX","股指期货"],["000001.SS","上证指数","SSE","指数"],["399001.SZ","深证成指","SZSE","指数"],["000688.SS","科创 50","SSE","指数"],["399006.SZ","创业板","SZSE","指数"],["BTC-USD","比特币","CRYPTO","加密资产"]
].map(([symbol,name,market,assetType])=>({symbol,name,market,assetType}));
const DEFAULT_FOCUS_STOCKS = [
  ["^KS11","KOSPI","KRX","指数"],["^N225","日经 225","TSE","指数"],["HSTECH.HK","恒生科技","HKEX","指数"],["CN00Y","富时中国 A50 期货","SGX","股指期货"],["000001.SS","上证指数","SSE","指数"],["399001.SZ","深证成指","SZSE","指数"],["000688.SS","科创 50","SSE","指数"],["399006.SZ","创业板","SZSE","指数"],
  ["005930.KS","三星电子","KRX"],["000660.KS","SK 海力士","KRX"],["688981.SS","中芯国际","SSE"],["601138.SS","工业富联","SSE"],["300308.SZ","中际旭创","SZSE"],["688256.SS","寒武纪","SSE"],["2513.HK","智谱","HKEX"],["002371.SZ","北方华创","SZSE"],["603986.SS","兆易创新","SSE"],["000977.SZ","浪潮信息","SZSE"]
].map(([symbol,name,market,assetType])=>({symbol,name,market,assetType}));
const STORAGE_KEY=IS_HOSTED_SITE?"market-pulse-settings-hosted-v2":"market-pulse-settings-v3",LEGACY_STORAGE_KEY="market-pulse-settings-v2",SETTINGS_VERSION=10,PERIOD_KEYS=["1d","5d","1mo","6mo","1y","3y"];
const UPDATE_CHECK_KEY="market-pulse-update-check-v1",UPDATE_DISMISSED_KEY="market-pulse-update-dismissed-v1",UPDATE_INTERVAL=2*24*60*60*1000;
const $=selector=>document.querySelector(selector),grid=$("#grid"),status=$("#status"),timestamp=$("#timestamp"),refresh=$("#refresh");
const buttons=[...document.querySelectorAll("[data-period]")],universeButtons=[...document.querySelectorAll("[data-universe]")],dialog=$("#settingsDialog"),preview=$("#layoutPreview"),formError=$("#formError"),slotEditor=$("#slotEditor");
let period="1mo",requestId=0,displayOrder=[],settingsSlots=[],pendingSlot=-1,editingSlot=-1,currentUniverse="global",preferences,autoRefreshTimer=null,autoRefreshCountdownTimer=null,autoRefreshDueAt=0,latestUpdateMeta=null;

function hideUpdateNotice(latestVersion){
  const notice=$("#updateNotice");
  if(latestVersion){try{localStorage.setItem(UPDATE_DISMISSED_KEY,latestVersion);}catch{/* 关闭提示仍然有效 */}}
  notice.classList.remove("visible");notice.classList.add("closing");
  setTimeout(()=>{notice.hidden=true;notice.classList.remove("closing");},220);
}

function showUpdateNotice(release){
  const notice=$("#updateNotice"),latest=String(release.tag_name||"").replace(/^v/i,"");
  $("#currentVersion").textContent=APP_VERSION;$("#latestVersion").textContent=latest;
  $("#updateReleaseLink").href=release.html_url||RELEASES_URL;
  notice.hidden=false;requestAnimationFrame(()=>notice.classList.add("visible"));
  $("#closeUpdateNotice").onclick=()=>hideUpdateNotice(latest);
}

async function checkForUpdates(){
  $("#appVersion").textContent=APP_VERSION;
  let lastCheck=0;
  try{lastCheck=Number(JSON.parse(localStorage.getItem(UPDATE_CHECK_KEY))?.checkedAt)||0;}catch{/* 立即检查 */}
  if(Date.now()-lastCheck<UPDATE_INTERVAL)return;
  try{
    const response=await fetch(LATEST_RELEASE_API,{headers:{accept:"application/vnd.github+json"},cache:"no-store"});
    try{localStorage.setItem(UPDATE_CHECK_KEY,JSON.stringify({checkedAt:Date.now()}));}catch{/* 不影响检查结果 */}
    if(!response.ok)return;
    const release=await response.json(),latest=String(release.tag_name||"").replace(/^v/i,"");
    const dismissed=localStorage.getItem(UPDATE_DISMISSED_KEY);
    if(!release.draft&&!release.prerelease&&latest!==dismissed&&isNewerVersion(latest,APP_VERSION))showUpdateNotice(release);
  }catch{/* 离线或 GitHub 不可达时静默跳过 */}
}

function repairLegacyMarketProfile(savedMarket,schemaVersion){
  if(!savedMarket)return savedMarket;
  let stocks=Array.isArray(savedMarket.stocks)?savedMarket.stocks.map(item=>schemaVersion<5&&item.symbol==="518880.SS"?structuredClone(DEFAULT_MARKET_STOCKS.find(stock=>stock.symbol==="AU9999")):{...item}):[];
  const symbols=new Set(stocks.map(item=>item.symbol));
  const corruptedIndex=stocks.findIndex((item,index)=>index===0&&item.symbol==="AMD");
  if(schemaVersion<5&&corruptedIndex>=0&&symbols.has("^NDX")&&symbols.has("^GSPC")&&!symbols.has("^SOX"))stocks[corruptedIndex]=structuredClone(DEFAULT_MARKET_STOCKS[0]);
  if(schemaVersion<6){
    for(const symbol of ["000001.SS","399001.SZ","CN00Y"]){
      if(!symbols.has(symbol)){stocks.push(structuredClone(DEFAULT_MARKET_STOCKS.find(stock=>stock.symbol===symbol)));symbols.add(symbol);}
    }
  }
  // v6 曾把“用户删除了 881121”误判为旧版默认名单，进而重建整个大盘配置。
  // 这两项是本次误加回的标的，只对受影响的 v6 状态做一次性修复。
  if(schemaVersion===6)stocks=stocks.filter(item=>!["512480.SS","881121.TI"].includes(item.symbol));
  return{...savedMarket,stocks};
}
function backupBeforeMigration(saved,schemaVersion){
  if(!saved||schemaVersion>=SETTINGS_VERSION)return;
  try{const key=`${STORAGE_KEY}-backup-v${schemaVersion}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(saved));}catch{/* 备份失败不影响当前使用 */}
}
function loadDashboardState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(saved?.universes){
      const schemaVersion=Number(saved.schemaVersion)||0;
      backupBeforeMigration(saved,schemaVersion);
      const chinaProfile=normalizeProfile(saved.universes.china,DEFAULT_CHINA_STOCKS);
      const repairedMarket=repairLegacyMarketProfile(saved.universes.market,schemaVersion);
      // 大盘配置始终以用户当前的名单与顺序为准；版本升级不得根据数量或缺少某个代码来猜测它是默认配置。
      const marketProfile=normalizeProfile(repairedMarket,DEFAULT_MARKET_STOCKS);
    const active=["global","china","market","focus"].includes(saved.activeUniverse)?saved.activeUniverse:"china";
      const activePeriod=PERIOD_KEYS.includes(saved.activePeriod)?saved.activePeriod:"1d";
      const autoRefreshMs=schemaVersion<9&&Number(saved.autoRefreshMs)===5_000?10_000:normalizeAutoRefreshMs(saved.autoRefreshMs);
      return{schemaVersion:SETTINGS_VERSION,activeUniverse:active,activePeriod,autoRefreshMs,universes:{global:normalizeProfile(saved.universes.global,DEFAULT_GLOBAL_STOCKS,{legacyGlobal:schemaVersion<4}),china:chinaProfile,market:marketProfile,focus:normalizeProfile(saved.universes.focus,DEFAULT_FOCUS_STOCKS)}};
    }
    const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    return{schemaVersion:SETTINGS_VERSION,activeUniverse:"china",activePeriod:"1d",autoRefreshMs:10_000,universes:{global:normalizeProfile(legacy,DEFAULT_GLOBAL_STOCKS,{legacyGlobal:true}),china:normalizeProfile(null,DEFAULT_CHINA_STOCKS),market:normalizeProfile(null,DEFAULT_MARKET_STOCKS),focus:normalizeProfile(null,DEFAULT_FOCUS_STOCKS)}};
  }catch{return{schemaVersion:SETTINGS_VERSION,activeUniverse:"china",activePeriod:"1d",autoRefreshMs:10_000,universes:{global:normalizeProfile(null,DEFAULT_GLOBAL_STOCKS),china:normalizeProfile(null,DEFAULT_CHINA_STOCKS),market:normalizeProfile(null,DEFAULT_MARKET_STOCKS),focus:normalizeProfile(null,DEFAULT_FOCUS_STOCKS)}};}
}
const dashboardState=loadDashboardState();currentUniverse=dashboardState.activeUniverse;period=dashboardState.activePeriod;preferences=dashboardState.universes[currentUniverse];
const capacity=()=>preferences.columns*preferences.rows;
const persist=()=>{try{dashboardState.activeUniverse=currentUniverse;dashboardState.activePeriod=period;localStorage.setItem(STORAGE_KEY,JSON.stringify(dashboardState));}catch{/* 本次会话仍可使用 */}};
const esc=value=>String(value).replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const formatPrice=(value,currency)=>{const digits=["JPY","KRW"].includes(currency)?0:2;return new Intl.NumberFormat("zh-CN",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value)+`<span class="currency">${esc(currency)}</span>`;};
const formatMarketCap=value=>new Intl.NumberFormat("zh-CN",{notation:"compact",compactDisplay:"short",maximumFractionDigits:2}).format(value);
const formatTime=(value,timeZone)=>new Intl.DateTimeFormat("zh-CN",{timeZone:timeZone||"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value));
const formatMarket=(market,symbol)=>symbol==="000001.SS"?"上证":symbol==="399001.SZ"?"深证":market==="SSE"?(/^51/.test(symbol)?"沪市 ETF":/^68[89]|^000688/.test(symbol)?"科创板":"沪主板"):market==="SZSE"?(/^30[01]|^399006/.test(symbol)?"创业板":"深主板"):({BSE:"北交所",HKEX:"港交所",NASDAQ:"纳斯达克",NasdaqGS:"纳斯达克全球精选",NasdaqGM:"纳斯达克全球市场",NasdaqCM:"纳斯达克资本市场",NYSE:"纽交所",KRX:"韩交所",TSE:"东交所",TWSE:"台湾市场",CBOE:"美国利率",NYB:"美元指数",COMEX:"贵金属",NYMEX:"能源",CRYPTO:"加密市场",THS:"同花顺行业",SGE:"上海金交所",SGX:"新交所",INDEX:"指数",CUSTOM:"自选"})[market]||market;
const tickerLine=item=>{const label=formatMarket(item.market,item.symbol),mainBoard=label==="沪主板"||label==="深主板";return`<span class="market-label${mainBoard?" main-board":""}">${esc(label)}</span> · ${esc(item.symbol)}`;};
const inferMarket=symbol=>symbol.startsWith("^")?"INDEX":symbol.endsWith(".KS")?"KRX":symbol.endsWith(".T")?"TSE":symbol.endsWith(".HK")?"HKEX":symbol.endsWith(".SS")?"SSE":symbol.endsWith(".SZ")?"SZSE":symbol.endsWith(".BJ")?"BSE":"CUSTOM";
function updateUniverseUI(){
  universeButtons.forEach(button=>{const active=button.dataset.universe===currentUniverse;button.classList.toggle("active",active);button.setAttribute("aria-pressed",active);});
  $("#marketCapSortNote").textContent=["market","focus"].includes(currentUniverse)?"按关注顺序展示；所有时间统一为北京时间；所有周期压缩休市时段":currentUniverse==="china"?"按折合人民币总市值降序；所有时间统一为北京时间；所有周期压缩休市时段":"按折合美元总市值降序；所有时间统一为北京时间；所有周期压缩休市时段";
  const sources=["Yahoo Finance"],symbols=new Set(preferences.stocks.map(item=>item.symbol));
  if(preferences.stocks.some(item=>/\.(SS|SZ|BJ|HK)$/.test(item.symbol)))sources.push("腾讯证券");
  if(symbols.has("AU9999")||symbols.has("CN00Y"))sources.push("东方财富");
  if(symbols.has("GC=F"))sources.push("新浪财经");
  if(symbols.has("881121.TI"))sources.push("同花顺");
  $("#dataSourceNote").textContent=`数据源：${sources.join(" · ")}`;
  $("#reorderHint").hidden=!(["market","focus"].includes(currentUniverse));
}

function setCustomSelect(id,value){
  const root=document.querySelector(`[data-select="${id}"]`);if(!root)return;
  const selectedOption=[...root.querySelectorAll("[role=option]")].find(option=>option.dataset.value===String(value));
  root.querySelector("input").value=value;root.querySelector(".select-trigger span").textContent=selectedOption?.textContent||value;
  root.querySelectorAll("[role=option]").forEach(option=>{const selected=option===selectedOption;option.classList.toggle("selected",selected);option.setAttribute("aria-selected",selected);});
}

function applyLayout(){
  grid.style.setProperty("--grid-columns",preferences.columns);grid.style.setProperty("--mobile-columns",Math.min(preferences.columns,2));
  preview.style.setProperty("--preview-columns",preferences.columns);$("#watchCount").textContent=preferences.stocks.length;
  setCustomSelect("columnCount",preferences.columns);setCustomSelect("rowCount",preferences.rows);
  $("#layoutHint").textContent=`${preferences.columns} × ${preferences.rows}，共 ${capacity()} 个位置`;
}
function orderedStocks(){
  const map=new Map(preferences.stocks.map(item=>[item.symbol,item])),ordered=[];
  for(const symbol of displayOrder){if(map.has(symbol)){ordered.push(map.get(symbol));map.delete(symbol);}}
  return ordered.concat([...map.values()]);
}
function prepareSettingsSlots(){settingsSlots=orderedStocks().slice(0,capacity());while(settingsSlots.length<capacity())settingsSlots.push(null);}
function syncStocksFromSlots(){preferences.stocks=settingsSlots.filter(Boolean);persist();$("#watchCount").textContent=preferences.stocks.length;}
function renderLayoutPreview(){
  applyLayout();
  preview.innerHTML=settingsSlots.map((item,index)=>item
    ?`<div class="layout-slot${["market","focus"].includes(currentUniverse)?" reorderable":""}" data-slot="${index}" ${["market","focus"].includes(currentUniverse)?`draggable="true" tabindex="0" aria-label="${esc(item.name||item.symbol)}，可拖动或用方向键排序"`:""}><span class="layout-slot-name"><strong>${esc(item.name||item.symbol)}</strong><small>${esc(item.symbol)}</small></span><span class="slot-actions"><button type="button" class="edit-slot" data-slot="${index}" aria-label="编辑 ${esc(item.name||item.symbol)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button type="button" class="remove-slot" data-slot="${index}" aria-label="移除 ${esc(item.name||item.symbol)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button></span></div>`
    :`<div class="layout-slot empty"><button type="button" class="add-slot" data-slot="${index}" aria-label="在第 ${index+1} 格添加股票">＋</button></div>`).join("");
}

function openStockEditor(index,item=null){
  pendingSlot=index;editingSlot=item?index:-1;
  $("#slotEditorTitle").textContent=item?`编辑 ${item.name||item.symbol}`:`在第 ${index+1} 格添加股票`;
  $("#stockSubmit").textContent=item?"保存":"添加";
  $("#stockSymbol").value=item?.symbol||"";$("#stockName").value=item?.name||"";
  slotEditor.hidden=false;formError.textContent="";$("#stockSymbol").focus();
}

function closeStockEditor(){slotEditor.hidden=true;pendingSlot=-1;editingSlot=-1;formError.textContent="";}

function makeChart(points,direction,session,previousClose,periodKey,timeZone,market,provisionalLatest){
  const width=300,height=120,pad=4,values=points.map(point=>point[1]);if(Number.isFinite(previousClose)&&previousClose>0)values.push(previousClose);
  let min=Math.min(...values),max=Math.max(...values);if(max===min){max+=1;min-=1;}
  const progressValues=chartProgressValues(points,periodKey,timeZone,session,market,provisionalLatest);
  const coords=points.map(([,value],index)=>[pad+progressValues[index]*(width-pad*2),pad+(max-value)/(max-min)*(height-pad*2)]);
  const color=direction>0?"#ff817a":direction<0?"#6fe0a7":"#81918e",referenceY=Number.isFinite(previousClose)&&previousClose>0?pad+(max-previousClose)/(max-min)*(height-pad*2):null;
  const segments=chartSegmentIndexes(points,periodKey,timeZone,market),lines=segments.map(indexes=>`<polyline class="chart-line" points="${indexes.map(index=>coords[index].join(",")).join(" ")}" stroke="${color}"/>`).join(""),area=`M${coords[0].join(" ")} ${coords.slice(1).map(point=>`L${point.join(" ")}`).join(" ")} L${coords.at(-1)[0]} ${height} L${coords[0][0]} ${height} Z`;
  const referenceLabel=periodKey==="1d"?"上一交易日收盘价":"区间前一交易日收盘价";
  const reference=referenceY===null?"":`<line class="previous-close" x1="${pad}" y1="${referenceY}" x2="${width-pad}" y2="${referenceY}" data-value="${previousClose}" aria-label="${referenceLabel} ${previousClose}"><title>${referenceLabel} ${previousClose}</title></line>`;
  return`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="价格走势图"><line class="chart-grid" x1="0" y1="30" x2="300" y2="30"/><line class="chart-grid" x1="0" y1="90" x2="300" y2="90"/><path class="chart-area" d="${area}" fill="${color}"/>${reference}${lines}</svg>`;
}
function marketCapBadge(item){
  if(currentUniverse==="market")return`<span class="card-market-cap"><small>类别</small><strong>${esc(item.assetType||"市场指标")}</strong></span>`;
  if(item.marketCapStatus==="not_applicable"&&Number.isFinite(item.breadthUpPercent)){
    const percent=item.breadthUpPercent.toFixed(2);
    const title=`上涨 ${item.breadthUp} 家，平 ${item.breadthFlat} 家，下跌 ${item.breadthDown} 家`;
    return`<span class="card-market-cap" title="${esc(title)}"><small>上涨个股</small><strong>${percent}%</strong></span>`;
  }
  const isChina=["china","focus"].includes(currentUniverse),value=isChina?item.marketCapCny:item.marketCapUsd,currency=isChina?"CNY":"USD";
  const available=Number.isFinite(value)&&value>0,text=item.marketCapStatus==="not_applicable"?"不适用":available?`${item.marketCapCurrency!==currency?"≈ ":""}${formatMarketCap(value)} ${currency}`:"暂无";
  const original=available&&item.marketCapCurrency!==currency?`原始市值 ${formatMarketCap(item.marketCap)} ${item.marketCapCurrency}`:"";
  const title=[original,item.marketCapStale?"市值为缓存数据":""].filter(Boolean).join("；");
  return`<span class="card-market-cap"${title?` title="${esc(title)}"`:""}><small>总市值</small><strong>${text}</strong></span>`;
}
function card(item){
  if(item.status!=="ok")return`<article class="card error"><div class="card-head"><div><div class="name">${esc(item.name)}</div><div class="ticker">${tickerLine(item)}</div></div>${marketCapBadge(item)}</div><p class="error-message">暂时无法取得有效行情<br>${esc(item.error||"未知错误")}</p><div class="range"><span>未使用虚构或过期数据</span><span>—</span></div></article>`;
  const direction=Math.sign(item.change),tone=direction>0?"up":direction<0?"down":"flat",prefix=direction>0?"+":"",intraday=["1d","5d"].includes(period),timeZone=item.exchangeTimezone||"UTC";
  const providedSession=period==="1d"?item.session:null,latestSession=marketSessionForTime(item.asOf,timeZone,item.market,providedSession),firstSession=marketSessionForTime(item.points[0][0],timeZone,item.market,period==="1d"?item.session:null);
  const now=Date.now(),withinCurrentSession=latestSession&&now>=latestSession.start&&now<latestSession.end&&item.asOf>=latestSession.start&&item.asOf<latestSession.end;
  const inProgress=item.provisionalPoint?.kind==="in_progress"||withinCurrentSession;
  // 分时横轴已压缩所有未交易区间，标签也必须从首个真实点开始，不能再显示
  // 一个图中并不存在的理论夜盘开盘时间。
  const rangeStart=intraday?item.points[0][0]:(firstSession?.end||item.points[0][0]);
  const rangeEnd=intraday?(latestSession?.end||item.asOf):(inProgress?item.asOf:(latestSession?.end||item.asOf));
  const progressLabel=inProgress?`<span class="provisional-point">截至 ${rangeTimeLabel(item.asOf).slice(-5)}</span>`:"";
  const chartSession=latestSession||item.session;
  return`<article class="card">${item.cache==="stale"?`<span class="stale" title="${esc(item.warning)}">缓存</span>`:""}<div class="card-head"><div><div class="name">${esc(item.name)}</div><div class="ticker">${tickerLine(item)}</div></div>${marketCapBadge(item)}</div><div class="quote"><div class="price">${formatPrice(item.price,item.currency)}</div><div class="change ${tone}">${prefix}${item.changePercent.toFixed(2)}%</div></div><div class="chart">${makeChart(item.points,direction,chartSession,item.previousClose,period,timeZone,item.market,inProgress)}</div><div class="range"><span>${rangeTimeLabel(rangeStart)}</span>${progressLabel}<span>${rangeTimeLabel(rangeEnd)}</span></div></article>`;
}
function showSkeletons(count){grid.innerHTML=Array.from({length:count},()=>`<article class="card skeleton"><div>加载</div></article>`).join("");}
const BREADTH_SECIDS={"000001.SS":"1.000001","399001.SZ":"0.399001","000688.SS":"1.000688","399006.SZ":"0.399006"};
async function fillMissingIndexBreadth(instruments){
  const missing=instruments.filter(item=>BREADTH_SECIDS[item.symbol]&&!Number.isFinite(item.breadthUpPercent));
  if(!missing.length)return instruments;
  try{
    const secids=missing.map(item=>BREADTH_SECIDS[item.symbol]).join(",");
    const response=await fetch(`https://push2his.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f12,f104,f105,f106`,{cache:"no-store"});
    const rows=(await response.json())?.data?.diff||[];
    const byCode=new Map(rows.map(row=>[String(row.f12),row]));
    return instruments.map(item=>{
      const row=byCode.get(BREADTH_SECIDS[item.symbol]?.split(".")[1]);
      const up=Number(row?.f104),down=Number(row?.f105),flat=Number(row?.f106),total=up+down+flat;
      return Number.isFinite(up)&&Number.isFinite(down)&&Number.isFinite(flat)&&total>0?{...item,breadthUp:up,breadthDown:down,breadthFlat:flat,breadthUpPercent:up/total*100}:item;
    });
  }catch{return instruments;}
}
async function load({skeleton=true,force=false}={}){
  const id=++requestId;refresh.disabled=true;if(skeleton)showSkeletons(preferences.stocks.length);status.innerHTML=`<i class="pulse"></i> 正在更新 ${buttons.find(button=>button.dataset.period===period)?.textContent}行情…`;
  try{
    const params=new URLSearchParams({period,symbols:preferences.stocks.map(item=>item.symbol).join(","),page:"0",pageSize:String(capacity())});if(["market","focus"].includes(currentUniverse))params.set("sort","none");if(force)params.set("force","1");else if(dashboardState.autoRefreshMs)params.set("refreshMs",String(dashboardState.autoRefreshMs));
    const response=await fetch(`/api/market?${params}`,{cache:"no-store"});if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`服务器返回 ${response.status}`);}
    const payload=await response.json();if(id!==requestId)return;const config=new Map(preferences.stocks.map(item=>[item.symbol,item]));
    let instruments=payload.instruments.map(item=>{const own=config.get(item.symbol);return{...item,name:own?.name||item.name,assetType:own?.assetType,market:item.market==="CUSTOM"?(own?.market||item.market):item.market};});
    if(currentUniverse==="focus")instruments=await fillMissingIndexBreadth(instruments);
    if(["market","focus"].includes(currentUniverse)){const order=new Map(preferences.stocks.map((item,index)=>[item.symbol,index]));instruments=instruments.sort((a,b)=>order.get(a.symbol)-order.get(b.symbol));}
    displayOrder=instruments.map(item=>item.symbol);grid.innerHTML=instruments.map(card).join("");
    const good=instruments.filter(item=>item.status==="ok").length,stale=instruments.filter(item=>item.cache==="stale").length;
    status.innerHTML=`<i class="pulse"></i> ${good}/${instruments.length} 个标的已校验 · 共 ${preferences.stocks.length} 只${stale?` · ${stale} 个使用缓存`:""}`;latestUpdateMeta={generatedAt:payload.generatedAt,durationMs:payload.durationMs};
  }catch(error){if(id!==requestId)return;status.textContent=`更新失败：${error.message}`;grid.innerHTML=`<article class="card error"><p class="error-message">无法加载行情，请检查股票代码或本地服务后重试。</p></article>`;}finally{if(id===requestId){refresh.disabled=false;scheduleAutoRefresh();}}
}

function scheduleAutoRefresh(){
  clearAutoRefreshSchedule();
  const delay=dashboardState.autoRefreshMs;if(!delay||document.hidden){renderUpdateTimestamp();return;}
  autoRefreshDueAt=Date.now()+delay;renderUpdateTimestamp();
  autoRefreshCountdownTimer=setInterval(renderUpdateTimestamp,250);
  autoRefreshTimer=setTimeout(()=>{clearAutoRefreshSchedule();load({skeleton:false});},delay);
}

function clearAutoRefreshSchedule(){
  clearTimeout(autoRefreshTimer);clearInterval(autoRefreshCountdownTimer);autoRefreshTimer=null;autoRefreshCountdownTimer=null;autoRefreshDueAt=0;
}

function renderUpdateTimestamp(){
  if(!latestUpdateMeta)return;
  const countdown=dashboardState.autoRefreshMs&&autoRefreshDueAt?autoRefreshCountdownSeconds(autoRefreshDueAt-Date.now()):null;
  timestamp.innerHTML=[
    countdown===null?'<span class="timestamp-countdown off">自动更新已关闭</span>':`<span class="timestamp-countdown"><span class="timestamp-number">${countdown}</span><span class="timestamp-unit">&nbsp;秒后更新</span></span>`,
    '<span class="timestamp-separator">·</span>',
    '<span class="timestamp-label">当前</span>',
    `<span class="timestamp-time">${formatTime(latestUpdateMeta.generatedAt)}</span>`,
    '<span class="timestamp-separator">·</span>',
    '<span class="timestamp-label">耗时</span>',
    `<span class="timestamp-duration"><span class="timestamp-number">${Math.max(0,Math.round(Number(latestUpdateMeta.durationMs)||0))}</span><span class="timestamp-unit">ms</span></span>`
  ].join("");
}

function initializeCustomSelect(id,values){
  const root=document.querySelector(`[data-select="${id}"]`),trigger=root.querySelector(".select-trigger"),menu=root.querySelector(".select-menu");
  const options=Array.isArray(values)?values:Array.from({length:values},(_,index)=>({value:index+1,label:String(index+1)}));
  menu.innerHTML=options.map(option=>`<button type="button" role="option" data-value="${option.value}" aria-selected="false">${option.label}</button>`).join("");
  const close=()=>{root.classList.remove("open");trigger.setAttribute("aria-expanded","false");};
  trigger.addEventListener("click",()=>{document.querySelectorAll(".custom-select.open").forEach(item=>item!==root&&item.classList.remove("open"));const open=root.classList.toggle("open");trigger.setAttribute("aria-expanded",open);});
  menu.addEventListener("click",event=>{const option=event.target.closest("[role=option]");if(!option)return;setCustomSelect(id,option.dataset.value);close();root.querySelector("input").dispatchEvent(new Event("change",{bubbles:true}));});
  return close;
}
const closeColumnSelect=initializeCustomSelect("columnCount",8),closeRowSelect=initializeCustomSelect("rowCount",6),closeAutoRefreshSelect=initializeCustomSelect("autoRefreshMs",AUTO_REFRESH_OPTIONS);
document.addEventListener("click",event=>{if(!event.target.closest(".custom-select")){closeColumnSelect();closeRowSelect();closeAutoRefreshSelect();}});
persist();updateUniverseUI();applyLayout();
setCustomSelect("autoRefreshMs",dashboardState.autoRefreshMs);
buttons.forEach(button=>{const active=button.dataset.period===period;button.classList.toggle("active",active);button.setAttribute("aria-pressed",active);button.addEventListener("click",()=>{if(button.dataset.period===period)return;period=button.dataset.period;buttons.forEach(item=>{const selected=item===button;item.classList.toggle("active",selected);item.setAttribute("aria-pressed",selected);});persist();load();});});
universeButtons.forEach(button=>button.addEventListener("click",()=>{if(button.dataset.universe===currentUniverse)return;currentUniverse=button.dataset.universe;preferences=dashboardState.universes[currentUniverse];displayOrder=[];settingsSlots=[];pendingSlot=-1;editingSlot=-1;updateUniverseUI();applyLayout();persist();load();}));
refresh.addEventListener("click",()=>load({skeleton:false,force:true}));
if(IS_HOSTED_SITE)$("#shutdownButton").hidden=true;
$("#shutdownButton").addEventListener("click",async event=>{
  if(!window.confirm("关闭后台服务并关闭当前标签页？"))return;
  const button=event.currentTarget;button.disabled=true;clearAutoRefreshSchedule();
  try{
    const response=await fetch("/api/shutdown",{method:"POST",headers:{"x-market-pulse-action":"shutdown"},cache:"no-store"});
    if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"后台服务未能关闭");
    setTimeout(()=>{
      window.close();
      setTimeout(()=>{$("#shutdownScreen").hidden=false;},180);
    },80);
  }catch(error){button.disabled=false;status.textContent=`关闭失败：${error.message}`;scheduleAutoRefresh();}
});
$("#settingsButton").addEventListener("click",()=>{prepareSettingsSlots();renderLayoutPreview();setCustomSelect("autoRefreshMs",dashboardState.autoRefreshMs);closeStockEditor();dialog.showModal();$("#columnCount").focus();});
$("#closeSettings").addEventListener("click",()=>{closeStockEditor();dialog.close();});
$("#cancelAdd").addEventListener("click",closeStockEditor);
$("#stockSymbol").addEventListener("input",event=>{event.target.value=event.target.value.toUpperCase().replace(/\s/g,"");formError.textContent="";});
preview.addEventListener("click",event=>{
  const remove=event.target.closest(".remove-slot"),edit=event.target.closest(".edit-slot"),add=event.target.closest(".add-slot");
  if(remove){if(preferences.stocks.length===1){formError.textContent="看板至少保留一只股票";return;}settingsSlots[Number(remove.dataset.slot)]=null;closeStockEditor();syncStocksFromSlots();renderLayoutPreview();load();return;}
  if(edit){const index=Number(edit.dataset.slot);openStockEditor(index,settingsSlots[index]);return;}
  if(add){openStockEditor(Number(add.dataset.slot));}
});
function moveSettingsSlot(from,to){
  const occupied=settingsSlots.filter(Boolean);if(from<0||from>=occupied.length)return;
  const destination=Math.max(0,Math.min(occupied.length-1,to));if(destination===from)return;
  const [item]=occupied.splice(from,1);occupied.splice(destination,0,item);settingsSlots=occupied;while(settingsSlots.length<capacity())settingsSlots.push(null);syncStocksFromSlots();renderLayoutPreview();load();
  requestAnimationFrame(()=>preview.querySelector(`[data-slot="${destination}"]`)?.focus());
}
let draggedSlot=-1;
preview.addEventListener("dragstart",event=>{const slot=event.target.closest(".reorderable");if(!slot)return;draggedSlot=Number(slot.dataset.slot);slot.classList.add("dragging");event.dataTransfer.effectAllowed="move";});
preview.addEventListener("dragover",event=>{if(draggedSlot<0)return;event.preventDefault();event.dataTransfer.dropEffect="move";preview.querySelectorAll(".drag-over").forEach(slot=>slot.classList.remove("drag-over"));event.target.closest(".layout-slot")?.classList.add("drag-over");});
preview.addEventListener("drop",event=>{event.preventDefault();const target=event.target.closest(".layout-slot");if(target&&draggedSlot>=0)moveSettingsSlot(draggedSlot,Math.min(Number(target.dataset.slot),preferences.stocks.length-1));draggedSlot=-1;});
preview.addEventListener("dragend",()=>{draggedSlot=-1;preview.querySelectorAll(".dragging,.drag-over").forEach(slot=>slot.classList.remove("dragging","drag-over"));});
preview.addEventListener("keydown",event=>{const slot=event.target.closest(".reorderable");if(!slot||!event.key.startsWith("Arrow"))return;const from=Number(slot.dataset.slot),delta=event.key==="ArrowLeft"?-1:event.key==="ArrowRight"?1:event.key==="ArrowUp"?-preferences.columns:preferences.columns;event.preventDefault();moveSettingsSlot(from,from+delta);});
$("#stockForm").addEventListener("submit",async event=>{
  event.preventDefault();const rawSymbol=$("#stockSymbol").value.trim().toUpperCase(),customName=$("#stockName").value.trim(),submitButton=event.submitter;
  if(pendingSlot<0)return;if(!SYMBOL_PATTERN.test(rawSymbol)){formError.textContent="代码格式不正确，例如 301308、AMD、0700.HK";return;}
  submitButton.disabled=true;formError.textContent="正在识别股票代码与名称…";
  try{
    const response=await fetch(`/api/lookup?symbol=${encodeURIComponent(rawSymbol)}`,{cache:"no-store"}),result=await response.json();
    if(!response.ok)throw new Error(result.error||"未找到该股票");
    const symbol=result.symbol,name=customName||result.name||symbol,market=result.market||inferMarket(symbol);
    if(settingsSlots.some((item,index)=>index!==pendingSlot&&item?.symbol===symbol)){formError.textContent="该股票已在看板中";return;}
    const wasEditing=editingSlot===pendingSlot;
    settingsSlots[pendingSlot]={symbol,name,market};syncStocksFromSlots();renderLayoutPreview();slotEditor.hidden=true;pendingSlot=-1;load();
    editingSlot=-1;formError.textContent=`已${wasEditing?"更新":"添加"} ${name}（${symbol}）`;
  }catch(error){formError.textContent=error.message||"无法识别该股票";}finally{submitButton.disabled=false;}
});
function changeLayout(){
  const columns=Number($("#columnCount").value),rows=Number($("#rowCount").value),newCapacity=columns*rows;
  if(newCapacity<preferences.stocks.length){formError.textContent=`当前有 ${preferences.stocks.length} 只股票，至少需要 ${preferences.stocks.length} 个位置`;applyLayout();return;}
  const occupied=settingsSlots.filter(Boolean);preferences.columns=columns;preferences.rows=rows;settingsSlots=occupied.slice(0,newCapacity);while(settingsSlots.length<newCapacity)settingsSlots.push(null);persist();renderLayoutPreview();load();
}
$("#columnCount").addEventListener("change",changeLayout);$("#rowCount").addEventListener("change",changeLayout);
$("#autoRefreshMs").addEventListener("change",event=>{dashboardState.autoRefreshMs=normalizeAutoRefreshMs(event.target.value);persist();setCustomSelect("autoRefreshMs",dashboardState.autoRefreshMs);scheduleAutoRefresh();});
document.addEventListener("visibilitychange",()=>{if(document.hidden){clearAutoRefreshSchedule();renderUpdateTimestamp();}else scheduleAutoRefresh();});
$("#resetWatchlist").addEventListener("click",()=>{const defaults=currentUniverse==="china"?DEFAULT_CHINA_STOCKS:currentUniverse==="market"?DEFAULT_MARKET_STOCKS:currentUniverse==="focus"?DEFAULT_FOCUS_STOCKS:DEFAULT_GLOBAL_STOCKS;preferences.stocks=structuredClone(defaults);preferences.columns=6;preferences.rows=3;displayOrder=[];persist();prepareSettingsSlots();renderLayoutPreview();slotEditor.hidden=true;pendingSlot=-1;editingSlot=-1;formError.textContent="已恢复默认 6 × 3 看板";load();});
load();
checkForUpdates();
