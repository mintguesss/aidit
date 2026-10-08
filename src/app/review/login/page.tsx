import { ReviewLogin } from "@/components/trace/ReviewLogin";
import { ReviewTopbar } from "@/components/trace/ReviewTopbar";

export const dynamic = "force-dynamic";

/** 校對登入（lib/review/auth.ts）。登入後回到原本要去的頁面 */
export default async function ReviewLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // 只接受站內的校對頁路徑，不做任意跳轉
  const target = next && /^\/review(\/[\w-]+)?$/.test(next) ? next : "/review";
  return (
    <>
      <ReviewTopbar />
      <div className="abort" style={{ maxWidth: 460 }}>
        <ReviewLogin next={target} />
      </div>
    </>
  );
}
