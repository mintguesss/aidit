import { describe, it, expect } from "vitest";
import { parseOutline, outlineUrl } from "@/lib/offerings/outline";

/** 課程大綱（TODO C6）：學校大綱系統的回應整理成課綱頁要的形狀 */
const info = {
  obj: "The course aims to provide ...\r\nprocess management.",
  preCourse: "程式設計概論",
  book: "Operating System Concepts, 10th",
  refBook: "",
  // 學校回應裡有老師的電話與信箱；不收
  contact: "02-0000-0000",
  email: "someone@example.edu.tw",
};
const cp = { weeklyCP: [{ cweek: 1, unit: "Overview", theme: "Overview" }, { cweek: 2, unit: "Process", theme: "" }] };
const methods = [
  { mType: 1, methodsDetails: [{ methodName: "講述", percent: 50 }, { methodName: "個案研究", percent: 0 }] },
  { mType: 2, methodsDetails: [{ methodName: "期中考", percent: 35 }, { methodName: "期末考", percent: 65 }] },
];

describe("課程大綱", () => {
  const o = parseOutline(info, cp, methods, "https://example/")!;

  it("整理出教學目標、先修、教科書、每週進度", () => {
    expect(o.objective).toBe("The course aims to provide ...\nprocess management.");
    expect(o.prerequisite).toBe("程式設計概論");
    expect(o.weeks).toEqual([{ week: 1, topic: "Overview" }, { week: 2, topic: "Process" }]);
  });

  it("教學方法與評分只列有比重的", () => {
    expect(o.teaching).toEqual([{ name: "講述", percent: 50 }]);
    expect(o.grading).toEqual([{ name: "期中考", percent: 35 }, { name: "期末考", percent: 65 }]);
  });

  it("不收老師的聯絡資料", () => {
    expect(JSON.stringify(o)).not.toContain("example.edu.tw");
    expect(JSON.stringify(o)).not.toContain("02-0000");
  });

  it("老師還沒填（什麼都沒有）→ 當作沒有大綱", () => {
    expect(parseOutline({}, { weeklyCP: [] }, [], "u")).toBeNull();
  });

  it("學校大綱頁的網址", () => {
    expect(outlineUrl({ outline: { id: 709899, tchNo: "x" } })).toBe(
      "https://outline.fju.edu.tw/#/outlineSearch/outlineView/709899/1028",
    );
    expect(outlineUrl({})).toBeNull();
  });
});
