import type { Citation } from "@/lib/types";

/**
 * 學校層級的雙主修、輔系辦法（輔大教務處），拆成一條一條給修業問答與情境試算引用。
 *
 * 規則包管的是「本系畢業要修什麼」；雙主修、輔系的申請時間、學分下限、免修、延畢是全校共用的辦法，
 * 不屬於任何一個系的規則包，所以另外放。原文在 corpus/fju-double-major.txt、fju-minor.txt，
 * 每一條的 quote 都逐字取自原文（citation.verify 會回查）。
 *
 * keys：問題裡出現這些字就引用這一條；都沒對到時用 main 那一條回答。
 */

export type ProgramKind = "雙主修" | "輔系";

export type ProgramClause = {
  program: ProgramKind;
  locator: string;
  /** 白話的一句話，回答用 */
  text: string;
  quote: string;
  keys: RegExp;
  main?: true;
};

type ProgramDoc = { docId: string; title: string; url: string; publishedAt: string; corpusFile: string };

export const PROGRAM_DOCS: Record<string, Record<ProgramKind, ProgramDoc>> = {
  fju: {
    雙主修: {
      docId: "fju-double-major",
      title: "輔仁大學學生修讀雙主修辦法",
      url: "http://docs.academic.fju.edu.tw/edulaw/學生修讀雙主修辦法.pdf",
      publishedAt: "2025-11-27",
      corpusFile: "fju-double-major.txt",
    },
    輔系: {
      docId: "fju-minor",
      title: "輔仁大學學生修讀輔系辦法",
      url: "http://docs.academic.fju.edu.tw/edulaw/學生修讀輔系辦法.pdf",
      publishedAt: "2025-11-27",
      corpusFile: "fju-minor.txt",
    },
  },
};

export const PROGRAM_CLAUSES: Record<string, ProgramClause[]> = {
  fju: [
    {
      program: "雙主修",
      locator: "第二條",
      text: "學士班學生從一年級下學期到四年級下學期（不含延長修業年限）都可以申請其他學系為雙主修。",
      quote: "自第一學年第二學期起至第四學年第二學期止（不包括延長修業年限），得申請其他學系學士班為雙主修",
      keys: /什麼時候|幾年級|大[一二三四]|時間|資格|可以申請|能申請|能不能|可不可以/,
    },
    {
      program: "雙主修",
      locator: "第三條",
      text: "要在教務處公告的申請期間內申請，逾期不受理。",
      quote: "應在規定期間內依教務處公告申請，逾期不予受理",
      keys: /怎麼申請|如何申請|申請流程|去哪|期限|截止/,
    },
    {
      program: "雙主修",
      locator: "第五條",
      text: "除了修滿本系最低畢業學分，還要修滿雙主修學系全部專業必修科目，且不少於 40 學分；雙主修的學分不能算進本系畢業學分。",
      quote: "並應實際修滿雙主修學系全部專業（門）必修科目學分，且不得少於四十學分。雙主修學分不得認定為主系畢業學分。",
      keys: /學分|幾學分|多少|要修什麼|要修哪|條件|規定|差在哪|差別|不同|抵|算進|畢業學分/,
      main: true,
    },
    {
      program: "雙主修",
      locator: "第六條",
      text: "要修的科目依開始修讀那一年、該系入學生的必修科目表；跟本系相同或高度相似的課可以申請免修，由雙主修學系主任認定。",
      quote: "雙主修學系與其主學系科目相同或高度相似之課程得辦理免修",
      keys: /哪一年|哪一版|科目表|免修|抵免|抵|相同|一樣的課|重複/,
    },
    {
      program: "雙主修",
      locator: "第十條",
      text: "修業年限內沒修完，要在延長修業年限內修完或申請放棄；已達本系畢業資格、卻沒在期限內申請延長的，視同放棄雙主修。",
      quote: "應於延長修業年限內修畢或申請放棄修讀",
      keys: /延畢|延長|修不完|來不及|放棄|會不會延/,
    },
    {
      program: "雙主修",
      locator: "第十二條",
      text: "放棄雙主修時，加修的必修如果已達輔系規定，經輔系系主任認可可以改給輔系資格。",
      quote: "其加修他系必修科目學分已達輔系規定必修科目學分，經輔系系主任認可，得核給輔系資格",
      keys: /放棄|改成輔系|轉成輔系|改輔系/,
    },
    {
      program: "輔系",
      locator: "第二條",
      text: "學士班學生從一年級下學期到四年級下學期（不含延長修業年限）都可以申請其他學系為輔系。",
      quote: "自第一學年第二學期起至第四學年第二學期止（不包括延長修業年限），得申請其他學系學士班為輔系",
      keys: /什麼時候|幾年級|大[一二三四]|時間|資格|可以申請|能申請|能不能|可不可以/,
    },
    {
      program: "輔系",
      locator: "第六條",
      text: "要在教務處公告的申請期間內申請，逾期不受理。",
      quote: "學生選修輔系應在規定期間內依教務處公告申請，逾期不予受理",
      keys: /怎麼申請|如何申請|申請流程|去哪|期限|截止/,
    },
    {
      program: "輔系",
      locator: "第四條",
      text: "至少要修畢輔系的專業必修 20 學分，而且是在本系最低畢業學分以外另外加修。",
      quote: "至少應修畢輔系專業（門）必修科目二十學分",
      keys: /學分|幾學分|多少|要修什麼|要修哪|條件|規定|差在哪|差別|不同|算進|畢業學分/,
      main: true,
    },
    {
      program: "輔系",
      locator: "第十二條",
      text: "輔系的專業科目如果跟本系的專業科目相同，不能算輔系學分，要經輔系系主任同意另選其他輔系科目補足。",
      quote: "各輔系專業（門）科目如與主系專業（門）科目相同時，不得計算為輔系學分",
      keys: /相同|一樣的課|重複|抵|免修/,
    },
    {
      program: "輔系",
      locator: "第九條",
      text: "修業年限內沒修完，要在延長修業年限內修完或申請放棄；已達本系畢業資格、卻沒在期限內申請延長的，視同放棄輔系。",
      quote: "應於延長修業年限內修畢或申請放棄修讀",
      keys: /延畢|延長|修不完|來不及|放棄|會不會延/,
    },
  ],
};

/** 問題講到的雙主修／輔系條文。沒有特別對到哪一條時回該辦法的主要條文 */
export function programClausesFor(school: string, text: string): { clause: ProgramClause; citation: Citation }[] {
  const clauses = PROGRAM_CLAUSES[school] ?? [];
  const docs = PROGRAM_DOCS[school];
  if (!docs) return [];
  const kinds = (["雙主修", "輔系"] as ProgramKind[]).filter((k) => (k === "雙主修" ? /雙主修|雙學位/ : /輔系|輔修/).test(text));
  const out: ProgramClause[] = [];
  for (const k of kinds) {
    const mine = clauses.filter((c) => c.program === k);
    const hit = mine.filter((c) => c.keys.test(text));
    out.push(...(hit.length > 0 ? hit : mine.filter((c) => c.main)));
  }
  return out.map((clause) => {
    const doc = docs[clause.program];
    return {
      clause,
      citation: { docId: doc.docId, docTitle: doc.title, locator: clause.locator, quote: clause.quote, url: doc.url, publishedAt: doc.publishedAt },
    };
  });
}
