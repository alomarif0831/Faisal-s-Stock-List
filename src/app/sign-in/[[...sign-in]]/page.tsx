import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { MembersPitch } from "@/components/members-pitch";
import { SignedInBounce } from "@/components/session-resync";

export default function Page() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-10 lg:flex-row lg:items-start lg:gap-16">
      <MembersPitch />
      <Suspense>
        <SignedInBounce />
      </Suspense>
      <SignIn fallbackRedirectUrl="/" />
    </div>
  );
}
