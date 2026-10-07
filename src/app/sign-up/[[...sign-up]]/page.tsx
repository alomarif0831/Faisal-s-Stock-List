import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import { SignedInBounce } from "@/components/session-resync";

export default function Page() {
  return (
    <div className="flex justify-center py-10">
      <Suspense>
        <SignedInBounce />
      </Suspense>
      <SignUp forceRedirectUrl="/account?welcome=1" />
    </div>
  );
}
