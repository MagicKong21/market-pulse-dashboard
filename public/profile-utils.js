export const SYMBOL_PATTERN=/^[A-Z0-9^.=\-]{1,20}$/;

// 默认名单只用于新用户或缺失的看板配置。已有配置（包括空名单）必须原样保留。
export function normalizeProfile(saved,defaults,{legacyGlobal=false}={}){
  const replacements=legacyGlobal?{"^SOX":{symbol:"AMD",name:"AMD",market:"NASDAQ"},"9984.T":{symbol:"INTC",name:"英特尔",market:"NASDAQ"}}:{};
  const defaultBySymbol=new Map(defaults.map(item=>[item.symbol,item]));
  const hasSavedStocks=Array.isArray(saved?.stocks);
  const raw=hasSavedStocks?saved.stocks.map(item=>{
    const normalized=replacements[item?.symbol]||{...(defaultBySymbol.get(item?.symbol)||{}),...item};
    return normalized.symbol==="^KS11"&&normalized.name==="韩国综合"?{...normalized,name:"KOSPI"}:normalized;
  }):[];
  const stocks=[...new Map(raw.filter(item=>SYMBOL_PATTERN.test(item?.symbol)&&typeof item?.name==="string").map(item=>[item.symbol,item])).values()].slice(0,48);
  let columns=clamp(saved?.columns,1,8,6),rows=clamp(saved?.rows,1,6,3),items=hasSavedStocks?stocks:structuredClone(defaults);
  while(columns*rows<items.length&&rows<6)rows++;
  while(columns*rows<items.length&&columns<8)columns++;
  return{stocks:items,columns,rows};
}

function clamp(value,min,max,fallback){const number=Number(value);return Number.isInteger(number)&&number>=min&&number<=max?number:fallback;}
