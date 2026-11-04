import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrialRunner } from "@/components/trial/TrialRunner";
import { isTrialId } from "@/lib/trial/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aidit｜學生試用", robots: { index: false, follow: false } };

/** 受試者操作的頁面。連結由主持人在後台產生 */
export default async function TrialSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isTrialId(id)) notFound();
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <span className="brand-mark">Aidit 學生試用</span>
        </div>
      </header>
      <div className="trial-wide">
        <TrialRunner id={id} />
      </div>
    </>
  );
}
