import test from "node:test";
import assert from "node:assert/strict";
import { chartProgressValues, chartSegmentIndexes, marketSessionForTime, rangeTimeLabel } from "../public/chart-utils.js";

test("近五日为尚未收盘的当日保留完整交易日槽位",()=>{
  const points=[];
  for(let day=1;day<=4;day++)for(let bar=0;bar<13;bar++)points.push([Date.UTC(2026,6,day,13,30+bar*30),100+day+bar]);
  for(let bar=0;bar<3;bar++)points.push([Date.UTC(2026,6,5,13,30+bar*30),110+bar]);
  const progress=chartProgressValues(points,"5d","America/New_York",null,null,true);
  assert.equal(progress[0],0);
  assert.ok(progress.at(-1)>0.8);
  assert.ok(progress.at(-1)<0.9);
  assert.ok(progress.at(-1)<1);
});

test("跨午夜期货按 18 点开盘的交易日压缩维护停盘并为当前时段留白",()=>{
  const points=[
    [Date.parse("2026-06-28T22:00:00Z"),100], // 纽约周日 18:00，属于周一交易日
    [Date.parse("2026-06-29T20:30:00Z"),101], // 周一 16:30
    [Date.parse("2026-06-29T22:00:00Z"),102], // 周一 18:00，属于周二交易日
    [Date.parse("2026-07-02T08:15:00Z"),103]  // 周四 04:15，当前交易日尚未结束
  ];
  const progress=chartProgressValues(points,"5d","America/New_York",null,"COMEX",true);
  assert.equal(progress[0],0);
  assert.equal(progress[1],1/3);
  assert.equal(progress[2],1/3);
  assert.ok(progress[3]>.8&&progress[3]<.85);
  assert.ok(progress[3]<1);
});

test("当日缺少夜盘时从首个真实交易点起画并保留收盘前空间",()=>{
  const session={start:Date.parse("2026-07-05T09:00:00Z"),end:Date.parse("2026-07-06T08:35:00Z")};
  const points=[[Date.parse("2026-07-06T01:05:00Z"),100],[Date.parse("2026-07-06T02:00:00Z"),101]];
  const progress=chartProgressValues(points,"1d","Asia/Singapore",session,"SGX",true);
  assert.equal(progress[0],0);
  assert.ok(progress[1]>0&&progress[1]<1);
});

test("近五日把相邻期货会话的休市间隔压缩到同一边界",()=>{
  const points=[
    [Date.parse("2026-07-05T22:00:00Z"),100],
    [Date.parse("2026-07-06T20:30:00Z"),101],
    [Date.parse("2026-07-06T22:00:00Z"),102],
    [Date.parse("2026-07-07T20:30:00Z"),103]
  ];
  const progress=chartProgressValues(points,"5d","America/New_York",null,"COMEX");
  assert.equal(progress[0],0);
  assert.equal(progress[1],progress[2]);
  assert.equal(progress.at(-1),1);
});

test("近五日分钟图压缩休市后仍保持连续",()=>{
  const intraday=[[Date.parse("2026-07-01T13:30:00Z"),1],[Date.parse("2026-07-01T14:00:00Z"),2],[Date.parse("2026-07-02T13:30:00Z"),3],[Date.parse("2026-07-02T14:00:00Z"),4]];
  assert.deepEqual(chartSegmentIndexes(intraday,"5d","America/New_York","NASDAQ"),[[0,1,2,3]]);
  const daily=intraday.filter((_,index)=>index%2===0);
  assert.deepEqual(chartSegmentIndexes(daily,"5d","America/New_York","NASDAQ"),[[0,1]]);
});

test("近五日只有每日收盘点时首点仍贴齐左边",()=>{
  const at=(day,hour,minute)=>Date.UTC(2026,5,day,hour-8,minute),points=[[at(29,15,0),100],[at(30,15,0),101],[at(31,15,0),102],[at(32,15,0),103],[at(33,10,30),104]];
  const session={start:at(33,9,30),end:at(33,15,0)},progress=chartProgressValues(points,"5d","Asia/Shanghai",session,"SSE",true);
  assert.equal(progress[0],0);assert.ok(progress.at(-1)<1);assert.ok(progress.at(-1)>.8);
});

test("A50 近五日首个点晚于夜盘开盘时不留左侧空白",()=>{
  const points=[];for(let day=29;day<=33;day++)points.push([Date.UTC(2026,5,day,1),100+day]);
  points[points.length-1][0]=Date.UTC(2026,6,3,2,30);
  const session={start:Date.UTC(2026,6,2,9),end:Date.UTC(2026,6,3,8,35)},progress=chartProgressValues(points,"5d","Asia/Singapore",session,"SGX",true);
  assert.equal(progress[0],0);assert.ok(progress.at(-1)<1);
});

test("非周线周期仍完整铺满横轴",()=>{
  assert.deepEqual(chartProgressValues([[1,1],[2,2],[3,3]],"1mo","UTC"),[0,.5,1]);
});

test("A 股当日按完整交易时段留白并压缩午休",()=>{
  const at=(hour,minute)=>Date.UTC(2026,6,2,hour-8,minute);
  const session={start:at(9,30),end:at(15,0)};
  const points=[[at(9,30),100],[at(10,0),101],[at(11,30),102],[at(13,0),103],[at(14,0),104]];
  const progress=chartProgressValues(points,"1d","Asia/Shanghai",session,"SSE");
  assert.deepEqual(progress,[0,.125,.5,.5,.75]);
  assert.ok(progress.at(-1)<1);
});

test("无午休市场的当日图也按开收盘时间预留空间",()=>{
  const start=Date.parse("2026-07-01T13:30:00Z"),end=Date.parse("2026-07-01T20:00:00Z");
  const progress=chartProgressValues([[start,100],[start+60*60*1000,101]],"1d","America/New_York",{start,end},"NASDAQ");
  assert.equal(progress[0],0);
  assert.ok(Math.abs(progress[1]-1/6.5)<1e-12);
});

test("A50 期货当日横轴跨夜并压缩凌晨休市",()=>{
  const start=Date.parse("2026-07-01T09:00:00Z"),end=Date.parse("2026-07-02T08:35:00Z");
  const at=value=>Date.parse(value),points=[[start,100],[at("2026-07-01T21:15:00Z"),101],[at("2026-07-02T01:00:00Z"),102],[at("2026-07-02T02:00:00Z"),103]];
  const progress=chartProgressValues(points,"1d","Asia/Singapore",{start,end},"SGX");
  assert.equal(progress[0],0);assert.equal(progress[1],progress[2]);assert.ok(progress.at(-1)>progress[2]);assert.ok(progress.at(-1)<1);
});

test("所有时间标签统一转换为北京时间",()=>{
  const timestamp=Date.parse("2026-07-01T13:30:00Z");
  assert.equal(rangeTimeLabel(timestamp),"07/01 21:30");
});

test("美股交易时段跨时区转为北京时间且处理夏令时",()=>{
  const session=marketSessionForTime(Date.parse("2026-07-02T14:00:00Z"),"America/New_York","NASDAQ");
  assert.equal(rangeTimeLabel(session.start),"07/02 21:30");
  assert.equal(rangeTimeLabel(session.end),"07/03 04:00");
});

test("月年视图的当日临时点会为收盘前剩余时间留白",()=>{
  const at=(hour,minute)=>Date.UTC(2026,6,2,hour-8,minute),session={start:at(9,30),end:at(15,0)};
  const points=Array.from({length:20},(_,index)=>[Date.UTC(2026,5,3+index,7),100+index]);points[points.length-1][0]=at(10,30);
  const progress=chartProgressValues(points,"1mo","Asia/Shanghai",session,"SSE",true);
  assert.equal(progress[0],0);assert.ok(progress.at(-1)<.98);assert.ok(progress.at(-1)>.9);
});
