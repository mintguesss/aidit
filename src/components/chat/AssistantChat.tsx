"use client";

import { ChatPanel } from "./ChatPanel";

const TIPS = [
  "我還差多少學分？",
  "超修可以流用嗎？",
  "資料探勘什麼時候開？",
  "抵免要怎麼申請？",
  "我想提前一學期畢業",
  "待確認事項是什麼？",
];

/**
 * B 介面：修業問答（docs/CONVERSATION.md §2）。
 *
 * 它是路由器，不是問答機：收到問題先分類，再決定呼叫什麼能力，
 * 用引擎結果組織回答。不允許直接生成答案。
 */
export function AssistantChat({
  fixture,
  term,
  planHref,
  scenarioHref,
  rulepackHref,
  stamp,
}: {
  fixture: string;
  term: string;
  planHref: string;
  scenarioHref: string;
  rulepackHref: string;
  stamp?: string;
}) {
  return (
    <ChatPanel
      title="修業問答"
      stamp={stamp}
      hint="先分類，再交給對應的能力；回答只有「決定／不確定／超出範圍」三種"
      scope="ask"
      fixture={fixture}
      term={term}
      planHref={planHref}
      rulepackHref={rulepackHref}
      placeholder="例如：我還差多少學分？超修可以流用嗎？"
      tips={TIPS}
      intro="問吧。問題會先分類，再交給對應的能力處理；查不到就說查不到。"
      guide={
        <>
          <p>
            這裡是引擎的第二個入口，不是聊天機器人：問題會先被分類，再交給對應的能力處理，
            回答由查到的結果組成。課表的逐輪調整請到 <a href={planHref}>選課建議</a> 頁；
            要逐項比對的假設也可以到 <a href={scenarioHref}>情境試算</a> 頁用表單設定。
          </p>
          <p>
            <b>會怎麼處理你的問題</b>
          </p>
          <ul>
            <li>你的審查結果 —— 呼叫審查引擎，數字直接來自引擎</li>
            <li>規定是什麼 —— 查課程規劃表與學則，<b>必附條文出處</b></li>
            <li>開課資訊 —— 查開課資料庫（時段、教師、餘額、先修）</li>
            <li>怎麼辦理 —— 查流程並指向承辦單位</li>
            <li>改條件重算 —— 重跑引擎，例如提前畢業、停修某課</li>
            <li>要排課表 —— 導向「選課建議」頁</li>
          </ul>
          <p>
            <b>查不到就說查不到。</b>
            規則包與公告庫裡沒有的規定，系統不會用「一般大學的作法」補上去。
          </p>
          <p>
            <b>不回答</b>　成績預測、被當機率、教師評價、代為選課或送件、
            法律醫療心理建議、他校事務、其他學生的資料。
          </p>
        </>
      }
    />
  );
}
